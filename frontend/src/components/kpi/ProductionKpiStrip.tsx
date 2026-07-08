"use client";
import { BarChart3, Layers, Package, Droplets, Truck } from "lucide-react";
import { formatIndian, formatPct, pctBgClass } from "@/lib/utils";
import { useProductionSummary } from "@/hooks/useProduction";
import { useDespatchSummary }   from "@/hooks/useDespatch";
import { useDateFilter }        from "@/contexts/useDateFilter";
import type { ProductionKpiCard } from "@/types";

function tdLabel(apiTo: string): string {
  const d = new Date(apiTo + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return `TD · ${d.toUpperCase()}`;
}

function Shimmer({ w = "w-24", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

/* ── Generic Production KPI card (Ore / OB / COB / De-Silting) ── */
interface KpiCardProps {
  label:        string;
  icon:         React.ElementType;
  accentClass:  string;
  iconBg:       string;
  iconColor:    string;
  data?:        ProductionKpiCard;
  loading?:     boolean;
  pending?:     boolean;
  tdDate:       string;
  showGrades?:  boolean;
  sourcePlan?:  string;
  sourceActual?: string;
  showCuM?:     boolean;
}

function KpiCard({
  label, icon: Icon, accentClass, iconBg, iconColor,
  data, loading, pending, tdDate, showGrades,
  sourcePlan, sourceActual, showCuM,
}: KpiCardProps) {
  const mtdPct      = data?.mtd_pct   ?? null;
  const todayPct    = data?.today_pct ?? null;
  const mtdProgress = mtdPct != null ? Math.min(Math.max(mtdPct, 0), 100) : 0;

  const variance =
    data?.mtd_actual != null && data?.mtd_plan != null
      ? data.mtd_actual - data.mtd_plan
      : null;

  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm ${accentClass} flex flex-col overflow-hidden`}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${iconBg}`}>
            <Icon size={16} className={iconColor} />
          </div>
          <span className="font-condensed font-bold text-[13px] xl:text-[14px] text-navy tracking-widest uppercase leading-tight">
            {label}
          </span>
        </div>
        {pending ? (
          <span className="text-[10px] text-txt-light bg-bg-section px-2 py-0.5 rounded-full font-bold tracking-wider">
            PENDING
          </span>
        ) : loading ? (
          <Shimmer w="w-16" h="h-5" />
        ) : data?.mtd_plan != null ? (
          <span className={pctBgClass(mtdPct)}>
            Achieve % {formatPct(mtdPct)}
          </span>
        ) : (
          <span className="text-[10px] text-txt-light bg-bg-section px-2 py-0.5 rounded-full font-bold tracking-wider">
            ACTUAL
          </span>
        )}
      </div>

      {/* ── MTD big number ───────────────────────────────────── */}
      <div className="px-4 pb-2.5">
        {loading ? (
          <>
            <Shimmer w="w-36" h="h-9" />
            <div className="mt-1.5"><Shimmer w="w-48" h="h-3.5" /></div>
          </>
        ) : pending ? (
          <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-txt-light tracking-tight leading-none">
            — <span className="text-xs font-normal text-txt-light ml-1">{data?.unit ?? "—"}</span>
          </div>
        ) : (
          <>
            <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-navy tracking-tight leading-none">
              {formatIndian(data?.mtd_actual)}
              <span className="text-xs font-normal text-txt-muted ml-1.5">{data?.unit}</span>
              {showCuM && data?.mtd_actual != null && (
                <>
                  <span className="text-[20px] xl:text-[22px] font-normal text-txt-muted mx-1.5">/</span>
                  {formatIndian(Math.round(data.mtd_actual / 3))}
                  <span className="text-xs font-normal text-txt-muted ml-1.5">CuM</span>
                </>
              )}
            </div>
            {data?.mtd_plan != null && (
              <div className="text-[11px] text-txt-muted mt-1.5 flex items-center gap-2 flex-wrap">
                <span>Plan: <span className="text-txt-secondary font-semibold">{formatIndian(data?.mtd_plan)}</span></span>
                <span className="text-border-strong">·</span>
                <span>
                  Var:{" "}
                  <span className={
                    variance == null      ? "text-txt-muted"
                    : variance >= 0       ? "text-success font-semibold"
                    :                       "text-danger font-semibold"
                  }>
                    {variance == null
                      ? "—"
                      : `${variance >= 0 ? "+" : ""}${formatIndian(variance)}`}
                  </span>
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Progress bar — hidden when no plan ──────────────── */}
      {!pending && data?.mtd_plan != null && (
        <div className="px-4 pb-3">
          <div className="h-1.5 bg-bg-section rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                mtdProgress >= 90 ? "bg-success" :
                mtdProgress >= 60 ? "bg-warning"  :
                mtdProgress >  0  ? "bg-danger"   : "bg-bg-section"
              }`}
              style={{ width: loading ? "0%" : `${mtdProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Grade breakdown — Ore card only ─────────────────── */}
      {showGrades && (
        <div className="px-4 pb-3 space-y-1.5">
          {loading ? (
            <>
              <Shimmer w="w-full" h="h-4" />
              <Shimmer w="w-full" h="h-4" />
              <Shimmer w="w-full" h="h-4" />
            </>
          ) : (
            <>
              {[
                { label: "HG >52%",  value: data?.hg_actual, color: "bg-gold" },
                { label: "MG 40–52%", value: data?.mg_actual, color: "bg-accent" },
                { label: "LG <40%",  value: data?.lg_actual, color: "bg-[#e65100]" },
              ].map(({ label: gl, value, color }) => (
                <div key={gl} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${color} inline-block shrink-0`} />
                    <span className="text-[11px] text-txt-muted font-medium w-[72px] shrink-0">{gl}</span>
                  </div>
                  <div className="flex items-baseline gap-0.5 min-w-[64px] justify-end">
                    <span className="font-mono text-[11px] font-semibold text-navy tabular-nums">
                      {value != null && value > 0 ? formatIndian(value) : "—"}
                    </span>
                    {value != null && value > 0 && (
                      <span className="text-[9px] text-txt-light">MT</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <div className="border-t border-border-light mt-auto" />

      {/* ── Today footer ─────────────────────────────────────── */}
      <div className="px-4 py-3 bg-bg-light flex items-center justify-between flex-1 gap-1">
        <div className="shrink-0">
          <div className="text-[10px] xl:text-[11px] text-txt-light uppercase tracking-widest font-bold mb-1 whitespace-nowrap">{tdLabel(tdDate)}</div>
          {loading ? <Shimmer w="w-24" h="h-5" /> : pending ? (
            <span className="text-txt-light text-sm font-mono">—</span>
          ) : (
            <span className="font-mono font-semibold text-[12px] text-navy whitespace-nowrap">
              {formatIndian(data?.today_actual)}{" "}
              <span className="text-[10px] font-normal text-txt-muted">{data?.unit}</span>
              {showCuM && data?.today_actual != null && (
                <>
                  <span className="text-[10px] font-normal text-txt-muted mx-1">/</span>
                  {formatIndian(Math.round(data.today_actual / 3))}{" "}
                  <span className="text-[10px] font-normal text-txt-muted">CuM</span>
                </>
              )}
            </span>
          )}
        </div>
        {/* Plan column — only shown when plan data exists */}
        {(pending || data?.today_plan != null) && (
          <div className="text-right shrink-0">
            <div className="text-[10px] xl:text-[11px] text-txt-light uppercase tracking-widest font-bold mb-1">Plan</div>
            {loading ? <Shimmer w="w-24" h="h-5" /> : pending ? (
              <span className="text-txt-light text-sm font-mono">—</span>
            ) : (
              <span className="font-mono text-[12px] text-txt-secondary whitespace-nowrap">
                {formatIndian(data?.today_plan)}{" "}
                <span className="text-[10px] text-txt-muted">{data?.unit}</span>
              </span>
            )}
          </div>
        )}
        {!pending && !loading && data?.today_plan != null && (
          <span className={`${pctBgClass(todayPct)} shrink-0`}>{formatPct(todayPct)}</span>
        )}
        {!pending && loading && data?.today_plan != null && <Shimmer w="w-14" h="h-5" />}
      </div>

      {/* ── Data source strip ─────────────────────────────────── */}
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

/* ── Despatch KPI card ─────────────────────────────────────── */
interface DespatchKpiCardProps {
  loading:          boolean;
  mtdTotalPlan:     number;
  mtdTotalActual:   number | null;
  mtdBal:           number;
  mtdSuk:           number;
  mtdBalActual:     number | null;
  mtdSukActual:     number | null;
  tdTotal:          number | null;
  tdActual:         number | null;
  tdDate:           string;
  sourcePlan?:      string;
  sourceActual?:    string;
}

function DespatchKpiCard({
  loading,
  mtdTotalPlan, mtdTotalActual,
  mtdBal, mtdSuk, mtdBalActual, mtdSukActual,
  tdTotal, tdActual, tdDate,
  sourcePlan, sourceActual,
}: DespatchKpiCardProps) {
  const mtdPct = (mtdTotalActual != null && mtdTotalPlan > 0)
    ? Math.round((mtdTotalActual / mtdTotalPlan) * 1000) / 10
    : null;
  const mtdProgress = mtdPct != null ? Math.min(Math.max(mtdPct, 0), 100) : 0;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm accent-bar-orange flex flex-col overflow-hidden">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0 bg-orange-50">
            <Truck size={16} className="text-orange" />
          </div>
          <span className="font-condensed font-bold text-[13px] xl:text-[14px] text-navy tracking-widest uppercase leading-tight">
            Despatch
          </span>
        </div>
        {loading ? <Shimmer w="w-16" h="h-5" /> : (
          mtdPct != null
            ? <span className={pctBgClass(mtdPct)}>Achieve % {formatPct(mtdPct)}</span>
            : <span className="text-[10px] text-txt-light bg-bg-section px-2 py-0.5 rounded-full font-bold tracking-wider">PLAN</span>
        )}
      </div>

      {/* ── MTD big number ───────────────────────────────────── */}
      <div className="px-4 pb-2.5">
        {loading ? (
          <>
            <Shimmer w="w-36" h="h-9" />
            <div className="mt-1.5"><Shimmer w="w-32" h="h-3.5" /></div>
          </>
        ) : (
          <>
            <div className="font-condensed font-extrabold text-[28px] xl:text-[32px] text-navy tracking-tight leading-none">
              {mtdTotalActual != null ? formatIndian(mtdTotalActual) : formatIndian(mtdTotalPlan)}
              <span className="text-xs font-normal text-txt-muted ml-1.5">MT</span>
            </div>
            <div className="text-[11px] text-txt-muted mt-1.5 flex items-center gap-2 flex-wrap">
              {mtdTotalActual != null ? (
                <>
                  <span>Plan: <span className="text-txt-secondary font-semibold">{formatIndian(mtdTotalPlan)}</span></span>
                  <span className="text-border-strong">·</span>
                  <span className={
                    mtdTotalActual - mtdTotalPlan >= 0
                      ? "text-success font-semibold"
                      : "text-danger font-semibold"
                  }>
                    {mtdTotalActual - mtdTotalPlan >= 0 ? "+" : ""}
                    {formatIndian(mtdTotalActual - mtdTotalPlan)}
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-txt-light uppercase tracking-wider font-semibold">MTD Plan</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Progress bar — shown when actual available ───────── */}
      {!loading && mtdTotalActual != null && (
        <div className="px-4 pb-3">
          <div className="h-1.5 bg-bg-section rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                mtdProgress >= 90 ? "bg-success" :
                mtdProgress >= 60 ? "bg-warning"  :
                mtdProgress >  0  ? "bg-danger"   : "bg-bg-section"
              }`}
              style={{ width: `${mtdProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Location breakdown ───────────────────────────────── */}
      <div className="px-4 pb-3 space-y-1.5">
        {loading ? (
          <>
            <Shimmer w="w-full" h="h-4" />
            <Shimmer w="w-full" h="h-4" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent inline-block shrink-0" />
                <span className="text-[11px] text-txt-muted font-medium">BAL Plant</span>
              </div>
              <span className="font-mono text-[11px] font-semibold text-navy">
                {formatIndian(mtdBalActual ?? mtdBal)}
                <span className="text-[9px] text-txt-light ml-0.5">MT</span>
                {mtdBalActual == null && mtdBal > 0 && (
                  <span className="text-[9px] text-txt-light/60 ml-1">plan</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gold inline-block shrink-0" />
                <span className="text-[11px] text-txt-muted font-medium">SUK Plant</span>
              </div>
              <span className="font-mono text-[11px] font-semibold text-navy">
                {formatIndian(mtdSukActual ?? mtdSuk)}
                <span className="text-[9px] text-txt-light ml-0.5">MT</span>
                {mtdSukActual == null && mtdSuk > 0 && (
                  <span className="text-[9px] text-txt-light/60 ml-1">plan</span>
                )}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border-light" />

      {/* ── TD footer ─────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-bg-light flex-1">
        <div className="text-[10px] xl:text-[11px] text-txt-light uppercase tracking-widest font-bold mb-1.5">
          {tdLabel(tdDate)}
        </div>
        {loading ? (
          <Shimmer w="w-32" h="h-5" />
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            {tdActual != null ? (
              <span className="font-mono font-semibold text-[12px] text-navy">
                {formatIndian(tdActual)}{" "}
                <span className="text-[10px] font-normal text-txt-muted">MT Act</span>
              </span>
            ) : (
              <span className="text-[11px] text-txt-light font-mono italic">No actual yet</span>
            )}
            {tdTotal != null && (
              <span className="text-[10px] text-txt-light font-mono">
                Plan {formatIndian(tdTotal)} MT
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Data source strip ─────────────────────────────────── */}
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

/* ── Main strip ─────────────────────────────────────────────── */
export default function ProductionKpiStrip() {
  const { data, isLoading }           = useProductionSummary();
  const { data: dsp, isLoading: dspL } = useDespatchSummary();
  const { apiTo }                      = useDateFilter();

  const prodCards = [
    {
      label: "Ore Production",  icon: BarChart3,
      data: data?.ore,          accentClass: "accent-bar-green",
      iconBg: "bg-success-bg",  iconColor: "text-success",
      showGrades: true,         showCuM: true,
      sourcePlan: "IMOS",
      sourceActual: "SAP",
    },
    {
      label: "OB Excavation",   icon: Layers,
      data: data?.ob,           accentClass: "accent-bar-blue",
      iconBg: "bg-blue-50",     iconColor: "text-accent",
      showGrades: false,
      sourcePlan: "IMOS",
      sourceActual: "SAP",
    },
    {
      label: "COB Production",  icon: Package,
      data: data?.cob,          accentClass: "accent-bar-gold",
      iconBg: "bg-amber-50",    iconColor: "text-gold",
      showGrades: false,
      sourcePlan: "IMOS",
      sourceActual: "SAP",
    },
    {
      label: "De-Silting",      icon: Droplets,
      data: data?.de_silt,      accentClass: "accent-bar-teal",
      iconBg: "bg-teal-50",     iconColor: "text-info",
      showGrades: false,
      sourcePlan: undefined,
      sourceActual: "IMOS",
    },
  ];

  return (
    /* 2 columns on tablet, 5 on desktop/wide */
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 xl:gap-4">

      {/* Production cards (Ore / OB / COB / De-Silting) */}
      {prodCards.map((c) => (
        <KpiCard
          key={c.label}
          label={c.label}
          icon={c.icon}
          data={c.data}
          accentClass={c.accentClass}
          iconBg={c.iconBg}
          iconColor={c.iconColor}
          loading={isLoading}
          tdDate={apiTo}
          showGrades={c.showGrades}
          showCuM={c.showCuM}
          sourcePlan={c.sourcePlan}
          sourceActual={c.sourceActual}
        />
      ))}

      {/* Despatch card */}
      <DespatchKpiCard
        loading={dspL}
        mtdTotalPlan={dsp?.mtd_total_plan     ?? 0}
        mtdTotalActual={dsp?.mtd_total_actual ?? null}
        mtdBal={dsp?.mtd_bal_plan             ?? 0}
        mtdSuk={dsp?.mtd_suk_plan             ?? 0}
        mtdBalActual={dsp?.mtd_bal_actual     ?? null}
        mtdSukActual={dsp?.mtd_suk_actual     ?? null}
        tdTotal={dsp?.td_total_plan           ?? null}
        tdActual={dsp?.td_total_actual        ?? null}
        tdDate={apiTo}
        sourcePlan="IMOS"
        sourceActual="SAP"
      />
    </div>
  );
}
