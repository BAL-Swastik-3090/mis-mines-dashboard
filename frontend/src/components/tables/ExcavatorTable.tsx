"use client";
import { useState } from "react";
import { useExcavatorSummary } from "@/hooks/useEquipment";
import BreakdownModal from "./BreakdownModal";

function AvailBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-txt-light text-[11px] font-mono">—</span>;
  const barColor =
    pct >= 90 ? "#2e7d32" :
    pct >= 70 ? "#e65100" : "#c62828";
  const textClass =
    pct >= 90 ? "text-success" :
    pct >= 70 ? "text-warning"  : "text-danger";
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className={`font-mono text-[11px] font-semibold ${textClass}`}>
        {pct.toFixed(1)}%
      </span>
      <div className="w-2 h-5 rounded-sm shrink-0" style={{ background: barColor }} />
    </div>
  );
}

function UtilPct({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-txt-light text-[11px] font-mono">—</span>;
  const cls =
    pct >= 80 ? "text-success" :
    pct >= 50 ? "text-warning"  : "text-danger";
  return (
    <span className={`font-mono text-[11px] font-semibold ${cls}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border-light">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} className="px-3 py-2.5">
          <div className="h-3.5 bg-bg-section animate-pulse rounded" />
        </td>
      ))}
    </tr>
  );
}

interface Selected { sapName: string; displayName: string }

export default function ExcavatorTable() {
  const { data, isLoading } = useExcavatorSummary();
  const machines = data?.machines ?? [];
  const [selected, setSelected] = useState<Selected | null>(null);

  return (
    <>
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between shrink-0">
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Excavator MTD Performance · By Machine
          </span>
          <span className="text-[10px] text-txt-light font-mono tracking-wider">Top: Z-Axis</span>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto" style={{ maxHeight: "360px" }}>
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-bg-section border-b border-border">
                <th className="px-3 py-2.5 text-left  font-bold text-txt-secondary tracking-wide text-[11px]">MACHINE</th>
                <th className="px-3 py-2.5 text-right font-bold text-accent        tracking-wide text-[11px]">ENG-HR (MTD)</th>
                <th className="px-3 py-2.5 text-right font-bold text-danger        tracking-wide text-[11px]">B/D HR</th>
                <th className="px-3 py-2.5 text-right font-bold text-danger        tracking-wide text-[11px]">B/D COUNT</th>
                <th className="px-3 py-2.5 text-right font-bold text-success       tracking-wide text-[11px]">AVAIL %</th>
                <th className="px-3 py-2.5 text-right font-bold text-gold          tracking-wide text-[11px]">UTIL %</th>
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)
              ) : machines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-txt-muted text-sm">
                    No excavator data for selected period
                  </td>
                </tr>
              ) : (
                machines.map((m) => (
                  <tr
                    key={m.display_name}
                    onClick={() => setSelected({ sapName: m.sap_name, displayName: m.display_name })}
                    className={`border-b border-border-light hover:bg-bg-light transition-colors cursor-pointer ${
                      m.eng_hr_mtd === 0 && m.bd_hr === 0 ? "opacity-45" : ""
                    }`}
                    title="Click to view breakdown details"
                  >
                    <td className="px-3 py-2 font-mono text-[12px] text-navy font-semibold">
                      {m.display_name}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[12px] text-navy">
                      {m.eng_hr_mtd.toFixed(2)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-[12px] ${
                      m.bd_hr > 0 ? "text-danger font-semibold" : "text-txt-muted"
                    }`}>
                      {m.bd_hr.toFixed(2)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-[12px] font-semibold ${
                      m.bd_count_start > 0 ? "text-danger" : "text-txt-muted"
                    }`}>
                      {m.bd_count_start > 0 ? m.bd_count_start : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <AvailBar pct={m.avail_pct} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <UtilPct pct={m.util_pct} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {/* TOTAL FLEET footer */}
            {!isLoading && data && machines.length > 0 && (
              <tfoot>
                <tr className="bg-navy-2">
                  <td className="px-3 py-3 font-condensed font-bold text-[12px] text-white tracking-widest uppercase">
                    Total Fleet
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-white text-[12px]">
                    {data.total_eng_hr.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-white/70 text-[12px]">
                    {data.total_bd_hr.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-white/70 text-[12px]">
                    {machines.reduce((s, m) => s + m.bd_count_start, 0) || "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-white/40 text-[12px]">—</td>
                  <td className="px-3 py-3 text-right font-mono text-white/40 text-[12px]">—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Data source attribution */}
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">ACTUAL · </span>
            Running Hrs &amp; Fuel → Technoton · Breakdown Hrs &amp; Count → SAP · Click row for details
          </p>
        </div>
      </div>

      {selected && (
        <BreakdownModal
          machineName={selected.displayName}
          sapName={selected.sapName}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
