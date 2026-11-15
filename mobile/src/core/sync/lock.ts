/**
 * One send at a time, whoever starts it.
 *
 * There are now three things that can start a send: the screens (open, a
 * timer, Sync now), the position tracker running in the background, and the
 * OS's own background task. Two concurrent passes would both mark the same
 * handover `sending` and both post it -- the server's idempotency makes that
 * harmless to the record, but it spends a few seconds of signal twice and can
 * leave a photo half-sent twice over. So every caller takes this first and
 * skips its turn when somebody else is already sending.
 *
 * Module state, not storage: the screens and the background tracker share one
 * JavaScript runtime while the app is alive, which is the only time they can
 * overlap.
 */

let held = false;
let heldSince = 0;

/** A send that has held the lock this long has been killed mid-way. */
const STALE_MS = 3 * 60 * 1000;

export function tryLock(now = Date.now()): boolean {
  if (held && now - heldSince < STALE_MS) return false;
  held = true;
  heldSince = now;
  return true;
}

export function unlock(): void {
  held = false;
}

export function isLocked(now = Date.now()): boolean {
  return held && now - heldSince < STALE_MS;
}
