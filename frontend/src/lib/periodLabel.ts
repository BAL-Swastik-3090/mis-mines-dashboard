/**
 * A date range written the way a person would say it out loud.
 *
 * "Selected period" is a label for a control, not for a column of figures —
 * printed over a table it tells the reader nothing they can check, and a
 * printout or a screenshot carries it away from the picker that defined it.
 * The dates themselves travel.
 *
 * Repeating the month and the year on both sides ("01 Dec 2025 – 31 Dec 2025")
 * is accurate and unreadable, so the parts the two ends share are written once:
 *   same month   01 – 31 Dec 2025
 *   same year    01 Nov – 31 Dec 2025
 *   otherwise    01 Dec 2025 – 31 Jan 2026
 */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parsed as local midnight: `new Date("2025-12-01")` is UTC, and in IST that
 *  is still 30 November — a range label one day adrift from its own table. */
const parse = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

const dd = (d: Date) => String(d.getDate()).padStart(2, "0");

export function periodLabel(from: string | null | undefined,
                            to: string | null | undefined): string {
  const a = from ? parse(from) : null;
  const b = to ? parse(to) : null;
  if (!a || !b) return "selected period";

  const full = (d: Date) => `${dd(d)} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  if (a.getTime() === b.getTime()) return full(a);
  if (a.getFullYear() !== b.getFullYear()) return `${full(a)} – ${full(b)}`;
  if (a.getMonth() !== b.getMonth())
    return `${dd(a)} ${MON[a.getMonth()]} – ${dd(b)} ${MON[b.getMonth()]} ${b.getFullYear()}`;
  return `${dd(a)} – ${dd(b)} ${MON[b.getMonth()]} ${b.getFullYear()}`;
}

/** Days inclusive, for "31 days" beside the range. */
export function periodDays(from: string | null | undefined,
                           to: string | null | undefined): number | null {
  const a = from ? parse(from) : null;
  const b = to ? parse(to) : null;
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}
