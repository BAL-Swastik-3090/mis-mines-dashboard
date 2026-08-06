"use client";
import { Activity } from "lucide-react";
import { useDateFilter }  from "@/contexts/useDateFilter";
import { useOEE }         from "@/hooks/useOEE";
import type { OEEMachineRow } from "@/types";
import { formatIndian }   from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt1(v: number) { return v.toFixed(1); }
function fmt0(v: number) { return formatIndian(Math.round(v)); }

function pctColor(v: number, threshHigh = 75, threshMid = 50) {
  if (v >= threshHigh) return "text-[#2e7d32]";
  if (v >= threshMid)  return "text-[#c8960c]";
  return "text-[#c62828]";
}

function pctBadge(v: number, threshHigh = 75, threshMid = 50) {
  if (v >= threshHigh) return "bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]";
  if (v >= threshMid)  return "bg-[#fff8e1] text-[#c8960c] border-[#ffe082]";
  return "bg-[#ffebee] text-[#c62828] border-[#ef9a9a]";
}

function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

function tillLabel(apiTo: string) {
  return new Date(apiTo + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
    .toUpperCase();
}

// ── Fleet-level summary KPI strip ─────────────────────────────────────────────
function FleetKpis({ machines, loading }: { machines: OEEMachineRow[]; loading: boolean }) {
  const count = machines.length || 1;
  const avgOee          = machines.reduce((s, m) => s + m.oee, 0) / count;
  const avgAvail        = machines.reduce((s, m) => s + m.availability, 0) / count;
  const avgPerf         = machines.reduce((s, m) => s + m.performance, 0) / count;
  const totalBd         = machines.reduce((s, m) => s + m.bd_hours, 0);
  const totalPm         = machines.reduce((s, m) => s + m.pm_hours, 0);
  const totalActualCum  = machines.reduce((s, m) => s + m.actual_cum, 0);

  const cards = [
    {
      label: "Fleet OEE",
      sub: "avg across excavators",
      value: loading ? null : avgOee,
      unit: "%",
      colorFn: (v: number) => pctColor(v),
    },
    {
      label: "Availability",
      sub: "avg — operating / god hrs",
      value: loading ? null : avgAvail,
      unit: "%",
      colorFn: (v: number) => pctColor(v, 85, 70),
    },
    {
      label: "Performance",
      sub: "avg — actual / ideal CuM",
      value: loading ? null : avgPerf,
      unit: "%",
      colorFn: (v: number) => pctColor(v, 85, 70),
    },
    {
      label: "Total Breakdown",
      sub: "hrs across all excavators",
      value: loading ? null : totalBd,
      unit: " hrs",
      colorFn: () => "text-[#c62828]",
      fmt: fmt1,
    },
    {
      label: "Total PM",
      sub: "hrs planned maintenance",
      value: loading ? null : totalPm,
      unit: " hrs",
      colorFn: () => "text-[#c8960c]",
      fmt: fmt1,
    },
    {
      label: "Actual Excavation",
      sub: "fleet total CuM",
      value: loading ? null : totalActualCum,
      unit: " M³",
      colorFn: () => "text-[#1565c0]",
      fmt: fmt0,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <div className="text-[10px] font-bold tracking-widest uppercase font-condensed text-txt-secondary">{c.label}</div>
            <div className="text-[9px] text-txt-light tracking-wider font-condensed uppercase mt-0.5">{c.sub}</div>
          </div>
          <div className="px-4 pb-3">
            {c.value == null ? (
              <Shimmer w="w-20" h="h-7" />
            ) : (
              <div className={`font-condensed font-extrabold text-[24px] tracking-tight leading-none ${c.colorFn(c.value)}`}>
                {c.fmt ? c.fmt(c.value) : c.value.toFixed(1)}
                <span className="text-[11px] font-normal text-txt-muted ml-0.5">{c.unit}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Per-machine OEE table ──────────────────────────────────────────────────────
function OEETable({ machines, loading }: { machines: OEEMachineRow[]; loading: boolean }) {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          OEE Breakdown — Per Excavator
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-mono">
          <thead>
            <tr className="bg-bg-section border-b border-border-light">
              {[
                "Machine", "Ideal Cap\n(CuM/hr)", "God Hrs",
                "BD Hrs", "PM Hrs", "Op Hrs",
                "Actual CuM", "Ideal CuM",
                "Availability", "Performance", "Quality", "OEE",
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-[10px] font-condensed font-bold tracking-widest uppercase text-txt-secondary whitespace-pre-line"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light/60">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 12 }).map((__, j) => (
                    <td key={j} className="px-3 py-3">
                      <Shimmer w="w-14" h="h-4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : machines.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-txt-muted text-sm font-sans">
                  No data for selected period
                </td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m.machine} className="hover:bg-bg-section/50 transition-colors">
                  {/* Machine name */}
                  <td className="px-3 py-2.5 font-condensed font-bold text-[12px] text-navy whitespace-nowrap">
                    {m.machine}
                  </td>
                  {/* Ideal cap */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt1(m.ideal_cap)}</td>
                  {/* God hrs */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt1(m.god_hours)}</td>
                  {/* BD hrs */}
                  <td className={`px-3 py-2.5 font-semibold ${m.bd_hours > 0 ? "text-[#c62828]" : "text-txt-light"}`}>
                    {fmt1(m.bd_hours)}
                  </td>
                  {/* PM hrs */}
                  <td className={`px-3 py-2.5 font-semibold ${m.pm_hours > 0 ? "text-[#c8960c]" : "text-txt-light"}`}>
                    {fmt1(m.pm_hours)}
                  </td>
                  {/* Op hrs */}
                  <td className="px-3 py-2.5 text-[#1565c0] font-semibold">{fmt1(m.operating_hrs)}</td>
                  {/* Actual CuM */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt0(m.actual_cum)}</td>
                  {/* Ideal CuM */}
                  <td className="px-3 py-2.5 text-txt-light">{fmt0(m.ideal_cum)}</td>
                  {/* Availability */}
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${pctBadge(m.availability, 85, 70)}`}>
                      {fmt1(m.availability)}%
                    </span>
                  </td>
                  {/* Performance */}
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${pctBadge(m.performance, 85, 70)}`}>
                      {fmt1(m.performance)}%
                    </span>
                  </td>
                  {/* Quality */}
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]">
                      100%
                    </span>
                  </td>
                  {/* OEE */}
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-extrabold ${pctBadge(m.oee)}`}>
                      {fmt1(m.oee)}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 flex flex-wrap gap-x-4 gap-y-1">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">LOSS HRS · </span>IMOS
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">BREAKDOWN · </span>SAP
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">PM · </span>SAP
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">EXCAVATION · </span>SAP
        </p>
      </div>
    </div>
  );
}

// ── OEE formula reference card ────────────────────────────────────────────────
function FormulaCard() {
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          OEE Calculation Reference
        </span>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Availability",
            formula: "Operating Hrs ÷ God Hrs × 100",
            note: "God Hrs = Days × 24",
            color: "text-[#1565c0]",
            border: "border-l-[#1565c0]",
          },
          {
            label: "Performance",
            formula: "Actual CuM ÷ (Ideal Cap × Op Hrs) × 100",
            note: "Capped at 100%",
            color: "text-[#c8960c]",
            border: "border-l-[#c8960c]",
          },
          {
            label: "Quality",
            formula: "100% (fixed)",
            note: "No quality losses tracked",
            color: "text-[#2e7d32]",
            border: "border-l-[#2e7d32]",
          },
          {
            label: "OEE",
            formula: "Availability × Performance × Quality",
            note: "Target: ≥ 75%",
            color: "text-[#6a1b9a]",
            border: "border-l-[#6a1b9a]",
          },
        ].map((f) => (
          <div key={f.label} className={`border-l-2 pl-3 ${f.border}`}>
            <div className={`font-condensed font-bold text-[11px] tracking-widest uppercase mb-1 ${f.color}`}>
              {f.label}
            </div>
            <div className="font-mono text-[10px] text-navy leading-relaxed">{f.formula}</div>
            <div className="text-[9px] text-txt-muted mt-0.5">{f.note}</div>
          </div>
        ))}
      </div>
      <div className="px-4 pb-3 pt-0">
        <div className="text-[9px] font-mono text-txt-muted">
          <span className="font-semibold">Operating Hrs</span> = God Hrs − (Weekly Off + No Plan + Planned Shutdown) − (Breakdown + PM)
        </div>
      </div>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────
export default function OEESection() {
  const { apiTo }                        = useDateFilter();
  const { data, isLoading }              = useOEE();
  const machines                         = data?.machines ?? [];

  return (
    <div className="space-y-4">

      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-[#6a1b9a]" />
          <h2 className="font-condensed font-extrabold text-[15px] tracking-widest uppercase text-navy">
            OEE / LCM Analysis
          </h2>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#f3e5f5] text-[#6a1b9a] border-[#ce93d8] tracking-widest uppercase font-mono">
            Excavators
          </span>
        </div>
        {!isLoading && apiTo && (
          <span className="text-[10px] font-mono text-txt-muted">
            MTD till {tillLabel(apiTo)}
          </span>
        )}
      </div>

      {/* Fleet KPI strip */}
      <FleetKpis machines={machines} loading={isLoading} />

      {/* Per-machine breakdown table */}
      <OEETable machines={machines} loading={isLoading} />

      {/* Formula reference */}
      <FormulaCard />

    </div>
  );
}
