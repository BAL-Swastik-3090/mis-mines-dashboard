"use client";
/**
 * Upload the mine's day-wise de-silting plan for a month.
 *
 * FOUR STEPS, AND THE THIRD IS THE POINT. Month → file → check → submit.
 * Nothing is stored until the third step has been looked at: the server parses
 * the workbook, says what it read and what confirming would replace, and only
 * then is there a Submit button. De-silting is the one activity that had no
 * target anywhere, so the first plan uploaded here becomes the figure every
 * achievement on the dashboard is measured against — worth a look before it
 * lands.
 *
 * NO FILE IS KEPT, ON THE SERVER OR HERE. The workbook is posted, parsed and
 * forgotten; what is stored is thirty-one numbers. Choosing a different file
 * discards the preview rather than merging with it, so the rows on screen are
 * always the rows in the file named above them.
 *
 * WHY THE MONTH IS CHOSEN BEFORE THE FILE. So a sheet of September uploaded
 * into October is an error rather than something to be accommodated. The
 * server checks every date against the chosen month and refuses the lot,
 * naming the rows — the alternative is a plan silently overwriting a month
 * nobody was looking at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Droplets, X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  ArrowLeft, Loader2, Trash2,
} from "lucide-react";
import api from "@/lib/api";
import { formatIndian } from "@/lib/utils";

type Row = { plan_date: string; plan_qty: number };

interface Preview {
  file_name: string;
  qty_heading: string;
  header_row: number;
  rows: Row[];
  total: number;
  sheet_total: number | null;
  warnings: string[];
  diff: {
    added: Row[];
    changed: { plan_date: string; was: number; now: number }[];
    removed: { plan_date: string; was: number }[];
    unchanged: number;
    had_rows: number;
    is_revision: boolean;
    total_was: number | null;
    total_now: number;
  };
}

interface StoredMonth {
  rows: {
    plan_date: string; plan_qty: number; entry_id: string;
    created_at: string | null;
    modified_by: string | null; modified_at: string | null;
  }[];
  total: number | null;
  has_plan: boolean;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** The month to offer first: the one the mine is working in. */
function currentYM(): { y: number; m: number } {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

function dayLabel(iso: string): string {
  const [, , d] = iso.split("-");
  return d;
}

function Qty({ v, strong = false }: { v: number | null | undefined; strong?: boolean }) {
  if (v == null) return <span className="text-txt-light">—</span>;
  return (
    <span className={`font-mono tabular-nums ${strong ? "font-bold text-navy" : "text-txt-secondary"}`}>
      {formatIndian(Math.round(v * 100) / 100)}
    </span>
  );
}

export default function DesiltingPlanModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const now = currentYM();
  const [year, setYear] = useState(now.y);
  const [month, setMonth] = useState(now.m);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ stored: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setFile(null); setPreview(null); setProblems([]); setError(null);
    setDone(null); setBusy(false);
    if (picker.current) picker.current.value = "";
  }, []);

  useEffect(() => {
    if (!open) return;
    const ym = currentYM();
    setYear(ym.y); setMonth(ym.m);
    reset();
  }, [open, reset]);

  // CHANGING THE MONTH DISCARDS THE PREVIEW. It was computed against the old
  // month — its "removed" list is the old month's rows — and leaving it on
  // screen under a new heading would be a diff of the wrong thing.
  useEffect(() => { reset(); }, [year, month, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const stored = useQuery<StoredMonth>({
    queryKey: ["desilting-plan", year, month],
    queryFn: async () =>
      (await api.get("/desilting-plan", { params: { year, month } })).data,
    enabled: open,
    staleTime: 10 * 1000,
  });

  const entered = stored.data?.rows?.[0];
  const lastTouched = useMemo(() => {
    const rows = stored.data?.rows ?? [];
    const stamps = rows
      .map((r) => r.modified_at ?? r.created_at)
      .filter(Boolean) as string[];
    return stamps.length ? stamps.sort().at(-1)! : null;
  }, [stored.data]);

  /** Post the file for parsing. Writes nothing. */
  async function runPreview(f: File) {
    setBusy(true); setProblems([]); setError(null); setPreview(null);
    const body = new FormData();
    body.append("file", f);
    try {
      const { data } = await api.post<Preview>("/desilting-plan/preview", body, {
        params: { year, month },
      });
      setPreview(data);
    } catch (e) {
      const r = (e as { response?: { data?: { detail?: unknown } } }).response;
      const d = r?.data?.detail as { problems?: string[]; message?: string } | string | undefined;
      if (d && typeof d === "object" && Array.isArray(d.problems)) {
        setProblems(d.problems);
      } else {
        setError(typeof d === "string" ? d : "That file could not be read.");
      }
    } finally {
      setBusy(false);
    }
  }

  function take(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    void runPreview(f);
  }

  async function submit() {
    if (!file) return;
    setBusy(true); setError(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const { data } = await api.post<{ stored: number; total: number }>(
        "/desilting-plan", body, { params: { year, month } });
      setDone({ stored: data.stored, total: data.total });
      await stored.refetch();
      await onSaved();
    } catch (e) {
      const r = (e as { response?: { data?: { detail?: unknown } } }).response;
      const d = r?.data?.detail;
      setError(typeof d === "string" ? d : "The plan could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function clearMonth() {
    setBusy(true); setError(null);
    try {
      await api.delete("/desilting-plan", { params: { year, month } });
      reset();
      await stored.refetch();
      await onSaved();
    } catch {
      setError("That month could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const monthName = `${MONTHS[month - 1]} ${year}`;
  const d = preview?.diff;
  const willRemove = (d?.removed.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/45 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enter de-silting plan"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-border w-full max-w-3xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── heading ──────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Droplets size={15} className="text-info" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            De-Silting Plan
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── step 1 · which month ─────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
          <div>
            <label htmlFor="silt-month"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Month
            </label>
            <select
              id="silt-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="silt-year"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Year
            </label>
            <select
              id="silt-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white"
            >
              {[now.y - 1, now.y, now.y + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* WHAT IS ALREADY THERE, said before the file is chosen, so nobody
              revises a month without knowing it was a revision. */}
          <div className="ml-auto text-right">
            {stored.isLoading ? (
              <span className="text-[11px] text-txt-light">checking…</span>
            ) : stored.data?.has_plan ? (
              <>
                <div className="text-[11px] text-txt-secondary">
                  <span className="font-bold text-navy">{stored.data.rows.length} day(s)</span>
                  {" already stored · "}
                  <span className="font-mono font-bold text-navy">
                    {formatIndian(Math.round((stored.data.total ?? 0) * 100) / 100)}
                  </span>
                  {" CuM"}
                </div>
                <div className="text-[10px] text-txt-light">
                  {entered?.entry_id ? `entered by ${entered.entry_id}` : ""}
                  {lastTouched ? ` · last changed ${lastTouched.slice(0, 10)}` : ""}
                </div>
              </>
            ) : (
              <span className="text-[11px] text-txt-light">no plan stored for {monthName}</span>
            )}
          </div>
        </div>

        {/* ── step 4 · stored ──────────────────────────────────────────── */}
        {done ? (
          <div className="px-4 py-8 text-center space-y-3">
            <CheckCircle2 size={34} className="mx-auto text-[#2e7d32]" />
            <div className="text-[14px] font-bold text-navy">
              {monthName} plan saved
            </div>
            <div className="text-[12px] text-txt-secondary">
              {done.stored} day(s), {formatIndian(Math.round(done.total * 100) / 100)} CuM.
              The dashboard now shows de-silting against this plan.
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button onClick={reset}
                className="px-3 py-1.5 rounded border border-border text-[12px] font-semibold text-txt-secondary hover:text-navy">
                Upload another month
              </button>
              <button onClick={onClose}
                className="px-4 py-1.5 rounded bg-navy text-white text-[12px] font-bold hover:bg-navy/90">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── step 2 · the file ────────────────────────────────────── */}
            {!preview && (
              <div className="px-4 py-4">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault(); setDragging(false);
                    take(e.dataTransfer.files?.[0]);
                  }}
                  className={`rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
                    dragging ? "border-accent bg-accent/5" : "border-border bg-bg-soft"
                  }`}
                >
                  {busy ? (
                    <div className="flex items-center justify-center gap-2 text-[12px] text-txt-secondary">
                      <Loader2 size={15} className="animate-spin" />
                      Reading the sheet…
                    </div>
                  ) : (
                    <>
                      <FileSpreadsheet size={28} className="mx-auto text-txt-light mb-2" />
                      <div className="text-[12px] text-txt-secondary mb-3">
                        Drop the {monthName} plan here, or
                      </div>
                      <button
                        onClick={() => picker.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-navy text-white text-[12px] font-bold hover:bg-navy/90"
                      >
                        <Upload size={13} /> Choose Excel file
                      </button>
                      <div className="text-[10px] text-txt-light mt-3">
                        Two columns — <span className="font-semibold">Date</span> and the
                        day&apos;s plan in CuM. The header need not be on the first row.
                      </div>
                    </>
                  )}
                  <input
                    ref={picker}
                    type="file"
                    accept=".xlsx,.xlsm"
                    className="hidden"
                    onChange={(e) => take(e.target.files?.[0])}
                  />
                </div>

                {/* EVERY FAULT AT ONCE, as a checklist against the sheet —
                    not the first one, which would mean one upload per typo. */}
                {problems.length > 0 && (
                  <div className="mt-3 rounded-lg border border-[#ef9a9a] bg-[#ffebee] px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#c62828] mb-1.5">
                      <AlertTriangle size={14} />
                      That sheet could not be read as a {monthName} plan
                    </div>
                    <ul className="space-y-0.5">
                      {problems.map((p) => (
                        <li key={p} className="text-[11px] text-[#c62828] font-mono">• {p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {error && (
                  <div className="mt-3 text-[12px] text-[#c62828] font-semibold">{error}</div>
                )}

                {stored.data?.has_plan && (
                  <button
                    onClick={clearMonth}
                    disabled={busy}
                    className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#c62828] hover:underline disabled:opacity-50"
                  >
                    <Trash2 size={12} /> Remove the stored {monthName} plan
                  </button>
                )}
              </div>
            )}

            {/* ── step 3 · check it ────────────────────────────────────── */}
            {preview && d && (
              <>
                <div className="px-4 py-2.5 border-b border-border-light flex items-center gap-2 flex-wrap">
                  <FileSpreadsheet size={14} className="text-accent" />
                  <span className="text-[12px] font-semibold text-navy">{preview.file_name}</span>
                  <span className="text-[10px] text-txt-light">
                    read from row {preview.header_row + 1}, column &ldquo;{preview.qty_heading}&rdquo;
                  </span>
                  <button
                    onClick={reset}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-txt-secondary hover:text-navy"
                  >
                    <ArrowLeft size={12} /> Choose a different file
                  </button>
                </div>

                {/* What confirming would do. Stated before the button, in the
                    words the mine would use. */}
                <div className="px-4 py-2.5 bg-bg-soft border-b border-border-light grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Days in sheet" value={String(preview.rows.length)} />
                  <Stat label="Total CuM"
                    value={formatIndian(Math.round(preview.total * 100) / 100)} strong />
                  <Stat label={d.is_revision ? "Days added" : "Days to store"}
                    value={String(d.added.length)} />
                  <Stat label="Days changed" value={String(d.changed.length)}
                    tone={d.changed.length ? "amber" : undefined} />
                </div>

                {(preview.warnings.length > 0 || willRemove) && (
                  <div className="px-4 pt-3 space-y-2">
                    {willRemove && (
                      <div className="rounded-lg border border-[#ef9a9a] bg-[#ffebee] px-3 py-2">
                        <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#c62828]">
                          <AlertTriangle size={14} />
                          {d.removed.length} day(s) will lose their plan
                        </div>
                        <div className="text-[11px] text-[#c62828] mt-0.5 font-mono">
                          {d.removed.map((r) => dayLabel(r.plan_date)).join(", ")}
                          {" — stored now, absent from this sheet."}
                        </div>
                      </div>
                    )}
                    {preview.warnings.map((w) => (
                      <div key={w}
                        className="rounded-lg border border-[#ffe082] bg-[#fff8e1] px-3 py-2 text-[11px] text-[#8d6e00]">
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* The rows themselves. All of them — a month is thirty-one
                    lines and the point of this step is to look at them. */}
                <div className="px-4 py-3">
                  <div className="max-h-64 overflow-y-auto rounded border border-border-light">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-bg-section">
                        <tr>
                          <th className="px-3 py-1.5 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Date</th>
                          <th className="px-3 py-1.5 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Plan (CuM)</th>
                          <th className="px-3 py-1.5 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Was</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => {
                          const ch = d.changed.find((c) => c.plan_date === r.plan_date);
                          const isNew = d.added.some((a) => a.plan_date === r.plan_date);
                          return (
                            <tr key={r.plan_date} className="border-t border-border-light">
                              <td className="px-3 py-1.5 font-mono text-txt-secondary">
                                {r.plan_date}
                                {isNew && d.is_revision && (
                                  <span className="ml-1.5 text-[9px] font-bold text-[#2e7d32]">NEW</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <Qty v={r.plan_qty} strong />
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {ch ? <Qty v={ch.was} /> : <span className="text-txt-light">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-bg-section">
                        <tr className="border-t-2 border-border">
                          <td className="px-3 py-1.5 font-condensed font-bold text-[11px] uppercase tracking-widest text-navy">Total</td>
                          <td className="px-3 py-1.5 text-right"><Qty v={preview.total} strong /></td>
                          <td className="px-3 py-1.5 text-right"><Qty v={d.total_was} /></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {error && (
                  <div className="px-4 pb-2 text-[12px] text-[#c62828] font-semibold">{error}</div>
                )}

                {/* ── submit ───────────────────────────────────────────── */}
                <div className="px-4 py-3 border-t border-border-light bg-bg-soft flex items-center gap-2">
                  <span className="text-[11px] text-txt-light">
                    {d.is_revision
                      ? `${monthName} already has a plan. Submitting replaces it with this sheet.`
                      : `${monthName} has no plan yet. Submitting stores this sheet.`}
                  </span>
                  <button
                    onClick={onClose}
                    className="ml-auto px-3 py-1.5 rounded border border-border text-[12px] font-semibold text-txt-secondary hover:text-navy"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy}
                    className="px-4 py-1.5 rounded bg-navy text-white text-[12px] font-bold hover:bg-navy/90 disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {d.is_revision ? "Replace plan" : "Submit plan"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, strong = false, tone }: {
  label: string; value: string; strong?: boolean; tone?: "amber";
}) {
  return (
    <div>
      <div className="text-[9px] font-condensed font-bold tracking-widest uppercase text-txt-light">
        {label}
      </div>
      <div className={`font-mono tabular-nums ${
        tone === "amber" ? "text-[#c8960c]" : "text-navy"
      } ${strong ? "text-[14px] font-extrabold" : "text-[13px] font-bold"}`}>
        {value}
      </div>
    </div>
  );
}
