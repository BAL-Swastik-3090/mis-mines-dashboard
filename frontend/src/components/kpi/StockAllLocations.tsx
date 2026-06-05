"use client";
import { formatIndian } from "@/lib/utils";
import { useStockPosition } from "@/hooks/useStock";

function Shimmer({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`h-8 w-24 animate-pulse rounded ${dark ? "bg-white/10" : "bg-bg-section"}`} />
  );
}

interface PanelProps {
  label:    string;
  sublabel: string;
  value:    number;
  loading:  boolean;
  dark?:    boolean;     // navy background (TOTAL card)
  border?:  boolean;     // right divider
}

function Panel({ label, sublabel, value, loading, dark, border }: PanelProps) {
  return (
    <div className={`
      flex-1 flex flex-col items-center justify-center px-6 py-4
      ${dark   ? "bg-[#1a2744]" : "bg-white"}
      ${border ? (dark ? "border-r border-[#f5a623]/25" : "border-r border-border-light") : ""}
    `}>
      <div className={`text-[10px] font-extrabold tracking-[.18em] uppercase mb-0.5
        ${dark ? "text-[#f5a623]" : "text-txt-light"}`}>
        {label}
      </div>
      <div className={`text-[9px] tracking-wider uppercase mb-2
        ${dark ? "text-white/35" : "text-txt-light/60"}`}>
        {sublabel}
      </div>
      {loading ? <Shimmer dark={dark} /> : (
        <div className={`font-condensed font-extrabold text-[28px] xl:text-[32px] leading-none tracking-tight
          ${dark ? "text-white" : "text-navy"}`}>
          {formatIndian(value)}
        </div>
      )}
      <div className={`text-[11px] font-semibold mt-1 ${dark ? "text-white/45" : "text-txt-muted"}`}>
        TON
      </div>
    </div>
  );
}

export default function StockAllLocations() {
  const { data, isLoading } = useStockPosition();
  const al = data?.all_locations;

  return (
    <div className="space-y-2">
      {/* Sub-header */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-extrabold tracking-[.16em] text-txt-light uppercase">
          All Locations — Total Stock
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-border-light to-transparent" />
      </div>

      {/* Unified card with dividers — no gaps */}
      <div className="flex rounded-xl overflow-hidden border border-border shadow-sm">
        <Panel
          label="Total Stock" sublabel="All locations"
          value={al?.grand_total ?? 0}
          loading={isLoading} dark border
        />
        <Panel
          label="Mines" sublabel="Plant 1200"
          value={al?.mines_total ?? 0}
          loading={isLoading} border
        />
        <Panel
          label="BAL Plant" sublabel="Plant 1100"
          value={al?.bal_plant ?? 0}
          loading={isLoading} border
        />
        <Panel
          label="SUK Plant" sublabel="Plant 1110"
          value={al?.suk_plant ?? 0}
          loading={isLoading}
        />
      </div>
    </div>
  );
}
