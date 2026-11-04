"use client";
/**
 * Upload the mine's day-wise shifting plan for a month.
 *
 * FOUR STEPS, AND THE THIRD IS THE POINT. Month → file → check → submit.
 * Nothing is stored until the third step has been looked at: the server reads
 * the workbook, says what it found and what confirming would replace, and only
 * then is there a Submit button. A re-upload REPLACES the month, so somebody
 * about to overwrite thirty days of plan should first see how many of them
 * move and by how much.
 *
 * NO FILE IS KEPT, on the server or here. The workbook is posted, read and
 * forgotten; what is stored is ninety numbers. Choosing a different file
 * discards the preview rather than merging with it, so the figures on screen
 * always belong to the file named above them. The file is posted twice — once
 * to preview, once to submit — because holding a parse between two requests
 * would mean trusting that the file behind the confirmation is the file that
 * was previewed.
 *
 * WHY THE MONTH IS CHOSEN BEFORE THE FILE, so a sheet of October uploaded into
 * November is an error rather than something to accommodate. The server checks
 * every date against the chosen month and refuses the lot, naming the rows.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Shuffle, X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  ArrowLeft, Loader2, History,
} from "lucide-react";
import api from "@/lib/api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

type Code = "LG" | "TAILINGS" | "REHANDLING";
const ORDER: Code[] = ["LG", "TAILINGS", "REHANDLING"];
const LABEL: Record<Code, string> = {
  LG: "LG Shifting",
  TAILINGS: "Tailing Shifting",
  REHANDLING: "Rehandling (others)",
};

interface Preview {
  filename: string;
  header_row: number;
  days: number;
  totals: Record<Code, number>;
  skipped_total_rows: number;
  change: {
    month_entered: boolean;
    revision: number;
    added: number;
    changed: number;
    removed: number;
    unchanged: number;
    samples: { date: string; material: Code; label: string;
               old: number; new: number }[];
  };
}

interface StoredMonth {
  entered: boolean;
  revision: number;
  days: number;
  totals: Record<Code, number>;
  last_change: string | null;
}

const n2 = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ShiftingPlanModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* A new month, or a new file, invalidates whatever was on screen: the
     preview belongs to one file read against one month and must never be
     submitted against another. */
  const reset = () => {
    setPreview(null); setProblems([]); setError(null); setDone(null);
  };
  useEffect(() => { reset(); setFile(null); }, [year, month, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const stored = useQuery<StoredMonth>({
    queryKey: ["shifting", "plan", year, month],
    queryFn: async () =>
      (await api.get("/shifting/plan", { params: { year, month } })).data,
    enabled: open,
    staleTime: 10 * 1000,
  });

  function readProblems(e: unknown): boolean {
    const d = (e as { response?: { data?: { detail?: unknown } } })
      ?.response?.data?.detail;
    if (d && typeof d === "object" && "problems" in d) {
      setProblems((d as { problems: string[] }).problems);
      return true;
    }
    setError(typeof d === "string" ? d : "The sheet could not be read.");
    return false;
  }

  async function doPreview(f: File) {
    setBusy(true); reset();
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post("/shifting/plan/preview", fd,
        { params: { year, month } });
      setPreview(r.data);
    } catch (e) { readProblems(e); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!file) return;
    setBusy(true); setProblems([]); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/shifting/plan", fd, { params: { year, month } });
      const d = r.data ?? {};
      setDone(
        d.revised
          ? `Revision ${d.revision} stored — ${d.changed} changed, ${d.added} added, ${d.removed} removed.`
          : `${MONTHS[month - 1]} ${year} stored — ${d.rows} figures.`);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await stored.refetch();
      await onSaved();
    } catch (e) { readProblems(e); }
    finally { setBusy(false); }
  }

  if (!open) return null;

  const s = stored.data;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/45 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enter shifting plan"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-border w-full max-w-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── heading ──────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border-light flex items-center gap-2">
          <Shuffle size={15} className="text-accent" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Enter Shifting Plan
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded hover:bg-bg-section text-txt-muted hover:text-navy transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── 1 · the month ────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 border-b border-border-light bg-bg-soft flex items-end gap-3 flex-wrap">
          <div>
            <label htmlFor="sp-month"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Month
            </label>
            <select id="sp-month" value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white">
              {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sp-year"
              className="block text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary mb-1">
              Year
            </label>
            <select id="sp-year" value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-border rounded px-2 py-1.5 text-[12px] font-semibold text-navy bg-white">
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
                .map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="ml-auto text-[11px] text-txt-muted text-right">
            {stored.isLoading ? "Loading…"
              : s?.entered
                ? <>
                    {s.days} days stored
                    {s.revision > 1 ? ` · revision ${s.revision}` : ""}
                    {s.last_change && (
                      <span className="block text-[10px]">
                        last changed {stamp(s.last_change)}
                      </span>
                    )}
                  </>
                : "No plan uploaded yet"}
          </div>
        </div>

        {/* A month that already has a plan says so BEFORE the file is chosen,
            because the upload replaces it rather than adding to it. */}
        {!stored.isLoading && s?.entered && !done && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
            <History size={13} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-900 leading-relaxed">
              <strong>{MONTHS[month - 1]} {year} already has a plan</strong> —
              LG {n2(s.totals?.LG)}, Tailings {n2(s.totals?.TAILINGS)},
              Rehandling {n2(s.totals?.REHANDLING)} CuM. Uploading replaces it.
              What it replaces is kept, and you will see what changes before
              anything is stored.
            </p>
          </div>
        )}

        {/* ── 2 · the file ─────────────────────────────────────────────── */}
        <div className="px-4 py-3">
          <label
            htmlFor="sp-file"
            className="flex items-center gap-3 px-3 py-3 rounded border border-dashed
                       border-border hover:border-navy hover:bg-bg-section/50
                       cursor-pointer transition-colors"
          >
            <Upload size={16} className="text-accent shrink-0" />
            <span className="text-[12px] text-txt-secondary">
              {file
                ? <span className="font-semibold text-navy">{file.name}</span>
                : <>Choose the plan workbook (.xlsx) — a row per day, with
                   columns for Date, LG Shifting, Tailings Shifting and Other
                   Rehandling</>}
            </span>
          </label>
          <input
            ref={fileRef}
            id="sp-file"
            type="file"
            accept=".xlsx,.xlsm"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) void doPreview(f);
              else reset();
            }}
          />

          {busy && !preview && (
            <p className="mt-3 text-[11px] text-txt-muted">
              <Loader2 size={12} className="animate-spin inline mr-1.5" />
              Reading the sheet…
            </p>
          )}

          {/* ── 3 · what it found, and what it would change ───────────── */}
          {preview && (
            <div className="mt-3 space-y-3">
              <div className="rounded border border-border-light bg-bg-section/40 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-navy flex items-center gap-1.5">
                  <FileSpreadsheet size={12} className="text-accent" />
                  {preview.days} days read, header on row {preview.header_row}
                  {preview.skipped_total_rows > 0 && (
                    <span className="text-txt-muted font-normal">
                      · {preview.skipped_total_rows} total row skipped
                    </span>
                  )}
                </p>
                <table className="w-full mt-2 text-[11px] font-mono">
                  <tbody>
                    {ORDER.map((c) => (
                      <tr key={c}>
                        <td className="py-0.5 text-txt-secondary">{LABEL[c]}</td>
                        <td className="py-0.5 text-right font-bold text-navy">
                          {n2(preview.totals?.[c])} CuM
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded border border-border-light px-3 py-2.5">
                <p className="text-[11px] font-semibold text-navy mb-1">
                  {preview.change.month_entered
                    ? `This would be revision ${preview.change.revision + 1}`
                    : "This would be the first plan for the month"}
                </p>
                <p className="text-[11px] text-txt-secondary">
                  {preview.change.added} added · {preview.change.changed} changed ·{" "}
                  {preview.change.removed} removed · {preview.change.unchanged} unchanged
                </p>
                {preview.change.samples.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {preview.change.samples.map((x, i) => (
                      <li key={i} className="text-[11px] font-mono text-txt-secondary">
                        <span className="text-txt-muted">{x.date}</span>{" "}
                        <span className="font-bold text-navy">{x.label}</span>{" "}
                        <span className="line-through text-txt-muted">{n2(x.old)}</span>
                        {" → "}<strong>{n2(x.new)}</strong>
                      </li>
                    ))}
                    {preview.change.changed > preview.change.samples.length && (
                      <li className="text-[10px] text-txt-muted">
                        …and {preview.change.changed - preview.change.samples.length} more
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}

          {problems.length > 0 && (
            <div className="mt-3 rounded border border-danger/30 bg-danger/5 px-3 py-2">
              <p className="text-[11px] font-bold text-danger mb-1 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                That sheet could not be read as a shifting plan.
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {problems.map((p) => (
                  <li key={p} className="text-[11px] text-danger">{p}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="mt-3 text-[11px] text-danger">{error}</p>}
          {done && (
            <p className="mt-3 text-[11px] text-success font-semibold inline-flex items-center gap-1.5">
              <CheckCircle2 size={13} /> {done}
            </p>
          )}
        </div>

        {/* ── 4 · footer ───────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t border-border-light bg-bg-soft flex items-center gap-2">
          {preview && (
            <button
              onClick={() => { setFile(null); reset();
                               if (fileRef.current) fileRef.current.value = ""; }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-border
                         text-[12px] font-semibold text-txt-secondary hover:bg-bg-section transition-colors"
            >
              <ArrowLeft size={12} /> Choose another file
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-border text-[12px] font-semibold text-txt-secondary hover:bg-bg-section transition-colors"
            >
              Close
            </button>
            <button
              onClick={submit}
              disabled={busy || !preview}
              className="px-4 py-1.5 rounded bg-navy text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-navy/90 transition-colors inline-flex items-center gap-1.5"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {s?.entered ? "Replace the month" : "Submit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
