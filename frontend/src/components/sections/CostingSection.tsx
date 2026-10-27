"use client";
import { useState } from "react";
import { Calculator, Info } from "lucide-react";
import CostingKpiStrip from "@/components/kpi/CostingKpiStrip";
import CostCurveChart from "@/components/charts/CostCurveChart";
import CostSummaryTable from "@/components/tables/CostSummaryTable";
import GlWiseTable from "@/components/tables/GlWiseTable";
import {
  currentPeriod, periodLabel, usePeriods, useCostCoverage,
} from "@/hooks/useCosting";
import { formatIndian } from "@/lib/utils";
import type { CostSection } from "@/types";

const SECTIONS: { id: CostSection; label: string }[] = [
  { id: "MINES", label: "Mines" },
  { id: "COB", label: "COB Plant" },
];

// The workbook is two sheets and the department reads them as two steps:
// the cost sheet, then the GL detail that proves it. Tabs rather than one
// long scroll, because nobody checking a Rs./MT figure wants to page past a
// 140-row ledger to reach it.
type Phase = "summary" | "detail";

export default function CostingSection() {
  const { data: meta } = usePeriods();
  const [period, setPeriod] = useState<string>("");
  const [section, setSection] = useState<CostSection>("MINES");
  const [phase, setPhase] = useState<Phase>("summary");

  // Settle on the newest period the backend actually has, once it is known.
  const periods = meta?.periods ?? [];
  const active = period || periods[0] || currentPeriod();
  const { data: cov } = useCostCoverage(active, section);

  return (
    <section className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded bg-navy flex items-center justify-center shrink-0">
            <Calculator size={20} className="text-gold" />
          </div>
          <div>
            <h2 className="font-condensed text-[22px] font-bold text-txt-primary leading-tight">
              Product Costing
            </h2>
            <p className="text-[12px] text-txt-muted">
              Cost incurred to date and cost per tonne — {periodLabel(active)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-[#d0d9e8] rounded overflow-hidden">
            {([
              { id: "summary" as Phase, label: "Summary" },
              { id: "detail" as Phase, label: "GL Detail" },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setPhase(t.id)}
                className={[
                  "px-3 py-1.5 font-condensed text-[12px] font-bold tracking-wide uppercase transition-colors",
                  phase === t.id
                    ? "bg-gold text-white"
                    : "bg-white text-txt-secondary hover:bg-bg-soft",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={`flex border border-[#d0d9e8] rounded overflow-hidden ${phase === "detail" ? "opacity-40 pointer-events-none" : ""}`}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={[
                  "px-3 py-1.5 font-condensed text-[12px] font-bold tracking-wide uppercase transition-colors",
                  section === s.id
                    ? "bg-navy text-white"
                    : "bg-white text-txt-secondary hover:bg-bg-soft",
                ].join(" ")}
              >
                {s.label}
              </button>
            ))}
          </div>

          <select
            id="costing-period"
            value={active}
            onChange={(e) => setPeriod(e.target.value)}
            className="border border-[#d0d9e8] rounded px-3 py-1.5 text-[12px] font-mono
                       text-txt-secondary bg-white focus:outline-none focus:border-accent"
          >
            {(periods.length ? periods : [active]).map((p) => (
              <option key={p} value={p}>{periodLabel(p)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── How to read the number ─────────────────────────────── */}
      <div className="flex items-start gap-2.5 bg-[#fff8e6] border border-[#f0dca8] rounded px-4 py-2.5">
        <Info size={15} className="text-gold-dark shrink-0 mt-0.5" />
        <p className="text-[12px] text-txt-secondary leading-relaxed">
          Prototype running on the costing workbook extract — not the live ledger. Cost is
          accrued on <strong>{meta?.default_basis === "doc" ? "document date" : "posting date"}</strong>,
          matching how Finance pulled the sheet. Daily, contractor and feed costs are{" "}
          <strong>posted actuals</strong>; the month-end block is <strong>accrued from plan</strong>{" "}
          while the month is open.
        </p>
      </div>

      {/* ── Phase 2: the GL wise summary sheet ─────────────────── */}
      {phase === "detail" && <GlWiseTable period={active} />}

      {/* ── Phase 1: the cost sheet ────────────────────────────── */}
      {phase === "summary" && <CostingKpiStrip period={active} section={section} />}
      {phase === "summary" && <CostCurveChart period={active} section={section} />}
      {phase === "summary" && <CostSummaryTable period={active} section={section} />}

      {/* ── Data coverage ──────────────────────────────────────── */}
      {phase === "summary" && cov && (
        <div className="bg-white border border-[#d0d9e8] rounded shadow-sm p-4 accent-bar-teal">
          <div className="font-condensed text-[12px] font-bold tracking-[.14em] uppercase text-steel mb-3">
            What this figure is built from
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[560px]">
              <thead>
                <tr className="text-txt-muted border-b border-[#d0d9e8]">
                  <th className="text-left font-medium pb-1.5">Bucket</th>
                  <th className="text-left font-medium pb-1.5">Source</th>
                  <th className="text-right font-medium pb-1.5">Actual posted</th>
                  <th className="text-right font-medium pb-1.5">Plan</th>
                </tr>
              </thead>
              <tbody>
                {cov.buckets.map((b) => (
                  <tr key={b.bucket} className="border-b border-[#eef2f8]">
                    <td className="py-1.5 font-mono text-txt-secondary">{b.bucket}</td>
                    <td className="py-1.5 text-txt-muted">{b.source}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-txt-primary">
                      {formatIndian(b.actual)}
                    </td>
                    <td className={`py-1.5 text-right font-mono tabular-nums ${
                      b.has_plan ? "text-txt-primary" : "text-danger"}`}>
                      {b.has_plan ? formatIndian(b.plan) : "no plan"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-txt-muted">
            <span>
              Median entry lag{" "}
              <strong className="font-mono text-txt-secondary">
                {cov.posting_lag.median_lag_days ?? "—"} days
              </strong>
            </span>
            <span>
              Posted after period end{" "}
              <strong className="font-mono text-txt-secondary">
                {cov.posting_lag.late_posted_lines} lines
              </strong>{" "}
              ({formatIndian(cov.posting_lag.late_posted_amount)})
            </span>
          </div>

          {cov.warnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {cov.warnings.map((w) => (
                <li key={w} className="text-[12px] text-warning flex items-start gap-1.5">
                  <span className="font-bold">!</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
