/**
 * "Where are we?", asked the way it should have been asked all along.
 *
 * The expo half of recent.ts -- kept apart from it so the choosing rule stays
 * testable without a device. Three sources, tried in this order and then judged
 * purely on age:
 *
 *   1. a live fix, with a short wait -- the shutter position when it exists;
 *   2. Android's own cached fix, which is free and usually seconds old;
 *   3. the tracker's own queue, which is the one source that still works on a
 *      tablet that has been out of signal all shift.
 *
 * The live wait is deliberately SHORTER than the six seconds it used to be. It
 * is no longer the only hope, so making an operator stand still waiting for it
 * buys nothing -- and a camera screen that pauses for six seconds after the
 * shutter is a camera screen people learn to distrust.
 */

import * as Location from 'expo-location';
import { pickFix, lastQueuedFix, type Candidate, type Chosen } from './recent';

/** How long to wait for a live fix before falling back to a recent one. */
const LIVE_WAIT_MS = 3500;

interface Readable {
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

/**
 * The best honest position available right now, or null.
 *
 * Never throws and never blocks for long: a position is evidence worth having,
 * but it is never worth losing a photograph or blocking a handover over.
 */
export async function positionNow(store: Readable | null): Promise<Chosen | null> {
  const now = Date.now();
  const candidates: (Candidate | null)[] = [];

  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) {
      const live = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), LIVE_WAIT_MS)),
      ]).catch(() => null);
      if (live) {
        candidates.push({
          lat: live.coords.latitude, lon: live.coords.longitude,
          accuracyM: live.coords.accuracy ?? null, atMs: live.timestamp ?? now,
        });
      }

      const cached = await Location.getLastKnownPositionAsync().catch(() => null);
      if (cached) {
        candidates.push({
          lat: cached.coords.latitude, lon: cached.coords.longitude,
          accuracyM: cached.coords.accuracy ?? null, atMs: cached.timestamp ?? now,
        });
      }
    }
  } catch {
    // Permission or provider trouble. The queue below may still have a fix.
  }

  if (store) {
    try {
      candidates.push(await lastQueuedFix(store));
    } catch {
      // A queue read failing must not cost the photograph.
    }
  }

  return pickFix(candidates, now);
}
