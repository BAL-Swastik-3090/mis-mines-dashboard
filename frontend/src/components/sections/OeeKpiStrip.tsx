"use client";
import { formatIndian } from "@/lib/utils";
import type { OEEFleet, TipperOEEFleet } from "@/types";

/**
 * The KPI strip that sits above an OEE table, and the cards for each fleet.
 *
 * WHY EVERY TABLE GETS ITS OWN. One strip across the whole excavator fleet
 * answered a question nobody asks. A 58 CuM/hr machine commissioned this year
 * and a seven-year-old 17 CuM/hr one are not the same fleet, and a single
 * Performance figure spanning both told you nothing you could act on -- the
 * two tables were split for exactly that reason and the figures above them
 * were not. Each table now carries the roll-up for the machines in it.
 *
 * THE NUMBERS ARE THE SERVER'S, NOT AVERAGES TAKEN HERE. Every percentage is
 * a ratio of sums -- Σ available ÷ Σ ideal time, Σ actual ÷ Σ ideal -- so a
 * machine that barely ran counts for what it did rather than for as much as
 * one that ran all month. Averaging the rows in the browser overstated fleet
 * Performance and OEE by roughly half, which is why these come down the wire
 * already weighted and are never re-derived from the table above them.
 *
 * AND THEY FOLLOW THE SELECTORS. Which machines are in a roll-up, which fleet
 * each belongs to, and the rate each is measured against all come from the
 * Equipment Status Selector; the ORE / OB split comes from the Excavation
 * Plan. Change either and these figures move with the table, because both are
 * built from the same resolved roster on the server.
 */

function fmt1(v: number) { return formatIndian(Number(v.toFixed(1))); }
function fmt0(v: number) { return formatIndian(Math.round(v)); }

export function pctColor(v: number, threshHigh = 75, threshMid = 50) {
  if (v >= threshHigh) return "text-[#2e7d32]";
  if (v >= threshMid)  return "text-[#c8960c]";
  return "text-[#c62828]";
}

/** Over 100 is not a triumph on a tipper — it means the breakdown hours
 *  behind it are overstated by a notification left open in SAP. Coloured as
 *  the fault it is, the same way the table below colours it. */
function overColor(v: number, high = 75, mid = 50) {
  return v > 100 ? "text-[#c62828]" : pctColor(v, high, mid);
}

function Shimmer({ w = "w-20", h = "h-5" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-bg-section animate-pulse rounded`} />;
}

export interface Kpi {
  label: string;
  sub: string;
  value: number | null;
  unit: string;
  colorFn: (v: number) => string;
  fmt?: (v: number) => string;
  /** Shown instead of the figure when the server sent null — "not asked"
   *  rather than nought. A truck down all period has no Utilisation. */
  blank?: string;
}

/**
 * `dense` is for a strip inside a table card, where it is a caption on the
 * table beneath it rather than the heading of the section. Same cards, less
 * weight, so the page still has one obvious top line.
 */
/** The grid, per number of cards. Written out rather than built from a
 *  template string because Tailwind reads the source for class names and
 *  never sees one that is assembled at runtime -- `xl:grid-cols-${n}` is a
 *  class that silently does not exist. The excavator strip carries seven
 *  cards and the tipper strip six, and neither should leave a card stranded
 *  alone on a row. */
const GRID: Record<number, string> = {
  5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  7: "grid-cols-2 md:grid-cols-4 xl:grid-cols-7",
};

export function KpiStrip({ cards, loading, dense = false }: {
  cards: Kpi[]; loading: boolean; dense?: boolean;
}) {
  return (
    <div className={"grid "
      + (GRID[cards.length] ?? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6") + " "
      + (dense ? "gap-2 px-4 py-3 bg-bg-soft/60 border-b border-border-light"
               : "gap-3")}>
      {cards.map((c) => (
        <div key={c.label}
             className={dense
               ? "bg-white border border-border-light rounded-md px-3 py-2"
               : "bg-white border border-border rounded-lg shadow-sm overflow-hidden px-4 py-3"}>
          <div className={"font-bold tracking-widest uppercase font-condensed "
            + "text-txt-secondary " + (dense ? "text-[9px]" : "text-[10px]")}>
            {c.label}
          </div>
          <div className={"text-txt-light tracking-wider font-condensed uppercase mt-0.5 "
            + (dense ? "text-[8px]" : "text-[9px]")}>
            {c.sub}
          </div>
          <div className="mt-1">
            {loading ? (
              <Shimmer w={dense ? "w-14" : "w-20"} h={dense ? "h-5" : "h-7"} />
            ) : c.value == null ? (
              <div className={"font-condensed font-extrabold tracking-tight leading-none "
                + "text-txt-light " + (dense ? "text-[17px]" : "text-[24px]")}>
                {c.blank ?? "—"}
              </div>
            ) : (
              <div className={"font-condensed font-extrabold tracking-tight leading-none "
                + (dense ? "text-[17px]" : "text-[24px]") + " " + c.colorFn(c.value)}>
                {c.fmt ? c.fmt(c.value) : c.value.toFixed(1)}
                <span className={"font-normal text-txt-muted ml-0.5 "
                  + (dense ? "text-[10px]" : "text-[11px]")}>{c.unit}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Excavators ───────────────────────────────────────────────────────────────
export function excavatorKpis(fleet: OEEFleet | undefined): Kpi[] {
  return [
    {
      label: "Fleet OEE",
      sub: "weighted · avail × perf × qual",
      value: fleet?.oee ?? null,
      unit: "%",
      colorFn: (v) => pctColor(v),
    },
    {
      label: "Availability",
      sub: "Σ available ÷ Σ ideal time",
      value: fleet?.availability ?? null,
      unit: "%",
      colorFn: (v) => pctColor(v, 85, 70),
    },
    {
      // BESIDE AVAILABILITY, AND NOT AMONG THE THREE FACTORS. Availability,
      // Performance and Quality multiply into OEE; Utilisation does not and
      // never has. It sits here because it answers the question Availability
      // raises -- the machine was free to work, did it? -- and it is the last
      // column of every table on this page, which until now had no card.
      //
      // THE SAME THRESHOLDS THE COLUMN USES (70 / 50), deliberately. A card
      // and the column it summarises calling the same figure different
      // colours is worse than having no card.
      label: "Utilisation",
      // The server's weighted figure, never an average of the rows: a machine
      // that ran two shifts must not count as much as one that ran the month.
      sub: "Σ running ÷ Σ (god − breakdown)",
      value: fleet?.utilisation ?? null,
      unit: "%",
      colorFn: (v) => pctColor(v, 70, 50),
      // Null is a real answer here, not a nought. A fleet broken down for the
      // whole window has no usable hours to have used.
      blank: "—",
    },
    {
      label: "Performance",
      sub: "Σ actual ÷ Σ ideal CuM",
      value: fleet?.performance ?? null,
      unit: "%",
      colorFn: (v) => pctColor(v, 85, 70),
    },
    {
      label: "Total Breakdown",
      // Not one source: the owned machines carry SAP M2 notifications, the
      // hired ones have no equipment number and carry the shift log instead.
      sub: "hrs · SAP + shift log",
      value: fleet?.bd_hours ?? null,
      unit: " hrs",
      colorFn: () => "text-[#c62828]",
      fmt: fmt1,
    },
    {
      label: "Deviation Hrs",
      sub: fleet?.deviation_pct != null
        ? `${fleet.deviation_pct}% of shift hrs` : "unplanned idle",
      value: fleet?.deviation_hrs ?? null,
      unit: " hrs",
      colorFn: () => "text-[#c8960c]",
      fmt: fmt1,
    },
    {
      label: "Actual Excavation",
      // The plan split for THESE machines, so the card says what the group
      // was dug for rather than repeating the whole fleet's mix.
      sub: fleet ? `${fleet.plan_ore} ore · ${fleet.plan_ob} OB` : "total CuM",
      value: fleet?.actual_cum ?? null,
      unit: " M³",
      colorFn: () => "text-[#1565c0]",
      fmt: fmt0,
    },
  ];
}

// ── Tippers ──────────────────────────────────────────────────────────────────
// Yield in place of Performance: an excavator is measured in volume against
// capacity, a tipper in trips against the trips it should have turned.
export function tipperKpis(fleet: TipperOEEFleet | undefined): Kpi[] {
  return [
    {
      label: "Fleet OEE",
      sub: "weighted · avail × yield",
      value: fleet?.oee ?? null,
      unit: "%",
      colorFn: (v) => overColor(v),
    },
    {
      label: "Availability",
      sub: "Σ available ÷ Σ god hrs",
      value: fleet?.availability ?? null,
      unit: "%",
      colorFn: (v) => overColor(v, 85, 70),
    },
    {
      label: "Yield",
      sub: "Σ actual ÷ Σ ideal trips",
      value: fleet?.yield_pct ?? null,
      unit: "%",
      colorFn: (v) => overColor(v, 85, 70),
    },
    {
      label: "Utilisation",
      sub: "Σ engine ÷ Σ (god − breakdown)",
      value: fleet?.utilisation ?? null,
      unit: "%",
      colorFn: (v) => overColor(v, 60, 35),
    },
    {
      label: "Total Breakdown",
      sub: fleet?.generation === "new" ? "hrs · shift log" : "hrs · SAP M2",
      value: fleet?.bd_hours ?? null,
      unit: " hrs",
      colorFn: () => "text-[#c62828]",
      fmt: fmt1,
    },
    {
      label: "Actual Trips",
      sub: fleet ? `of ${fmt0(fleet.ideal_trip)} ideal` : "fleet total",
      value: fleet?.actual_trip ?? null,
      unit: "",
      colorFn: () => "text-[#1565c0]",
      fmt: fmt0,
    },
  ];
}
