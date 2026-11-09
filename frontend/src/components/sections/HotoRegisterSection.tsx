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
  AlertTriangle, Camera, ChevronLeft, CloudOff, Loader2, MapPinOff, Search, X,
} from "lucide-react";
import api from "@/lib/api";

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
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [onlyAdverse, setOnlyAdverse] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");

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

  if (detail) {
    return <DetailView d={detail} onBack={() => setDetail(null)} />;
  }

  return (
    <div className="p-4 space-y-3">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">HOTO register</h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-prose">
            Every handover as it was recorded — who signed for the machine, what
            they found, and what the checklist said at the time.
          </p>
        </div>
        {blocked > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
            <AlertTriangle size={12} />
            {blocked} machine{blocked === 1 ? "" : "s"} blocked in this period
          </div>
        )}
      </header>

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
          No handovers recorded for this period.{" "}
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
                <th className="text-left px-2 py-1.5 font-medium">Operator</th>
                <th className="text-left px-2 py-1.5 font-medium">Captured</th>
                <th className="text-right px-2 py-1.5 font-medium">Meter</th>
                <th className="text-right px-2 py-1.5 font-medium">Fuel</th>
                <th className="text-left px-2 py-1.5 font-medium">Found</th>
                <th className="text-left px-2 py-1.5 font-medium">Status</th>
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
                    {r.meter_reading != null
                      ? `${r.meter_reading}${r.meter_uom ? ` ${r.meter_uom}` : ""}`
                      : "—"}
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

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-[11px]">
          <Field label="Operator" value={d.operator_name ?? d.operator_emp_id} />
          <Field label="Confirmed by" value={d.confirmed_by} />
          <Field label="Captured" value={fmt(d.captured_at)} />
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
          <Field label="GPS" value={d.gps_status} />
          {d.counterpart_ref && (
            <Field label="Paired with"
                   value={`${d.counterpart_ref} (${TYPE_LABEL[d.counterpart_type ?? ""] ?? d.counterpart_type}, ${d.counterpart_status})`} />
          )}
        </dl>

        {d.remarks && (
          <p className="text-[11px] border-t border-border pt-2">
            <span className="text-muted-foreground">Remarks: </span>{d.remarks}
          </p>
        )}
      </header>

      {d.adverse.length > 0 && (
        <section className="rounded border border-border">
          <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">
            What was found — {d.adverse.length} of {d.answer_count}
          </h3>
          <ul className="divide-y divide-border">
            {d.adverse.map((a) => <AnswerRow key={a.response_id} a={a} emphasise />)}
          </ul>
        </section>
      )}

      <section className="rounded border border-border">
        <h3 className="px-3 py-2 text-xs font-semibold border-b border-border">
          The checklist as answered
        </h3>
        {d.sections.map((s) => (
          <div key={s.name}>
            <h4 className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
              {s.name}
            </h4>
            <ul className="divide-y divide-border">
              {s.answers.map((a) => <AnswerRow key={a.response_id} a={a} />)}
            </ul>
          </div>
        ))}
      </section>
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
  return (
    <li className={`px-3 py-1.5 flex items-start gap-2 ${emphasise ? "bg-red-50/40 dark:bg-red-950/10" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs">{a.item_label}</span>
          {a.is_critical && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
              BLOCKS
            </span>
          )}
        </div>
        {a.remark && (
          <p className="text-[10px] text-muted-foreground italic mt-0.5">“{a.remark}”</p>
        )}
      </div>

      <div className="text-right shrink-0">
        <div className={`text-xs tabular-nums ${a.is_adverse ? "text-red-700 dark:text-red-300 font-medium" : ""}`}>
          {answerText(a)}
        </div>
        {rangeText(a) && (
          <div className="text-[9px] text-muted-foreground">
            {a.in_range === false ? "outside " : "within "}{rangeText(a)}
          </div>
        )}
      </div>

      {a.severity && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_STYLE[a.severity]}`}>
          {a.severity}
        </span>
      )}
      {a.photo_count > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground shrink-0">
          <Camera size={9} />{a.photo_count}
        </span>
      )}
    </li>
  );
}
