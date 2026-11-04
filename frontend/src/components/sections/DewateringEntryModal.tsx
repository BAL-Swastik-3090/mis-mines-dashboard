"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Droplet, X, Loader2, AlertTriangle, Check, History, Link2,
} from "lucide-react";
import api from "@/lib/api";

/**
 * One day of the mine's dewatering sheet.
 *
 * THE FORM IS BUILT FROM THE SERVER'S FIELD LIST, not from a list typed in
 * here. The sheet has twenty-seven KPIs in a fixed order and six of them are
 * derived; a second copy of that list on the client is a copy that drifts
 * from the table it writes to the first time either changes.
 *
 * DERIVED FIGURES ARE SHOWN, NEVER TYPED. They are computed here only so the
 * closing stock moves as you type — the values actually stored are generated
 * by the database from the inputs, so what you see and what lands cannot
 * disagree for long. The grey boxes are reading material, not fields.
 *
 * OPENING STOCK IS YESTERDAY'S CLOSING, pre-filled and labelled with the day
 * it came from. It stays editable: the chain has to start somewhere, and a
 * day the mine re-measures after a survey must be able to override it.
 *
 * SAVING ONE DAY CAN MOVE MANY. Opening stock chains, so correcting the 3rd
 * moves every day after it. The screen says which days moved rather than
 * letting somebody find out later in a report.
 */

interface FieldMeta {
  field: string;
  label: string;
  uom: string;
  section: string;
  kind: "input" | "derived";
  type: "number" | "text";
}

interface DayForm {
  date: string;
  entered: boolean;
  revision: number;
  stored: Record<string, unknown> | null;
  suggested_opening: number | null;
  suggested_opening_from: string | null;
  rain_factor: number;
  fields: FieldMeta[];
  sections: { key: string; label: string }[];
}

interface Edit {
  date: string;
  field: string;
  label: string;
  action: "ADDED" | "CHANGED" | "REMOVED" | "CHAINED";
  old_value: string | null;
  new_value: string | null;
  revision: number;
  entry_id: string;
  entry_date: string | null;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function niceDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const n3 = (v: number | null) =>
  v == null || Number.isNaN(v) ? "—"
    : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function DewateringEntryModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [day, setDay] = useState(yesterday);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [chained, setChained] = useState<string[]>([]);
  const [stoppedAt, setStoppedAt] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { if (open) setDay(yesterday()); }, [open]);
  useEffect(() => {
    setTyped({}); setProblems([]); setError(null); setDone(null);
    setChained([]); setStoppedAt(null); setShowHistory(false);
  }, [day, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const q = useQuery<DayForm>({
    queryKey: ["dewatering-entry", day],
    queryFn: async () =>
      (await api.get("/dewatering-entry", { params: { data_date: day } })).data,
    enabled: open,
    staleTime: 10 * 1000,
  });

  const hist = useQuery<{ history: Edit[] }>({
    queryKey: ["dewatering-entry", "history", day],
    queryFn: async () =>
      (await api.get("/dewatering-entry/history",
        { params: { from_date: day, to_date: day, limit: 200 } })).data,
    enabled: open && showHistory,
    staleTime: 10 * 1000,
  });

  const meta = useMemo(() => q.data?.fields ?? [], [q.data]);
  const stored = q.data?.stored ?? null;
  const entered = !!q.data?.entered;

  /** Stored value for a field, as a string for an input box. */
  const storedStr = useCallback((f: string): string => {
    const v = stored?.[f];
    return v === null || v === undefined ? "" : String(v);
  }, [stored]);

  /** What the box shows: typed first, then stored, then — for opening stock
      on a day not yet entered — the figure carried from the previous day. */
  const shown = useCallback((f: string): string => {
    if (typed[f] !== undefined) return typed[f];
    const s = storedStr(f);
    if (s !== "") return s;
    if (f === "opening_stock_m3" && !entered
        && q.data?.suggested_opening != null) {
      return String(q.data.suggested_opening);
    }
    return "";
  }, [typed, storedStr, entered, q.data]);

  const num = useCallback((f: string): number | null => {
    const v = shown(f).trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }, [shown]);

  /* The six derived figures, computed here ONLY so the screen moves as you
     type. The stored values come from the database's generated columns, in
     exactly these forms — October 2026's. */
  const derived = useMemo(() => {
    const rf = q.data?.rain_factor ?? 280;
    const mm = num("rainfall_mm"), cap = num("pump_capacity_m3_hr");
    const open_ = num("opening_stock_m3"), seep = num("seepage_m3");
    const ph = num("plan_pump_hr"), ah = num("actual_pump_hr");
    const mul = (a: number | null, b: number | null) =>
      a == null || b == null || Number.isNaN(a) || Number.isNaN(b) ? null : a * b;
    const rain = mul(mm, rf);
    const planD = mul(ph, cap);
    const actD = mul(ah, cap);
    return {
      rain_water_m3: rain,
      plan_disposal_m3: planD,
      actual_disposal_m3: actD,
      variance_m3: actD == null || planD == null ? null : actD - planD,
      closing_stock_m3:
        open_ == null || seep == null || rain == null || actD == null
          || [open_, seep, rain, actD].some(Number.isNaN)
          ? null : open_ + seep + rain - actD,
      plan_compliance_pct:
        ah == null || ph == null || ph === 0 || Number.isNaN(ah) ? null
          : (ah / ph) * 100,
    } as Record<string, number | null>;
  }, [num, q.data]);

  const bad = meta.filter((m) => m.kind === "input" && m.type === "number"
    && Number.isNaN(num(m.field) as number));

  const changes = meta.filter((m) => {
    if (m.kind !== "input") return false;
    const now = shown(m.field).trim();
    const was = storedStr(m.field);
    return now !== was;
  });

  const canSave = !busy && bad.length === 0 && changes.length > 0;

  async function save() {
    setBusy(true); setProblems([]); setError(null);
    setChained([]); setStoppedAt(null);
    try {
      const body: Record<string, unknown> = {};
      for (const m of meta) {
        if (m.kind !== "input") continue;
        const v = shown(m.field).trim();
        // Only what differs is sent: a field left alone must stay as it is,
        // and sending the whole row would make every save look like an edit.
        if (v === storedStr(m.field)) continue;
        body[m.field] = v === "" ? null : (m.type === "number" ? Number(v) : v);
      }
      const r = await api.post("/dewatering-entry", body,
        { params: { data_date: day } });
      const d = r.data ?? {};
      setChained(d.chained ?? []);
      setStoppedAt(d.stopped_at ?? null);
      setDone(
        d.action === "unchanged" ? "Nothing had changed — nothing was written."
          : d.action === "created" ? `Saved — ${d.fields_changed} figures.`
            : `Revision ${d.revision} saved — ${d.fields_changed} figure${d.fields_changed === 1 ? "" : "s"} changed.`);
      setTyped({});
      await q.refetch();
      if (showHistory) await hist.refetch();
      await onSaved();
    } catch (e) {
      const d = (e as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      if (d && typeof d === "object" && "problems" in d) {
        setProblems((d as { problems: string[] }).problems);
      } else {
        setError(typeof d === "string" ? d : "The day could not be saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const sections = q.data?.sections ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/45 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enter daily dewatering data"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-border w-full max-w-3xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── heading ──────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Droplet size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Enter Daily Dewatering Data
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── the day ──────────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
          <div>
            <label htmlFor="dw-day"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Date
            </label>
            <input id="dw-day" type="date" value={day}
              onChange={(e) => setDay(e.target.value)}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white" />
          </div>
          <div className="ml-auto text-[11px] text-txt-muted text-right">
            {q.isLoading ? "Loading…"
              : entered
                ? <>
                    {(q.data!.revision ?? 1) > 1
                      ? `Entered · revision ${q.data!.revision}` : "Entered"}
                    {!!stored?.updated_date && (
                      <span className="block text-[10px]">
                        last edited {stamp(String(stored.updated_date))}
                        {stored.updated_id ? ` by ${stored.updated_id}` : ""}
                      </span>
                    )}
                  </>
                : "Not entered yet"}
          </div>
          {entered && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border
                         bg-white text-[10px] font-condensed font-bold uppercase tracking-widest
                         text-navy hover:bg-bg-section focus:outline-none focus:ring-1 focus:ring-navy"
              aria-expanded={showHistory}
            >
              <History size={11} />
              {showHistory ? "Hide changes" : "Change history"}
            </button>
          )}
        </div>

        {showHistory && (
          <div className="px-4 py-2.5 border-b border-border-light bg-bg-section/40">
            {hist.isLoading ? (
              <p className="text-[11px] text-txt-muted">
                <Loader2 size={11} className="animate-spin inline mr-1.5" />
                Reading the log…
              </p>
            ) : !hist.data?.history?.length ? (
              <p className="text-[11px] text-txt-muted">No edits recorded for this day.</p>
            ) : (
              <ul className="space-y-1 max-h-52 overflow-y-auto">
                {hist.data.history.map((h, i) => (
                  <li key={i} className="text-[11px] font-mono text-txt-secondary
                                         flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-navy w-[200px] shrink-0 truncate"
                          title={h.label}>{h.label}</span>
                    <span>
                      {h.action === "ADDED" && <>set to <strong>{h.new_value}</strong></>}
                      {h.action === "CHANGED" && <>
                        <span className="line-through text-txt-muted">{h.old_value}</span>
                        {" → "}<strong>{h.new_value}</strong>
                      </>}
                      {h.action === "REMOVED" && <>
                        cleared (was <span className="line-through text-txt-muted">{h.old_value}</span>)
                      </>}
                      {/* The one action nobody performed. Saying so is the
                          point: a figure that moved without being edited is
                          otherwise inexplicable to whoever finds it. */}
                      {h.action === "CHAINED" && <span className="text-amber-700">
                        carried forward from an earlier day&rsquo;s edit:{" "}
                        <span className="line-through">{h.old_value ?? "—"}</span>
                        {" → "}<strong>{h.new_value}</strong>
                      </span>}
                    </span>
                    <span className="ml-auto text-[10px] text-txt-muted">
                      {h.entry_id} · {stamp(h.entry_date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── the sheet ────────────────────────────────────────────────── */}
        <div className="px-4 py-3 space-y-4 max-h-[58vh] overflow-y-auto">
          {q.isLoading ? (
            <div className="py-10 text-center text-[12px] text-txt-muted">
              <Loader2 size={16} className="animate-spin inline mr-2" />
              Reading the day…
            </div>
          ) : sections.map((sec) => (
            <div key={sec.key}>
              <p className="text-[10px] font-condensed font-bold tracking-widest
                            uppercase text-txt-secondary border-b border-border-light pb-1 mb-1.5">
                {sec.label}
              </p>
              <table className="w-full">
                <tbody>
                  {meta.filter((m) => m.section === sec.key).map((m) => {
                    const isDerived = m.kind === "derived";
                    const v = num(m.field);
                    const invalid = !isDerived && m.type === "number"
                      && Number.isNaN(v as number);
                    const moved = m.kind === "input"
                      && shown(m.field).trim() !== storedStr(m.field);
                    const carried = m.field === "opening_stock_m3" && !entered
                      && typed[m.field] === undefined
                      && q.data?.suggested_opening != null;
                    return (
                      <tr key={m.field} className="border-b border-border-light/50">
                        <td className="py-1.5 pr-3 align-top">
                          <span className={`text-[12px] ${isDerived
                            ? "text-txt-secondary" : "font-semibold text-navy"}`}>
                            {m.label}
                          </span>
                          {m.uom && (
                            <span className="ml-1.5 text-[10px] text-txt-light font-mono">
                              {m.uom}
                            </span>
                          )}
                          {carried && (
                            <span className="block text-[10px] text-amber-700">
                              carried from {niceDay(q.data!.suggested_opening_from)}
                              &rsquo;s closing stock — edit if the mine re-measured
                            </span>
                          )}
                          {moved && storedStr(m.field) !== "" && (
                            <span className="block text-[10px] text-navy">
                              was <span className="line-through">{storedStr(m.field)}</span>
                              {" "}— not saved yet
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right w-[180px]">
                          {isDerived ? (
                            /* Grey, borderless, not a control: the database
                               computes these and nothing typed here would be
                               stored. */
                            <span className="inline-block w-[160px] px-2 py-1.5 rounded
                                             bg-bg-section text-right text-[12px]
                                             font-mono font-bold text-navy">
                              {n3(derived[m.field] ?? null)}
                            </span>
                          ) : m.type === "text" ? (
                            <textarea
                              rows={2}
                              value={shown(m.field)}
                              onChange={(e) => setTyped((p) => ({
                                ...p, [m.field]: e.target.value }))}
                              aria-label={m.label}
                              className="w-[320px] max-w-full border border-border rounded
                                         px-2 py-1 text-[11px] text-navy bg-white
                                         focus:outline-none focus:ring-1 focus:ring-navy"
                            />
                          ) : (
                            <input
                              type="number" inputMode="decimal" step="any"
                              value={shown(m.field)}
                              onChange={(e) => setTyped((p) => ({
                                ...p, [m.field]: e.target.value }))}
                              placeholder="—"
                              aria-label={`${m.label}${m.uom ? ` in ${m.uom}` : ""}`}
                              className={`w-[160px] text-right border rounded px-2 py-1.5
                                          text-[12px] font-mono text-navy bg-white
                                          focus:outline-none focus:ring-1
                                          ${invalid ? "border-danger ring-danger"
                                                    : "border-border focus:ring-navy"}`}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* ── what the save moved beyond this day ──────────────────────── */}
        {(chained.length > 0 || stoppedAt) && (
          <div className="px-4 pb-3">
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
              <Link2 size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-900 leading-relaxed">
                {chained.length > 0 && <>
                  <strong>{chained.length} later day{chained.length === 1 ? "" : "s"} moved</strong>{" "}
                  — opening stock is the previous day&rsquo;s closing, so this edit
                  carried forward to {chained.map(niceDay).join(", ")}.{" "}
                </>}
                {stoppedAt && <>
                  It stopped at <strong>{niceDay(stoppedAt)}</strong>, because the day
                  before it has no closing stock to hand on — enter its pump hours
                  and capacity, then the chain will continue.
                </>}
              </p>
            </div>
          </div>
        )}

        {bad.length > 0 && (
          <div className="px-4 pb-3">
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-900">
                <strong>{bad.map((m) => m.label).join(", ")}</strong>{" "}
                {bad.length === 1 ? "is" : "are"} not a number.
              </p>
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <div className="px-4 pb-3">
            <div className="rounded border border-danger/30 bg-danger/5 px-3 py-2">
              <p className="text-[11px] font-bold text-danger mb-1">
                The day was not saved.
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {problems.map((p) => (
                  <li key={p} className="text-[11px] text-danger">{p}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {error && <div className="px-4 pb-3"><p className="text-[11px] text-danger">{error}</p></div>}

        {/* ── footer ───────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t border-border-light bg-bg-soft flex items-center gap-3">
          <div className="text-[11px] text-txt-muted">
            {done != null ? (
              <span className="text-success font-semibold inline-flex items-center gap-1">
                <Check size={12} /> {done}
              </span>
            ) : changes.length > 0 ? (
              `${changes.length} figure${changes.length === 1 ? "" : "s"} to save`
            ) : entered ? "Nothing to change" : ""}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-border text-[12px] font-semibold text-txt-secondary hover:bg-bg-section transition-colors"
            >
              Close
            </button>
            <button
              onClick={save}
              disabled={!canSave}
              className="px-4 py-1.5 rounded bg-navy text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy/90 transition-colors inline-flex items-center gap-1.5"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {entered ? "Save changes" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
