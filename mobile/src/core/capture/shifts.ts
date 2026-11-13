/**
 * Which shift a moment falls in, by the mine's own hours.
 *
 * ── WHY THE DEVICE ANSWERS THIS AT ALL ───────────────────────────────────────
 * The server resolves the shift again on receipt and its answer is the one
 * stored (migration 113). This is for the person signing: near a shift
 * boundary, which shift a handover lands in is the difference between their
 * shift and the next one, and they are the only person present who can say it
 * is wrong. A confirm screen that cannot name the shift is asking somebody to
 * sign for a period it will not show them.
 *
 * ── AND WHY IT READS THE CALENDAR RATHER THAN KNOWING THE HOURS ──────────────
 * The hours were briefly written into the confirm screen as 06/14/22, which is
 * correct for this mine today. It is a copy of a business rule in the place
 * least able to be updated, and would have been quietly wrong the first time a
 * shift moved by an hour. The server has sent the calendar in every sync
 * bundle since phase 4; the device simply threw it away.
 *
 * ── THE PRODUCTION DAY IS THE PART PEOPLE GET WRONG ──────────────────────────
 * A handover at 02:00 on night shift belongs to the day the SHIFT started, not
 * the date on the clock. Getting that backwards splits a night shift's work
 * across two days in every report that follows.
 */

import type { Store } from './store';

export interface CachedShift {
  shift_id: number;
  code: string;
  name: string;
  /** 'HH:MM:SS' */
  start_time: string;
  end_time: string;
  crosses_midnight: number;
}

export interface ResolvedShift {
  code: string;
  name: string;
  /** The day the shift STARTED, as YYYY-MM-DD. */
  productionDay: string;
}

const minutes = (hhmmss: string): number => {
  const [h, m] = hhmmss.split(':');
  return Number(h) * 60 + Number(m ?? 0);
};

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${
    String(d.getDate()).padStart(2, '0')}`;

/**
 * Resolve a moment against the cached calendar.
 *
 * GENERAL is excluded: it overlaps A and B and is an office day, not a
 * production shift, so a handover never belongs to it. The server's resolver
 * excludes it for the same reason.
 */
export function resolveShift(
  shifts: CachedShift[], at: Date,
): ResolvedShift | null {
  const t = at.getHours() * 60 + at.getMinutes();

  for (const s of shifts) {
    if (s.code === 'GENERAL') continue;
    const start = minutes(s.start_time);
    const end = minutes(s.end_time);
    const inside = s.crosses_midnight === 1
      ? (t >= start || t < end)
      : (t >= start && t < end);
    if (!inside) continue;

    // Read AFTER midnight on a shift that crosses it: the shift began
    // yesterday, so that is its production day.
    const day = new Date(at);
    if (s.crosses_midnight === 1 && t < end) day.setDate(day.getDate() - 1);

    return { code: s.code, name: s.name, productionDay: ymd(day) };
  }
  return null;
}

/** The cached calendar, in start order. */
export async function cachedShifts(store: Store): Promise<CachedShift[]> {
  return store.getAllAsync<CachedShift>(
    `SELECT * FROM cached_shift ORDER BY start_time`);
}

/** Convenience for a screen: the shift for a moment, or null if unknown. */
export async function shiftAt(store: Store, at: Date): Promise<ResolvedShift | null> {
  return resolveShift(await cachedShifts(store), at);
}

/**
 * The calendar day an instant falls on **where the tablet is standing**.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, and the mine is at
 * +05:30. Every capture before 05:30 local therefore reported the previous
 * day — which is the night shift, every night. Written as its own function so
 * the next person reaching for `.slice(0, 10)` finds this instead.
 */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
