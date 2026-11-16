/**
 * Sending while nobody is looking at the app.
 *
 * ── WHY IT RIDES ON THE POSITION TRACKER ─────────────────────────────────────
 * Android does not reliably run an app's background work: the OS's own
 * scheduler (expo-background-task) fires at its discretion, which on a tablet
 * in a cab means hours or never. The one thing Android does keep alive is a
 * foreground service -- and the position tracker already is one, with its
 * notification, delivering a fix every few minutes all shift. So each time it
 * wakes, it also sends whatever is waiting: handovers, their photographs, and
 * the positions it has just queued.
 *
 * Before this, positions themselves only reached the office when somebody
 * opened the app, and a handover confirmed in the pit waited for the next
 * person to pick the tablet up within reach of the server.
 *
 * ── HOW OFTEN ────────────────────────────────────────────────────────────────
 * At most once a minute, and only when something is waiting. The engine's own
 * backoff (15 s doubling to 5 min per record) still decides which records are
 * due, so a server that is down is not hammered.
 *
 * ── AND THE OFFICE'S LISTS, EVERY HALF HOUR ──────────────────────────────────
 * So that a new operator, machine or checklist reaches a tablet that nobody
 * has opened, and its notification shows (16 Nov 2026). Half an hour rather
 * than the ten minutes of an open app: the list is about 100 kB, and a tablet
 * in a cab may be on a SIM all day. The notification itself is posted by
 * whatever the app registered with setAnnouncer -- core does not draw.
 */

import { adapt, openDb } from '../db/open';

import { syncNow, waiting } from './engine';
import type { Change } from '../notices';
import type { Store } from '../capture/store';
import { httpTransport } from './transport';
import { storedBaseUrl, storedToken } from './enrolment';
import { tryLock, unlock } from './lock';

const MIN_GAP_MS = 60_000;
/** How stale the office's lists may get on a tablet nobody is looking at. */
export const MASTERS_BACKGROUND_MS = 30 * 60_000;
let lastRun = 0;

type Announcer = (changes: Change[]) => Promise<void>;
let announcer: Announcer | null = null;
/** What to do with the office's changes found while in the background. */
export function setAnnouncer(fn: Announcer): void { announcer = fn; }

/** Whether the lists were last refreshed longer ago than `ms` (or never). */
export async function mastersOlderThan(
  store: Store, ms: number, now = Date.now()): Promise<boolean> {
  const r = await store.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'last_sync_at'`);
  const at = r?.value ? Date.parse(r.value) : NaN;
  return Number.isNaN(at) || now - at > ms;
}

/**
 * Send what is waiting, if it is time and nobody else is sending.
 * Returns how many records went, or null when it did not try.
 */
export async function sendFromBackground(opts: { force?: boolean } = {}): Promise<number | null> {
  const now = Date.now();
  if (!opts.force && now - lastRun < MIN_GAP_MS) return null;
  if (!(await storedBaseUrl()) || !(await storedToken())) return null;   // not set up yet
  if (!tryLock(now)) return null;
  lastRun = now;
  try {
    const store = adapt(await openDb());
    const mastersDue = await mastersOlderThan(store, MASTERS_BACKGROUND_MS, now);
    if ((await waiting(store)).total === 0 && !mastersDue) return 0;
    const report = await syncNow({
      store,
      transport: httpTransport({ baseUrl: storedBaseUrl, deviceToken: storedToken }),
      force: opts.force ?? false,
      refreshMasters: mastersDue,
    });
    if (report.changes.length && announcer) await announcer(report.changes).catch(() => undefined);
    return report.sessionsSent + report.photosSent + report.locationsSent;
  } catch {
    return null;
  } finally {
    unlock();
  }
}
