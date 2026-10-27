"use client";
/**
 * The monthly cost plan as uploaded from SAP.
 *
 * Mines is the default view because that is whose costing this serves, but
 * the export covers the whole company and the section split is shown rather
 * than hidden - a plan that silently dropped three quarters of its rows
 * would be worse than one that shows them.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  IndianRupee, Upload, X, AlertTriangle, CheckCircle2, FileSpreadsheet,
  Loader2, BookOpen, Building2,
} from "lucide-react";
import api from "@/lib/api";
import { useCostPlanPeriods, useCostPlanSummary } from "@/hooks/useCostPlan";

const SECTIONS = ["MINES", "COB"] as const;

/* While the plan is still being fetched the tiles say nothing rather than
   zero: "0 cost centres" is a finding, and we have not found it yet. */
const LOADING_TILES = (section: string) => [
  { label: `${section} plan`, value: "…", hint: "loading" },
  { label: "This site", value: "…", hint: "Mines + COB" },
  { label: "Cost centres", value: "…", hint: `in ${section}` },
  { label: "Cost elements", value: "…", hint: `in ${section}` },
];

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
function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
      if (!dryRun && res.data.rows_written > 0) onDone();
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

/* ── section ────────────────────────────────────────────────────── */
export default function CostPlanSection() {
  const { data: periodData, isLoading: periodsLoading, refetch: refetchPeriods } = useCostPlanPeriods();
  const [selected, setSelected] = useState<string>("");
  const [section, setSection] = useState<string>("MINES");
  const [showUpload, setShowUpload] = useState(false);

  const periods = periodData?.periods ?? [];
  useEffect(() => {
    if (!selected && periods.length) setSelected(`${periods[0].fiscal_year}-${periods[0].period}`);
  }, [periods, selected]);

  const [fy, p] = useMemo(() => {
    const [a, b] = (selected || "-").split("-");
    return [Number(a) || null, Number(b) || null];
  }, [selected]);

  const { data: summary, isLoading, refetch: refetchSummary } = useCostPlanSummary(fy, p, section);
  const loading = periodsLoading || (isLoading && !summary);
  const refreshAll = () => { refetchPeriods(); refetchSummary(); };

  const masters = periodData?.masters;
  const mastersMissing = masters && masters.elements === 0 && masters.centres === 0;
  const unmapped = (masters?.unmapped_elements ?? 0) + (masters?.unmapped_centres ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-light pb-3">
        <div>
          <div className="flex items-center gap-2">
            <IndianRupee size={18} className="text-gold" />
            <h1 className="font-condensed text-[22px] font-black uppercase tracking-[.04em] text-navy">
              Cost Plan
            </h1>
          </div>
          <p className="ml-[26px] mt-0.5 text-[11px] text-txt-light">
            Planned cost per cost centre and cost element, as uploaded from SAP
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-border bg-white px-2 py-1.5 text-[11px] font-semibold text-navy">
            {periods.length === 0 ? (
              <option value="">{periodsLoading ? "Loading…" : "No plan uploaded"}</option>
            ) : null}
            {periods.map((pr) => (
              <option key={`${pr.fiscal_year}-${pr.period}`} value={`${pr.fiscal_year}-${pr.period}`}>
                {monthLabel(pr.plan_month)} · FY{pr.fiscal_year} P{pr.period}
              </option>
            ))}
          </select>
          <select value={section} onChange={(e) => setSection(e.target.value)}
            className="rounded border border-border bg-white px-2 py-1.5 text-[11px] font-semibold text-navy">
            {SECTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 rounded border border-border bg-white px-3 py-1.5 text-[11px] font-condensed font-bold tracking-widest text-txt-secondary shadow-sm hover:bg-bg-section hover:text-navy">
            <Upload size={12} /> UPLOAD PLAN
          </button>
        </div>
      </div>

      {mastersMissing ? (
        <div className="flex items-start gap-2 rounded-md border border-gold/30 bg-gold-light/10 px-4 py-3 text-[12px] text-txt-secondary">
          <BookOpen size={15} className="mt-0.5 shrink-0 text-gold-dark" />
          <span>
            <span className="font-semibold text-txt-primary">Descriptions not loaded. </span>
            The plan will show numbers without names until the CE and CC List workbook is uploaded.
          </span>
        </div>
      ) : null}

      {unmapped > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {masters?.unmapped_elements} cost element(s) and {masters?.unmapped_centres} cost centre(s) in the plan
            have no description. Re-upload the CE and CC List to pick them up.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(loading ? LOADING_TILES(section) : [
          { label: `${section} plan`, value: summary ? `Rs ${rupees(summary.totals.amount)}` : "-", hint: `${summary?.totals.rows ?? 0} rows` },
          {
            label: "This site",
            value: summary
              ? `Rs ${rupees(summary.by_section
                  .filter((s) => s.section === "MINES" || s.section === "COB")
                  .reduce((a, b) => a + b.amount, 0))}`
              : "-",
            hint: "Mines + COB",
          },
          { label: "Cost centres", value: String(summary?.by_centre.length ?? 0), hint: `in ${section}` },
          { label: "Cost elements", value: String(summary?.by_element.length ?? 0), hint: `in ${section}` },
        ]).map((k) => (
          <div key={k.label} className="rounded-md border border-border-light bg-white p-4 shadow-sm">
            <div className="text-[10px] font-condensed font-bold uppercase tracking-widest text-txt-light">{k.label}</div>
            <div className="mt-1 font-condensed text-[24px] font-black text-navy">{k.value}</div>
            <div className="text-[11px] text-txt-light">{k.hint}</div>
          </div>
        ))}
      </div>

      {loading ? <p className="text-[12px] text-txt-light">Loading…</p> : null}

      {summary ? (
        <>
          <Panel
            title="By section"
            subtitle="OTHER is the other plants carried in the same export — stored for fidelity, not this mine's cost"
          >
            <Table head={["Section", "Rows", "Planned (Rs)"]}
              rows={summary.by_section.map((u) => [u.section, String(u.rows), rupees(u.amount)])}
              highlight={(r) => r[0] === section} />
          </Panel>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title={`Cost elements — ${section}`} subtitle="largest first">
              <Table head={["Element", "Description", "Centres", "Planned (Rs)"]}
                rows={summary.by_element.map((e) => [e.cost_element, e.cost_element_desc, String(e.centres), rupees(e.amount)])} />
            </Panel>
            <Panel title={`Cost centres — ${section}`} subtitle="largest first">
              <Table head={["Centre", "Description", "Elements", "Planned (Rs)"]}
                rows={summary.by_centre.map((c) => [c.cost_centre, c.cost_centre_desc, String(c.elements), rupees(c.amount)])} />
            </Panel>
          </div>
        </>
      ) : null}

      {showUpload ? <UploadDialog onClose={() => setShowUpload(false)} onDone={refreshAll} /> : null}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border-light bg-white shadow-sm">
      <div className="border-b border-border-light px-4 py-2.5">
        <h3 className="font-condensed text-[13px] font-black uppercase tracking-[.05em] text-navy">{title}</h3>
        {subtitle ? <p className="text-[11px] text-txt-light">{subtitle}</p> : null}
      </div>
      <div className="max-h-[420px] overflow-auto">{children}</div>
    </div>
  );
}

function Table({ head, rows, highlight }: {
  head: string[]; rows: string[][]; highlight?: (r: string[]) => boolean;
}) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-[12px] text-txt-light">Nothing for this selection.</p>;
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-bg-section">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`px-3 py-2 font-condensed font-bold uppercase tracking-wider text-txt-light ${i >= head.length - 2 ? "text-right" : "text-left"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r[0]}-${idx}`} className={`border-t border-border-light ${highlight?.(r) ? "bg-gold-light/15 font-semibold" : ""}`}>
            {r.map((cell, i) => (
              <td key={i} className={`px-3 py-1.5 ${i >= r.length - 2 ? "text-right tabular-nums" : "text-left"} ${i === 0 ? "font-mono text-navy" : "text-txt-secondary"}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
