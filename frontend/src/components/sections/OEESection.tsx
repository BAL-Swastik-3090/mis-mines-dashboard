"use client";
import { useState } from "react";
import { Activity, Layers, Info, Factory } from "lucide-react";
import FormulaModal from "@/components/sections/FormulaModal";
import LCMSection from "@/components/sections/LCMSection";
import LCMCobSection from "@/components/sections/LCMCobSection";
import { useDateFilter }  from "@/contexts/useDateFilter";
import { useOEE }         from "@/hooks/useOEE";
import type { OEEMachineRow, OEEFleet } from "@/types";
import { formatIndian }   from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt1(v: number) { return formatIndian(Number(v.toFixed(1))); }
function fmt2(v: number) { return v.toFixed(2); }
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
// Figures come straight from the server's weighted roll-up. Averaging the
// machine percentages here would overstate fleet Performance and OEE by ~50%,
// because a machine that barely ran would count as much as one that ran all month.
function FleetKpis({ fleet, loading }: { fleet: OEEFleet | undefined; loading: boolean }) {
  const cards = [
    {
      label: "Fleet OEE",
      sub: "weighted · avail × perf × qual",
      value: loading ? null : fleet?.oee ?? null,
      unit: "%",
      colorFn: (v: number) => pctColor(v),
    },
    {
      label: "Availability",
      sub: "Σ operating ÷ Σ ideal time",
      value: loading ? null : fleet?.availability ?? null,
      unit: "%",
      colorFn: (v: number) => pctColor(v, 85, 70),
    },
    {
      label: "Performance",
      sub: "Σ actual ÷ Σ ideal CuM",
      value: loading ? null : fleet?.performance ?? null,
      unit: "%",
      colorFn: (v: number) => pctColor(v, 85, 70),
    },
    {
      label: "Total Breakdown",
      sub: "hrs · SAP M2 notifications",
      value: loading ? null : fleet?.bd_hours ?? null,
      unit: " hrs",
      colorFn: () => "text-[#c62828]",
      fmt: fmt1,
    },
    {
      label: "Deviation Hrs",
      sub: fleet?.deviation_pct != null ? `${fleet.deviation_pct}% of shift hrs` : "unplanned idle",
      value: loading ? null : fleet?.deviation_hrs ?? null,
      unit: " hrs",
      colorFn: () => "text-[#c8960c]",
      fmt: fmt1,
    },
    {
      label: "Actual Excavation",
      sub: "fleet total CuM",
      value: loading ? null : fleet?.actual_cum ?? null,
      unit: " M³",
      colorFn: () => "text-[#1565c0]",
      fmt: fmt0,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
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
function OEETable({ machines, fleet, loading }: { machines: OEEMachineRow[]; fleet: OEEFleet | undefined; loading: boolean }) {
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
                "Excavator", "God Hrs",
                "BD Hrs", "PM Hrs", "Deviation Hrs", "Operating Hrs",
                "Actual CuM", "Ideal CuM",
                "Availability %", "Performance %", "Quality %", "OEE %",
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
                  {/* Machine + ideal capacity underneath */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="font-condensed font-bold text-[12px] text-navy">{m.machine}</div>
                    <div className="text-[9px] text-txt-light">{fmt1(m.ideal_cap)} CuM/hr</div>
                  </td>
                  {/* God hrs */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt1(m.god_hours)}</td>
                  {/* BD hrs */}
                  <td className={`px-3 py-2.5 font-semibold ${m.bd_hours > 0 ? "text-[#c62828]" : "text-txt-light"}`}>
                    {fmt2(m.bd_hours)}
                  </td>
                  {/* PM hrs */}
                  <td className={`px-3 py-2.5 font-semibold ${m.pm_hours > 0 ? "text-[#c8960c]" : "text-txt-light"}`}>
                    {fmt2(m.pm_hours)}
                  </td>
                  {/* Deviation hrs — reporting only, feeds no formula */}
                  <td className="px-3 py-2.5">
                    <div className="text-navy font-semibold">{fmt2(m.deviation_hrs)}</div>
                    {m.deviation_pct != null && (
                      <div className="text-[9px] text-txt-light">{m.deviation_pct}% of shift</div>
                    )}
                  </td>
                  {/* Operating hrs */}
                  <td className="px-3 py-2.5 text-[#1565c0] font-semibold">{fmt2(m.operating_hrs)}</td>
                  {/* Actual CuM */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt1(m.actual_cum)}</td>
                  {/* Ideal CuM */}
                  <td className="px-3 py-2.5 text-txt-light">{fmt1(m.ideal_cum)}</td>
                  {/* Availability */}
                  <td className={`px-3 py-2.5 font-bold ${pctColor(m.availability, 85, 70)}`}>
                    {fmt2(m.availability)}
                  </td>
                  {/* Performance */}
                  <td className={`px-3 py-2.5 font-bold ${pctColor(m.performance, 85, 70)}`}>
                    {fmt2(m.performance)}
                  </td>
                  {/* Quality — fixed 100, no regrade loss is captured anywhere */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt2(m.quality)}</td>
                  {/* OEE */}
                  <td className={`px-3 py-2.5 font-extrabold ${pctColor(m.oee)}`}>
                    {fmt2(m.oee)}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* Weighted fleet roll-up — from the server, not averaged here */}
          {!loading && fleet && machines.length > 0 && (
            <tfoot>
              <tr className="bg-bg-section border-t-2 border-border font-bold">
                <td className="px-3 py-3 font-condensed text-[12px] text-navy tracking-widest uppercase">
                  Overall
                </td>
                <td className="px-3 py-3 text-navy">{fmt1(fleet.god_hours)}</td>
                <td className="px-3 py-3 text-[#c62828]">{fmt2(fleet.bd_hours)}</td>
                <td className="px-3 py-3 text-[#c8960c]">{fmt2(fleet.pm_hours)}</td>
                <td className="px-3 py-3">
                  <div className="text-navy">{fmt2(fleet.deviation_hrs)}</div>
                  {fleet.deviation_pct != null && (
                    <div className="text-[9px] font-normal text-txt-light">{fleet.deviation_pct}% of shift</div>
                  )}
                </td>
                <td className="px-3 py-3 text-[#1565c0]">{fmt2(fleet.operating_hrs)}</td>
                <td className="px-3 py-3 text-navy">{fmt1(fleet.actual_cum)}</td>
                <td className="px-3 py-3 text-txt-secondary">{fmt1(fleet.ideal_cum)}</td>
                <td className={`px-3 py-3 ${pctColor(fleet.availability, 85, 70)}`}>{fmt2(fleet.availability)}</td>
                <td className={`px-3 py-3 ${pctColor(fleet.performance, 85, 70)}`}>{fmt2(fleet.performance)}</td>
                <td className="px-3 py-3 text-txt-secondary">{fmt2(fleet.quality)}</td>
                <td className="px-3 py-3 text-[#0288d1] font-extrabold">{fmt2(fleet.oee)}</td>
              </tr>
            </tfoot>
          )}
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

// ── Main section ──────────────────────────────────────────────────────────────
export default function OEESection() {
  const { apiTo }           = useDateFilter();
  const { data, isLoading } = useOEE();
  const machines            = data?.machines ?? [];
  const [showFormulae, setShowFormulae] = useState(false);

  return (
    <div className="space-y-4">

      <FormulaModal open={showFormulae} onClose={() => setShowFormulae(false)} />

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
        {/* Right side — MTD label with the formula trigger beside it. The button
            renders whether or not the label does, so it never disappears while
            the section is loading. */}
        <div className="flex items-center gap-2">
          {!isLoading && apiTo && (
            <span className="text-[10px] font-mono text-txt-muted">
              MTD till {tillLabel(apiTo)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowFormulae(true)}
            title="View all OEE / LCM formulae"
            aria-label="View all OEE / LCM formulae"
            className="w-6 h-6 rounded-full border border-[#ce93d8] bg-[#f3e5f5] text-[#6a1b9a]
                       flex items-center justify-center hover:bg-[#e1bee7] transition-colors shrink-0"
          >
            <Info size={13} />
          </button>
        </div>
      </div>

      {/* Fleet KPI strip */}
      <FleetKpis fleet={data?.fleet} loading={isLoading} />

      {/* Per-machine breakdown table */}
      <OEETable machines={machines} fleet={data?.fleet} loading={isLoading} />

      {/* ── LCM — Lost Cost Matrix, inline below the OEE reference ────── */}
      <div className="flex items-center gap-2 pt-3">
        <Layers size={17} className="text-[#6a1b9a]" />
        <h2 className="font-condensed font-extrabold text-[15px] tracking-widest uppercase text-navy">
          LCM — Lost Cost Matrix
        </h2>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#f3e5f5] text-[#6a1b9a] border-[#ce93d8] tracking-widest uppercase font-mono">
          Own Equipment
        </span>
        <span className="ml-auto text-[10px] font-mono text-txt-muted hidden sm:inline">
          Ore · 470(7), 470(2)&nbsp;&nbsp;|&nbsp;&nbsp;OB · 370(5), 370(4), 220(8)
        </span>
      </div>

      <LCMSection />

      {/* ── LCM for COB — the beneficiation plant, below the mines matrix ──
          Kept a separate block rather than extra columns on the matrix above:
          the mines LCM distributes across loss heads from the shift log, and
          the plant has no downtime log to draw heads from. Different object,
          different shape, same period and costing conventions. */}
      <div className="flex items-center gap-2 pt-3">
        <Factory size={17} className="text-[#00838f]" />
        <h2 className="font-condensed font-extrabold text-[15px] tracking-widest uppercase text-navy">
          LCM for COB
        </h2>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#e0f7fa] text-[#00838f] border-[#80deea] tracking-widest uppercase font-mono">
          Plant 1210
        </span>
        <span className="ml-auto text-[10px] font-mono text-txt-muted hidden sm:inline">
          Concentrate deviation&nbsp;·&nbsp;feed volume vs recovery
        </span>
      </div>

      <LCMCobSection />

    </div>
  );
}
