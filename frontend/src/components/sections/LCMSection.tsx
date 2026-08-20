"use client";
import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Calculator, TrendingDown, Layers, IndianRupee, ArrowUpDown } from "lucide-react";
import { useLCM } from "@/hooks/useLCM";
import { formatIndian } from "@/lib/utils";
import type { LCMRow } from "@/types";

function fmt(v: number | null | undefined, dp = 2) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function f0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}
/** Rupees, Indian grouping. Null means the IBM rate is not configured yet. */
function rs(v: number | null | undefined) {
  return v == null ? "—" : `₹${formatIndian(Math.round(v))}`;
}
/** Large rupee figures read better in lakhs on a summary line. */
function rsLakh(v: number | null | undefined) {
  return v == null ? "—" : `₹${(v / 100000).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;
}
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

/** Distinct hues for the pie. Chosen to stay apart at small slice sizes rather
 *  than to sit on a gradient — adjacent slices must not read as one block. */
const PIE_COLORS = [
  "#1565c0", "#c62828", "#2e7d32", "#c8960c", "#6a1b9a",
  "#00838f", "#e65100", "#ad1457", "#37474f", "#558b2f",
];

function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

export default function LCMSection() {
  const { data, isLoading, isError, error } = useLCM();
  const b = data?.basis;
  const t = data?.totals;
  const c = data?.coverage;
  const cost = data?.costing;
  // Default is the workbook order the server returns; the toggle re-sorts by
  // share without touching that order server-side.
  const [sortByShare, setSortByShare] = useState(false);
  const matrixRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!sortByShare) return rows;
    return [...rows].sort((a, b) => (b.loss_share_pct ?? 0) - (a.loss_share_pct ?? 0));
  }, [data?.rows, sortByShare]);

  if (isError) {
    return (
      <div className="mx-1 mt-4 p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
        <AlertTriangle size={16} className="text-[#c62828] shrink-0" />
        <span className="text-[12px] text-[#c62828]">
          {error instanceof Error ? error.message : "Failed to load LCM"}
        </span>
      </div>
    );
  }

  const oreThin = c ? c.ore_days_present < c.days_in_period : false;
  const obThin  = c ? c.ob_days_present  < c.days_in_period : false;

  return (
    <div className="space-y-4">

      {/* Shift-log coverage warning — a thin period understates every hour figure */}
      {!isLoading && c && (oreThin || obThin) && (
        <div className="p-3 rounded-lg bg-[#fff8e1] border border-[#ffe082] border-l-[3px] border-l-[#c8960c] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              Partial shift-log coverage — ore {c.ore_days_present}/{c.days_in_period} days,
              OB {c.ob_days_present}/{c.days_in_period} days.
            </span>{" "}
            Loss hours below cover only the shift-days present in the log, so every hour and
            tonnage figure understates the true loss. The multiplying factors remain valid
            because they are derived from the same hours they divide.
          </div>
        </div>
      )}

      {/* Basis of calculation */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
          <Calculator size={14} className="text-[#6a1b9a]" />
          <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
            Basis of Calculation
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border-light">
          {/* Ore */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold tracking-widest uppercase font-condensed text-[#1565c0]">
                Ore Excavation
              </span>
              <span className="text-[9px] text-txt-light font-mono">
                {b?.ore_machines.join(" · ")}
              </span>
            </div>
            {isLoading ? <Shimmer w="w-56" h="h-16" /> : (
              <table className="w-full text-[11.5px] font-mono">
                <tbody className="divide-y divide-border-light/50">
                  <tr><td className="py-1 text-txt-secondary">Plan Ore (IMOS)</td>
                      <td className="py-1 text-right font-semibold text-navy">{fmt(b?.ore_plan, 2)} MT</td></tr>
                  <tr><td className="py-1 text-txt-secondary">Actual Ore (SAP)</td>
                      <td className="py-1 text-right font-semibold text-navy">{fmt(b?.ore_actual, 2)} MT</td></tr>
                  <tr><td className="py-1 text-txt-secondary font-semibold">Ore Deviation</td>
                      <td className="py-1 text-right font-bold text-[#c62828]">{fmt(b?.ore_deviation, 2)} MT</td></tr>
                  <tr><td className="py-1 text-txt-secondary">Total Ore Loss Hour</td>
                      <td className="py-1 text-right text-navy">{fmt(b?.total_ore_loss_hours, 2)} hrs</td></tr>
                  <tr><td className="py-1 text-txt-secondary font-semibold">Ore Multiplying Factor</td>
                      <td className="py-1 text-right font-bold text-[#1565c0]">{fmt(b?.ore_factor, 4)} MT/hr</td></tr>
                </tbody>
              </table>
            )}
          </div>
          {/* OB */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold tracking-widest uppercase font-condensed text-[#2e7d32]">
                OB Excavation
              </span>
              <span className="text-[9px] text-txt-light font-mono">
                {b?.ob_machines.join(" · ")}
              </span>
            </div>
            {isLoading ? <Shimmer w="w-56" h="h-16" /> : (
              <table className="w-full text-[11.5px] font-mono">
                <tbody className="divide-y divide-border-light/50">
                  <tr><td className="py-1 text-txt-secondary">Plan OB (IMOS)</td>
                      <td className="py-1 text-right font-semibold text-navy">{fmt(b?.ob_plan, 2)} CuM</td></tr>
                  <tr><td className="py-1 text-txt-secondary">Actual OB (SAP)</td>
                      <td className="py-1 text-right font-semibold text-navy">{fmt(b?.ob_actual, 2)} CuM</td></tr>
                  <tr><td className="py-1 text-txt-secondary font-semibold">OB Deviation</td>
                      <td className="py-1 text-right font-bold text-[#c62828]">{fmt(b?.ob_deviation, 2)} CuM</td></tr>
                  <tr><td className="py-1 text-txt-secondary">Total OB Loss Hour</td>
                      <td className="py-1 text-right text-navy">{fmt(b?.total_ob_loss_hours, 2)} hrs</td></tr>
                  <tr><td className="py-1 text-txt-secondary font-semibold">OB Multiplying Factor</td>
                      <td className="py-1 text-right font-bold text-[#2e7d32]">{fmt(b?.ob_factor, 4)} CuM/hr</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
          <p className="text-[9px] font-mono text-success/70 leading-tight">
            <span className="font-semibold text-success/60">PLAN · </span>IMOS
            &nbsp;·&nbsp;
            <span className="font-semibold text-success/60">ACTUAL · </span>SAP
            &nbsp;·&nbsp;
            <span className="font-semibold text-success/60">LOSS HOURS · </span>IMOS shift log · SAP (breakdown, PM)
          </p>
        </div>
      </div>

      {/* A loss column exists in the entry form but has no controllability /
          owner mapping yet. Surfaced rather than guessed, because an
          unclassified head is silently excluded from the Controllable Share. */}
      {!isLoading && data && data.rows.some((r) => r.loss_type === "Unclassified") && (
        <div className="p-3 rounded-lg bg-[#fff8e1] border border-[#ffe082] border-l-[3px] border-l-[#c8960c] flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
          <div className="text-[11.5px] text-txt-secondary leading-relaxed">
            <span className="font-bold text-navy">
              New loss reason{data.rows.filter((r) => r.loss_type === "Unclassified").length > 1 ? "s" : ""} awaiting classification
              — {data.rows.filter((r) => r.loss_type === "Unclassified").map((r) => r.loss_description).join(", ")}.
            </span>{" "}
            Picked up automatically from the entry form. Hours and loss value are counted in
            full, but until someone assigns Controllable / Non Controllable and a KAM they are
            excluded from the Controllable Share.
          </div>
        </div>
      )}

      {/* Costing basis — grade-wise IBM rate and the plan-weighted average */}
      {!isLoading && cost && (
        <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <IndianRupee size={14} className="text-[#ad1457]" />
              <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
                Costing Basis — IBM Rate
              </span>
            </div>
            <span className="text-[10px] font-mono text-txt-light">{cost.source}</span>
          </div>

          {cost.status !== "ok" && (
            <div className="px-4 py-2.5 bg-[#fff8e1] border-b border-[#ffe082] flex items-start gap-2.5">
              <AlertTriangle size={15} className="text-[#c8960c] shrink-0 mt-[1px]" />
              <div className="text-[11.5px] text-txt-secondary leading-relaxed">
                {cost.status === "rate_missing" ? (
                  <>
                    <span className="font-bold text-navy">
                      IBM rate not configured for {cost.missing_grades.join(", ")}.
                    </span>{" "}
                    The Loss Amount column is blank rather than partial — pricing only the
                    grades that have a rate would understate every row.
                  </>
                ) : (
                  <span className="font-bold text-navy">
                    No planned ore quantity in this period, so no rate can be weighted.
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="bg-bg-section border-b border-border-light">
                  <th className="px-3 py-2 text-left  text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Grade</th>
                  <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Plan Qty (MT)</th>
                  <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#ad1457]">IBM Rate (₹/MT)</th>
                  <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Plan Value<br/>(Qty × Rate)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light/60">
                {cost.breakdown.map((g) => (
                  <tr key={g.grade} className={g.qty === 0 ? "opacity-45" : ""}>
                    <td className="px-3 py-2 font-condensed font-bold text-[12px] text-navy">{g.grade}</td>
                    <td className="px-3 py-2 text-right text-navy">{fmt(g.qty, 2)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${g.rate == null ? "text-[#c62828]" : "text-[#ad1457]"}`}>
                      {g.rate == null ? "not set" : rs(g.rate)}
                    </td>
                    <td className="px-3 py-2 text-right text-navy">{rs(g.value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-navy text-white font-bold">
                  <td className="px-3 py-2.5 font-condensed tracking-widest uppercase text-[11px]">Weighted</td>
                  <td className="px-3 py-2.5 text-right">{fmt(cost.grade_plan_total, 2)}</td>
                  <td className="px-3 py-2.5 text-right">{cost.weighted_rate == null ? "—" : rs(cost.weighted_rate)}</td>
                  {/* This is the true total of the column above — the value of the
                      whole planned ore. The LOST slice of it is the tile below. */}
                  <td className="px-3 py-2.5 text-right">
                    {cost.breakdown.some((g) => g.value == null)
                      ? "—"
                      : rs(cost.breakdown.reduce((s, g) => s + (g.value ?? 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!cost.grade_plan_matches_ore_plan && (
            <div className="px-3 py-2 border-t border-border-light/40 bg-[#fff8e1]/60">
              <p className="text-[9.5px] font-mono text-[#8d6e00] leading-tight">
                Grade split totals {fmt(cost.grade_plan_total, 2)} MT against an ore plan of{" "}
                {fmt(cost.ore_plan, 2)} MT — the grade columns are not fully entered for this
                period. The weighted rate is a ratio so it is unaffected, but the mix shown
                above reflects only the graded portion.
              </p>
            </div>
          )}

          {cost.status === "ok" && t && (
            <div className="px-4 py-3 border-t border-border-light grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[9.5px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                  Total Loss Value
                </div>
                <div className="font-condensed font-extrabold text-[22px] leading-none text-navy mt-1">
                  {rsLakh(t.loss_amount)}
                </div>
                <div className="text-[9.5px] text-txt-light font-mono mt-0.5">
                  {f0(t.planned_ore_loss)} MT × {rs(cost.weighted_rate)}/MT
                </div>
              </div>
              <div>
                <div className="text-[9.5px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                  Controllable Share
                </div>
                <div className="font-condensed font-extrabold text-[22px] leading-none text-[#c62828] mt-1">
                  {rsLakh(t.controllable_loss_amount)}
                </div>
                <div className="text-[9.5px] text-txt-light font-mono mt-0.5">
                  {t.loss_amount && t.controllable_loss_amount != null && t.loss_amount > 0
                    ? `${((t.controllable_loss_amount / t.loss_amount) * 100).toFixed(1)}% of total loss value`
                    : "recoverable with action"}
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* Period totals */}
      {!isLoading && t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Total Ore Loss",       value: `${f0(t.planned_ore_loss)} MT`,
              sub: "planned ore not excavated", accent: "#1565c0" },
            { label: "Ore Loss Hours",       value: `${fmt(t.ore_hours, 1)} hrs`,
              sub: `across ${data?.rows.length ?? 0} loss heads`, accent: "#6a1b9a" },
            { label: "Total OB Loss",        value: `${f0(t.planned_ob_loss)} CuM`,
              sub: "planned OB not excavated", accent: "#2e7d32" },
            { label: "OB Loss Hours",        value: `${fmt(t.ob_hours, 1)} hrs`,
              sub: `across ${data?.rows.length ?? 0} loss heads`, accent: "#c8960c" },
          ].map((k) => (
            <div key={k.label} className="bg-white border border-border rounded-lg shadow-sm overflow-hidden border-t-2"
                 style={{ borderTopColor: k.accent }}>
              <div className="px-3 pt-2.5 pb-1">
                <div className="text-[9.5px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">
                  {k.label}
                </div>
              </div>
              <div className="px-3 pb-2.5">
                <div className="font-condensed font-extrabold text-[20px] leading-none text-navy">{k.value}</div>
                <div className="text-[9.5px] text-txt-light font-mono mt-0.5">{k.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The matrix */}
      <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-[#6a1b9a]" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Lost Cost Matrix — Loss Heads
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSortByShare((v) => !v)}
              title={sortByShare ? "Back to workbook order" : "Sort by loss share, high to low"}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-[9.5px] font-condensed font-bold
                          tracking-widest uppercase transition-colors ${
                sortByShare
                  ? "border-[#ad1457] bg-[#fce4ec] text-[#ad1457]"
                  : "border-border bg-white text-txt-secondary hover:bg-bg-section"
              }`}
            >
              <ArrowUpDown size={11} />
              {sortByShare ? "Loss share ↓" : "Workbook order"}
            </button>
            <span className="text-[10px] font-mono text-txt-light">own equipment only</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="bg-bg-section border-b border-border-light">
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Sl.</th>
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Loss Description</th>
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">KAM</th>
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Loss Type</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#1565c0]">Production<br/>Hour Loss</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#1565c0]">Planned Ore<br/>Loss (MT)</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#2e7d32]">OB Production<br/>Hour Loss</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#2e7d32]">Planned OB<br/>Loss (CuM)</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#ad1457]">Loss Amount<br/>(₹ Lakh)</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#ad1457]">Loss<br/>Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/60">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 10 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5"><Shimmer w="w-14" h="h-4" /></td>
                  ))}</tr>
                ))
              ) : matrixRows.map((r) => {
                const idle = r.ore_hours === 0 && r.ob_hours === 0;
                return (
                  <tr key={r.sl_no} className={`hover:bg-bg-section/50 transition-colors ${idle ? "opacity-45" : ""}`}>
                    <td className="px-3 py-2 text-txt-light">{r.sl_no}</td>
                    <td className="px-3 py-2 font-condensed font-bold text-[12px] text-navy whitespace-nowrap">
                      {r.loss_description}
                    </td>
                    <td className="px-3 py-2 text-txt-secondary whitespace-nowrap">{r.kam}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9.5px] font-condensed font-bold tracking-wider uppercase ${
                        r.loss_type === "Controllable"     ? "bg-[#fdecea] text-[#c62828]"
                        : r.loss_type === "Non Controllable" ? "bg-bg-section text-txt-light"
                        : "bg-[#fff8e1] text-[#8d6e00]"
                      }`}>
                        {r.loss_type === "Controllable" ? "Controllable"
                         : r.loss_type === "Non Controllable" ? "Non Ctrl" : "Unclassified"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-navy">{fmt(r.ore_hours, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#1565c0]">{fmt(r.planned_ore_loss, 1)}</td>
                    <td className="px-3 py-2 text-right text-navy">{fmt(r.ob_hours, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#2e7d32]">{f0(r.planned_ob_loss)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#ad1457]">{rsLakh(r.loss_amount)}</td>
                    <td className="px-3 py-2 text-right text-txt-secondary tabular-nums">
                      {r.loss_share_pct != null && r.loss_share_pct > 0
                        ? `${r.loss_share_pct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {!isLoading && t && (
              <tfoot>
                <tr className="bg-navy text-white border-t-2 border-navy font-bold">
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 font-condensed tracking-widest uppercase text-[11px]">Total</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right">{fmt(t.ore_hours, 2)}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(t.planned_ore_loss, 1)}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(t.ob_hours, 2)}</td>
                  <td className="px-3 py-2.5 text-right">{f0(t.planned_ob_loss)}</td>
                  <td className="px-3 py-2.5 text-right">{rsLakh(t.loss_amount)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {t.loss_share_pct != null ? `${t.loss_share_pct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

      </div>

      {/* Composition of the ore loss — pie rather than bars, so the split
          reads as parts of one whole. Slices are grouped and coloured to stay
          distinguishable; anything below 2% is folded into "Others" because a
          sliver is unreadable and unclickable. */}
      {!isLoading && data && data.rows.some((r) => r.planned_ore_loss > 0) && (
        <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
            <TrendingDown size={14} className="text-[#c62828]" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Loss Composition — Ore
            </span>
            <span className="ml-auto text-[10px] font-mono text-txt-light">
              {f0(data.totals.planned_ore_loss)} MT total
            </span>
          </div>
          <LossPie rows={data.rows} total={data.totals.planned_ore_loss} />
        </div>
      )}

    </div>
  );
}

/** Ore-loss composition as a pie.
 *
 *  Slices below MIN_SLICE_PCT are collapsed into "Others": with one head at 64%
 *  the tail is sub-1% slivers that cannot be told apart or hovered, and showing
 *  them individually makes the chart less readable, not more. The collapsed
 *  count is stated so nothing looks hidden.
 *
 *  Set at 1.5 rather than 2 so Preventive maintenance (1.8% for 1-20 Aug) keeps
 *  its own slice — it is a named SAP-sourced head and the bar chart this
 *  replaced showed it separately.
 */
const MIN_SLICE_PCT = 1.5;

function LossPie({ rows, total }: { rows: LCMRow[]; total: number }) {
  const { slices, groupedCount } = useMemo(() => {
    const positive = rows
      .filter((r) => r.planned_ore_loss > 0)
      .sort((a, b) => b.planned_ore_loss - a.planned_ore_loss);
    const big   = positive.filter((r) => (r.planned_ore_loss / total) * 100 >= MIN_SLICE_PCT);
    const small = positive.filter((r) => (r.planned_ore_loss / total) * 100 <  MIN_SLICE_PCT);
    const out = big.map((r) => ({ name: r.loss_description, value: r.planned_ore_loss }));
    if (small.length) {
      out.push({
        name: `Others (${small.length})`,
        value: small.reduce((sum, r) => sum + r.planned_ore_loss, 0),
      });
    }
    return { slices: out, groupedCount: small.length };
  }, [rows, total]);

  const option = {
    backgroundColor: "transparent",
    color: PIE_COLORS,
    tooltip: {
      trigger: "item",
      backgroundColor: "#0f1c35",
      borderColor: "#2c4a7c",
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#e8eef8", fontSize: 13, fontFamily: "IBM Plex Sans" },
      formatter: (p: { name: string; value: number; percent: number; color: string }) =>
        `<div style="font-weight:700;margin-bottom:4px;color:${p.color}">${p.name}</div>` +
        `<div style="font-family:'IBM Plex Mono'">${formatIndian(Math.round(p.value))} MT` +
        `<span style="color:#8fa8d0"> · ${p.percent.toFixed(1)}%</span></div>`,
    },
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 8,
      top: "middle",
      itemWidth: 11,
      itemHeight: 8,
      textStyle: { fontSize: 11, color: "#6b7ea8", fontFamily: "IBM Plex Sans" },
    },
    series: [{
      type: "pie",
      // A donut: the hole carries the total, and equal-ish slices are easier to
      // compare along an arc than as wedges meeting at a point.
      radius: ["42%", "72%"],
      center: ["31%", "50%"],
      avoidLabelOverlap: true,
      minAngle: 3,
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: {
        show: true,
        formatter: "{d}%",
        fontSize: 11,
        fontFamily: "IBM Plex Mono",
        color: "#31415f",
      },
      labelLine: { length: 8, length2: 8 },
      emphasis: {
        scaleSize: 6,
        label: { show: true, fontSize: 12, fontWeight: "bold" as const },
      },
      data: slices,
    }],
  };

  return (
    <>
      <div className="px-2 pt-2">
        <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge />
      </div>
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
        <p className="text-[9px] font-mono text-txt-muted leading-tight">
          Share of total planned ore loss for the period
          {groupedCount > 0 && <> · {groupedCount} head{groupedCount > 1 ? "s" : ""} below {MIN_SLICE_PCT}% grouped as Others</>}
        </p>
      </div>
    </>
  );
}
