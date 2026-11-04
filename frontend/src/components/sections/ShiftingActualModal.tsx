"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shuffle, X, Loader2, AlertTriangle, Check, History } from "lucide-react";
import api from "@/lib/api";

/**
 * One day's shifting: LG, Tailings and Other Rehandling, in CuM.
 *
 * A FORM, NOT AN UPLOAD, like Enter Est Actual: three figures for one day is
 * something you read in a single screen, so there is nothing to preview —
 * what is about to be stored is in front of you.
 *
 * THE PLAN SITS BESIDE THE FIGURE BEING TYPED, read-only, out of the uploaded
 * monthly plan. The person entering an actual is answering "against what?",
 * and sending them to a second screen for the target is how a figure gets
 * typed into the wrong row.
 *
 * BLANK IS NOT ZERO. A material left empty is not stored, because "nobody
 * entered it" and "nothing was moved" are different statements and only the
 * second is a figure. Clearing a saved one removes it, and the removal keeps
 * the value it had.
 *
 * EDITING IS THE SAME SCREEN. A saved day opens with its figures and says so;
 * changing one and saving records the previous value, who changed it and
 * when, and leaves the original entry date alone.
 */

type Code = "LG" | "TAILINGS" | "REHANDLING";

interface MaterialRow {
  material: Code;
  label: string;
  unit: string;
  plan_cum: number | null;
  actual_cum: number | null;
  revision: number | null;
  entry_id: string | null;
  entry_date: string | null;
  updated_id: string | null;
  updated_date: string | null;
}

interface DayRead {
  date: string;
  unit: string;
  entered: boolean;
  revision: number;
  materials: MaterialRow[];
}

interface Edit {
  date: string;
  material: Code;
  label: string;
  action: "ADDED" | "CHANGED" | "REMOVED";
  old_qty_cum: number | null;
  new_qty_cum: number | null;
  revision: number;
  entry_id: string;
  entry_date: string | null;
}

const FIELD: Record<Code, "lg" | "tailings" | "rehandling"> = {
  LG: "lg", TAILINGS: "tailings", REHANDLING: "rehandling",
};

/** Yesterday, because the mine reports a day in arrears. */
function defaultDay(): string {
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

const n2 = (v: number) =>
  v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function ShiftingActualModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [day, setDay] = useState(defaultDay);
  const [typed, setTyped] = useState<Partial<Record<Code, string>>>({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { if (open) setDay(defaultDay()); }, [open]);
  useEffect(() => {
    setTyped({}); setProblems([]); setError(null); setDone(null);
    setShowHistory(false);
  }, [day, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const q = useQuery<DayRead>({
    queryKey: ["shifting", "actual", day],
    queryFn: async () =>
      (await api.get("/shifting/actual", { params: { entry_date: day } })).data,
    enabled: open,
    staleTime: 10 * 1000,
  });

  const rows = useMemo(() => q.data?.materials ?? [], [q.data]);
  const entered = !!q.data?.entered;
  const revision = q.data?.revision ?? 0;

  /* Scoped to the day's own MONTH, not the whole table: the trail is opened
     from a day, and a list running back through every month ever entered
     buries the edit the reader came to find. Each row still carries its date,
     so neighbouring days read as context rather than noise. */
  const hist = useQuery<{ history: Edit[] }>({
    queryKey: ["shifting", "actual", "history", day],
    queryFn: async () => {
      const [y, m] = day.split("-");
      return (await api.get("/shifting/history", {
        params: { which: "actual", year: Number(y), month: Number(m),
                  limit: 200 },
      })).data;
    },
    enabled: open && showHistory && entered,
    staleTime: 10 * 1000,
  });

  /** What the box shows: what has been typed, else what is stored. */
  const valueOf = useCallback((r: MaterialRow): string => {
    const t = typed[r.material];
    if (t !== undefined) return t;
    return r.actual_cum == null ? "" : String(r.actual_cum);
  }, [typed]);

  const parsed = useCallback((r: MaterialRow): number | null => {
    const v = valueOf(r).trim();
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }, [valueOf]);

  const invalid = rows.filter((r) => Number.isNaN(parsed(r) as number));
  const negative = rows.filter((r) => {
    const n = parsed(r);
    return n != null && !Number.isNaN(n) && n < 0;
  });

  const changes = rows.filter((r) => {
    const n = parsed(r);
    if (Number.isNaN(n as number)) return false;
    return (n ?? null) !== (r.actual_cum ?? null);
  });

  const canSave = !busy && invalid.length === 0 && negative.length === 0
    && changes.length > 0;

  async function save() {
    setBusy(true); setProblems([]); setError(null);
    try {
      const body: Record<string, unknown> = { entry_date: day };
      for (const r of rows) body[FIELD[r.material]] = parsed(r);
      const res = await api.post("/shifting/actual", body);
      const d = res.data ?? {};
      const n = (d.added ?? 0) + (d.changed ?? 0) + (d.removed ?? 0);
      setDone(
        n === 0 ? "Nothing had changed — nothing was written."
          : d.revised
            ? `Revision ${d.revision} saved — ${n} figure${n === 1 ? "" : "s"} changed.`
            : `Saved — ${d.added} figure${d.added === 1 ? "" : "s"} entered.`);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/45 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enter shifting actual"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-border w-full max-w-xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── heading ──────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Shuffle size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Enter Shifting Actual
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
            <label htmlFor="shift-day"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Date
            </label>
            <input
              id="shift-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white"
            />
          </div>
          <div className="ml-auto text-[11px] text-txt-muted">
            {q.isLoading ? "Loading…"
              : entered
                ? (revision > 1 ? `Entered · revision ${revision}` : "Entered")
                : "Not entered yet"}
          </div>
        </div>

        {/* ── an entered day is editable, and says so ──────────────────── */}
        {!q.isLoading && entered && (
          <div className="px-4 py-2 border-b border-border-light bg-bg-soft/60 flex items-center gap-2 flex-wrap">
            <p className="text-[11px] text-txt-secondary">
              Change any figure below and save — the previous value is kept,
              not overwritten.
            </p>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border
                         border-border bg-white text-[10px] font-condensed font-bold
                         uppercase tracking-widest text-navy hover:bg-bg-section
                         focus:outline-none focus:ring-1 focus:ring-navy"
              aria-expanded={showHistory}
            >
              <History size={11} />
              {showHistory ? "Hide changes" : "Change history"}
            </button>
          </div>
        )}

        {showHistory && entered && (
          <div className="px-4 py-2.5 border-b border-border-light bg-bg-section/40">
            {hist.isLoading ? (
              <p className="text-[11px] text-txt-muted">
                <Loader2 size={11} className="animate-spin inline mr-1.5" />
                Reading the trail…
              </p>
            ) : !hist.data?.history?.length ? (
              <p className="text-[11px] text-txt-muted">No edits recorded.</p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {hist.data.history.map((h, i) => (
                  <li key={`${h.entry_date}-${h.material}-${i}`}
                      className="text-[11px] font-mono text-txt-secondary flex items-baseline gap-2 flex-wrap">
                    <span className="text-txt-muted w-[74px] shrink-0">{h.date}</span>
                    <span className="font-bold text-navy w-[124px] shrink-0">{h.label}</span>
                    <span>
                      {h.action === "ADDED" && <>set to <strong>{n2(h.new_qty_cum ?? 0)}</strong></>}
                      {h.action === "CHANGED" && <>
                        <span className="line-through text-txt-muted">{n2(h.old_qty_cum ?? 0)}</span>
                        {" → "}<strong>{n2(h.new_qty_cum ?? 0)}</strong>
                      </>}
                      {h.action === "REMOVED" && <>
                        cleared (was <span className="line-through text-txt-muted">{n2(h.old_qty_cum ?? 0)}</span>)
                      </>}
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

        {/* ── the three materials ──────────────────────────────────────── */}
        <div className="px-4 py-3">
          {q.isLoading ? (
            <div className="py-10 text-center text-[12px] text-txt-muted">
              <Loader2 size={16} className="animate-spin inline mr-2" />
              Reading the day…
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-light">
                  <th className="text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary pb-1.5">
                    Material
                  </th>
                  <th className="text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary pb-1.5 w-[110px]">
                    Plan (CuM)
                  </th>
                  <th className="text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary pb-1.5 w-[130px]">
                    Actual (CuM)
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const n = parsed(r);
                  const bad = Number.isNaN(n as number) || (n != null && n < 0);
                  const moved = !bad && (n ?? null) !== (r.actual_cum ?? null);
                  return (
                    <tr key={r.material} className="border-b border-border-light/60">
                      <td className="py-2.5">
                        <span className="text-[12px] font-bold text-navy">{r.label}</span>
                        {/* An unsaved edit names what it replaces: without it
                            the box simply changes and the previous figure is
                            gone from the screen before it is gone from the
                            database. */}
                        {moved && r.actual_cum != null && (
                          <span className="block text-[10px] text-navy">
                            was <span className="line-through">{n2(r.actual_cum)}</span>
                            {" "}— not saved yet
                          </span>
                        )}
                        {!moved && r.actual_cum != null && (
                          <span className="block text-[10px] text-txt-muted">
                            {r.updated_date
                              ? `changed ${stamp(r.updated_date)}${r.updated_id ? ` by ${r.updated_id}` : ""}`
                              : `entered ${stamp(r.entry_date)}${r.entry_id ? ` by ${r.entry_id}` : ""}`}
                          </span>
                        )}
                      </td>
                      {/* READ-ONLY, from the uploaded plan. A dash means no
                          plan was uploaded for this day — which is not a plan
                          of zero, and the figure can still be entered. */}
                      <td className="py-2.5 text-right text-[12px] font-mono text-txt-light">
                        {r.plan_cum == null
                          ? <span className="text-txt-light/50">—</span>
                          : n2(r.plan_cum)}
                      </td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={valueOf(r)}
                          onChange={(e) => setTyped((p) => ({
                            ...p, [r.material]: e.target.value }))}
                          placeholder="—"
                          aria-label={`${r.label} actual in CuM`}
                          className={`w-[120px] text-right border rounded px-2 py-1.5
                                      text-[12px] font-mono text-navy bg-white
                                      focus:outline-none focus:ring-1
                                      ${bad ? "border-danger ring-danger"
                                            : "border-border focus:ring-navy"}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {(invalid.length > 0 || negative.length > 0) && (
          <div className="px-4 pb-3">
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-900">
                {invalid.length > 0 && <>
                  <strong>{invalid.map((r) => r.label).join(", ")}</strong>{" "}
                  {invalid.length === 1 ? "is" : "are"} not a number.{" "}
                </>}
                {negative.length > 0 && <>
                  <strong>{negative.map((r) => r.label).join(", ")}</strong>{" "}
                  cannot be negative.
                </>}
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
        {error && (
          <div className="px-4 pb-3">
            <p className="text-[11px] text-danger">{error}</p>
          </div>
        )}

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
