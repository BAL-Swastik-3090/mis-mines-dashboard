"use client";
/**
 * Importing the monthly cost plan.
 *
 * The plan is not a report - nobody opens it to read it, they open it to
 * load the month's SAP CO export so the cost sheet has a plan column and
 * the month-end accrual has a number to pro-rate. So it lives here, as a
 * dialog on the cost sheet, rather than as a screen of its own.
 *
 * Two uploads, because the export carries numbers and the workbook carries
 * what they mean: the plan files, and the CE and CC List that names them.
 */
import React, { useState } from "react";
import {
  Upload, X, AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, BookOpen,
} from "lucide-react";
import api from "@/lib/api";
import { useCostPlanPeriods } from "@/hooks/useCostPlan";

interface Props {
  onClose: () => void;
  /** Fired once rows are actually written, so the sheet can re-read. */
  onDone: () => void;
}

const rupees = (n: number | null | undefined) =>
  n == null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const monthLabel = (iso: string | null | undefined) => {
  if (!iso) return "-";
  const [y, m] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
};

interface PlanFileReport {
  file: string; fiscal_year: number; period: number; plan_month: string;
  rows_parsed: number; amount_total: number; negative_rows: number;
  rows_skipped_unreadable: number; duplicate_pairs_collapsed: number;
  by_section: Record<string, { rows: number; amount: number }>;
  written: boolean; rows_new?: number; rows_changed?: number; rows_identical?: number;
}
interface PlanUploadResponse {
  files_accepted: number; files_rejected: number; rows_written: number;
  results: PlanFileReport[]; errors: { file: string; error: string }[];
}

/* ── upload dialog ──────────────────────────────────────────────── */
export default function PlanImportDialog({ onClose, onDone }: Props) {
  const { data: loaded, refetch: refetchLoaded } = useCostPlanPeriods();
  const current = loaded?.periods?.[0];
  const [files, setFiles] = useState<File[]>([]);
  const [master, setMaster] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlanUploadResponse | null>(null);
  const [masterResult, setMasterResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendPlan = async () => {
    if (!files.length) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("dry_run", String(dryRun));
      const res = await api.post<PlanUploadResponse>("/cost-plan/upload", form);
      setResult(res.data);
      if (!dryRun && res.data.rows_written > 0) { refetchLoaded(); onDone(); }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
      const detail = e.response?.data?.detail;
      if (detail && typeof detail === "object" && Array.isArray((detail as { errors?: unknown }).errors)) {
        const d = detail as { errors: { file: string; error: string }[] };
        setResult({ files_accepted: 0, files_rejected: d.errors.length, rows_written: 0, results: [], errors: d.errors });
      } else {
        setError(typeof detail === "string" ? detail : e.message ?? "Upload failed");
      }
    } finally { setBusy(false); }
  };

  const sendMaster = async () => {
    if (!master) return;
    setBusy(true); setError(null); setMasterResult(null);
    try {
      const form = new FormData();
      form.append("file", master);
      const res = await api.post("/cost-plan/masters", form);
      setMasterResult(`${res.data.cost_elements} cost elements and ${res.data.cost_centres} cost centres loaded.`);
      onDone();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
      setError(String(e.response?.data?.detail ?? e.message ?? "Upload failed"));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-md border border-border bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-border-light px-5 py-3">
          <div>
            <h2 className="font-condensed text-[15px] font-black uppercase tracking-[.05em] text-navy">
              Upload cost plan
            </h2>
            <p className="mt-0.5 text-[11px] text-txt-light">
              The same SAP CO export you load into SAP - one period at a time
            </p>
            {/* Removing the Cost Plan screen left nowhere else to see what the
                sheet is currently planning against. It belongs here. */}
            <p className="mt-1 text-[11px] text-txt-secondary">
              {current
                ? `Loaded now: ${monthLabel(current.plan_month)} · ${current.rows} rows · Rs ${rupees(current.amount_total)}`
                : "No plan loaded yet - the month-end accrual has nothing to pro-rate."}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-txt-light hover:bg-bg-section hover:text-navy">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block cursor-pointer rounded border-2 border-dashed border-border px-4 py-5 text-center hover:border-gold hover:bg-bg-section">
            <FileSpreadsheet size={20} className="mx-auto text-txt-light" />
            <p className="mt-2 text-[12px] font-semibold text-navy">
              {files.length ? `${files.length} plan file${files.length > 1 ? "s" : ""} selected` : "Choose plan exports (.csv or .xlsx)"}
            </p>
            <p className="mt-0.5 text-[11px] text-txt-light">
              Salary Planning, CC OH Plan, depreciation Plan - all of a month at once is fine
            </p>
            <input type="file" accept=".csv,.xlsx" multiple hidden
              onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResult(null); setError(null); }} />
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-txt-secondary">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            Check without saving - parse and report, write nothing
          </label>

          <div className="flex justify-end">
            <button onClick={sendPlan} disabled={busy || !files.length}
              className="flex items-center gap-1.5 rounded border border-gold-dark bg-gold px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-white disabled:opacity-40">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {dryRun ? "CHECK PLAN" : "UPLOAD PLAN"}
            </button>
          </div>

          <div className="border-t border-border-light pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-txt-secondary">
              <BookOpen size={12} /> Descriptions (CE and CC List) - load once, refresh when it changes
            </p>
            <div className="flex items-center gap-2">
              <label className="flex-1 cursor-pointer truncate rounded border border-border px-3 py-1.5 text-[11px] text-txt-secondary hover:bg-bg-section">
                {master ? master.name : "Choose CE and CC List.xlsx"}
                <input type="file" accept=".xlsx" hidden
                  onChange={(e) => { setMaster(e.target.files?.[0] ?? null); setMasterResult(null); }} />
              </label>
              <button onClick={sendMaster} disabled={busy || !master}
                className="rounded border border-border px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-txt-secondary hover:bg-bg-section disabled:opacity-40">
                LOAD
              </button>
            </div>
            {masterResult ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-green-700">
                <CheckCircle2 size={12} /> {masterResult}
              </p>
            ) : null}
          </div>

          {error ? (
            <div className="flex gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          ) : null}

          {result ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-4 rounded border border-border-light bg-bg-section px-3 py-2 text-[12px]">
                <span className="font-semibold text-navy">{result.files_accepted} accepted</span>
                {result.files_rejected > 0 ? <span className="text-red-600">{result.files_rejected} rejected</span> : null}
                <span className="text-txt-secondary">{result.rows_written} rows written</span>
              </div>
              {result.results.map((r) => (
                <div key={r.file} className="rounded border border-border-light px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-1.5 font-semibold text-navy">
                    <CheckCircle2 size={12} className="text-green-600" />
                    <span className="truncate">{r.file}</span>
                    {!r.written ? <span className="ml-auto shrink-0 rounded bg-gold-light/30 px-1.5 py-0.5 text-gold-dark">NOT SAVED</span> : null}
                  </div>
                  <div className="mt-1 text-txt-secondary">
                    FY{r.fiscal_year} P{r.period} = {monthLabel(r.plan_month)} · {r.rows_parsed} rows · Rs {rupees(r.amount_total)}
                    {r.written ? ` · ${r.rows_new} new, ${r.rows_changed} changed, ${r.rows_identical} unchanged` : ""}
                  </div>
                  <div className="mt-1 text-txt-light">
                    {Object.entries(r.by_section).map(([u, v]) => `${u} ${v.rows}`).join(" · ")}
                  </div>
                  {r.negative_rows > 0 ? (
                    <div className="mt-1 text-amber-700">{r.negative_rows} credit row(s) - deduction elements carry negatives.</div>
                  ) : null}
                  {r.rows_skipped_unreadable > 0 ? (
                    <div className="mt-1 text-amber-700">{r.rows_skipped_unreadable} row(s) skipped as unreadable.</div>
                  ) : null}
                </div>
              ))}
              {result.errors.map((e) => (
                <div key={e.file} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  <span className="font-semibold">{e.file}</span> — {e.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-border-light px-5 py-3">
          <button onClick={onClose} className="rounded border border-border px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-txt-secondary hover:bg-bg-section">
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
