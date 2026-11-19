"use client";

/**
 * The Shift HOTO Board — what a supervisor looks at before a shift goes out.
 *
 * ── WHY THE EMPTY ROWS ARE THE POINT ─────────────────────────────────────────
 * Every active machine appears, including the ones nobody filled anything in
 * for. Those are the rows that matter most and the ones a list of handovers
 * cannot contain, so the board starts from the fleet and attaches whatever
 * handover exists — often none.
 *
 * ── WHY THERE IS NO COMPLIANCE PERCENTAGE ────────────────────────────────────
 * What a missing handover counts as is not settled (scope §9, question 2), and
 * a machine sitting in the workshop has no handover because it is in the
 * workshop. So the four cases are counted separately and named, rather than
 * divided into a number whose denominator nobody agreed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronLeft, Clock, FileWarning, Loader2, Lock,
  ShieldAlert, Wrench, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import Explainer from "@/components/hoto/Explainer";
import { useHotoFocus } from "@/contexts/useHotoFocus";
import ShiftProgress from "@/components/hoto/ShiftProgress";

type MachineState =
  | "AVAILABLE" | "RUNNING" | "CAUTION" | "RESTRICTED"
  | "BREAKDOWN" | "UNDER_MAINTENANCE" | "LOCKED";
type Handover = "captured" | "not_captured" | "not_expected" | "no_checklist";

interface Machine {
  asset_id: number;
  fleet_code: string;
  asset_type_name: string;
  plant_name: string | null;
  current_reading: number | null;
  reading_uom: string | null;
  machine_state: MachineState;
  machine_state_reason: string | null;
  machine_state_since: string | null;
  machine_state_by: string | null;
  has_checklist: boolean;
  handover: Handover;
  session_id: number | null;
  session_ref: string | null;
  session_type: string | null;
  session_status: string | null;
  captured_at: string | null;
  captured_offline: boolean | null;
  operator_emp_id: string | null;
  operator_name: string | null;
  meter_reading: number | null;
  blocked_reason: string | null;
  last_handover_ever: string | null;
  open_defects: number;
  blocking_defects: number;
  serious_defects: number;
  awaiting_verification: number;
  worst_open_severity: string | null;
  implied_state: MachineState;
  understated: boolean;
  needs_attention: boolean;
}

interface Shift {
  shift_id: number | null;
  code: string;
  name: string;
  production_day: string;
  starts_at: string;
  ends_at: string;
}

interface Board {
  shift: Shift;
  machines: Machine[];
  count: number;
  needs_attention: number;
  tally: Record<string, number>;
  compliance_note: string;
}

const STATE_STYLE: Record<MachineState, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  RUNNING: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  CAUTION: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  RESTRICTED: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  BREAKDOWN: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  UNDER_MAINTENANCE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  LOCKED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

/** The four cases, in the mine's own words rather than the API's. */
const HANDOVER_LABEL: Record<Handover, string> = {
  captured: "Handed over",
  not_captured: "Nobody filled it in",
  not_expected: "Already off work",
  no_checklist: "No checklist published",
};
const HANDOVER_STYLE: Record<Handover, string> = {
  captured: "text-emerald-700 dark:text-emerald-300",
  not_captured: "text-red-700 dark:text-red-300",
  not_expected: "text-muted-foreground",
  no_checklist: "text-amber-700 dark:text-amber-300",
};

/* What a person may set, grouped by what it does to the machine. Order is
   deliberate: the things that stop a machine come first, because they are the
   ones somebody reaches for in a hurry. */
const STOP_STATES: { to: MachineState; label: string }[] = [
  { to: "BREAKDOWN", label: "Breakdown" },
  { to: "UNDER_MAINTENANCE", label: "To the workshop" },
  { to: "LOCKED", label: "Lock it" },
];
const WORK_STATES: { to: MachineState; label: string }[] = [
  { to: "RESTRICTED", label: "Limited operation" },
  { to: "CAUTION", label: "Run with caution" },
  { to: "AVAILABLE", label: "Approve for work" },
];

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }) : "—";

const timeOnly = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }) : "—";

export default function HotoBoardSection() {
  const canOverride = useAuth((s) => s.user?.permissions?.includes("hoto.override") ?? false);

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(true);
  const goTo = useHotoFocus((st) => st.goTo);
  const [picked, setPicked] = useState<Machine | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/hoto/board");
      setBoard(r.data);
      setError(null);
      return r.data as Board;
    } catch (e: any) {
      setError([e?.response?.data?.detail ?? "Could not load the board."]);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* HOW FAR THROUGH THE SHIFT WE ARE.
     A handover missing at 06:10 is normal; the same one missing at 13:50 is a
     shift that was never signed for. The board read identically at both,
     which is why "61 not filled in" could not be acted on -- the reader could
     not tell urgency from earliness. Recomputed on a timer so a board left
     open on a wall does not freeze at the moment it was loaded. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const clock = useMemo(() => {
    if (!board) return null;
    const start = Date.parse(board.shift.starts_at);
    const end = Date.parse(board.shift.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const through = Math.min(1, Math.max(0, (now - start) / (end - start)));
    const leftMs = end - now;
    return {
      through,
      elapsed: Math.max(0, now - start),
      // Negative when the shift has ended, which the caller words differently.
      leftMs,
      over: leftMs <= 0,
    };
  }, [board, now]);

  /* THE TALLY NEEDS A HISTORY TO BE JUDGED BY. 61 not filled in is a bad
     shift or a rollout that never happened, and those call for opposite
     actions. Without the last week beside it nobody can tell which. */
  const [trend, setTrend] = useState<{ day: string; filed: number; machines: number }[]>([]);
  useEffect(() => {
    api.get("/hoto/board/trend", { params: { days: 7 } })
      .then((r) => setTrend(r.data.days ?? []))
      .catch(() => { /* the board stands without it */ });
  }, []);

  const rows = useMemo(() => {
    if (!board) return [];
    return attentionOnly ? board.machines.filter((m) => m.needs_attention) : board.machines;
  }, [board, attentionOnly]);

  /* GROUPED BY MACHINE TYPE. Seventy-four flat rows hide the one pattern that
     matters: "every drill is missing" is a different problem from "fourteen
     scattered machines are missing", and as a flat list the two look the
     same. Types with something wrong come first, then by size. */
  const groups = useMemo(() => {
    const by = new Map<string, Machine[]>();
    for (const m of rows) {
      const k = m.asset_type_name ?? "Other";
      by.set(k, [...(by.get(k) ?? []), m]);
    }
    return [...by.entries()]
      .map(([name, list]) => ({
        name, list,
        missing: list.filter((m) => m.handover === "not_captured").length,
        attention: list.filter((m) => m.needs_attention).length,
      }))
      .sort((a, b) => b.attention - a.attention || b.list.length - a.list.length
                      || a.name.localeCompare(b.name));
  }, [rows]);

  if (picked) {
    return <Decide m={picked} canOverride={canOverride}
                   onBack={() => setPicked(null)}
                   onDone={async (msg) => {
                     const fresh = await load();
                     setNotice(msg);
                     const again = fresh?.machines.find((x) => x.asset_id === picked.asset_id);
                     setPicked(again ?? null);
                   }} />;
  }

  const t = board?.tally ?? {};



  return (
    <div className="p-4 space-y-3">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-1.5">
            Shift Board
            {board?.compliance_note && (
              <Explainer>{board.compliance_note}</Explainer>
            )}
          </h2>
          {board && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {board.shift.name} · production day {board.shift.production_day} ·{" "}
              {timeOnly(board.shift.starts_at)}–{timeOnly(board.shift.ends_at)} ·{" "}
              {board.count} machines
            </p>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={attentionOnly}
                 onChange={(e) => setAttentionOnly(e.target.checked)} />
          Only what needs attention
          {board && <span className="text-muted-foreground">({board.needs_attention})</span>}
        </label>
      </header>

      {/* The four cases, counted separately and never divided into each other. */}
      {board && (
        <ShiftProgress
          clock={clock}
          trend={trend}
          startsAt={board.shift.starts_at}
          endsAt={board.shift.ends_at}
        />
      )}

      {board && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tally label="Handed over" n={t.captured ?? 0} tone="good" />
          <Tally label="Nobody filled it in" n={t.not_captured ?? 0} tone="bad" />
          <Tally label="Already off work" n={t.not_expected ?? 0} tone="muted" />
          <Tally label="No checklist published" n={t.no_checklist ?? 0} tone="warn" />
        </div>
      )}

      {notice && (
        <div className="rounded border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 px-3 py-2 flex items-start gap-2">
          <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-[11px] text-emerald-900 dark:text-emerald-200">{notice}</p>
          <button onClick={() => setNotice(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {error && (
        <div className="rounded border border-border bg-muted/50 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="text-[11px] space-y-0.5">{error.map((p, i) => <p key={i}>{p}</p>)}</div>
          <button onClick={() => setError(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" /> Loading the shift…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {attentionOnly
            ? "Nothing on the board needs attention this shift."
            : "No active machines."}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Machine</th>
                <th className="text-left px-2 py-1.5 font-medium">State</th>
                <th className="text-left px-2 py-1.5 font-medium">This shift</th>
                <th className="text-left px-2 py-1.5 font-medium">Operator</th>
                <th className="text-right px-2 py-1.5 font-medium">Open</th>
                <th className="text-left px-2 py-1.5 font-medium">Flags</th>
                <th className="text-right px-2 py-1.5 font-medium">Go to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map((g) => [
                /* A heading per machine type, carrying the count that makes
                   the group worth opening. Rendered as a row rather than a
                   separate table so every column stays in one grid. */
                <tr key={`h-${g.name}`} className="bg-muted/60">
                  <td colSpan={7} className="px-2 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide">
                      {g.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-2">
                      {g.list.length} machine{g.list.length === 1 ? "" : "s"}
                      {g.missing > 0 && (
                        <span className="text-red-700 dark:text-red-300 ml-1.5">
                          · {g.missing} with nobody signed on
                        </span>
                      )}
                    </span>
                  </td>
                </tr>,
                ...g.list.map((m) => (
                <tr key={m.asset_id} onClick={() => setPicked(m)}
                    className="hover:bg-muted/40 cursor-pointer">
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="font-medium">{m.fleet_code}</span>{" "}
                    <span className="text-[10px] text-muted-foreground">{m.asset_type_name}</span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATE_STYLE[m.machine_state]}`}>
                      {m.machine_state.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${HANDOVER_STYLE[m.handover]}`}>
                    {m.handover === "captured" && m.captured_at
                      ? <>{timeOnly(m.captured_at)}{" "}
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {m.session_ref}
                          </span></>
                      : <>
                          {HANDOVER_LABEL[m.handover]}
                          {/* HOW LATE, not just that it is missing. The same
                              words ten minutes in and forty minutes from the
                              end describe a normal shift and a shift that
                              will end unsigned. */}
                          {m.handover === "not_captured" && clock && (
                            <span className="text-[10px] text-muted-foreground ml-1.5">
                              {clock.over
                                ? "· shift over"
                                : `· ${Math.round(clock.through * 100)}% through`}
                            </span>
                          )}
                        </>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {m.operator_name ?? (m.operator_emp_id ?? "—")}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {m.open_defects || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {m.blocking_defects > 0 && (
                        <span title={`${m.blocking_defects} defect(s) hold this machine`}>
                          <Lock size={11} className="text-red-600" />
                        </span>
                      )}
                      {m.understated && (
                        <span title={`Working more freely than its defects allow — should be ${m.implied_state}`}>
                          <ShieldAlert size={11} className="text-red-600" />
                        </span>
                      )}
                      {m.awaiting_verification > 0 && (
                        <span title={`${m.awaiting_verification} repair(s) awaiting an independent check`}>
                          <Wrench size={11} className="text-sky-600" />
                        </span>
                      )}
                      {m.session_status === "BLOCKED" && (
                        <span title="The handover itself was blocked">
                          <FileWarning size={11} className="text-amber-600" />
                        </span>
                      )}
                    </span>
                  </td>

                  {/* OUT OF THE BOARD AND INTO THE RECORD. Until now a foreman
                      who saw something here read the machine name off the
                      screen, opened the register by hand, set the dates and
                      searched for it. The board is where a problem is noticed;
                      it should also be where it is followed.

                      stopPropagation because the row itself opens the machine
                      panel -- without it one click would do two things. */}
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <span className="inline-flex gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          goTo("hoto-register", {
                            assetId: m.asset_id, fleetCode: m.fleet_code,
                            onDate: board?.shift.production_day,
                            because: m.fleet_code,
                          });
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-border
                                   text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        Register
                      </button>
                      {m.open_defects > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            goTo("hoto-defects", {
                              assetId: m.asset_id, fleetCode: m.fleet_code,
                              because: m.fleet_code,
                            });
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border
                                     text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          Defects
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tally({ label, n, tone }: {
  label: string; n: number; tone: "good" | "bad" | "warn" | "muted";
}) {
  const colour = {
    good: "text-emerald-700 dark:text-emerald-300",
    bad: n > 0 ? "text-red-700 dark:text-red-300" : "text-muted-foreground",
    warn: n > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className="rounded border border-border px-2.5 py-1.5">
      <div className={`text-lg font-semibold tabular-nums leading-none ${colour}`}>{n}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

/* ── one machine ───────────────────────────────────────────────────────────── */

function Decide({ m, canOverride, onBack, onDone }: {
  m: Machine; canOverride: boolean;
  onBack: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [pending, setPending] = useState<MachineState | null>(null);
  const [reason, setReason] = useState("");
  const [events, setEvents] = useState<any[] | null>(null);

  useEffect(() => {
    void api.get(`/hoto/board/${m.asset_id}/history`)
      .then((r) => setEvents(r.data.events))
      .catch(() => setEvents([]));
  }, [m.asset_id]);

  /* Which targets would put the machine back to work more freely than its own
     open defects allow. Mirrors WORK_PERMITTED on the server — the server is
     the authority, this only decides what to warn about before asking. */
  const permits: Record<MachineState, number> = {
    AVAILABLE: 3, RUNNING: 3, CAUTION: 2, RESTRICTED: 1,
    BREAKDOWN: 0, UNDER_MAINTENANCE: 0, LOCKED: 0,
  };
  const isOverride = (to: MachineState) => permits[to] > permits[m.implied_state];

  const send = async (to: MachineState, why: string) => {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/hoto/board/${m.asset_id}/state`,
                               { state: to, reason: why || undefined });
      setPending(null); setReason("");
      await onDone(
        r.data.changed
          ? `${r.data.fleet_code} is now ${to.replace(/_/g, " ")}` +
            (r.data.override ? " — recorded as an override." : ".")
          : r.data.message);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setError(Array.isArray(d?.problems) ? d.problems : [d?.message ?? d ?? "Refused."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft size={13} /> Back to the board
      </button>

      <header className="rounded border border-border p-3 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold">{m.fleet_code}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {m.asset_type_name}{m.plant_name ? ` · ${m.plant_name}` : ""}
            </p>
          </div>
          <span className={`text-[10px] px-2 py-1 rounded ${STATE_STYLE[m.machine_state]}`}>
            {m.machine_state.replace(/_/g, " ")}
          </span>
        </div>

        {m.understated && (
          <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-2.5 py-2 flex items-start gap-2">
            <ShieldAlert size={13} className="text-red-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-red-900 dark:text-red-200">
              <strong>This machine is working more freely than its defects allow.</strong>{" "}
              Its open defects say it should be{" "}
              {m.implied_state.replace(/_/g, " ")}. Either that was a deliberate
              call or somebody forgot — the state history below says which.
            </p>
          </div>
        )}

        {m.handover === "not_captured" && (
          <div className="rounded border border-border bg-muted/50 px-2.5 py-2 flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <p className="text-[11px]">
              No handover was filed for this machine this shift. It was last
              handed over {m.last_handover_ever ? fmt(m.last_handover_ever) : "never"}.
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px] border-t border-border pt-2">
          <F label="This shift" value={HANDOVER_LABEL[m.handover]} />
          <F label="Handover" value={m.session_ref} />
          <F label="Captured" value={m.captured_at
            ? `${fmt(m.captured_at)}${m.captured_offline ? " (offline)" : ""}` : null} />
          <F label="Operator" value={m.operator_name ?? m.operator_emp_id} />
          <F label="Open defects" value={String(m.open_defects)} />
          <F label="Holding the machine" value={String(m.blocking_defects)} />
          <F label="Awaiting verification" value={String(m.awaiting_verification)} />
          <F label="Defects say it should be" value={m.implied_state.replace(/_/g, " ")} />
          <F label="Meter" value={m.meter_reading != null
            ? `${m.meter_reading} ${m.reading_uom ?? ""}`.trim()
            : (m.current_reading != null
               ? `${m.current_reading} ${m.reading_uom ?? ""} (last known)`.trim() : null)} />
          <F label="State set by" value={m.machine_state_by} />
          <F label="State since" value={fmt(m.machine_state_since)} />
          <F label="Last handed over" value={fmt(m.last_handover_ever)} />
        </dl>

        {m.machine_state_reason && (
          <p className="text-[11px] border-t border-border pt-2">
            <span className="text-muted-foreground">Why it is in this state: </span>
            {m.machine_state_reason}
          </p>
        )}
        {m.blocked_reason && (
          <p className="text-[11px]">
            <span className="text-muted-foreground">The handover was blocked: </span>
            {m.blocked_reason}
          </p>
        )}
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
          <div className="text-[11px] text-red-900 dark:text-red-200 space-y-0.5">
            {error.map((p, i) => <p key={i}>{p}</p>)}
          </div>
          <button onClick={() => setError(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {/* ── the decision ──────────────────────────────────────────────────── */}
      <section className="rounded border border-border p-3 space-y-2.5">
        <h3 className="text-xs font-semibold">This machine, this shift</h3>

        {pending ? (
          <div className="space-y-1.5">
            <label className="block text-[11px]">
              {isOverride(pending) ? (
                <span className="text-red-700 dark:text-red-300">
                  Say why {m.fleet_code} is being put back to work when its open
                  defects say it should be {m.implied_state.replace(/_/g, " ")}.
                  This is recorded as an override against your name.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Why is it being set to {pending.replace(/_/g, " ")}?
                </span>
              )}
            </label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                      className="w-full text-xs px-2 py-1 rounded border border-border bg-background" />
            <div className="flex items-center gap-1.5">
              <button
                disabled={busy || (isOverride(pending) && !reason.trim())}
                onClick={() => void send(pending, reason)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-foreground text-background disabled:opacity-40">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Confirm
              </button>
              <button onClick={() => { setPending(null); setReason(""); setError(null); }}
                      className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Stop it
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {STOP_STATES.map((o) => (
                  <button key={o.to} disabled={busy || m.machine_state === o.to}
                          onClick={() => setPending(o.to)}
                          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40">
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 border-t border-border pt-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Put it to work
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {WORK_STATES.map((o) => {
                  const over = isOverride(o.to);
                  const blocked = over && !canOverride;
                  return (
                    <button
                      key={o.to}
                      disabled={busy || blocked || m.machine_state === o.to}
                      title={blocked
                        ? `${m.fleet_code} should be ${m.implied_state.replace(/_/g, " ")} while its defects are open — releasing it needs the HOTO override permission`
                        : over ? "This counts as an override and will be recorded" : undefined}
                      onClick={() => setPending(o.to)}
                      className={`text-[11px] px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed
                        ${over
                          ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                          : "border-border hover:bg-muted"}`}>
                      {o.label}{over ? " (override)" : ""}
                    </button>
                  );
                })}
              </div>
              {m.understated === false && m.implied_state !== "AVAILABLE" && !canOverride && (
                <p className="text-[10px] text-muted-foreground">
                  Putting this machine back to work needs the HOTO override
                  permission, because {m.worst_open_severity?.toLowerCase()} defects
                  are open against it.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── how it got here ───────────────────────────────────────────────── */}
      {events && events.length > 0 && (
        <section className="rounded border border-border">
          <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">
            State history
          </h3>
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.availability_event_id} className="px-3 py-1.5 text-[11px] flex items-start gap-2">
                <Clock size={11} className="text-muted-foreground mt-0.5 shrink-0" />
                <span className="text-muted-foreground shrink-0 w-28">{fmt(e.started_at)}</span>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                  STATE_STYLE[e.state as MachineState] ?? ""}`}>
                  {String(e.state).replace(/_/g, " ")}
                </span>
                <span className="min-w-0 flex-1">
                  {e.reason?.startsWith("OVERRIDE:") && (
                    <strong className="text-red-700 dark:text-red-300">Override — </strong>
                  )}
                  {e.reason?.replace(/^OVERRIDE:\s*/, "")}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {e.recorded_by ?? e.source}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function F({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}
