/**
 * Where this device is, reported while nobody is looking at it.
 *
 * ── WHY THE FIXES GO INTO SQLITE AND NOT STRAIGHT UP THE WIRE ────────────────
 * The background task runs where there is no network: a tipper at the face is
 * out of signal for most of a shift. A task that tried to POST each fix would
 * lose almost all of them and burn the battery retrying. So each fix is
 * written to `location_queue` and the ordinary sync sends whatever has piled
 * up, whenever it next gets signal.
 *
 * ── IT IS A FOREGROUND SERVICE, AND IT SAYS SO ───────────────────────────────
 * Android will not let an app read location in the background without a
 * persistent notification, and that is the correct behaviour: a device
 * reporting its position around the clock should be visibly doing so to
 * whoever is carrying it. The notification text says what is happening in
 * plain words rather than hiding behind the app name.
 *
 * ── TRACKING IS OFF UNTIL THE OFFICE TURNS IT ON ─────────────────────────────
 * The setting comes from the server, per device, and arrives on every hello.
 * A device that cannot read its setting keeps the last one it was given and a
 * device that has never been told anything does not track. The default on a
 * question about following people around is off.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import * as Crypto from 'expo-crypto';
import { adapt, openDb } from '../db/open';
import type { Store } from '../capture/store';
import { trackingSettings } from '../sync/enrolment';
import { sendFromBackground } from '../sync/background';

export const LOCATION_TASK = 'hoto-location';

/** Fixes closer together than this are not worth a row. */
const MIN_DISTANCE_M = 25;

export interface Fix {
  client_uuid: string;
  recorded_at: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  battery_pct: number | null;
  is_charging: number | null;
  source: string;
}

/** Write one position into the queue. Exported so capture can use it too. */
export async function queueFix(
  store: Store, l: Location.LocationObject, source = 'BACKGROUND',
): Promise<void> {
  let batteryPct: number | null = null;
  let charging: number | null = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    batteryPct = level >= 0 ? Math.round(level * 100) : null;
    const state = await Battery.getBatteryStateAsync();
    charging = state === Battery.BatteryState.CHARGING
            || state === Battery.BatteryState.FULL ? 1 : 0;
  } catch {
    // Battery is nice to have, not a reason to drop a position.
  }

  await store.runAsync(
    `INSERT OR IGNORE INTO location_queue
       (client_uuid, recorded_at, lat, lon, accuracy_m, altitude_m,
        speed_mps, heading, battery_pct, is_charging, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [Crypto.randomUUID(),
     new Date(l.timestamp).toISOString(),
     l.coords.latitude, l.coords.longitude,
     l.coords.accuracy ?? null, l.coords.altitude ?? null,
     l.coords.speed ?? null, l.coords.heading ?? null,
     batteryPct, charging, source],
  );
}

/**
 * The background task.
 *
 * Defined at module scope, because Android calls into it on a cold start with
 * no component tree: a definition inside a hook is registered too late to ever
 * be called. Wrapped, because the module does not exist in Expo Go and a throw
 * here takes the whole app down before anything renders.
 */
try {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
    if (error || !data?.locations?.length) return;
    try {
      const store = adapt(await openDb());
      for (const l of data.locations as Location.LocationObject[]) {
        await queueFix(store, l, 'BACKGROUND');
      }
      // ...and send what is waiting while it is awake. This foreground
      // service is the one piece of the app Android keeps running, so it
      // carries the handovers too -- see core/sync/background.ts. Throttled
      // to once a minute there; never awaited past this task's own work.
      await sendFromBackground();
    } catch {
      // Nothing useful to do from a background task with no UI. The next fix
      // tries again; a device that cannot write its own database has a much
      // larger problem that the capture screens will surface loudly.
    }
  });
} catch {
  console.warn('[hoto] background location is not available in this runtime');
}

/** Are we tracking right now? */
export async function isTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export type PermissionOutcome =
  | { ok: true }
  | { ok: false; reason: 'foreground' | 'background' | 'services' | 'unavailable';
      message: string };

/**
 * Ask for what background tracking needs, in the order Android demands it.
 *
 * Foreground first, ALWAYS: asking for background permission before
 * foreground has been granted is refused outright on Android 11 and later,
 * and the refusal looks to the user like the app being broken.
 */
export async function requestPermissions(): Promise<PermissionOutcome> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return { ok: false, reason: 'services',
               message: 'Location is switched off on this device. Turn it on in Settings.' };
    }
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      return { ok: false, reason: 'foreground',
               message: 'This device was not allowed to read its position.' };
    }
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      // Said precisely, because the wording in Android's own dialog is the
      // thing somebody has to find: "Allow all the time", which is not on the
      // first screen it shows.
      return { ok: false, reason: 'background',
               message: 'Reporting while the app is closed needs location set to '
                      + '"Allow all the time" in Android settings.' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'unavailable',
             message: e instanceof Error ? e.message : String(e) };
  }
}

/** Start reporting, or change how often. Safe to call when already running. */
export async function startTracking(intervalS: number): Promise<PermissionOutcome> {
  const perm = await requestPermissions();
  if (!perm.ok) return perm;

  const timeInterval = Math.max(30, Math.min(7200, Math.round(intervalS))) * 1000;
  try {
    if (await isTracking()) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      // Balanced rather than the highest: a mine needs to know which pit a
      // device is in, not which side of a vehicle it is on, and the highest
      // accuracy costs several times the battery for that difference.
      accuracy: Location.Accuracy.Balanced,
      timeInterval,
      distanceInterval: MIN_DISTANCE_M,
      // Android stops delivering to a stationary device otherwise, and a
      // device parked in a workshop all shift is exactly the case where the
      // office still wants to see that it is in the workshop.
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'HOTO is recording this device',
        notificationBody: 'Its position is sent to the mine office.',
        notificationColor: '#1e5f8a',
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'unavailable',
             message: e instanceof Error ? e.message : String(e) };
  }
}

export async function stopTracking(): Promise<void> {
  try {
    if (await isTracking()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch { /* not running */ }
}

/**
 * Do whatever the office last told this device to do.
 *
 * Called at startup and after every sync, so a setting changed in the
 * dashboard takes effect without anybody touching the device.
 */
export async function applyTrackingSettings(): Promise<PermissionOutcome> {
  const { track, intervalS } = await trackingSettings();
  if (!track) {
    await stopTracking();
    return { ok: true };
  }
  return startTracking(intervalS);
}

/** How many fixes are waiting to be sent. */
export async function queuedCount(store: Store): Promise<number> {
  const r = await store.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM location_queue`);
  return r?.n ?? 0;
}
