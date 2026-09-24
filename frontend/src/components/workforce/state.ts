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
  /** Set on the grid rather than produced by a pattern. Marked on the board so
   *  a roster made of exceptions looks like one. */
  by_hand?: boolean;
  reason?: string | null;
  blocks?: boolean;
}

export const DAY_STATE: Record<string, { label: string; tone: Tone; cell: string }> = {
  ON:      { label: "On duty",  tone: "emerald", cell: "bg-emerald/15 text-emerald border-emerald/30" },
  REST:    { label: "Rest day", tone: "slate",   cell: "bg-slate-100 text-txt-light border-slate-200" },
  LEAVE:   { label: "On leave", tone: "amber",   cell: "bg-amber/15 text-amber border-amber/30" },
  HOLIDAY: { label: "Holiday",  tone: "violet",  cell: "bg-violet/15 text-violet border-violet/30" },
};

/**
 * A colour per shift, so a roster can be read without reading it.
 *
 * "On duty" in one green answered the wrong question. Whether somebody is
 * working is visible from the letter; what a supervisor scans a fortnight for
 * is the shape of the crews — who is on nights this week, where the handover
 * falls, whether one man is on mornings on Monday and nights on Tuesday. All
 * one colour, that has to be read letter by letter.
 *
 * The colours follow the clock rather than the alphabet, because that is the
 * thing they mean: morning is warm, the afternoon is bright, the night shift is
 * dark, and the general shift — the one that is not a rotation at all — is set
 * apart in teal. A mine that renames its shifts keeps the sense of it, because
 * the mapping is by start time first and by code only as a fallback.
 */
export const SHIFT_LOOK: Record<string, { cell: string; dot: string; label: string }> = {
  MORNING: { cell: "bg-amber/15 text-amber border-amber/40",
             dot: "bg-amber", label: "Morning" },
  AFTERNOON: { cell: "bg-sky/15 text-sky border-sky/40",
               dot: "bg-sky", label: "Afternoon" },
  NIGHT:   { cell: "bg-indigo/15 text-indigo border-indigo/40",
             dot: "bg-indigo", label: "Night" },
  GENERAL: { cell: "bg-teal/15 text-teal border-teal/40",
             dot: "bg-teal", label: "General" },
  OTHER:   { cell: "bg-emerald/15 text-emerald border-emerald/30",
             dot: "bg-emerald", label: "On duty" },
};

/** A shift code short enough for a grid square: "GENERAL" reads as "G".
 *
 *  A day gets 28 pixels on the board and 36 in the month strip. A, B and C fit
 *  either; GENERAL fits neither, and GENERAL is exactly the shift a fitter or a
 *  clerk is on. The mine says "G shift" out loud, so the screens do too, and
 *  the full name stays on the hover. */
export function shortShift(code: string | null | undefined): string {
  if (!code) return "";
  return code.length <= 2 ? code : code[0];
}

/** Which of those a shift is, from when it starts.
 *
 *  By the clock, not the code: this mine calls them A, B and C, the next one
 *  calls them 1, 2 and 3, and both mean the same three parts of a day. A shift
 *  with no start time recorded falls back to its letter, and then to the
 *  neutral green, which is where every shift used to be. */
export function shiftBand(code: string | null | undefined,
                          startTime?: string | null): keyof typeof SHIFT_LOOK {
  const c = (code ?? "").toUpperCase();
  if (c.startsWith("GEN")) return "GENERAL";

  if (startTime) {
    const hour = Number(startTime.slice(0, 2));
    if (!Number.isNaN(hour)) {
      if (hour >= 4 && hour < 12) return "MORNING";
      if (hour >= 12 && hour < 19) return "AFTERNOON";
      return "NIGHT";
    }
  }

  if (c === "A") return "MORNING";
  if (c === "B") return "AFTERNOON";
  if (c === "C") return "NIGHT";
  return "OTHER";
}

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
