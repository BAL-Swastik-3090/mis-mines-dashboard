"use client";
import { AlertTriangle } from "lucide-react";
import { useRealityCheck } from "@/hooks/useInsights";
import { useDateFilter } from "@/contexts/useDateFilter";
import type { RealityCheckRow, InsightVerdict } from "@/types";

// ── Verdict styling ────────────────────────────────────────────
const VERDICT_CONFIG: Record<InsightVerdict, { label: string; cls: string }> = {
  ACHIEVABLE:   { label: "ACHIEVABLE",   cls: "bg-success/10 text-success border border-success/30 font-bold" },
  STRETCH:      { label: "STRETCH",      cls: "bg-warning/10 text-warning border border-warning/30 font-bold" },
  NOT_FEASIBLE: { label: "NOT FEASIBLE", cls: "bg-danger/10 text-danger border border-danger/30 font-bold" },
  NO_DATA:      { label: "NO DATA",      cls: "bg-bg-section text-txt-light border border-border font-normal" },
  "N/A":        { label: "N/A",          cls: "bg-bg-section text-txt-light border border-border font-normal" },
};

function VerdictBadge({ verdict }: { verdict: InsightVerdict }) {
  const cfg = VERDICT_CONFIG[verdict] ?? VERDICT_CONFIG["N/A"];
  return (
    <span className={`text-[10px] tracking-widest px-2 py-0.5 rounded ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function UpliftCell({ uplift, verdict }: { uplift: number | null; verdict: InsightVerdict }) {
  if (uplift == null) return <span className="text-txt-light">—</span>;
  const color =
    verdict === "ACHIEVABLE"   ? "text-success font-bold" :
    verdict === "STRETCH"      ? "text-warning font-bold" :
    verdict === "NOT_FEASIBLE" ? "text-danger  font-bold" : "text-txt-muted";
  return <span className={color}>{uplift.toFixed(1)}×</span>;
}

function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} bg-bg-section rounded animate-pulse`} />;
}

// ── Row ───────────────────────────────────────────────────────
function RcRow({ row, loading }: { row?: RealityCheckRow; loading: boolean }) {
  if (loading || !row) {
    return (
      <tr className="border-b border-border-light">
        {Array.from({ length: 8 }).map((_, i) => (
          <td key={i} className="px-3 py-3">
            <Shimmer w={i === 0 ? "w-32" : "w-16"} />
          </td>
        ))}
      </tr>
    );
  }

  const gapColor = row.gap > 0 ? "text-danger" : "text-success";
  const fmt = (v: number | null, decimals = 0) =>
    v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: decimals });

  return (
    <tr className="border-b border-border-light hover:bg-bg-soft transition-colors">
      <td className="px-3 py-3 font-semibold text-txt-primary text-[13px] whitespace-nowrap">
        {row.kpi}
        <span className="ml-1.5 text-[10px] text-txt-light font-normal">({row.unit})</span>
      </td>
      <td className="px-3 py-3 text-right font-mono text-[12px] text-txt-primary">
        {fmt(row.plan)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-[12px] text-accent font-semibold">
        {fmt(row.actual)}
      </td>
      <td className={`px-3 py-3 text-right font-mono text-[12px] font-semibold ${gapColor}`}>
        {fmt(row.gap)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-[12px] text-txt-secondary">
        {fmt(row.run_rate_per_day, 0)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-[12px] text-txt-secondary">
        {fmt(row.required_per_day, 0)}
      </td>
      <td className="px-3 py-3 text-right">
        <UpliftCell uplift={row.uplift} verdict={row.verdict} />
      </td>
      <td className="px-3 py-3 text-center">
        <VerdictBadge verdict={row.verdict} />
      </td>
    </tr>
  );
}

// ── Section ───────────────────────────────────────────────────
export default function RealityCheckSection() {
  const { apiTo } = useDateFilter();
  const { data, isLoading } = useRealityCheck();

  const asOn      = data?.as_on     ?? apiTo;
  const remaining = data?.days_remaining ?? "—";
  const elapsed   = data?.days_elapsed   ?? "—";
  const cyclePct  = data?.cycle_pct      ?? "—";
  const monthEnd  = data?.month_end      ?? "—";

  const asOnFmt = new Date(asOn + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .toUpperCase();

  return (
    <section className="space-y-4">

      {/* Header */}
      <div className="section-title">
        <AlertTriangle size={13} className="text-danger" />
        Reality Check · Month-End Feasibility

        <span className="ml-auto flex items-center gap-2 normal-case tracking-normal font-normal text-[11px] text-txt-muted">
          <span className="bg-danger text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-wider">
            @ {asOnFmt}
          </span>
        </span>
      </div>

      {/* Cycle progress */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-border-light flex items-center gap-4 flex-wrap">
          <span className="text-[11px] text-txt-muted font-mono">
            Cycle <strong className="text-txt-primary">{cyclePct}%</strong> elapsed
            &nbsp;·&nbsp;
            <strong className="text-danger">{remaining}</strong> days remaining to{" "}
            <strong className="text-txt-primary">{monthEnd}</strong>
            &nbsp;·&nbsp;
            <strong className="text-accent">{elapsed}</strong> days elapsed
          </span>

          {/* Progress bar */}
          <div className="flex-1 min-w-[120px] h-1.5 bg-bg-section rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent to-danger rounded-full transition-all"
              style={{ width: `${cyclePct}%` }}
            />
          </div>
        </div>

        {/* Plan fallback notice */}
        {data?.plan_fallback && (
          <div className="px-4 py-2 bg-warning/5 border-b border-warning/20 flex items-center gap-2">
            <span className="text-warning text-[10px]">⚠</span>
            <span className="text-[11px] text-warning/80">
              Plan data for the selected month is not yet entered — using{" "}
              <strong>{data.plan_month}</strong> plan as reference.
            </span>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-bg-soft border-b border-border">
                {["KPI", "Full Month Plan", "MTD Actual", "Gap", "Run-Rate/Day", "Required/Day", "Uplift Needed", "Verdict"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-[10px] font-extrabold tracking-widest uppercase text-txt-secondary text-right first:text-left last:text-center"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => <RcRow key={i} loading />)
                : (data?.rows ?? []).map((row) => (
                    <RcRow key={row.kpi} row={row} loading={false} />
                  ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="px-4 py-2.5 bg-bg-soft border-t border-border-light flex items-center gap-4 flex-wrap">
          <span className="text-[9px] font-bold tracking-widest uppercase text-txt-light">Verdict legend</span>
          {(["ACHIEVABLE", "STRETCH", "NOT_FEASIBLE"] as InsightVerdict[]).map((v) => {
            const cfg = VERDICT_CONFIG[v];
            return (
              <span key={v} className={`text-[9px] tracking-wider px-2 py-0.5 rounded ${cfg.cls}`}>
                {v === "ACHIEVABLE" ? "≤1.5×" : v === "STRETCH" ? "1.5–3.5×" : ">3.5×"} · {cfg.label}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
