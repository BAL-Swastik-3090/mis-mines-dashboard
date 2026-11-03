"use client";
import { useState } from "react";
import { Activity, Layers, Info, Factory, Download, Check } from "lucide-react";
import FormulaModal from "@/components/sections/FormulaModal";
import LCMSection from "@/components/sections/LCMSection";
import EquipmentPlanModal from "@/components/sections/EquipmentPlanModal";
import { useLCM } from "@/hooks/useLCM";
import { useEntryDialog } from "@/contexts/useEntryDialog";
import LCMCobSection from "@/components/sections/LCMCobSection";
import KamLossTreeSection from "@/components/sections/KamLossTreeSection";
import { useDateFilter }  from "@/contexts/useDateFilter";
import { useOEE }         from "@/hooks/useOEE";
import { useTipperOEE }   from "@/hooks/useTipperOEE";
import TipperOEETable     from "@/components/sections/TipperOEETable";
import type { OEEMachineRow, OEEFleet } from "@/types";
import { formatIndian }   from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { downloadDashboard } from "@/utils/downloadDashboard";
import { withExportMode }    from "@/contexts/useExportMode";
import { toCsv, download } from "@/components/minehub/spreadsheet";

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
      sub: "Σ available ÷ Σ ideal time",
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
      // No longer one source: the owned machines carry SAP M2 notifications,
      // the hired ones have no equipment number and carry the shift log instead.
      sub: "hrs · SAP + shift log",
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

// ── Export ────────────────────────────────────────────────────────────────────
// The twelve columns on screen, in the same order, then the four things the
// table prints as small print under a heading — capacity, whether the machine is
// hired, where its breakdown came from, and deviation as a share of the shift.
// Columns of their own here rather than two values in one cell: a spreadsheet is
// sorted and filtered, and "17 CuM/hr" inside the machine name defeats both.
const EXPORT_HEADINGS = [
  "Excavator", "God Hrs", "BD Hrs", "PM Hrs", "Available Hrs", "Running Hrs",
  "Deviation Hrs",
  // Ideal before Actual, as on screen. The material split is not here but in
  // its own columns at the end, so this pair is adjacent in both places.
  "Ideal CuM", "Actual CuM", "Availability %", "Performance %",
  "Quality %", "OEE %", "Utilisation %",
  "Ideal Capacity (CuM/hr)", "Ownership", "Breakdown Source", "Deviation % of Shift",
  // PLAN FIRST, THEN WHAT ACTUALLY MOVED, because the sheet is sorted on the
  // plan and read against the measurement. "Plan Source" says whether the
  // month was entered or carried forward — a filter the mine needs, and one
  // that is invisible if the two are collapsed into a single column.
  "Planned Material", "Plan Source", "Plan From",
  // Shares as their own columns, not "ORE 83%" in one cell: a spreadsheet is
  // sorted and filtered, and a label glued to a number defeats both.
  "Material Moved", "Ore CuM", "OB CuM", "Other CuM", "Ore %", "OB %", "Other %",
];

/** Numbers go out as numbers, rounded the way the screen rounds them.
 *  formatIndian would write "12,092", which Excel reads as text and will not
 *  sum — and the comma would have to be quoted, so the file is worse twice. */
const n1 = (v: number) => Number(v.toFixed(1));
const n2 = (v: number) => Number(v.toFixed(2));

function exportRows(machines: OEEMachineRow[], fleet: OEEFleet | undefined): unknown[][] {
  const rows: unknown[][] = machines.map((m) => [
    m.machine, n1(m.god_hours), n2(m.bd_hours), n2(m.pm_hours),
    n2(m.operating_hrs), n2(m.running_hrs),
    n2(m.deviation_hrs), n1(m.ideal_cum), n1(m.actual_cum), n2(m.availability),
    n2(m.performance), n2(m.quality), n2(m.oee), m.utilisation ?? "",
    n1(m.ideal_cap), m.hired ? "Hired" : "Owned",
    m.bd_source === "sap" ? "SAP" : "Shift log",
    m.deviation_pct ?? "",
    m.plan_material ?? "", m.plan_source ?? "", m.plan_from ?? "",
    m.material ?? "", n1(m.ore_cum), n1(m.ob_cum), n1(m.other_cum),
    m.ore_pct ?? "", m.ob_pct ?? "", m.other_pct ?? "",
  ]);
  // The weighted roll-up exactly as the footer shows it, taken from the server
  // rather than re-summed here: averaging machine percentages would overstate
  // fleet Performance and OEE badly.
  if (fleet && machines.length) {
    rows.push([
      "OVERALL", n1(fleet.god_hours), n2(fleet.bd_hours), n2(fleet.pm_hours),
      n2(fleet.operating_hrs), n2(fleet.running_hrs),
      n2(fleet.deviation_hrs), n1(fleet.ideal_cum),
      n1(fleet.actual_cum), n2(fleet.availability),
      n2(fleet.performance), n2(fleet.quality), n2(fleet.oee), fleet.utilisation ?? "",
      "", "", "", fleet.deviation_pct ?? "",
      `${fleet.plan_ore} ore / ${fleet.plan_ob} OB`, "", "",
      fleet.material ?? "", n1(fleet.ore_cum), n1(fleet.ob_cum), n1(fleet.other_cum),
      fleet.ore_pct ?? "", fleet.ob_pct ?? "", fleet.other_pct ?? "",
    ]);
  }
  return rows;
}

/** THE MONTH'S PLAN: what the mine assigned this machine to dig.
 *
 *  NOT WHAT IT ACTUALLY MOVED. That is the tooltip, and the two are meant to
 *  be read against each other — a machine planned ORE whose tooltip says OB
 *  is the deviation the mine explains. The column itself states the plan,
 *  because the plan is a fact about the month: it does not disappear on a day
 *  the machine stood idle, which is what the measured split did on six of ten
 *  rows the moment anyone looked at a single day.
 *
 *  COLOUR CARRIES THE CLASS, NOT THE QUALITY. Ore is not "good" and overburden
 *  "bad" — stripping waste is the job on some benches — so these are neutral
 *  hues that tell the classes apart, never the red/amber/green used by the
 *  percentage columns, which a reader scans for trouble.
 *
 *  CARRIED FORWARD IS MARKED, NOT HIDDEN. A plan taken from an earlier month
 *  is dimmed and carries a dot; the tooltip names the month. Somebody has to
 *  be able to see that this month was never entered.
 *
 *  A DASH MEANS NEVER ASSIGNED, in any month — not "idle". Nothing is guessed
 *  for it, and the LCM is leaving its hours out for the same reason. */
const PLAN_TONE: Record<string, string> = {
  ORE: "bg-[#e8f0fe] text-[#1a4a8f]",
  OB:  "bg-[#f3ece3] text-[#7a5a2e]",
};

function monthLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function PlanTag({ m }: {
  m: { plan_material: string | null; plan_source: string | null;
       plan_from: string | null;
       material: string | null; material_pct: number | null;
       ore_pct: number | null; ob_pct: number | null; other_pct: number | null };
}) {
  // What the machine actually moved, always in the tooltip so the plan can be
  // checked against it. "no movement logged" rather than 0% — the machine was
  // not measured, which is not the same as having dug nothing.
  const moved = m.material
    ? `Moved: ore ${m.ore_pct ?? 0}% · OB ${m.ob_pct ?? 0}% · other ${m.other_pct ?? 0}%`
    : "Moved: no movement logged in this period";

  if (!m.plan_material) {
    return (
      <span className="text-txt-light/60"
            title={`No excavation plan has ever been entered for this machine. ${moved}`}>
        —
      </span>
    );
  }

  const carried = m.plan_source === "carried";
  const title = carried
    ? `Planned ${m.plan_material} — carried forward from ${monthLabel(m.plan_from)}; `
      + `this month's plan has not been entered. ${moved}`
    : `Planned ${m.plan_material} for this month. ${moved}`;

  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span
        className={`px-1.5 py-px rounded-sm text-[9px] font-bold tracking-wide
                    ${PLAN_TONE[m.plan_material]} ${carried ? "opacity-60" : ""}`}
      >
        {m.plan_material}
      </span>
      {carried && (
        <span className="text-[10px] text-amber-600 font-bold leading-none"
              aria-label="carried forward">•</span>
      )}
    </span>
  );
}

/** The OVERALL row counts machines rather than averaging them: a plan is a
 *  label per machine, so there is no weighted mean of ORE and OB to take. */
function PlanTotals({ f }: {
  f: { plan_ore: number; plan_ob: number;
       plan_unplanned: number; plan_carried: number };
}) {
  if (!f.plan_ore && !f.plan_ob) {
    return <span className="text-txt-light/60">—</span>;
  }
  const notes = [
    f.plan_carried   ? `${f.plan_carried} carried forward from an earlier month` : "",
    f.plan_unplanned ? `${f.plan_unplanned} never assigned, excluded from the LCM` : "",
  ].filter(Boolean);
  return (
    <span className="inline-flex items-center gap-1.5"
          title={notes.length ? notes.join("; ") : "Every machine assigned this month"}>
      <span className="text-[10px] font-mono text-txt-light">
        {f.plan_ore} ore · {f.plan_ob} OB
      </span>
      {!!f.plan_unplanned && (
        <span className="text-[10px] font-mono text-amber-600">
          +{f.plan_unplanned} unplanned
        </span>
      )}
    </span>
  );
}

// ── Per-machine OEE table ──────────────────────────────────────────────────────
function OEETable({ title, slug, machines, fleet, loading, from, to }: {
  title: string; slug: string;
  machines: OEEMachineRow[]; fleet: OEEFleet | undefined; loading: boolean;
  from?: string; to?: string;
}) {
  const canExport = !loading && machines.length > 0;
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border-light flex items-center justify-between gap-3">
        <span className="font-condensed font-bold text-[13px] text-navy tracking-widest uppercase">
          {title}
        </span>
        {/* The period goes in the FILENAME, not a banner row above the data. A
            title row stops Excel treating row 1 as headings, which breaks sort,
            filter and freeze-panes. */}
        <button
          type="button"
          onClick={() => download(
            toCsv(EXPORT_HEADINGS, exportRows(machines, fleet)),
            `oee-${slug}-${from ?? ""}-to-${to ?? ""}.csv`)}
          disabled={!canExport}
          title={canExport ? "Download this table as a spreadsheet" : "Nothing to export yet"}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded border
                     border-border bg-white text-[10px] font-condensed font-bold uppercase
                     tracking-widest text-navy hover:bg-bg-soft
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white
                     focus:outline-none focus:ring-1 focus:ring-navy"
        >
          <Download size={12} />
          Excel
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-mono">
          <thead>
            <tr className="bg-bg-section border-b border-border-light">
              {[
                "Excavator", "God Hrs",
                "BD Hrs", "PM Hrs", "Available Hrs", "Running Hrs", "Deviation Hrs",
                // WHAT, THEN THE TARGET, THEN WHAT WAS DONE. Actual sits last
                // of the three so it lands beside Ideal, which is the number
                // it is read against — Performance is Actual ÷ Ideal, and the
                // two were separated by the material tag.
                "Ore / OB (Plan)", "Ideal CuM", "Actual CuM",
                "Availability %", "Performance %", "Quality %", "OEE %", "Utilisation %",
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
                <td colSpan={15} className="px-4 py-8 text-center text-txt-muted text-sm font-sans">
                  No data for selected period
                </td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m.machine} className="hover:bg-bg-section/50 transition-colors">
                  {/* Machine + ideal capacity underneath */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-condensed font-bold text-[12px] text-navy">{m.machine}</span>
                      {/* Hired machines are not Balasore assets, so they have no
                          SAP equipment number and their downtime is read from a
                          different place. Marking them keeps that visible rather
                          than leaving two sources silently mixed in one column. */}
                      {m.hired && (
                        <span
                          title="Hired machine — no SAP equipment number; breakdown and PM come from the daily shift log"
                          className="px-1 py-px rounded-sm bg-[#ede7f6] text-[#5e35b1] text-[8px] font-bold tracking-wide"
                        >
                          HIRED
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-txt-light">{fmt1(m.ideal_cap)} CuM/hr</div>
                  </td>
                  {/* God hrs */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt1(m.god_hours)}</td>
                  {/* BD hrs — and WHERE IT CAME FROM, because the two sources do
                      not measure the same thing. SAP counts a notification from
                      open to close including unmanned nights; the shift log
                      counts downtime inside a manned shift. A reader comparing
                      two rows needs to know which they are looking at. */}
                  <td className={`px-3 py-2.5 font-semibold ${m.bd_hours > 0 ? "text-[#c62828]" : "text-txt-light"}`}>
                    <div>{fmt2(m.bd_hours)}</div>
                    <div className="text-[8px] font-normal text-txt-light tracking-wide">
                      {m.bd_source === "sap" ? "SAP" : "SHIFT LOG"}
                    </div>
                  </td>
                  {/* PM hrs */}
                  <td className={`px-3 py-2.5 font-semibold ${m.pm_hours > 0 ? "text-[#c8960c]" : "text-txt-light"}`}>
                    {fmt2(m.pm_hours)}
                  </td>
                  {/* AVAILABLE HRS — Ideal Time less BD less PM, so it sits
                      directly after the two columns it subtracts and the
                      arithmetic reads left to right across the row. (Ideal Time
                      is God Hrs less planned loss, so where none is booked this
                      is simply God − BD − PM, which is how most rows read.)
                      NOT the denominator of Utilisation at the far right, which
                      deliberately leaves PM in — see _utilisation() in
                      services/oee.py for why. */}
                  <td className="px-3 py-2.5 text-[#1565c0] font-semibold">{fmt2(m.operating_hrs)}</td>
                  {/* RUNNING HRS — before Deviation, because the two are one
                      8-hour shift split in two: every shift row in
                      mines_tipper_details has running + deviation = 8.00
                      exactly. Reading them apart puts the pair back together.
                      It is also the numerator of Utilisation at the far right,
                      so the figure behind that percentage is on the row. */}
                  <td className="px-3 py-2.5 text-[#2e7d32] font-semibold">
                    {fmt2(m.running_hrs)}
                  </td>
                  {/* Deviation hrs — reporting only, feeds no formula */}
                  <td className="px-3 py-2.5">
                    <div className="text-navy font-semibold">{fmt2(m.deviation_hrs)}</div>
                    {m.deviation_pct != null && (
                      <div className="text-[9px] text-txt-light">{m.deviation_pct}% of shift</div>
                    )}
                  </td>
                  {/* WHAT WAS IN THE BUCKET, not just how much. Five of the ten
                      machines move almost no ore — EV 2 is entirely tailing and
                      COB feed — so a CuM figure alone says nothing about which
                      job the machine was doing. The share is of that machine's
                      own CuM, and the title carries the full three-way split. */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <PlanTag m={m} />
                  </td>
                  {/* Ideal CuM */}
                  <td className="px-3 py-2.5 text-txt-light">{fmt1(m.ideal_cum)}</td>
                  {/* Actual CuM */}
                  <td className="px-3 py-2.5 text-txt-secondary">{fmt1(m.actual_cum)}</td>
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
                  {/* UTILISATION, last — it is not a term in OEE. Availability,
                      Performance and Quality multiply out to the column before
                      it; this one answers a different question, how much of the
                      machine's usable time it actually ran, and sitting among
                      the three factors invited it to be read as a fourth. */}
                  <td className={`px-3 py-2.5 font-bold ${m.utilisation == null ? "text-txt-light" : pctColor(m.utilisation, 70, 50)}`}>
                    {m.utilisation == null ? "—" : fmt2(m.utilisation)}
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
                <td className="px-3 py-3 text-[#1565c0]">{fmt2(fleet.operating_hrs)}</td>
                <td className="px-3 py-3 text-[#2e7d32]">{fmt2(fleet.running_hrs)}</td>
                <td className="px-3 py-3">
                  <div className="text-navy">{fmt2(fleet.deviation_hrs)}</div>
                  {fleet.deviation_pct != null && (
                    <div className="text-[9px] font-normal text-txt-light">{fleet.deviation_pct}% of shift</div>
                  )}
                </td>
                <td className="px-3 py-3"><PlanTotals f={fleet} /></td>
                <td className="px-3 py-3 text-txt-secondary">{fmt1(fleet.ideal_cum)}</td>
                <td className="px-3 py-3 text-navy">{fmt1(fleet.actual_cum)}</td>
                <td className={`px-3 py-3 ${pctColor(fleet.availability, 85, 70)}`}>{fmt2(fleet.availability)}</td>
                <td className={`px-3 py-3 ${pctColor(fleet.performance, 85, 70)}`}>{fmt2(fleet.performance)}</td>
                <td className="px-3 py-3 text-txt-secondary">{fmt2(fleet.quality)}</td>
                <td className="px-3 py-3 text-[#0288d1] font-extrabold">{fmt2(fleet.oee)}</td>
                <td className={`px-3 py-3 font-bold ${fleet.utilisation == null ? "text-txt-light" : pctColor(fleet.utilisation, 70, 50)}`}>
                  {fleet.utilisation == null ? "—" : fmt2(fleet.utilisation)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* A machine on the roster with no shift rows in this period is left out
          of the table entirely rather than drawn as a row of zeros, which would
          read as fully available and producing nothing and would pull the fleet
          figure down. Saying so beats letting someone count the rows and wonder
          where a machine went. */}
      {!loading && fleet && fleet.absent_machines.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border-light/40 bg-[#fff8e1]">
          <p className="text-[9px] text-txt-secondary leading-tight">
            <span className="font-bold text-navy">Not at the mine in this period: </span>
            {fleet.absent_machines.join(", ")} — no shift entries, so excluded from the table and the fleet figure.
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border-light/40 bg-bg-section/40 flex flex-wrap gap-x-4 gap-y-1">
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">LOSS HRS · </span>IMOS
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">BREAKDOWN · </span>SAP (owned) · IMOS SHIFT LOG (hired)
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">PM · </span>SAP (owned) · IMOS SHIFT LOG (hired)
        </p>
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">EXCAVATION · </span>SAP
        </p>
        {/* Says outright that the ORE / OB column is the plan, not a
            measurement — the one column on this table whose source is the
            mine's own entry rather than a system of record. */}
        <p className="text-[9px] font-mono text-success/70 leading-tight">
          <span className="font-semibold text-success/60">ORE / OB · </span>EQUIPMENT EXCAVATION PLAN
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
  // Partitioned on the server's own tag, not on a name list repeated here —
  // one place decides which machines are new (NEW_EXCAVATORS in oee.py).
  const oldMachines         = machines.filter((m) => m.generation !== "new");
  const newMachines         = machines.filter((m) => m.generation === "new");
  const tippers             = useTipperOEE();

  /* Same query key as LCMSection's, so this reads the cached response rather
     than fetching a second time. The heading and the matrix underneath it are
     then the same object by construction and cannot drift apart. */
  const lcmPlan = useLCM().data?.plan;
  const hiredNames = new Set(machines.filter((m) => m.hired).map((m) => m.machine));
  const lcmHasHired = !!lcmPlan &&
    [...lcmPlan.ore, ...lcmPlan.ob].some((n) => hiredNames.has(n));

  const entryDialog = useEntryDialog((s) => s.which);
  const closeEntryDialog = useEntryDialog((s) => s.close);
  const [showFormulae, setShowFormulae] = useState(false);
  const { label: dateRange, periodLabel } = useDateFilter();
  const qc = useQueryClient();
  const [busy, setBusy]         = useState(false);
  const [htmlDone, setHtmlDone] = useState(false);

  async function handleHtml() {
    if (busy) return;
    setBusy(true);
    setHtmlDone(false);
    try {
      // Export mode first, so the LCM loss trees and any collapsed register
      // beneath these tables render whole rather than arriving as empty
      // expanders — React does not render what is collapsed.
      await withExportMode(
        () =>
          downloadDashboard({
            dateRange,
            periodLabel,
            rootSelector: "#oee-section",
            title: "OEE / LCM Analysis",
            fileStem: "kaliapani-oee-lcm",
          }),
        // The LCM trees below these tables fetch on mount, and export mode is
        // what mounts them. Without this the file keeps their skeletons.
        () => qc.isFetching(),
      );
      setHtmlDone(true);
      setTimeout(() => setHtmlDone(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    // The id is what the download points at: the whole section, nothing of the
    // chrome around it. Same mechanism the MIS and Intelligence exports use.
    <div id="oee-section" className="space-y-4">

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

          {/* THE WHOLE SECTION AS ONE HTML FILE — the four fleet tables, the
              KPI strip above them and the footnotes under each, exactly as
              they sit here. The per-table Excel buttons are still the way to
              get figures into a spreadsheet; this is the way to send somebody
              the screen. Disabled while loading: a snapshot of skeleton rows
              is worse than no file. */}
          <button
            type="button"
            onClick={handleHtml}
            disabled={isLoading || busy}
            data-export-hide
            title="Download this section as a self-contained HTML file"
            /* The same green as the MIS bar's Export HTML, down to the three
               states — they do the same job and should not look like two
               different features. See SectionTabBar. */
            className={`
              flex items-center gap-[6px] px-3 py-1.5 rounded
              font-condensed text-[11px] font-bold tracking-[.08em] uppercase
              transition-all duration-150
              ${htmlDone
                ? "bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]"
                : busy || isLoading
                  ? "bg-[#f5f7fb] text-[#8899bb] border border-[#d0d9e8] cursor-wait"
                  : "bg-[#2e7d32] text-white border border-[#2e7d32] hover:bg-[#388e3c] hover:border-[#388e3c] active:scale-95"
              }
            `}
          >
            {htmlDone
              ? <><Check size={12} className="shrink-0" /><span>Downloaded</span></>
              : busy
                ? <><span className="w-3 h-3 border border-[#b0bdd4] border-t-[#6b7ea8] rounded-full animate-spin shrink-0" /><span>Preparing…</span></>
                : <><Download size={12} className="shrink-0" /><span>Export to HTML</span></>
            }
          </button>

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

      {/* TWO TABLES, SPLIT BY GENERATION. The new machines are read on their
          own because a 58 CuM/hr excavator commissioned this year and a
          seven-year-old 17 CuM/hr one are not answering the same question, and
          one OVERALL row across both hid that. Each table carries its own
          weighted roll-up from the server — see fleet_old / fleet_new. */}
      <OEETable title="OEE Breakdown — For Old Excavator" slug="old-excavator"
                machines={oldMachines} fleet={data?.fleet_old} loading={isLoading}
                from={data?.from_date} to={data?.to_date} />

      <OEETable title="OEE Breakdown — For New Excavator" slug="new-excavator"
                machines={newMachines} fleet={data?.fleet_new} loading={isLoading}
                from={data?.from_date} to={data?.to_date} />

      {/* ── TIPPERS. Same four factors, but Yield in place of Performance:
          an excavator is measured in volume against capacity, a tipper in
          trips against the trips it should have turned. The two fleets are
          split because their numbers come from different systems entirely —
          the PRIMA trucks have no Technoton unit and no SAP record, so hours
          and breakdown both come from the shift log. ─────────────────── */}
      <TipperOEETable
        title="OEE Breakdown — For Old Tipper" slug="old-tipper"
        machines={tippers.data?.old_machines ?? []}
        fleet={tippers.data?.old_fleet} loading={tippers.isLoading}
        from={tippers.data?.from_date} to={tippers.data?.to_date}
        note="Engine Hrs · Technoton telematics   ·   BD Hrs · SAP M2 notifications. A Utilisation above 100% means the breakdown hours are overstated by a notification left open in SAP."
      />

      <TipperOEETable
        title="OEE Breakdown — For New Tipper" slug="new-tipper"
        machines={tippers.data?.new_machines ?? []}
        fleet={tippers.data?.new_fleet} loading={tippers.isLoading}
        from={tippers.data?.from_date} to={tippers.data?.to_date}
        note="These ten have no Technoton unit and no SAP equipment record, so Engine Hrs and BD Hrs both come from the shift log. BD reads 0.00 until the mine fills the breakdown column, so Availability of 100% is the absence of a record, not a measurement."
      />

      {/* ── LCM — Lost Cost Matrix, inline below the OEE reference ────── */}
      <div className="flex items-center gap-2 pt-3">
        <Layers size={17} className="text-[#6a1b9a]" />
        <h2 className="font-condensed font-extrabold text-[15px] tracking-widest uppercase text-navy">
          LCM — Lost Cost Matrix
        </h2>
        {/* Was hardcoded "Own Equipment" and stopped being true the moment the
            mine could assign a hired machine to a bucket. Read from the plan
            against the fleet rather than asserted. */}
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-[#f3e5f5] text-[#6a1b9a] border-[#ce93d8] tracking-widest uppercase font-mono">
          {lcmHasHired ? "Own + Hired" : "Own Equipment"}
        </span>
        {/* THE MACHINE SPLIT IS THE MINE'S OWN PLAN NOW, not a line of markup.
            It was written out by hand here, which meant the heading and the
            calculation could disagree without anyone noticing -- and once the
            mine can change the split monthly, they would. */}
        <span className="ml-auto text-[10px] font-mono text-txt-muted hidden sm:inline">
          {lcmPlan
            ? <>Ore · {lcmPlan.ore.join(", ") || "—"}&nbsp;&nbsp;|&nbsp;&nbsp;OB · {lcmPlan.ob.join(", ") || "—"}</>
            : "—"}
        </span>
      </div>

      {/* The excavation plan belongs to this page: it is what decides the
          machine split in the matrix below, so it is entered from here. */}
      <EquipmentPlanModal
        open={entryDialog === "equipment-plan"}
        onClose={closeEntryDialog}
        onSaved={async () => {
          /* ["oee"] is the prefix of the LCM and KAM-tree keys as well as
             the OEE table's own, so one invalidation refetches every figure
             the plan can move. */
          await qc.invalidateQueries({ queryKey: ["oee"] });
        }}
      />

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

      {/* Re-cut of the LCM figures by accountability head. Sits after both LCM
          blocks because it is derived from them, not a new measurement. */}
      <KamLossTreeSection />

    </div>
  );
}
