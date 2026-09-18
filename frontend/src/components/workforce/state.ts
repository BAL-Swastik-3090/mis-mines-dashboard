/**
 * The words the roster screens share.
 *
 * A rest day and a leave day are both "not working", and a screen that draws
 * them the same way is a screen that cannot answer the only question anybody
 * asks of a roster — whether the gap was planned or has to be covered. So each
 * kind of day has one colour, one label and one meaning, defined here once.
 */
import type { Tone } from "@/components/minehub/ui";

export interface DayCell {
  state: "ON" | "REST" | "LEAVE" | "HOLIDAY" | null;
  shift: string | null;
  label: string;
  kind?: string | null;
  half_day?: boolean;
  leave_ref?: string;
  colour?: string | null;
  pattern?: string | null;
  blocks?: boolean;
}

export const DAY_STATE: Record<string, { label: string; tone: Tone; cell: string }> = {
  ON:      { label: "On duty",  tone: "emerald", cell: "bg-emerald/15 text-emerald border-emerald/30" },
  REST:    { label: "Rest day", tone: "slate",   cell: "bg-slate-100 text-txt-light border-slate-200" },
  LEAVE:   { label: "On leave", tone: "amber",   cell: "bg-amber/15 text-amber border-amber/30" },
  HOLIDAY: { label: "Holiday",  tone: "violet",  cell: "bg-violet/15 text-violet border-violet/30" },
};

/** Nothing said at all. Deliberately drawn as absence of information rather
 *  than as a rest day: somebody nobody has rostered is a gap in the register,
 *  and a roster that quietly shows them resting hides it. */
export const UNROSTERED = {
  label: "Not on a roster", tone: "rose" as Tone,
  cell: "bg-white text-txt-light border-dashed border-slate-300",
};

export const LEAVE_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT:     { label: "Draft",     tone: "slate" },
  SUBMITTED: { label: "Waiting",   tone: "amber" },
  APPROVED:  { label: "Approved",  tone: "emerald" },
  REJECTED:  { label: "Rejected",  tone: "rose" },
  CANCELLED: { label: "Cancelled", tone: "slate" },
};

export const HOLIDAY_KIND: Record<string, { label: string; tone: Tone }> = {
  PUBLIC:       { label: "Public holiday",  tone: "violet" },
  FESTIVAL:     { label: "Festival",        tone: "gold" },
  MINE_CLOSURE: { label: "Mine closed",     tone: "rose" },
  RESTRICTED:   { label: "Restricted",      tone: "slate" },
  MAINTENANCE:  { label: "Maintenance day", tone: "sky" },
};

export const CONFIDENCE: Record<string, { label: string; tone: Tone }> = {
  high: { label: "Strong match",   tone: "emerald" },
  fair: { label: "Workable",       tone: "sky" },
  low:  { label: "Worth a look",   tone: "amber" },
};

/** A date, the way a roster header says it: "Mon 14". */
export function dayLabel(iso: string): { weekday: string; day: string; weekend: boolean } {
  const d = new Date(`${iso}T00:00:00`);
  return {
    weekday: d.toLocaleDateString("en-IN", { weekday: "short" }),
    day: String(d.getDate()).padStart(2, "0"),
    weekend: d.getDay() === 0,
  };
}

export function prettyDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(`${String(iso).slice(0, 10)}T00:00:00`)
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function shortDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(`${String(iso).slice(0, 10)}T00:00:00`)
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Every date from one to the other, inclusive. */
export function span(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  // Guarded rather than open-ended: a bad pair of dates should draw nothing,
  // not lock the browser drawing a century of columns.
  for (let i = 0; i <= 92 && cursor <= to; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}
