"use client";
/**
 * Importing the monthly cost plan.
 *
 * Two steps and nothing else: choose the files, then save. What the files
 * ARE is never asked - every SAP CO export carries its identity in the
 * header block above the rows (CO Area, Version, Fiscal Year, Period n To
 * m), so the server reads that and reports which month it covers and how
 * many rows will be written. The CE and CC List is recognised the same way,
 * so both kinds of file go through one picker.
 */
import React, { useState } from "react";
import {
  Upload, X, AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, BookOpen,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { useCostPlanPeriods, usePlanCoverage } from "@/hooks/useCostPlan";

interface Props {
  onClose: () => void;
  /** Fired once rows are actually written, so the sheet can re-read. */
  onDone: () => void;
}

const rupees = (n: number | null | undefined) =>
  n == null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = (iso: string | null | undefined) => {
  if (!iso) return "-";
  const [y, m] = iso.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
};

/** The dates a period covers, since a date range is what is being written. */
const monthRange = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `1 - ${last} ${MONTHS[m - 1]} ${y}`;
};

interface Inspected {
  file: string;
  kind: "plan" | "masters" | "error";
  error?: string;
  /* plan */
  fiscal_year?: number;
  period?: number;
  plan_month?: string;
  rows_parsed?: number;
  site_rows?: number;
  site_amount?: number;
  negative_rows?: number;
  rows_skipped_unreadable?: number;
  /* masters */
  cost_elements?: number;
  cost_centres?: number;
}

export default function PlanImportDialog({ onClose, onDone }: Props) {
  const { data: loaded, refetch: refetchLoaded } = useCostPlanPeriods();
  const current = loaded?.periods?.[0];
  const empId = useAuth((s) => s.user?.emp_id);

  // A month's plan is four exports. Which ones are in is the question this
  // dialog exists to answer - loading two of four produces a sheet that is
  // quietly a quarter of the cost, with nothing on screen to say so.
  const { data: cover, refetch: refetchCover } =
    usePlanCoverage(current?.fiscal_year, current?.period);

  const [files, setFiles] = useState<File[]>([]);
  const [found, setFound] = useState<Inspected[] | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plans = (found ?? []).filter((f) => f.kind === "plan");
  const masters = (found ?? []).filter((f) => f.kind === "masters");
  const bad = (found ?? []).filter((f) => f.kind === "error");
  const canSave = plans.length + masters.length > 0 && !reading && !saving && !saved;

  /** Choosing the files reads them at once - there is nothing to decide first. */
  const choose = async (picked: File[]) => {
    setFiles(picked);
    setFound(null); setError(null); setSaved(null);
    if (!picked.length) return;
    setReading(true);
    try {
      const form = new FormData();
      picked.forEach((f) => form.append("files", f));
      const res = await api.post<{ files: Inspected[] }>("/cost-plan/inspect", form);
      setFound(res.data.files);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
      setError(String(e.response?.data?.detail ?? e.message ?? "Could not read the files"));
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    setSaving(true); setError(null); setSaved(null);
    try {
      let written = 0;
      const planFiles = files.filter((f) => plans.some((p) => p.file === f.name));
      if (planFiles.length) {
        const form = new FormData();
        planFiles.forEach((f) => form.append("files", f));
        form.append("dry_run", "false");
        if (empId) form.append("uploaded_by", empId);
        const res = await api.post<{ rows_written: number }>("/cost-plan/upload", form);
        written = res.data.rows_written;
      }
      let names = 0;
      for (const f of files.filter((x) => masters.some((m) => m.file === x.name))) {
        const form = new FormData();
        form.append("file", f);
        const res = await api.post<{ cost_elements: number; cost_centres: number }>(
          "/cost-plan/masters", form);
        names += res.data.cost_elements + res.data.cost_centres;
      }
      setSaved([
        written ? `${written} plan rows saved` : "",
        names ? `${names} descriptions saved` : "",
      ].filter(Boolean).join(" · ") || "Nothing to save.");
      refetchLoaded();
      refetchCover();
      onDone();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
      const detail = e.response?.data?.detail;
      setError(typeof detail === "string" ? detail : e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-md border border-border bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-border-light px-5 py-3">
          <div>
            <h2 className="font-condensed text-[15px] font-black uppercase tracking-[.05em] text-navy">
              Import cost plan
            </h2>
            {/* Mines + COB only. The export carries the whole company, so its
                own total says nothing about what this mine plans to spend. */}
            <p className="mt-0.5 text-[11px] text-txt-light">
              {current
                ? `Loaded now: ${monthLabel(current.plan_month)} · ${current.mines_rows} rows for this mine · Rs ${rupees(current.mines_amount)}`
                : "No plan loaded yet - the month-end accrual has nothing to pro-rate."}
            </p>
          </div>
          <button onClick={onClose}
            className="rounded p-1 text-txt-light hover:bg-bg-section hover:text-navy">
            <X size={16} />
          </button>
        </div>

        {cover ? (
          <div className={`border-b border-border-light px-5 py-3 ${
            cover.complete ? "bg-green-50/60" : "bg-gold-light/10"}`}>
            <p className="text-[11px] font-semibold text-txt-primary">
              {monthLabel(cover.plan_month)} — {cover.files_loaded} of {cover.files_expected} plan
              exports loaded
              {cover.complete ? " · complete" : ""}
            </p>
            <ul className="mt-1.5 space-y-1">
              {cover.files.map((f) => (
                <li key={f.name} className="flex items-start gap-1.5 text-[11px]">
                  {f.present
                    ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-green-600" />
                    : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-gold-dark" />}
                  <span className={f.present ? "text-txt-secondary" : "text-txt-primary"}>
                    <span className="font-semibold">{f.name}</span>
                    {f.present ? (
                      <> — Rs {rupees(f.amount)}</>
                    ) : f.missing_lines.length ? (
                      <> — not loaded, so{" "}
                        <span className="text-amber-800">{f.missing_lines.join(", ")}</span>{" "}
                        {f.missing_lines.length === 1 ? "is" : "are"} missing from the cost sheet
                      </>
                    ) : (
                      <> — not loaded, though its lines are already covered by another export</>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {cover.unrecognised_files.length ? (
              <p className="mt-1.5 text-[11px] text-txt-light">
                Also loaded, not one of the four: {cover.unrecognised_files.join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3 px-5 py-4">
          {/* ── 1. choose, and it reads itself ───────────────────── */}
          <label className="block cursor-pointer rounded border-2 border-dashed border-border px-4 py-5 text-center hover:border-gold hover:bg-bg-section">
            {reading
              ? <Loader2 size={20} className="mx-auto animate-spin text-gold-dark" />
              : <FileSpreadsheet size={20} className="mx-auto text-txt-light" />}
            <p className="mt-2 text-[12px] font-semibold text-navy">
              {reading
                ? "Reading the files…"
                : files.length
                  ? `${files.length} file${files.length > 1 ? "s" : ""} chosen`
                  : "Choose plan exports (.csv or .xlsx)"}
            </p>
            <p className="mt-0.5 text-[11px] text-txt-light">
              Salary Planning, CC OH Plan, depreciation Plan, or the CE and CC List
            </p>
            <input type="file" accept=".csv,.xlsx" multiple hidden
              onChange={(e) => choose(Array.from(e.target.files ?? []))} />
          </label>

          {/* ── what each file turned out to be ──────────────────── */}
          {plans.map((p) => (
            <div key={p.file} className="rounded border border-border-light px-3 py-2 text-[11px]">
              <div className="flex items-center gap-1.5 font-semibold text-navy">
                <CheckCircle2 size={12} className="text-green-600" />
                <span className="truncate">{p.file}</span>
                <span className="ml-auto shrink-0 rounded bg-bg-section px-1.5 py-0.5 tracking-wider text-txt-secondary">
                  COST PLAN
                </span>
              </div>
              <div className="mt-1 text-[12px] font-semibold text-txt-primary">
                {monthRange(p.plan_month!)}
                <span className="ml-1.5 font-normal text-txt-light">
                  FY{p.fiscal_year} P{p.period}
                </span>
              </div>
              <div className="mt-0.5 text-txt-secondary">
                <strong>{p.rows_parsed}</strong> rows to write, of which{" "}
                <strong>{p.site_rows}</strong> are this mine &middot; Rs {rupees(p.site_amount)}
              </div>
              {p.negative_rows ? (
                <div className="mt-1 text-amber-700">
                  {p.negative_rows} credit row(s) - deduction elements carry negatives.
                </div>
              ) : null}
              {p.rows_skipped_unreadable ? (
                <div className="mt-1 text-amber-700">
                  {p.rows_skipped_unreadable} row(s) unreadable and will be skipped.
                </div>
              ) : null}
            </div>
          ))}

          {masters.map((m) => (
            <div key={m.file} className="rounded border border-border-light px-3 py-2 text-[11px]">
              <div className="flex items-center gap-1.5 font-semibold text-navy">
                <BookOpen size={12} className="text-gold-dark" />
                <span className="truncate">{m.file}</span>
                <span className="ml-auto shrink-0 rounded bg-bg-section px-1.5 py-0.5 tracking-wider text-txt-secondary">
                  DESCRIPTIONS
                </span>
              </div>
              <div className="mt-1 text-txt-secondary">
                {m.cost_elements} cost elements and {m.cost_centres} cost centres - names, not
                amounts, so they carry no period and apply to every month.
              </div>
            </div>
          ))}

          {bad.map((b) => (
            <div key={b.file}
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
              <span className="font-semibold">{b.file}</span> &mdash; {b.error}
            </div>
          ))}

          {error ? (
            <div className="flex gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          ) : null}

          {saved ? (
            <div className="flex items-center gap-1.5 rounded border border-green-200 bg-green-50 px-3 py-2 text-[12px] text-green-700">
              <CheckCircle2 size={14} /> {saved}
            </div>
          ) : null}
        </div>

        {/* ── 2. save ──────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 border-t border-border-light px-5 py-3">
          <button onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-txt-secondary hover:bg-bg-section">
            CLOSE
          </button>
          <button onClick={save} disabled={!canSave}
            className="flex items-center gap-1.5 rounded border border-gold-dark bg-gold px-4 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-white disabled:opacity-40">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}
