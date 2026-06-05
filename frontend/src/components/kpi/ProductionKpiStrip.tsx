"use client";
import { BarChart3, Layers, Package, Droplets } from "lucide-react";
import { formatIndian, formatPct, pctBgClass } from "@/lib/utils";
import { useProductionSummary } from "@/hooks/useProduction";
import type { ProductionKpiCard } from "@/types";

function tdLabel(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const d = yesterday.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return `TD · ${d}`;
}

function Shimmer({ w = "w-24", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

interface KpiCardProps {
  label:       string;
  icon:        React.ElementType;
  accentClass: string;
  iconBg:      string;
  iconColor:   string;
  data?:       ProductionKpiCard;
  loading?:    boolean;
  pending?:    boolean;
}

function KpiCard({
  label, icon: Icon, accentClass, iconBg, iconColor,
  data, loading, pending,
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

      <div className="border-t border-border-light" />

      {/* ── Today footer ─────────────────────────────────────── */}
      <div className="px-4 py-3 bg-bg-light flex items-center justify-between flex-1 gap-2">
        <div>
          <div className="text-[10px] xl:text-[11px] text-txt-light uppercase tracking-widest font-bold mb-1">{tdLabel()}</div>
          {loading ? <Shimmer w="w-24" h="h-5" /> : pending ? (
            <span className="text-txt-light text-sm font-mono">—</span>
          ) : (
            <span className="font-mono font-semibold text-[12px] text-navy">
              {formatIndian(data?.today_actual)}{" "}
              <span className="text-[10px] font-normal text-txt-muted">{data?.unit}</span>
            </span>
          )}
        </div>
        {/* Plan column — only shown when plan data exists */}
        {(pending || data?.today_plan != null) && (
          <div className="text-right">
            <div className="text-[10px] xl:text-[11px] text-txt-light uppercase tracking-widest font-bold mb-1">Plan</div>
            {loading ? <Shimmer w="w-24" h="h-5" /> : pending ? (
              <span className="text-txt-light text-sm font-mono">—</span>
            ) : (
              <span className="font-mono text-[12px] text-txt-secondary">
                {formatIndian(data?.today_plan)}{" "}
                <span className="text-[10px] text-txt-muted">{data?.unit}</span>
              </span>
            )}
          </div>
        )}
        {!pending && !loading && data?.today_plan != null && (
          <span className={pctBgClass(todayPct)}>{formatPct(todayPct)}</span>
        )}
        {!pending && loading && data?.today_plan != null && <Shimmer w="w-14" h="h-5" />}
      </div>
    </div>
  );
}

export default function ProductionKpiStrip() {
  const { data, isLoading } = useProductionSummary();

  const cards = [
    {
      label: "Ore Production",  icon: BarChart3,
      data: data?.ore,          accentClass: "accent-bar-green",
      iconBg: "bg-success-bg",  iconColor: "text-success",
    },
    {
      label: "OB Excavation",   icon: Layers,
      data: data?.ob,           accentClass: "accent-bar-blue",
      iconBg: "bg-blue-50",     iconColor: "text-accent",
    },
    {
      label: "COB Production",  icon: Package,
      data: data?.cob,          accentClass: "accent-bar-gold",
      iconBg: "bg-amber-50",    iconColor: "text-gold",
    },
    {
      label: "De-Silting",      icon: Droplets,
      data: data?.de_silt,      accentClass: "accent-bar-teal",
      iconBg: "bg-teal-50",     iconColor: "text-info",
    },
  ] as const;

  return (
    /* 2 columns on tablet, 4 on desktop/wide — cards never squash on small screens */
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 xl:gap-4">
      {cards.map((c) => (
        <KpiCard
          key={c.label}
          label={c.label}
          icon={c.icon}
          data={c.data}
          accentClass={c.accentClass}
          iconBg={c.iconBg}
          iconColor={c.iconColor}
          loading={isLoading && !(c as { pending?: boolean }).pending}
          pending={(c as { pending?: boolean }).pending}
        />
      ))}
    </div>
  );
}
