"use client";
import { AlertTriangle, Calculator, TrendingDown, Layers } from "lucide-react";
import { useLCM } from "@/hooks/useLCM";
import { formatIndian } from "@/lib/utils";

function fmt(v: number | null | undefined, dp = 2) {
  if (v == null) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function f0(v: number | null | undefined) {
  return v == null ? "—" : formatIndian(Math.round(v));
}
function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

export default function LCMSection() {
  const { data, isLoading, isError, error } = useLCM();
  const b = data?.basis;
  const t = data?.totals;
  const c = data?.coverage;

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

      {/* Controllable split */}
      {!isLoading && t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Controllable Ore Loss",     value: `${f0(t.controllable_ore_loss)} MT`,
              sub: `${fmt(t.controllable_ore_hours, 1)} hrs`, accent: "#c62828" },
            { label: "Total Ore Loss",            value: `${f0(t.planned_ore_loss)} MT`,
              sub: `${fmt(t.ore_hours, 1)} hrs`, accent: "#1565c0" },
            { label: "Controllable OB Loss",      value: `${f0(t.controllable_ob_loss)} CuM`,
              sub: `${fmt(t.controllable_ob_hours, 1)} hrs`, accent: "#c62828" },
            { label: "Total OB Loss",             value: `${f0(t.planned_ob_loss)} CuM`,
              sub: `${fmt(t.ob_hours, 1)} hrs`, accent: "#2e7d32" },
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
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">Loss Type</th>
                <th className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary">KAM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/60">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 8 }).map((__, j) => (
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
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-[9px] font-bold whitespace-nowrap ${
                        r.loss_type === "Controllable"
                          ? "bg-[#ffebee] text-[#c62828] border-[#ef9a9a]"
                          : "bg-[#eceef3] text-[#5a6480] border-[#c5cbd8]"
                      }`}>
                        {r.loss_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[10.5px] text-txt-light whitespace-nowrap">{r.kam}</td>
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
                  <td className="px-3 py-2.5" colSpan={2} />
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
            Mining Restriction is a flat 48 hrs per machine per month, prorated by period.
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
                      <div className="h-full rounded"
                           style={{ width: `${pct}%`,
                                    backgroundColor: r.loss_type === "Controllable" ? "#c62828" : "#5a6480" }} />
                    </div>
                    <span className="w-[120px] shrink-0 text-right text-[11px] font-mono text-navy">
                      {f0(r.planned_ore_loss)} MT
                      <span className="text-txt-light ml-1">({share.toFixed(1)}%)</span>
                    </span>
                  </div>
                );
              })}
          </div>
          <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 flex gap-3">
            <span className="text-[9px] font-mono text-txt-muted flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-[#c62828] inline-block" /> Controllable
            </span>
            <span className="text-[9px] font-mono text-txt-muted flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-[#5a6480] inline-block" /> Non Controllable
            </span>
          </div>
        </div>
      )}

    </div>
  );
}
