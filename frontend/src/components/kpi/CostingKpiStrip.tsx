"use client";
import { IndianRupee, Scale, TrendingUp, AlertTriangle } from "lucide-react";
import { useCostCurve, useCostCoverage } from "@/hooks/useCosting";
import { formatIndian } from "@/lib/utils";
import type { CostSection } from "@/types";

/** Rs. 1,23,45,678 -> "1.23 Cr" / "12.35 L" — Indian reading, not 12.3M. */
function crore(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return formatIndian(n);
}

function Card({
  label, sub, value, unit, icon: Icon, bar, foot,
}: {
  label: string; sub?: string; value: string; unit?: string;
  icon: React.ElementType; bar: string; foot?: React.ReactNode;
}) {
  return (
    <div className={`bg-white border border-[#d0d9e8] rounded shadow-sm p-4 ${bar}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-condensed text-[11px] font-bold tracking-[.14em] uppercase text-txt-muted">
            {label}
          </div>
          {sub && <div className="text-[11px] text-txt-light mt-0.5 truncate">{sub}</div>}
        </div>
        <Icon size={15} className="text-txt-light shrink-0" />
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-[25px] leading-none font-bold text-txt-primary tabular-nums">
          {value}
        </span>
        {unit && <span className="text-[12px] text-txt-muted font-medium">{unit}</span>}
      </div>

      {foot && <div className="mt-2.5 pt-2.5 border-t border-[#eef2f8]">{foot}</div>}
    </div>
  );
}

export default function CostingKpiStrip({
  period, section,
}: { period: string; section: CostSection }) {
  const { data: curve, isLoading } = useCostCurve(period, section);
  const { data: cov } = useCostCoverage(period, section);

  if (isLoading || !curve || curve.series.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-[#d0d9e8] rounded h-[132px] animate-pulse" />
        ))}
      </div>
    );
  }

  const last = curve.series[curve.series.length - 1];
  const measured = last.daily + last.form + last.feed;
  const estimated = last.month_end_used;
  const estPct = last.total_cost > 0 ? (estimated / last.total_cost) * 100 : 0;

  // Run-rate projection: today's Rs./MT held flat to month end. Only
  // meaningful once a few days of production exist.
  const projected =
    last.cum_qty_mt > 0 && curve.days_elapsed >= 3
      ? (last.total_cost / curve.days_elapsed) * curve.days_in_month
      : null;

  const qtyLabel = section === "MINES" ? "ore" : "concentrate";
  const lateAmt = cov?.posting_lag.late_posted_amount ?? 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <Card
        label="Cost to date"
        sub={`Day ${curve.days_elapsed} of ${curve.days_in_month}`}
        value={crore(last.total_cost)}
        unit="Rs."
        icon={IndianRupee}
        bar="accent-bar-blue"
        foot={
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-txt-muted">
              measured <span className="font-mono font-bold text-success">{crore(measured)}</span>
            </span>
            <span className="text-txt-muted">
              accrued <span className="font-mono font-bold text-warning">{crore(estimated)}</span>
            </span>
          </div>
        }
      />

      <Card
        label="Cost per tonne"
        sub={`${formatIndian(last.cum_qty_mt)} MT ${qtyLabel} to date`}
        value={last.rs_per_mt != null ? formatIndian(last.rs_per_mt) : "—"}
        unit="Rs./MT"
        icon={Scale}
        bar="accent-bar-gold"
        foot={
          <div className="text-[11px] text-txt-muted">
            cumulative — settles as the month fills
          </div>
        }
      />

      <Card
        label="Projected month end"
        sub="today's run-rate held flat"
        value={projected != null ? crore(projected) : "—"}
        unit="Rs."
        icon={TrendingUp}
        bar="accent-bar-teal"
        foot={
          <div className="text-[11px] text-txt-muted">
            {projected != null
              ? "indicative only — contractor bills land late"
              : "needs 3+ days of data"}
          </div>
        }
      />

      <Card
        label="Estimated share"
        sub="accrued from plan, not posted"
        value={estPct.toFixed(0)}
        unit="%"
        icon={AlertTriangle}
        bar={estPct > 50 ? "accent-bar-orange" : "accent-bar-green"}
        foot={
          <div className="text-[11px] text-txt-muted">
            {lateAmt !== 0 ? (
              <>
                <span className="font-mono font-bold text-danger">{crore(lateAmt)}</span>{" "}
                posted after period end
              </>
            ) : (
              "nothing posted after period end"
            )}
          </div>
        }
      />
    </div>
  );
}
