"use client";
import { Wrench } from "lucide-react";
import { useDateFilter } from "@/contexts/useDateFilter";
import { useExcavatorSummary, useTipperSummary } from "@/hooks/useEquipment";
import ExcavatorTrendChart from "@/components/charts/ExcavatorTrendChart";
import ExcavatorFuelChart  from "@/components/charts/ExcavatorFuelChart";
import ExcavatorTable      from "@/components/tables/ExcavatorTable";
import TipperFuelChart     from "@/components/charts/TipperFuelChart";
import TipperTable         from "@/components/tables/TipperTable";

function tillLabel(apiTo: string): string {
  return new Date(apiTo + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
    .toUpperCase();
}

function isLiveNow(apiTo: string): boolean {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return apiTo === today;
}

function Shimmer({ w = "w-20", h = "h-6" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

// ── MTTR / MTBF KPI card ──────────────────────────────────────
interface MtCard {
  label:        string;
  sub:          string;
  value:        number | null;
  count:        number;
  accentClass:  string;
  valueColor:   string;
  loading:      boolean;
  sourceActual?: string;
}

function MtKpiCard({ label, sub, value, count, accentClass, valueColor, loading, sourceActual }: MtCard) {
  return (
    <div className={`bg-white border border-border rounded-lg shadow-sm ${accentClass} flex flex-col overflow-hidden`}>
      <div className="px-4 pt-3 pb-1">
        <div className="text-[10px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
          {label}
        </div>
        <div className="text-[9px] text-txt-light tracking-wider font-condensed uppercase mt-0.5">
          {sub}
        </div>
      </div>
      <div className="px-4 pb-3 flex-1 flex flex-col justify-center">
        {loading ? (
          <Shimmer w="w-24" h="h-7" />
        ) : value != null ? (
          <>
            <div className={`font-condensed font-extrabold text-[24px] xl:text-[28px] tracking-tight leading-none ${valueColor}`}>
              {value.toFixed(1)}
              <span className="text-xs font-normal text-txt-muted ml-1">hrs</span>
            </div>
            {count > 0 && (
              <div className="text-[10px] text-txt-light mt-1 font-mono">
                {count} breakdown{count !== 1 ? "s" : ""} in period
              </div>
            )}
          </>
        ) : (
          <div className="font-condensed font-bold text-[22px] text-txt-light/40">—</div>
        )}
      </div>
      {sourceActual && (
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">ACTUAL · </span>{sourceActual}
          </p>
        </div>
      )}
    </div>
  );
}

// ── MTTR / MTBF strip ─────────────────────────────────────────
function MtrrMtbfStrip() {
  const { data: excData, isLoading: excLoading } = useExcavatorSummary();
  const { data: tipData, isLoading: tipLoading } = useTipperSummary();

  const cards: MtCard[] = [
    {
      label:        "Excavator MTTR",
      sub:          "Mean Time To Repair",
      value:        excData?.fleet_mttr ?? null,
      count:        excData?.total_bd_count ?? 0,
      accentClass:  "accent-bar-blue",
      valueColor:   "text-danger",
      loading:      excLoading,
      sourceActual: "SAP",
    },
    {
      label:        "Excavator MTBF",
      sub:          "Mean Time Between Failures",
      value:        excData?.fleet_mtbf ?? null,
      count:        excData?.total_bd_count ?? 0,
      accentClass:  "accent-bar-blue",
      valueColor:   "text-success",
      loading:      excLoading,
      sourceActual: "SAP",
    },
    {
      label:        "Tipper MTTR",
      sub:          "Mean Time To Repair",
      value:        tipData?.fleet_mttr ?? null,
      count:        tipData?.total_bd_count ?? 0,
      accentClass:  "accent-bar-gold",
      valueColor:   "text-danger",
      loading:      tipLoading,
      sourceActual: "SAP",
    },
    {
      label:        "Tipper MTBF",
      sub:          "Mean Time Between Failures",
      value:        tipData?.fleet_mtbf ?? null,
      count:        tipData?.total_bd_count ?? 0,
      accentClass:  "accent-bar-gold",
      valueColor:   "text-success",
      loading:      tipLoading,
      sourceActual: "SAP",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 xl:gap-4">
      {cards.map((c) => (
        <MtKpiCard key={c.label} {...c} />
      ))}
    </div>
  );
}

// ── Main Section ──────────────────────────────────────────────
export default function EquipmentSection() {
  const { apiTo } = useDateFilter();
  const live = isLiveNow(apiTo);

  return (
    <section className="space-y-4">

      {/* Section title */}
      <div className="section-title">
        <Wrench size={13} />
        Equipment Utilization — Excavators &amp; Tippers

        <span className="ml-auto flex items-center gap-2 normal-case tracking-normal font-normal text-[11px]">
          {live ? (
            <span className="flex items-center gap-1.5 text-success font-semibold">
              <span className="pulse-dot" />
              Live · 60s
            </span>
          ) : (
            <span className="text-txt-muted">Historical</span>
          )}
          <span className="bg-navy text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-wider">
            TILL {tillLabel(apiTo)}
          </span>
        </span>
      </div>

      {/* MTTR / MTBF KPI strip */}
      <MtrrMtbfStrip />

      {/* Row 1 — Excavator trend + table */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExcavatorTrendChart />
        <ExcavatorTable />
      </div>

      {/* Row 2 — Excavator fuel + Tipper fuel */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExcavatorFuelChart />
        <TipperFuelChart />
      </div>

      {/* Row 3 — Tipper table (full width) */}
      <TipperTable />

    </section>
  );
}
