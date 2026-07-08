"use client";
import { formatIndian, pctBgClass, formatPct } from "@/lib/utils";
import { useCobSummary } from "@/hooks/useCob";
import type { CobDayRowAPI } from "@/types";

function Shimmer({ w = "w-24", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

function tdDateLabel(dateStr: string | undefined): string {
  if (!dateStr) return "TD";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short",
  });
}

// ── TD footer row ──────────────────────────────────────────────
function TdFooter({
  label, value, unit, precision = 0, loading, showCuM = false,
}: {
  label: string; value: number | null | undefined;
  unit: string; precision?: number; loading: boolean; showCuM?: boolean;
}) {
  return (
    <div className="px-4 py-2.5 border-t border-border-light bg-bg-light flex items-center justify-between mt-auto">
      <span className="text-[10px] text-txt-light font-bold uppercase tracking-widest">{label}</span>
      {loading ? (
        <div className="h-3.5 w-16 bg-bg-section animate-pulse rounded" />
      ) : (
        <span className="font-mono font-semibold text-[12px] text-navy whitespace-nowrap">
          {value != null ? (
            <>
              {precision > 0 ? `${value.toFixed(precision)} ${unit}` : `${formatIndian(value)} ${unit}`}
              {showCuM && (
                <>
                  <span className="text-[10px] font-normal text-txt-muted mx-1">/</span>
                  {formatIndian(Math.round(value / 3))}{" "}
                  <span className="text-[10px] font-normal text-txt-muted">CuM</span>
                </>
              )}
            </>
          ) : "—"}
        </span>
      )}
    </div>
  );
}

// ── Quantity card (Feed / COB / Tailings) ──────────────────────
interface QtyCardProps {
  label:        string;
  unit:         string;
  accentClass:  string;
  dotColor:     string;
  actual:       number;
  plan:         number;
  tdValue:      number | null | undefined;
  tdLabel:      string;
  loading:      boolean;
  showCuM?:     boolean;
  sourcePlan?:  string;
  sourceActual?: string;
}

function QtyCard({
  label, unit, accentClass, dotColor,
  actual, plan, tdValue, tdLabel, loading,
  showCuM = false, sourcePlan, sourceActual,
}: QtyCardProps) {
  const pct      = plan > 0 ? Math.round((actual / plan) * 1000) / 10 : null;
  const progress = pct != null ? Math.min(Math.max(pct, 0), 100) : 0;
  const variance = actual - plan;

  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm ${accentClass} flex flex-col overflow-hidden`}>

      {/* Header */}
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase leading-tight">
            {label}
          </span>
        </div>
        {loading ? <Shimmer w="w-14" h="h-5" /> : (
          <span className={pctBgClass(pct)}>
            Achieve % {formatPct(pct)}
          </span>
        )}
      </div>

      {/* MTD big number */}
      <div className="px-4 pb-1.5">
        {loading ? <Shimmer w="w-32" h="h-8" /> : (
          <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-navy leading-none tracking-tight">
            {formatIndian(actual)}
            <span className="text-xs font-normal text-txt-muted ml-1.5">{unit}</span>
            {showCuM && actual != null && (
              <>
                <span className="text-[20px] xl:text-[22px] font-normal text-txt-muted mx-1.5">/</span>
                {formatIndian(Math.round(actual / 3))}
                <span className="text-xs font-normal text-txt-muted ml-1.5">CuM</span>
              </>
            )}
          </div>
        )}
        {!loading && (
          <div className="text-[11px] text-txt-muted mt-1">
            Plan:{" "}
            <span className="font-semibold text-txt-secondary">{formatIndian(plan)}</span>
            {" "}<span className="text-border-strong">·</span>{" "}
            Var:{" "}
            <span className={variance >= 0 ? "text-success font-semibold" : "text-danger font-semibold"}>
              {variance >= 0 ? "+" : ""}{formatIndian(variance)}
            </span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-2.5">
        <div className="h-1.5 bg-bg-section rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              progress >= 90 ? "bg-success" : progress >= 60 ? "bg-warning" : "bg-danger"
            }`}
            style={{ width: loading ? "0%" : `${progress}%` }}
          />
        </div>
      </div>

      {/* TD footer */}
      <TdFooter label={tdLabel} value={tdValue} unit={unit} loading={loading} showCuM={showCuM} />

      {/* Data source strip */}
      {(sourcePlan || sourceActual) && (
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          {sourcePlan && (
            <p className="text-[9px] font-mono text-success/70 leading-tight">
              <span className="font-semibold text-success/60">PLAN · </span>{sourcePlan}
            </p>
          )}
          {sourceActual && (
            <p className="text-[9px] font-mono text-success/70 leading-tight">
              <span className="font-semibold text-success/60">ACTUAL · </span>{sourceActual}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Rate card (Yield % / I/O Ratio) ───────────────────────────
interface RateCardProps {
  label:        string;
  actual:       number | null;
  plan:         number | null;
  unit:         string;
  precision:    number;
  accentClass:  string;
  dotColor:     string;
  tdValue:      number | null | undefined;
  tdLabel:      string;
  loading:      boolean;
  note:         string;
  sourcePlan?:  string;
  sourceActual?: string;
}

function RateCard({
  label, actual, plan, unit, precision,
  accentClass, dotColor, tdValue, tdLabel, loading, note,
  sourcePlan, sourceActual,
}: RateCardProps) {
  const diff     = actual != null && plan != null ? actual - plan : null;
  const goodHigh = unit === "%";   // yield% → higher is better; I/O → lower is better
  const positive = diff != null && (goodHigh ? diff >= 0 : diff <= 0);

  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm ${accentClass} flex flex-col overflow-hidden`}>

      {/* Header */}
      <div className="px-4 pt-3.5 pb-2 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase leading-tight">
          {label}
        </span>
      </div>

      {/* MTD big number */}
      <div className="px-4 pb-1.5 flex-1">
        {loading ? <Shimmer w="w-28" h="h-8" /> : (
          <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-navy leading-none tracking-tight">
            {actual != null ? actual.toFixed(precision) : "—"}
            <span className="text-xs font-normal text-txt-muted ml-1.5">{unit}</span>
          </div>
        )}
        {!loading && plan != null && (
          <div className="text-[11px] text-txt-muted mt-1">
            Plan:{" "}
            <span className="font-semibold text-txt-secondary">
              {plan.toFixed(precision)}{unit}
            </span>
            {diff != null && (
              <>
                {" "}<span className="text-border-strong">·</span>{" "}
                <span className={positive ? "text-success font-semibold" : "text-danger font-semibold"}>
                  {diff >= 0 ? "+" : ""}{diff.toFixed(precision)}{unit}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Note label */}
      <div className="px-4 pb-2">
        <span className="text-[10px] text-txt-light font-semibold uppercase tracking-wider">{note}</span>
      </div>

      {/* TD footer */}
      <TdFooter
        label={tdLabel}
        value={tdValue}
        unit={unit}
        precision={precision}
        loading={loading}
      />

      {/* Data source strip */}
      {(sourcePlan || sourceActual) && (
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          {sourcePlan && (
            <p className="text-[9px] font-mono text-success/70 leading-tight">
              <span className="font-semibold text-success/60">PLAN · </span>{sourcePlan}
            </p>
          )}
          {sourceActual && (
            <p className="text-[9px] font-mono text-success/70 leading-tight">
              <span className="font-semibold text-success/60">ACTUAL · </span>{sourceActual}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main strip ─────────────────────────────────────────────────
export default function CobKpiStrip() {
  const { data, isLoading } = useCobSummary();

  // Most recent day row (rows sorted ascending — last = most recent)
  const latestRow: CobDayRowAPI | undefined =
    data?.rows?.length ? data.rows[data.rows.length - 1] : undefined;

  const tdLabel = `TD · ${tdDateLabel(latestRow?.date)}`;

  // I/O ratio for TD
  const tdIoRatio =
    latestRow?.feed_actual && latestRow?.cob_actual
      ? Math.round((latestRow.feed_actual / latestRow.cob_actual) * 100) / 100
      : null;

  const d = data;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 xl:gap-4">

      {/* Ore Feed */}
      <QtyCard
        label="Ore Feed"        unit="MT"
        accentClass="accent-bar-blue"
        dotColor="bg-accent"
        actual={d?.mtd_feed_actual ?? 0}
        plan={d?.mtd_feed_plan ?? 0}
        tdValue={latestRow?.feed_actual}
        tdLabel={tdLabel}
        loading={isLoading}
        sourcePlan="IMOS"
        sourceActual="SAP"
      />

      {/* COB Production */}
      <QtyCard
        label="COB Conc."       unit="MT"
        accentClass="accent-bar-gold"
        dotColor="bg-[#c8960c]"
        actual={d?.mtd_cob_actual ?? 0}
        plan={d?.mtd_cob_plan ?? 0}
        tdValue={latestRow?.cob_actual}
        tdLabel={tdLabel}
        loading={isLoading}
        showCuM
        sourcePlan="IMOS"
        sourceActual="SAP"
      />

      {/* Tailings */}
      <QtyCard
        label="Tailings"        unit="MT"
        accentClass="accent-bar-orange"
        dotColor="bg-[#e65100]"
        actual={d?.mtd_tailings_actual ?? 0}
        plan={d?.mtd_tailings_plan ?? 0}
        tdValue={latestRow?.tailings_actual}
        tdLabel={tdLabel}
        loading={isLoading}
        sourcePlan="IMOS"
        sourceActual="SAP"
      />

      {/* Yield % */}
      <RateCard
        label="Yield %"         unit="%"   precision={1}
        accentClass="accent-bar-green"
        dotColor="bg-success"
        actual={d?.mtd_yield_pct ?? null}
        plan={d?.mtd_yield_plan ?? null}
        tdValue={latestRow?.yield_pct}
        tdLabel={tdLabel}
        loading={isLoading}
        note="COB ÷ Feed × 100"
        sourcePlan="IMOS"
        sourceActual="SAP"
      />

      {/* I/O Ratio */}
      <RateCard
        label="I/O Ratio"       unit=""   precision={2}
        accentClass="accent-bar-teal"
        dotColor="bg-[#00695c]"
        actual={d?.mtd_io_ratio ?? null}
        plan={
          d?.mtd_feed_plan && d?.mtd_cob_plan
            ? Math.round((d.mtd_feed_plan / d.mtd_cob_plan) * 100) / 100
            : null
        }
        tdValue={tdIoRatio}
        tdLabel={tdLabel}
        loading={isLoading}
        note="Feed ÷ COB Production"
        sourcePlan="IMOS"
        sourceActual="SAP"
      />
    </div>
  );
}
