/**
 * Where something was, when the satellites are slow.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Both the camera and the confirm screen asked the GPS for a FRESH fix, waited
 * a few seconds, and stored null when none arrived. Under a tipper body, inside
 * a workshop, or in the first half-minute after the app is opened, none does.
 * So photographs came back with no position at all -- six of the first twelve,
 * and the handover record itself on every session before the twelfth.
 *
 * Meanwhile the tracker had been running the whole time and had a perfectly
 * good fix from ninety seconds earlier sitting in location_queue, and Android
 * had one cached too. The position was on the device. Nothing asked for it.
 *
 * So: ask the shutter first, then fall back -- but only to a RECENT fix. A
 * position from two minutes ago, while somebody walks round one machine, is
 * within a few paces of the shutter and is honest evidence. A position from an
 * hour ago is a different place and recording it as the photograph's position
 * would be a lie told in a safety record. Hence MAX_AGE_S, and hence nothing
 * at all rather than something stale: "no position" is a true statement, and
 * the dashboard already says it plainly.
 */

export const MAX_AGE_S = 120;

export interface Candidate {
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** Milliseconds since the epoch, when this fix was taken. */
  atMs: number;
}

export interface Chosen {
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** How old the fix was when it was attached, in seconds. 0 means the shutter. */
  ageS: number;
}

/**
 * The freshest usable fix among whatever could be found, or null.
 *
 * Order is by age alone, not by claimed accuracy: a tight fix from three
 * minutes ago is a tight fix of somewhere else.
 */
export function pickFix(
  candidates: (Candidate | null | undefined)[],
  nowMs: number,
  maxAgeS: number = MAX_AGE_S,
): Chosen | null {
  let best: Chosen | null = null;

  for (const c of candidates) {
    if (!c) continue;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    // 0,0 is in the Atlantic. No machine of this mine has ever been there, and
    // it is what a broken location layer returns when it returns something.
    if (c.lat === 0 && c.lon === 0) continue;

    const ageS = (nowMs - c.atMs) / 1000;
    // A fix from the future is a clock problem, not a position; treat a small
    // skew as "now" and refuse anything wilder.
    if (ageS < -maxAgeS || ageS > maxAgeS) continue;

    const age = Math.max(0, Math.round(ageS));
    if (!best || age < best.ageS) {
      best = { lat: c.lat, lon: c.lon, accuracyM: c.accuracyM ?? null, ageS: age };
    }
  }

  return best;
}

/** Shape of a row in location_queue, as the tracker writes it. */
interface QueueRow {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  recorded_at: string;
}

interface Readable {
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

/**
 * The newest fix the background tracker has already stored.
 *
 * Read from the queue rather than from the sent history, because the queue is
 * what exists on a tablet that has been down a pit with no signal all shift --
 * which is precisely the tablet whose photographs most need a position.
 */
export async function lastQueuedFix(store: Readable): Promise<Candidate | null> {
  const r = await store.getFirstAsync<QueueRow>(
    `SELECT lat, lon, accuracy_m, recorded_at
       FROM location_queue
      ORDER BY recorded_at DESC
      LIMIT 1`);
  if (!r) return null;

  const atMs = Date.parse(r.recorded_at);
  if (!Number.isFinite(atMs)) return null;

  return { lat: r.lat, lon: r.lon, accuracyM: r.accuracy_m, atMs };
}
