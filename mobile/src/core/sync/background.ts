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
 */

import { adapt, openDb } from '../db/open';

import { syncNow, waiting } from './engine';
import { httpTransport } from './transport';
import { storedBaseUrl, storedToken } from './enrolment';
import { tryLock, unlock } from './lock';

const MIN_GAP_MS = 60_000;
let lastRun = 0;

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
    if ((await waiting(store)).total === 0) return 0;
    const report = await syncNow({
      store,
      transport: httpTransport({ baseUrl: storedBaseUrl, deviceToken: storedToken }),
      force: opts.force ?? false,
    });
    return report.sessionsSent + report.photosSent + report.locationsSent;
  } catch {
    return null;
  } finally {
    unlock();
  }
}
