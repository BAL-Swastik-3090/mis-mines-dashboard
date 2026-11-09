"use client";

/**
 * The workshop's queue.
 *
 * ── WHY IT IS NOT SORTED BY DATE ─────────────────────────────────────────────
 * Blocking machines first, then severity, then age. A queue sorted by date
 * alone buries a locked machine under a fortnight of cabin lights, and the
 * whole point of this screen is that somebody opening it at six in the morning
 * sees what is stopping work before anything else.
 *
 * ── WHAT THE SCREEN REFUSES TO DO ────────────────────────────────────────────
 * It will not offer *Verify* to the person who recorded the repair. The server
 * refuses it and the database refuses it, but a button that is offered and then
 * rejected teaches people the system is broken rather than that the rule
 * exists — so the button says why instead.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronLeft, Clock, Eye, Loader2, Lock, Wrench, X,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";

type State = "RAISED" | "ACKNOWLEDGED" | "RECTIFIED" | "VERIFIED" | "CLOSED" | "CANCELLED";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface Defect {
  defect_id: number;
  defect_ref: string;
  state: State;
  severity: Severity;
  blocks_operation: boolean;
  item_label: string;
  description: string;
  owner_role: string | null;
  raised_by: string;
  raised_at: string;
  acknowledged_at: string | null;
  rectified_by: string | null;
  rectified_at: string | null;
  rectification_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  closed_at: string | null;
  cancel_reason: string | null;
  asset_id: number;
  fleet_code: string;
  asset_type_name: string;
  age_days: number;
  sightings: number;
  last_seen_at: string | null;
  machine_state: string | null;
}

interface Sighting {
  sighting_id: number;
  observed_by: string | null;
  observed_at: string;
  answer: string | null;
  numeric_value: number | null;
  remark: string | null;
  session_ref: string | null;
}
interface Event {
  from_state: State | null;
  to_state: State;
  actor: string;
  at: string;
  note: string | null;
}
interface Detail extends Defect { sightings_list?: Sighting[]; events?: Event[] }

const SEVERITY_STYLE: Record<Severity, string> = {
  LOW: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const STATE_STYLE: Record<State, string> = {
  RAISED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  ACKNOWLEDGED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  RECTIFIED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  VERIFIED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  CLOSED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/** What a person may do from here, in the words they would use. */
const NEXT: Record<State, { to: State; label: string; needsNote?: string }[]> = {
  RAISED: [{ to: "ACKNOWLEDGED", label: "Accept it" },
           { to: "CANCELLED", label: "Cancel", needsNote: "Why is it being cancelled?" }],
  ACKNOWLEDGED: [{ to: "RECTIFIED", label: "Mark repaired", needsNote: "What was done?" },
                 { to: "CANCELLED", label: "Cancel", needsNote: "Why is it being cancelled?" }],
  RECTIFIED: [{ to: "VERIFIED", label: "Verify the repair" },
              { to: "ACKNOWLEDGED", label: "Repair did not hold", needsNote: "What is still wrong?" }],
  VERIFIED: [{ to: "CLOSED", label: "Close" },
             { to: "ACKNOWLEDGED", label: "Reopen", needsNote: "Why is it being reopened?" }],
  CLOSED: [],
  CANCELLED: [],
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

export default function HotoDefectsSection() {
  const me = useAuth((s) => s.user?.emp_id ?? null);

  const [rows, setRows] = useState<Defect[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [openOnly, setOpenOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/hoto/defects", { params: { open_only: openOnly } });
      const got: Defect[] = r.data.defects ?? [];
      setRows(got);
      setError(null);
      return got;
    } catch (e: any) {
      setError([e?.response?.data?.detail ?? "Could not load the defect queue."]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [openOnly]);

  useEffect(() => { void load(); }, [load]);

  /* The queue row and the detail answer different halves of the question.
     `detail` has the sightings and the trail but no age, no machine state and
     no sighting count; the queue row has those three and nothing else new. So
     the screen merges them rather than asking the server to repeat itself. */
  const open = useCallback(async (row: Defect) => {
    try {
      const r = await api.get(`/hoto/defects/${row.defect_id}`);
      setDetail({
        ...row,
        ...r.data,
        sightings: row.sightings,            // the count, not the list
        sightings_list: r.data.sightings ?? [],
        events: r.data.events ?? [],
        age_days: row.age_days,
        machine_state: row.machine_state,
      });
    } catch {
      setError(["Could not open that defect."]);
    }
  }, []);

  const move = useCallback(async (id: number, to: State, note?: string) => {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/hoto/defects/${id}/transition`, { to_state: to, note });
      const fresh = await load();
      const row = fresh.find((x) => x.defect_id === id);
      if (detail) {
        // A defect that just closed leaves the open queue, so there is no row
        // to merge any more -- fall back to the one on screen.
        await open(row ?? detail);
      }
      if (r.data.machine_released) {
        setError([`Machine released — ${r.data.machine_released.reason}`]);
      }
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setError(Array.isArray(d?.problems) ? d.problems : [d?.message ?? d ?? "Refused."]);
    } finally {
      setBusy(false);
    }
  }, [load, detail, open]);

  const held = useMemo(() => {
    const byMachine = new Map<string, number>();
    for (const r of rows) {
      if (r.blocks_operation && r.machine_state === "LOCKED") {
        byMachine.set(r.fleet_code, (byMachine.get(r.fleet_code) ?? 0) + 1);
      }
    }
    return byMachine;
  }, [rows]);

  if (detail) {
    return <DetailView d={detail} me={me} busy={busy} onBack={() => setDetail(null)}
                       onMove={move} error={error} clearError={() => setError(null)} />;
  }

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Defects</h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-prose">
            What a handover found, from raising to a verified repair. Machines
            that cannot work are at the top.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={!openOnly}
                 onChange={(e) => setOpenOnly(!e.target.checked)} />
          Include closed
        </label>
      </header>

      {held.size > 0 && (
        <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2">
          <div className="flex items-start gap-2">
            <Lock size={14} className="text-red-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-red-900 dark:text-red-200">
              <strong>
                {held.size} machine{held.size === 1 ? "" : "s"} cannot go to work:
              </strong>{" "}
              {[...held.entries()].map(([code, n]) => `${code} (${n})`).join(", ")}.
              {" "}A machine is released only when every blocking defect against it
              has been verified.
            </p>
          </div>
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
          <Loader2 size={13} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No open defects. Every machine that has been handed over is clear.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Reference</th>
                <th className="text-left px-2 py-1.5 font-medium">Machine</th>
                <th className="text-left px-2 py-1.5 font-medium">What is wrong</th>
                <th className="text-right px-2 py-1.5 font-medium">Open</th>
                <th className="text-right px-2 py-1.5 font-medium">Seen</th>
                <th className="text-left px-2 py-1.5 font-medium">Severity</th>
                <th className="text-left px-2 py-1.5 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.defect_id} onClick={() => void open(r)}
                    className="hover:bg-muted/40 cursor-pointer">
                  <td className="px-2 py-1.5 font-mono text-[10px] whitespace-nowrap">
                    {r.defect_ref}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {r.blocks_operation && r.machine_state === "LOCKED" && (
                        <Lock size={11} className="text-red-600" aria-label="machine locked" />
                      )}
                      {r.fleet_code}
                      <span className="text-[10px] text-muted-foreground">{r.asset_type_name}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {r.item_label}
                    {r.description && r.description !== r.item_label && (
                      <span className="text-[10px] text-muted-foreground italic"> — {r.description}</span>
                    )}
                  </td>
                  {/* The number the morning meeting asks for. */}
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                    <span className={r.age_days >= 7 ? "text-red-700 dark:text-red-300 font-medium" : ""}>
                      {r.age_days}d
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title="How many handovers have reported it">
                    {r.sightings}×
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${SEVERITY_STYLE[r.severity]}`}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATE_STYLE[r.state]}`}>
                      {r.state}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── one defect ────────────────────────────────────────────────────────────── */

function DetailView({ d, me, busy, onBack, onMove, error, clearError }: {
  d: Detail; me: string | null; busy: boolean;
  onBack: () => void;
  onMove: (id: number, to: State, note?: string) => Promise<void>;
  error: string[] | null; clearError: () => void;
}) {
  const [pending, setPending] = useState<{ to: State; prompt: string } | null>(null);
  const [note, setNote] = useState("");

  /* The server and the database both refuse this. Saying so on the button is
     better than letting somebody press it and be told off. */
  const selfVerify = d.state === "RECTIFIED" && me != null && d.rectified_by === me;

  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft size={13} /> Back to the queue
      </button>

      <header className="rounded border border-border p-3 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold font-mono">{d.defect_ref}</h2>
            <p className="text-xs mt-0.5">
              {d.item_label} on <strong>{d.fleet_code}</strong>
              <span className="text-muted-foreground"> ({d.asset_type_name})</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] px-2 py-1 rounded ${SEVERITY_STYLE[d.severity]}`}>
              {d.severity}
            </span>
            <span className={`text-[10px] px-2 py-1 rounded ${STATE_STYLE[d.state]}`}>
              {d.state}
            </span>
          </div>
        </div>

        {d.blocks_operation && d.state !== "CLOSED" && d.state !== "CANCELLED" && (
          <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-2.5 py-2 flex items-start gap-2">
            <Lock size={13} className="text-red-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-red-900 dark:text-red-200">
              <strong>This holds the machine.</strong> It is released when every
              blocking defect against {d.fleet_code} has been verified — not when
              this one is accepted, and not when the handover is closed.
            </p>
          </div>
        )}

        <p className="text-[11px]">{d.description}</p>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px] border-t border-border pt-2">
          <F label="Raised by" value={`${d.raised_by} · ${fmt(d.raised_at)}`} />
          <F label="Open for" value={`${d.age_days} days`} />
          <F label="Reported" value={`${d.sightings} time${d.sightings === 1 ? "" : "s"}`} />
          <F label="Machine state" value={d.machine_state} />
          <F label="Accepted" value={d.acknowledged_at ? fmt(d.acknowledged_at) : null} />
          <F label="Repaired by" value={d.rectified_by
            ? `${d.rectified_by} · ${d.rectified_at ? fmt(d.rectified_at) : ""}` : null} />
          <F label="Verified by" value={d.verified_by
            ? `${d.verified_by} · ${d.verified_at ? fmt(d.verified_at) : ""}` : null} />
          <F label="Owner" value={d.owner_role} />
        </dl>

        {d.rectification_note && (
          <p className="text-[11px] border-t border-border pt-2">
            <span className="text-muted-foreground">What was done: </span>{d.rectification_note}
          </p>
        )}
      </header>

      {error && (
        <div className="rounded border border-border bg-muted/50 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="text-[11px] space-y-0.5">{error.map((p, i) => <p key={i}>{p}</p>)}</div>
          <button onClick={clearError} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {/* ── what can be done next ─────────────────────────────────────────── */}
      {NEXT[d.state].length > 0 && (
        <section className="rounded border border-border p-3 space-y-2">
          <h3 className="text-xs font-semibold">What happens next</h3>

          {selfVerify && (
            <p className="text-[11px] text-amber-800 dark:text-amber-200">
              You recorded this repair, so somebody else has to verify it.
              Verification is independent or it is not verification.
            </p>
          )}

          {pending ? (
            <div className="space-y-1.5">
              <label className="block text-[11px] text-muted-foreground">{pending.prompt}</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                        className="w-full text-xs px-2 py-1 rounded border border-border bg-background" />
              <div className="flex items-center gap-1.5">
                <button disabled={busy || !note.trim()}
                        onClick={async () => {
                          await onMove(d.defect_id, pending.to, note);
                          setPending(null); setNote("");
                        }}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-foreground text-background disabled:opacity-40">
                  <Check size={12} /> Confirm
                </button>
                <button onClick={() => { setPending(null); setNote(""); }}
                        className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {NEXT[d.state].map((n) => {
                const blocked = n.to === "VERIFIED" && selfVerify;
                return (
                  <button
                    key={n.to}
                    disabled={busy || blocked}
                    title={blocked ? "You recorded the repair — somebody else must verify it" : undefined}
                    onClick={() => n.needsNote
                      ? setPending({ to: n.to, prompt: n.needsNote })
                      : void onMove(d.defect_id, n.to)}
                    className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border
                                hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed
                                ${n.to === "VERIFIED" ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700" : ""}`}
                  >
                    {n.to === "RECTIFIED" ? <Wrench size={12} />
                      : n.to === "VERIFIED" ? <Eye size={12} /> : null}
                    {n.label}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── every time it was seen ────────────────────────────────────────── */}
      {d.sightings_list && d.sightings_list.length > 0 && (
        <section className="rounded border border-border">
          <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">
            Reported {d.sightings_list.length} time{d.sightings_list.length === 1 ? "" : "s"}
          </h3>
          <ul className="divide-y divide-border">
            {d.sightings_list.map((s) => (
              <li key={s.sighting_id} className="px-3 py-1.5 flex items-start gap-2 text-[11px]">
                <Clock size={11} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-muted-foreground">{fmt(s.observed_at)}</span>
                  {s.session_ref && <span className="font-mono text-[10px] ml-1.5">{s.session_ref}</span>}
                  {s.remark && <p className="italic text-muted-foreground">“{s.remark}”</p>}
                </div>
                <span className="shrink-0">
                  {s.numeric_value ?? (s.answer ?? "").replace(/_/g, " ").toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── the trail ─────────────────────────────────────────────────────── */}
      {d.events && d.events.length > 0 && (
        <section className="rounded border border-border">
          <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">History</h3>
          <ul className="divide-y divide-border">
            {d.events.map((e, i) => (
              <li key={i} className="px-3 py-1.5 text-[11px] flex items-start gap-2">
                <span className="text-muted-foreground shrink-0 w-28">{fmt(e.at)}</span>
                <span className="shrink-0">
                  {e.from_state ? `${e.from_state} → ` : ""}<strong>{e.to_state}</strong>
                </span>
                <span className="text-muted-foreground">by {e.actor}</span>
                {e.note && <span className="italic text-muted-foreground">— {e.note}</span>}
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
