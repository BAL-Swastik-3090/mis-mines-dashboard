"use client";
import { AlertTriangle, Calculator, TrendingDown, Layers, IndianRupee } from "lucide-react";
import { useLCM } from "@/hooks/useLCM";
import { formatIndian } from "@/lib/utils";

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
function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

export default function LCMSection() {
  const { data, isLoading, isError, error } = useLCM();
  const b = data?.basis;
  const t = data?.totals;
  const c = data?.coverage;
  const cost = data?.costing;

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

          <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              Weighted Rate = Σ(Plan Qty × IBM Rate) ÷ Σ Plan Qty, weighted on the planned
              grade mix. Loss Amount = Planned Ore Loss × Weighted Rate.
            </p>
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              Plan Value is the whole planned ore valued at these rates. Total Loss Value below
              is only the portion that was planned and never excavated — a slice of it, not a
              total of it.
            </p>
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              IBM prices by Cr₂O₃ band, so each grade takes its representative band — HG the
              52–54% band, MG the 46–48% band at the midpoint of its 40–52% range. IBM
              publishes no band below 42%, so LG is valued at zero; since LG is COB feed and
              does realise value as concentrate, a period carrying LG tonnage is understated.
            </p>
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              OB carries no rupee value — it is waste rock moved to expose ore, not a saleable
              product, so OB loss stays a volume in CuM.
            </p>
          </div>
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
          <span className="text-[10px] font-mono text-txt-light">own equipment only</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="bg-bg-section border-b border-border-light">
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Sl.</th>
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Loss Description</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#1565c0]">Production<br/>Hour Loss</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#1565c0]">Planned Ore<br/>Loss (MT)</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#2e7d32]">OB Production<br/>Hour Loss</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#2e7d32]">Planned OB<br/>Loss (CuM)</th>
                <th className="px-3 py-2 text-right text-[10px] font-condensed font-bold tracking-widest uppercase text-[#ad1457]">Loss Amount<br/>(₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/60">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5"><Shimmer w="w-14" h="h-4" /></td>
                  ))}</tr>
                ))
              ) : (data?.rows ?? []).map((r) => {
                const idle = r.ore_hours === 0 && r.ob_hours === 0;
                return (
                  <tr key={r.sl_no} className={`hover:bg-bg-section/50 transition-colors ${idle ? "opacity-45" : ""}`}>
                    <td className="px-3 py-2 text-txt-light">{r.sl_no}</td>
                    <td className="px-3 py-2 font-condensed font-bold text-[12px] text-navy whitespace-nowrap">
                      {r.loss_description}
                    </td>
                    <td className="px-3 py-2 text-right text-navy">{fmt(r.ore_hours, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#1565c0]">{fmt(r.planned_ore_loss, 1)}</td>
                    <td className="px-3 py-2 text-right text-navy">{fmt(r.ob_hours, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#2e7d32]">{f0(r.planned_ob_loss)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#ad1457]">{rs(r.loss_amount)}</td>
                  </tr>
                );
              })}
            </tbody>
            {!isLoading && t && (
              <tfoot>
                <tr className="bg-navy text-white border-t-2 border-navy font-bold">
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 font-condensed tracking-widest uppercase text-[11px]">Total</td>
                  <td className="px-3 py-2.5 text-right">{fmt(t.ore_hours, 2)}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(t.planned_ore_loss, 1)}</td>
                  <td className="px-3 py-2.5 text-right">{fmt(t.ob_hours, 2)}</td>
                  <td className="px-3 py-2.5 text-right">{f0(t.planned_ob_loss)}</td>
                  <td className="px-3 py-2.5 text-right">{rs(t.loss_amount)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 space-y-0.5">
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Planned Loss = Hour Loss × Multiplying Factor. The column totals back to the Deviation by construction.
          </p>
          <p className="text-[9px] font-mono text-txt-muted leading-tight">
            Breakdown and Preventive Maintenance come from SAP; the other heads from the IMOS shift log.
            Mining Restriction has no source in the database and is entered manually by the mine, so it reads 0 here.
          </p>
        </div>
      </div>

      {/* Pareto — top controllable losses */}
      {!isLoading && data && data.rows.some((r) => r.planned_ore_loss > 0 || r.planned_ob_loss > 0) && (
        <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center gap-2">
            <TrendingDown size={14} className="text-[#c62828]" />
            <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
              Biggest Losses — Ore
            </span>
          </div>
          <div className="p-4 space-y-2">
            {[...data.rows]
              .filter((r) => r.planned_ore_loss > 0)
              .sort((a, bb) => bb.planned_ore_loss - a.planned_ore_loss)
              .slice(0, 8)
              .map((r) => {
                const max = Math.max(...data.rows.map((x) => x.planned_ore_loss), 1);
                const pct = (r.planned_ore_loss / max) * 100;
                const share = data.totals.planned_ore_loss > 0
                  ? (r.planned_ore_loss / data.totals.planned_ore_loss) * 100 : 0;
                return (
                  <div key={r.sl_no} className="flex items-center gap-3">
                    <span className="w-[190px] shrink-0 text-[11px] font-condensed font-bold text-navy truncate">
                      {r.loss_description}
                    </span>
                    <div className="flex-1 h-[16px] bg-bg-section rounded overflow-hidden">
                      <div className="h-full rounded bg-[#1565c0]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-[120px] shrink-0 text-right text-[11px] font-mono text-navy">
                      {f0(r.planned_ore_loss)} MT
                      <span className="text-txt-light ml-1">({share.toFixed(1)}%)</span>
                    </span>
                  </div>
                );
              })}
          </div>
          <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40">
            <p className="text-[9px] font-mono text-txt-muted leading-tight">
              Share is of total planned ore loss for the period
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
