"use client";

/**
 * The HOTO register — the record, not a dashboard.
 *
 * This is the screen that gets opened when there is an argument: which machine,
 * who signed for it, when, what they found, and what was done. So it reads
 * chronologically and completely rather than summarising, and the detail shows
 * the checklist **as it was answered** — the labels, ranges and severities
 * stored with each response, not today's version of the item.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Camera, Check, Minus, ChevronLeft, CloudOff, Loader2, MapPin, MapPinOff, Filter, Search, TrendingDown, X,
} from "lucide-react";
import api from "@/lib/api";

/**
 * A number, whatever the API felt like sending.
 *
 * Postgres numeric reaches JSON as a string unless something converts it, and
 * a screen that called .toFixed() on a latitude crashed the whole detail page
 * on the first handover that had one. The server now converts them; this is
 * here so that the next column nobody remembers to add to that list costs a
 * missing line instead of a blank screen.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
import { HotoPhotos } from "@/components/hoto/HotoPhotos";
import Explainer from "@/components/hoto/Explainer";
import { useHotoFocus } from "@/contexts/useHotoFocus";
import { useDateFilter } from "@/contexts/useDateFilter";

type Status = "DRAFT" | "SUBMITTED" | "BLOCKED" | "ACCEPTED" | "REJECTED" | "CANCELLED";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface Row {
  session_id: number;
  session_ref: string;
  session_type: string;
  sequence_no: number;
  status: Status;
  captured_at: string;
  received_at: string;
  captured_offline: boolean;
  sync_delay_minutes: number | null;
  /* Sent by the API since the register was written and never declared here,
     so nothing could link out to a machine by anything but its printed code. */
  asset_id: number;
  shift_code?: string | null;
  production_day?: string | null;
  bulk_answered?: boolean;
  captured_lat?: number | null;
  captured_lon?: number | null;
  gps_accuracy_m?: number | null;
  confirmed_at?: string | null;
  confirmed_by: string | null;
  blocked_reason: string | null;
  reject_reason: string | null;
  meter_reading: number | null;
  meter_uom: string | null;
  fuel_level: number | null;
  gps_status: string | null;
  fleet_code: string;
  asset_type_name: string;
  operator_name: string | null;
  operator_emp_id: string | null;
  location_name: string | null;
  device_code: string | null;
  device_profile: string | null;
  adverse_count: number;
  worst_severity: Severity | null;
  answer_count: number;
  photo_count: number;
  template_version: number | null;
}

interface Answer {
  response_id: number;
  item_label: string;
  response_type: string;
  answer: string | null;
  numeric_value: number | null;
  in_range: boolean | null;
  severity: Severity | null;
  remark: string | null;
  photo_count: number;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  is_critical: boolean | null;
  is_adverse: boolean;
}
interface Detail extends Row {
  template_name: string | null;
  counterpart_ref: string | null;
  counterpart_type: string | null;
  counterpart_status: string | null;
  /* Migration 115: everyone in the handover. A null other side that is not
     stated absent means NOT RECORDED -- every record filed before it -- and is
     never shown as "nobody". */
  operator_id: number | null;
  counterpart_operator_id: number | null;
  counterpart_emp_id: string | null;
  counterpart_absent: boolean;
  counterpart_name: string | null;
  recorded_by_operator_id: number | null;
  recorded_by_emp_id: string | null;
  recorded_by_name: string | null;
  counterpart_captured_at: string | null;
  counterpart_session_operator_id: number | null;
  counterpart_session_operator_name: string | null;
  /** Who the OTHER half names as being on this side. */
  counterpart_session_named_id: number | null;
  remarks: string | null;
  sections: { name: string; answers: Answer[] }[];
  adverse: Answer[];
}

const STATUS_STYLE: Record<Status, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  SUBMITTED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  BLOCKED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  ACCEPTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REJECTED: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const SEVERITY_STYLE: Record<Severity, string> = {
  LOW: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const TYPE_LABEL: Record<string, string> = {
  START_HANDOVER: "Taking over",
  MID_SHIFT: "Mid-shift",
  END_HANDOVER: "Handing over",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

/** What the answer actually was, printed the way the record should read. */
function answerText(a: Answer): string {
  if (a.numeric_value != null) return `${a.numeric_value}${a.unit ? ` ${a.unit}` : ""}`;
  return (a.answer ?? "—").replace(/_/g, " ").toLowerCase();
}

function rangeText(a: Answer): string | null {
  if (a.min_value == null && a.max_value == null) return null;
  const u = a.unit ? ` ${a.unit}` : "";
  if (a.min_value != null && a.max_value != null) return `${a.min_value}–${a.max_value}${u}`;
  return a.min_value != null ? `≥ ${a.min_value}${u}` : `≤ ${a.max_value}${u}`;
}

export default function HotoRegisterSection() {
  /**
   * A WEEK, not today.
   *
   * Both dates defaulted to today, so the register opened empty on any day
   * nobody had yet filed a handover -- and said "An empty register is not the
   * same as a clean one", which is true and, there, actively misleading: the
   * records existed, yesterday. Somebody opening this screen for the first
   * time was told the system had nothing in it while it held twenty-six
   * handovers.
   *
   * A week back is what a supervisor is actually asking about ("has this
   * machine been handed over properly lately"), and it is wide enough that an
   * empty answer means something.
   */
  /* THE RANGE COMES FROM THE HEADER, not from here.
   *
   * This screen used to keep its own From/To, so the header could say
   * "1 Nov - 13 Nov" while the register said "06-11 - 13-11" directly beneath
   * it. Two date controls on one screen, each claiming to be the filter, and
   * no way for a reader to know which one the rows obeyed. Thirteen other
   * sections already follow the header; this one now does too.
   *
   * The local inputs stay, because "this machine, last three days" is a real
   * question and the header's period picker answers it badly. They are an
   * OVERRIDE, and the screen says so -- an override nobody can see is how you
   * get back to two filters disagreeing.
   */
  const { apiFrom, apiTo } = useDateFilter();
  const [override, setOverride] = useState<{ from: string; to: string } | null>(null);
  const from = override?.from ?? apiFrom;
  const to   = override?.to   ?? apiTo;
  const setFrom = (v: string) => setOverride({ from: v, to });
  const setTo   = (v: string) => setOverride({ from, to: v });

  const [onlyAdverse, setOnlyAdverse] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");

  /* ARRIVING FROM ANOTHER SCREEN. A link from the shift board or a defect
     carries the machine it is about, and the date that machine's row sits on
     -- the commonest way a link lands on an empty screen is a default range
     that does not include the thing the link points at.

     Taken once and cleared: a filter that arrived by a link describes this
     journey, not a preference, and one that survived would leave somebody
     next week staring at a register narrowed to a machine for no reason they
     can see. Hence the banner too -- a narrowed screen must say so, or it
     looks like a screen that has lost its data. */
  const goTo = useHotoFocus((st) => st.goTo);
  const [arrivedFor, setArrivedFor] = useState<string | null>(null);
  useEffect(() => {
    const f = useHotoFocus.getState().take();
    if (!f) return;
    if (f.fleetCode) setQ(f.fleetCode);
    if (f.onDate) {
      if (f.onDate < from) setFrom(f.onDate);
      if (f.onDate > to) setTo(f.onDate);
    }
    if (f.sessionId) void open(f.sessionId);
    setArrivedFor(f.because ?? f.fleetCode ?? null);
    // Deliberately on mount only: this is a handoff, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/hoto/register", {
        params: {
          from_date: from, to_date: to,
          only_adverse: onlyAdverse || undefined,
          status: statusFilter || undefined,
        },
      });
      setRows(r.data.sessions ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Could not load the register.");
    } finally {
      setLoading(false);
    }
  }, [from, to, onlyAdverse, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const open = useCallback(async (id: number) => {
    setDetail(null);
    try {
      const r = await api.get(`/hoto/register/${id}`);
      setDetail(r.data);
    } catch {
      setError("Could not open that handover.");
    }
  }, []);

  /* Filtered in the browser: the server already narrowed by date and status,
     and a machine or operator name is the thing somebody types while looking
     at the list rather than before loading it. */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.fleet_code, r.operator_name, r.operator_emp_id, r.session_ref]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)));
  }, [rows, q]);

  const blocked = rows.filter((r) => r.status === "BLOCKED").length;

  /* A METER THAT RUNS BACKWARDS. Across consecutive handovers of ONE machine
     the reading can only rise: an hour meter does not unwind. BD-80-15306
     currently reads 8335, 8339, 8334, 8328 on successive handovers, which is
     either a typed digit or a handover filed against the wrong machine -- and
     the second is the failure that makes the right machine look checked.
     Nothing in the system was looking, because each row is correct on its own
     and only the sequence is wrong. */
  const wentBackwards = useMemo(() => {
    const bad = new Set<number>();
    const byMachine = new Map<number, Row[]>();
    for (const r of rows) {
      if (r.meter_reading == null) continue;
      const list = byMachine.get(r.asset_id) ?? [];
      list.push(r);
      byMachine.set(r.asset_id, list);
    }
    for (const list of byMachine.values()) {
      // Oldest first, whatever order the table is sorted in.
      const seq = [...list].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
      for (let i = 1; i < seq.length; i++) {
        if (Number(seq[i]!.meter_reading) < Number(seq[i - 1]!.meter_reading)) {
          bad.add(seq[i]!.session_id);
        }
      }
    }
    return bad;
  }, [rows]);

  if (detail) {
    return <DetailView d={detail} onBack={() => setDetail(null)} />;
  }

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-1.5">
            HOTO register
            <Explainer>
              Every handover as it was recorded — who signed for the machine,
              what they found, and what the checklist said at the time. A row
              is never rewritten when a checklist later changes: it keeps the
              version that was actually answered.
            </Explainer>
          </h2>
        </div>
        {blocked > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
            <AlertTriangle size={12} />
            {blocked} machine{blocked === 1 ? "" : "s"} blocked in this period
          </div>
        )}
      </header>

      {arrivedFor && (
        <div className="flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded
                        border border-sky-200 bg-sky-50 text-sky-900
                        dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <Filter size={12} className="shrink-0" />
          <span>Narrowed to <strong>{arrivedFor}</strong>.</span>
          <button
            onClick={() => { setQ(""); setArrivedFor(null); }}
            className="ml-auto underline hover:no-underline"
          >
            Show everything
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-[11px]">
          <span className="block text-muted-foreground mb-0.5">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 className="px-1.5 py-1 rounded border border-border bg-background" />
        </label>
        <label className="text-[11px]">
          <span className="block text-muted-foreground mb-0.5">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 className="px-1.5 py-1 rounded border border-border bg-background" />
        </label>
        <label className="text-[11px]">
          <span className="block text-muted-foreground mb-0.5">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-1.5 py-1 rounded border border-border bg-background">
            <option value="">Any</option>
            {(Object.keys(STATUS_STYLE) as Status[]).map((s) =>
              <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {override && (
          <button
            onClick={() => setOverride(null)}
            className="text-[10px] px-2 py-1 mb-px rounded border border-amber-300
                       bg-amber-50 text-amber-900 hover:bg-amber-100
                       dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            title="The dates above no longer match the range in the header"
          >
            Custom range — follow the dashboard again
          </button>
        )}
        <label className="flex items-center gap-1.5 text-[11px] pb-1"
               title="A register of clean handovers is long and says nothing — this is usually what you want">
          <input type="checkbox" checked={onlyAdverse}
                 onChange={(e) => setOnlyAdverse(e.target.checked)} />
          Only where something was found
        </label>
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="machine, operator, reference"
                 className="text-[11px] pl-7 pr-2 py-1 rounded border border-border bg-background w-56" />
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-[11px] text-red-900 dark:text-red-200">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-600"><X size={13} /></button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && shown.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No handovers recorded between {from} and {to}.{" "}
          <span className="text-amber-700 dark:text-amber-300">
            An empty register is not the same as a clean one — it may mean nobody
            filled anything in.
          </span>
        </p>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Reference</th>
                <th className="text-left px-2 py-1.5 font-medium">Machine</th>
                <th className="text-left px-2 py-1.5 font-medium">What</th>
                {/* Recorded since migration 113 and shown only in the detail
                    panel until now, though it is the second thing anybody
                    filters by after the date. */}
                <th className="text-left px-2 py-1.5 font-medium">Shift</th>
                <th className="text-left px-2 py-1.5 font-medium">Operator</th>
                <th className="text-left px-2 py-1.5 font-medium">Captured</th>
                <th className="text-right px-2 py-1.5 font-medium">Meter</th>
                <th className="text-right px-2 py-1.5 font-medium">Fuel</th>
                <th className="text-left px-2 py-1.5 font-medium">Found</th>
                <th className="text-left px-2 py-1.5 font-medium">Status</th>
                <th className="text-right px-2 py-1.5 font-medium">Go to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.session_id}
                    onClick={() => void open(r.session_id)}
                    className="hover:bg-muted/40 cursor-pointer">
                  <td className="px-2 py-1.5 font-mono text-[10px] whitespace-nowrap">
                    {r.session_ref}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.fleet_code}
                    <span className="text-[10px] text-muted-foreground ml-1">{r.asset_type_name}</span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {TYPE_LABEL[r.session_type] ?? r.session_type}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.shift_code
                      ? <>
                          <span className="font-medium">{r.shift_code}</span>
                          {r.production_day && (
                            <span className="text-[10px] text-muted-foreground ml-1">
                              {r.production_day.slice(5)}
                            </span>
                          )}
                        </>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.operator_name ?? r.operator_emp_id ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {fmt(r.captured_at)}
                      {/* The gap between the device clock and ours. A handover
                          that arrived six hours later is a normal offline
                          capture, but the reader should see it rather than
                          infer it. */}
                      {r.captured_offline && (
                        <CloudOff size={11} className="text-muted-foreground"
                                  aria-label="captured offline" />
                      )}
                      {r.sync_delay_minutes != null && r.sync_delay_minutes > 60 && (
                        <span className="text-[9px] text-amber-700 dark:text-amber-300">
                          +{Math.round(r.sync_delay_minutes / 60)}h
                        </span>
                      )}
                      {r.gps_status && r.gps_status !== "OK" && (
                        <MapPinOff size={11} className="text-amber-600"
                                   aria-label={`GPS ${r.gps_status}`} />
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                    {r.meter_reading != null ? (
                      <span className={`inline-flex items-center gap-1 ${
                        wentBackwards.has(r.session_id)
                          ? "text-red-700 dark:text-red-300 font-medium" : ""}`}>
                        {wentBackwards.has(r.session_id) && (
                          <TrendingDown
                            size={11}
                            aria-label="lower than this machine's previous handover"
                          />
                        )}
                        {r.meter_reading}{r.meter_uom ? ` ${r.meter_uom}` : ""}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.fuel_level != null ? `${r.fuel_level}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.adverse_count === 0 ? (
                      <span className="text-muted-foreground">nothing</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span>{r.adverse_count} of {r.answer_count}</span>
                        {r.worst_severity && (
                          <span className={`text-[9px] px-1 py-0.5 rounded ${SEVERITY_STYLE[r.worst_severity]}`}>
                            {r.worst_severity}
                          </span>
                        )}
                        {r.photo_count > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                            <Camera size={9} />{r.photo_count}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        goTo("hoto-defects", {
                          assetId: r.asset_id, fleetCode: r.fleet_code,
                          because: r.fleet_code,
                        });
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border
                                 text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      Defects
                    </button>
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

/* ── one handover, in full ─────────────────────────────────────────────────── */

function DetailView({ d, onBack }: { d: Detail; onBack: () => void }) {
  return (
    <div className="p-4 space-y-3">
      <button onClick={onBack}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft size={13} /> Back to the register
      </button>

      <header className="rounded border border-border p-3 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold font-mono">{d.session_ref}</h2>
            <p className="text-xs mt-0.5">
              {d.fleet_code} <span className="text-muted-foreground">({d.asset_type_name})</span>
              {" · "}{TYPE_LABEL[d.session_type] ?? d.session_type}
              {d.sequence_no > 1 && <span className="text-muted-foreground"> #{d.sequence_no}</span>}
            </p>
          </div>
          <span className={`text-[10px] px-2 py-1 rounded ${STATUS_STYLE[d.status]}`}>
            {d.status}
          </span>
        </div>

        {d.blocked_reason && (
          <div className="rounded border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-2.5 py-2">
            <p className="text-[11px] text-red-900 dark:text-red-200">
              <strong>The machine did not change hands.</strong> {d.blocked_reason}
            </p>
          </div>
        )}
        {d.reject_reason && (
          <div className="rounded border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/40 px-2.5 py-2">
            <p className="text-[11px] text-orange-900 dark:text-orange-200">
              <strong>Refused by the incoming operator.</strong> {d.reject_reason}
            </p>
          </div>
        )}

        <People d={d} />

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px]">
          <Field label="Confirmed by" value={
            d.confirmed_by
              ? `${d.confirmed_by}${d.confirmed_at ? ` · ${fmt(d.confirmed_at)}` : ""}`
              : null} />
          {/* WHICH SHIFT, resolved from the device's own clock when the record
              was filed rather than from whoever is reading it now. */}
          <Field label="Shift" value={d.shift_code
            ? `${d.shift_code}${d.production_day ? ` · ${d.production_day}` : ""}` : null} />
          <Field label="Captured" value={
            `${fmt(d.captured_at)}${d.captured_offline ? " (no signal)" : ""}`} />
          <Field label="Reached the server" value={
            d.sync_delay_minutes != null && d.sync_delay_minutes > 2
              ? `${fmt(d.received_at)} (+${d.sync_delay_minutes} min)`
              : fmt(d.received_at)} />
          <Field label="Meter" value={d.meter_reading != null
            ? `${d.meter_reading}${d.meter_uom ? ` ${d.meter_uom}` : ""}` : null} />
          <Field label="Fuel" value={d.fuel_level != null ? `${d.fuel_level}%` : null} />
          <Field label="Location" value={d.location_name} />
          <Field label="Device" value={d.device_code
            ? `${d.device_code}${d.device_profile ? ` (${d.device_profile.toLowerCase()})` : ""}`
            : null} />
          {/* The version it ANSWERED, which is why the labels below may differ
              from the checklist as it stands today. */}
          <Field label="Checklist" value={d.template_name
            ? `${d.template_name} v${d.template_version}` : null} />
          {/* Where it was signed, not merely whether a fix was had. */}
          <Field label="Where" value={
            num(d.captured_lat) != null && num(d.captured_lon) != null
              ? `${num(d.captured_lat)!.toFixed(5)}, ${num(d.captured_lon)!.toFixed(5)}`
              : (d.gps_status ?? null)} />
        </dl>

        {/* HOW IT WAS ANSWERED. A record filled with one tap is otherwise
            indistinguishable from a walk-round, and the whole reason that flag
            is stored is so a supervisor can tell. */}
        {d.bulk_answered && (
          <p className="text-[11px] rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 dark:border-amber-800 dark:bg-amber-950/30">
            The routine checks on this handover were answered together with one
            action. The checks that can stop the machine were answered
            individually.
          </p>
        )}

        {num(d.captured_lat) != null && num(d.captured_lon) != null && (
          <a href={`https://www.google.com/maps?q=${d.captured_lat},${d.captured_lon}`}
             target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline dark:text-sky-300">
            <MapPin size={11} /> Where this handover was signed
            {num(d.gps_accuracy_m) != null && ` (±${Math.round(num(d.gps_accuracy_m)!)} m)`}
          </a>
        )}

        {d.remarks && (
          <p className="text-[11px] border-t border-border pt-2">
            <span className="text-muted-foreground">Remarks: </span>{d.remarks}
          </p>
        )}
      </header>

      {/* ── the photographs ───────────────────────────────────────────────
          The endpoints have existed since phase 11 and nothing called them,
          so every photograph an operator took reached the office and nobody
          could look at it. */}
      <section className="rounded border border-border p-3 space-y-2">
        <h3 className="text-xs font-semibold flex items-center gap-1.5">
          <Camera size={13} /> Photographs
        </h3>
        <HotoPhotos sessionId={d.session_id} />
      </section>

      {/* The section somebody opened this page for. It used to be bordered
          and headed exactly like the photographs and the full checklist
          below it, so the one part that says a machine may be unsafe had no
          more weight on the page than a list of file sizes. */}
      {d.adverse.length > 0 && (
        <section className="rounded border border-red-300 dark:border-red-900 overflow-hidden">
          <h3 className="px-3 py-2 text-xs font-semibold border-b border-red-300
                         dark:border-red-900 bg-red-50 dark:bg-red-950/40
                         text-red-900 dark:text-red-200
                         flex items-center gap-1.5">
            <AlertTriangle size={13} className="shrink-0" />
            What was found
            <span className="font-normal opacity-80">
              — {d.adverse.length} of {d.answer_count} checks
            </span>
          </h3>
          <ul className="divide-y divide-border">
            {d.adverse.map((a) => <AnswerRow key={a.response_id} a={a} emphasise />)}
          </ul>
        </section>
      )}

      {/* ── the walk-round, in the order it was walked ──────────────────────
          Presentation matters here more than anywhere else in the module:
          this is the page somebody reads when they are deciding whether a
          machine is safe, and it used to render a pass and a fault in the
          same grey four-letter word at the same place on the line. "ok",
          "no" and "yes" all looked identical, so the reader had to know the
          wording of every question to tell which answers were good news.

          Now the state is carried by a mark at the START of the line, where
          the eye already is, and the section headings say what their section
          found instead of being a slightly greyer row. */}
      <section className="rounded border border-border overflow-hidden">
        <h3 className="px-3 py-2 text-xs font-semibold border-b border-border
                       flex items-center justify-between gap-2">
          <span>The checklist as answered</span>
          <span className="font-normal text-[10px] text-muted-foreground">
            {d.sections.reduce((n, s) => n + s.answers.length, 0)} checks
          </span>
        </h3>

        {d.sections.map((s) => {
          const found = s.answers.filter((a) => a.is_adverse).length;
          return (
            <div key={s.name}>
              <h4 className="px-3 py-2 bg-muted/60 border-y border-border
                             flex items-center gap-2 sticky top-0">
                <span className="text-[11px] font-bold uppercase tracking-[.08em]">
                  {s.name}
                </span>
                {found > 0 ? (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded
                                   bg-red-100 text-red-800
                                   dark:bg-red-900/50 dark:text-red-200">
                    {found} found
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700
                                   dark:text-emerald-400">
                    <Check size={10} /> all clear
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {s.answers.length} check{s.answers.length === 1 ? "" : "s"}
                </span>
              </h4>
              <ul className="divide-y divide-border">
                {s.answers.map((a) => <AnswerRow key={a.response_id} a={a} />)}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/* ── who was in it ───────────────────────────────────────────────────────────
   Three people, where the record used to have room for one: whose handover
   it is, the other side of it, and who held the tablet. Then the other half
   of the handover, if the server has paired one -- and a warning when the two
   halves disagree about who was there, because one of them names the wrong
   person and only somebody on site can say which. */

function People({ d }: { d: Detail }) {
  const own = TYPE_LABEL[d.session_type] ?? "Operator";
  const otherRole = d.session_type === "START_HANDOVER" ? "Handed over by"
    : d.session_type === "END_HANDOVER" ? "Handing over to" : null;

  const other = d.counterpart_name ?? d.counterpart_emp_id
    ?? (d.counterpart_absent ? "Nobody" : null);
  const otherNote = d.counterpart_absent ? "the machine was parked"
    : other == null ? "not recorded on this handover" : d.counterpart_emp_id;

  const recorderIsOperator = d.recorded_by_operator_id != null
    && d.recorded_by_operator_id === d.operator_id;
  const recorder = d.recorded_by_operator_id == null ? null
    : recorderIsOperator ? (d.operator_name ?? d.operator_emp_id)
    : (d.recorded_by_name ?? d.recorded_by_emp_id);
  const recorderNote = d.recorded_by_operator_id == null ? "not recorded on this handover"
    : recorderIsOperator ? "the operator themself" : d.recorded_by_emp_id;

  // The two halves disagree when either names somebody the other was not
  // filed by -- the same rule the server raises an exception on.
  const differs = (named: number | null, actual: number | null) =>
    named != null && actual != null && named !== actual;
  const disagree = d.counterpart_ref != null && (
    differs(d.counterpart_operator_id, d.counterpart_session_operator_id)
    || differs(d.counterpart_session_named_id, d.operator_id));

  return (
    <div className="space-y-2">
      <div className={`grid grid-cols-1 gap-2 ${otherRole ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <PersonCell role={own} name={d.operator_name ?? d.operator_emp_id}
                    note={d.operator_name ? d.operator_emp_id : null} lead />
        {otherRole && <PersonCell role={otherRole} name={other} note={otherNote} />}
        <PersonCell role="Filled in by" name={recorder} note={recorderNote} />
      </div>

      {d.counterpart_ref && (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded border px-2.5 py-1.5 text-[11px] ${
          disagree
            ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-border bg-muted/30"}`}>
          <span className="text-muted-foreground">Other half</span>
          <span className="font-mono">{d.counterpart_ref}</span>
          <span>
            {TYPE_LABEL[d.counterpart_type ?? ""] ?? d.counterpart_type}
            {d.counterpart_session_operator_name && <> by {d.counterpart_session_operator_name}</>}
            {d.counterpart_captured_at && <span className="text-muted-foreground"> · {fmt(d.counterpart_captured_at)}</span>}
          </span>
          {disagree && (
            <span className="basis-full text-amber-900 dark:text-amber-200">
              <strong>The two halves disagree about who was there.</strong> One of
              them names the wrong person, and only somebody on site can say which.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PersonCell({ role, name, note, lead }: {
  role: string; name: string | null | undefined; note?: string | null; lead?: boolean;
}) {
  return (
    <div className={`rounded border px-2.5 py-2 ${lead ? "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30" : "border-border"}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{role}</p>
      <p className={`text-xs font-semibold ${name ? "" : "text-muted-foreground font-normal italic"}`}>
        {name ?? "Not recorded"}
      </p>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function AnswerRow({ a, emphasise = false }: { a: Answer; emphasise?: boolean }) {
  /* THE STATE GOES FIRST, AND IT IS A MARK, NOT A WORD.
     "ok", "yes" and "no" were rendered identically at the right-hand end of
     the line, so whether an answer was good news depended entirely on how
     the question happened to be worded -- "Air leakage audible: no" is a
     pass and "Receiver drained: no" is a fault, and the screen drew them the
     same. The mark says which it is without the reader having to parse the
     wording. */
  const notAnswered = a.answer == null && a.numeric_value == null;

  return (
    <li className={`px-3 py-2 flex items-start gap-2.5 ${
      a.is_adverse
        ? "bg-red-50/60 dark:bg-red-950/20"
        : emphasise ? "bg-red-50/40 dark:bg-red-950/10" : ""}`}>

      <span className="mt-0.5 shrink-0">
        {notAnswered ? (
          <Minus size={13} className="text-muted-foreground/50" aria-label="not answered" />
        ) : a.is_adverse ? (
          <AlertTriangle size={13} className="text-red-600 dark:text-red-400"
                         aria-label="reported a fault" />
        ) : (
          <Check size={13} className="text-emerald-600/70 dark:text-emerald-500/70"
                 aria-label="clear" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs ${a.is_adverse ? "font-medium" : ""}`}>
            {a.item_label}
          </span>
          {a.is_critical && (
            <span
              title="A fault here stops the machine going to work"
              className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-800
                         dark:bg-red-900/40 dark:text-red-200">
              BLOCKS
            </span>
          )}
          {a.photo_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
              <Camera size={9} />{a.photo_count}
            </span>
          )}
        </div>
        {a.remark && (
          <p className="text-[10px] text-muted-foreground italic mt-0.5">“{a.remark}”</p>
        )}
      </div>

      {/* The answer itself, and for a reading the range it was judged
          against -- a number with no limits beside it is not evidence of
          anything. */}
      <div className="text-right shrink-0">
        <div className={`text-xs tabular-nums ${
          a.is_adverse
            ? "text-red-700 dark:text-red-300 font-semibold"
            : notAnswered ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
          {notAnswered ? "not answered" : answerText(a)}
        </div>
        {rangeText(a) && (
          <div className="text-[9px] text-muted-foreground">
            {a.in_range === false ? "outside " : "within "}{rangeText(a)}
          </div>
        )}
      </div>

      {a.severity && (
        <span className={`mt-0.5 text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_STYLE[a.severity]}`}>
          {a.severity}
        </span>
      )}
    </li>
  );
}
