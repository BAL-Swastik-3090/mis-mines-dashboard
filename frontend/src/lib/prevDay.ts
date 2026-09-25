/**
 * The day the "Previous Day — Plan vs Actual" panel is about, and the KPI rows
 * it shows.
 *
 * Pure, and in its own file for two reasons. The date arithmetic is all clock
 * edges — midnight, the grace minute, month end, year end — and those are
 * exactly the cases nobody notices are wrong until a morning meeting reads the
 * wrong day's figures, so they need testing without mounting a component. And
 * the rows are built identically by the table and by the entry dialog: if each
 * derived its own, the plan shown while entering a figure could differ from the
 * plan the variance is later measured against.
 */
import type { ProductionDayRowAPI, DespatchDayRowAPI } from "@/types";

/**
 * Tonnes of ore per cubic metre, for the Total Excavation row.
 *
 * ── HOW THIS NUMBER WAS ARRIVED AT, AND WHY IT NEEDS CONFIRMING ──
 * There is no conversion factor anywhere else in this codebase. The existing
 * "Day Wise Total Excavation (CuM)" KPI does NOT convert: it reads
 * ACTIVITY_CONF_1 from SAP's MINE_EXV work centre, already in cubic metres, and
 * it measures RE-HANDLING rather than ore + OB.
 *
 * Measured over 224 days of SAP data, ore_MT / MINE_EXV_M3 lands on exactly
 * 3.00 on 17 of them — the most common value by a factor of three. That is past
 * coincidence and says a 3.0 factor is applied somewhere upstream.
 *
 * Evidence-based, but NOT confirmed by the mine. Confirm with planning and
 * correct this one line if it is wrong; nothing else changes.
 */
export const ORE_T_PER_M3 = 3.0;

/**
 * Yesterday, as YYYY-MM-DD in LOCAL time, rolling over at 00:01.
 *
 * THE GRACE MINUTE. Between 00:00:00 and 00:00:59 the day before is still
 * returned, so the figures do not vanish the instant the clock ticks past
 * midnight while somebody is still looking at them. From 00:01:00 the panel
 * asks about the day that has just ended, which has no entries yet — so the
 * actuals read blank until they are entered, and a stale set never lingers
 * into a new day pretending to be current.
 *
 * NOT toISOString(). That converts to UTC, which names the day before for the
 * whole of IST's 05:30 offset — the panel would address the wrong date every
 * morning before 05:30.
 */
export function targetDayISO(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getHours() === 0 && d.getMinutes() < 1) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - 1);
  return localISO(d);
}

/**
 * The day before a YYYY-MM-DD, local.
 *
 * Date arithmetic rather than subtracting 86,400,000 milliseconds: the two
 * days a year on which a local day is not 24 hours long would land this on the
 * wrong date, and setDate handles month and year ends on its own.
 */
export function dayBefore(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return localISO(d);
}

/** Today, local. The latest date the entry dialog will accept. */
export function todayISO(now: Date = new Date()): string {
  return localISO(new Date(now));
}

function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "Wed, 24 Sept, 2026" for a YYYY-MM-DD string.
 *
 *  The T00:00:00 suffix keeps it local: a bare "2026-09-24" is parsed as UTC
 *  midnight, which renders as the previous day anywhere west of Greenwich and,
 *  more to the point here, is a different date from the one being displayed. */
export function dayLabel(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
}

export interface KpiRow {
  key: "ore" | "ob" | "total_excavation" | "cob" | "despatch";
  label: string;
  unit: string;
  plan: number | null;
  /** From SAP / the gate record. Null when nothing is posted for the day. */
  actual: number | null;
  /** False for despatch: the gate record already answers it, so there is
   *  nothing to estimate and the entry dialog shows it read-only. */
  manual: boolean;
}

/**
 * The five KPI rows for one day, from the two day-wise responses.
 *
 * Total excavation is derived on BOTH sides with the same formula, rather than
 * taking the plan from here and the actual from SAP's MINE_EXV work centre.
 * MINE_EXV measures re-handling, a different quantity — subtracting a plan of
 * ore + OB from it would produce a variance between two things that were never
 * the same measurement.
 */
export function buildRows(
  p: ProductionDayRowAPI | undefined,
  d: DespatchDayRowAPI | undefined,
): KpiRow[] {
  const orePlan = p?.ore_plan ?? null;
  const obPlan = p?.ob_plan ?? null;
  const oreAct = p?.ore_actual ?? null;
  const obAct = p?.ob_actual ?? null;

  const totalPlan =
    orePlan == null || obPlan == null ? null : obPlan + orePlan / ORE_T_PER_M3;
  const totalAct =
    oreAct == null || obAct == null ? null : obAct + oreAct / ORE_T_PER_M3;

  return [
    { key: "ore", label: "ORE", unit: "MT", plan: orePlan, actual: oreAct, manual: true },
    { key: "ob", label: "OB", unit: "CuM", plan: obPlan, actual: obAct, manual: true },
    { key: "total_excavation", label: "Total Excavation", unit: "CuM",
      plan: totalPlan, actual: totalAct, manual: true },
    { key: "cob", label: "COB", unit: "MT", plan: p?.cob_plan ?? null,
      actual: p?.cob_actual ?? null, manual: true },
    { key: "despatch", label: "DESPATCH", unit: "MT",
      plan: d?.total_plan ?? null, actual: d?.total_actual ?? null, manual: false },
  ];
}
