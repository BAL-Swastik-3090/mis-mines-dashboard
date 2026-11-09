/**
 * Getting what is on this tablet to the office.
 *
 * ── THE OUTBOX IS A QUEUE, NOT A SYNC ────────────────────────────────────────
 * There is no merge here and no conflict resolution in the usual sense. The
 * device OWNS its captured records until the server acknowledges them, and the
 * server owns the masters. Nothing is ever two-way, which is what makes this
 * tractable: the only questions are "has this reached the office yet" and "what
 * did the office say".
 *
 * ── A REFUSAL IS KEPT, NEVER DISCARDED ───────────────────────────────────────
 * If the server refuses a handover, the row stays on the device marked
 * `rejected`, with the server's words in `sync_error`. Deleting it would
 * destroy the only evidence that a handover was attempted, and "the tablet
 * threw it away" is not something anybody can investigate six weeks later. The
 * home screen surfaces it for a supervisor instead.
 *
 * ── WHAT COUNTS AS A FAILURE WORTH RETRYING ──────────────────────────────────
 * A network error, a timeout, a 5xx: the record is unchanged and will be sent
 * again. A 4xx is the server declining the content, and sending it again
 * unchanged will get the same answer forever -- so it stops, loudly. The one
 * exception is 409 on a photo whose session has not synced yet, which is an
 * ORDERING problem the device itself fixes by sending the session first.
 *
 * ── AND WHY THE BACKOFF IS CAPPED SHORT ──────────────────────────────────────
 * Not an hour. A tablet's window of signal is seconds long, at a gate or
 * passing the workshop, and an exponential backoff that has reached twenty
 * minutes will sleep through every one of them. Five minutes is the ceiling,
 * and `syncNow` always ignores it: a human pressing the button has information
 * the backoff does not.
 */

import type { Store } from '../capture/store';
import { payloadFor } from '../capture/session';
import type { SyncState } from '../enums';

export interface Transport {
  /** POST the session payload. Resolves for any HTTP answer; rejects only for
   *  a network failure, which is the distinction the engine turns on. */
  postSession(payload: Record<string, unknown>): Promise<{ status: number; body: any }>;
  postPhoto(args: {
    photoUuid: string; clientUuid: string; itemId: number | null;
    localPath: string; sha256: string; capturedAt: string;
  }): Promise<{ status: number; body: any }>;
  getBundle(): Promise<{ status: number; body: any }>;
}

export interface SyncReport {
  sessionsSent: number;
  sessionsRefused: number;
  photosSent: number;
  photosRefused: number;
  stillQueued: number;
  mastersRefreshed: boolean;
  problems: string[];
  /** Null when nothing is waiting; otherwise when to try again. */
  retryAfterSeconds: number | null;
}

const BASE_BACKOFF_SECONDS = 15;
export const MAX_BACKOFF_SECONDS = 300;

/** Exponential, capped, and deliberately short. See the file header. */
export function backoffSeconds(attempts: number): number {
  const n = Math.max(0, attempts);
  return Math.min(BASE_BACKOFF_SECONDS * 2 ** n, MAX_BACKOFF_SECONDS);
}

/** Whether this HTTP status means "try again" or "stop and tell somebody". */
export function isRetryable(status: number): boolean {
  if (status >= 500) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  return false;
}

async function log(store: Store, kind: string, subject: string | null,
                   ok: boolean, status: number | null, detail: string | null) {
  await store.runAsync(
    `INSERT INTO sync_log (at, kind, subject_uuid, ok, http_status, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [new Date().toISOString(), kind, subject, ok ? 1 : 0, status,
     detail ? detail.slice(0, 500) : null],
  );
}

interface Due {
  client_uuid: string;
  sync_attempts: number;
  last_sync_attempt_at: string | null;
}

/** Queued records whose backoff has elapsed. `force` ignores the backoff. */
export async function dueSessions(
  store: Store, now = new Date(), force = false,
): Promise<string[]> {
  const rows = await store.getAllAsync<Due>(
    `SELECT client_uuid, sync_attempts, last_sync_attempt_at
       FROM session WHERE sync_state IN ('queued', 'sending')
      ORDER BY captured_at`,
  );
  if (force) return rows.map((r) => r.client_uuid);
  return rows.filter((r) => ready(r, now)).map((r) => r.client_uuid);
}

function ready(r: Due, now: Date): boolean {
  if (!r.last_sync_attempt_at) return true;
  const since = (now.getTime() - Date.parse(r.last_sync_attempt_at)) / 1000;
  return since >= backoffSeconds(r.sync_attempts);
}

/**
 * Send everything that is ready.
 *
 * SESSIONS BEFORE PHOTOS, always. A photo is addressed by its session's
 * client_uuid, so a photo sent first is refused with a 409 that the device
 * then has to understand -- and ordering it correctly here is cheaper than
 * teaching the retry logic to recover from an ordering it chose itself.
 */
export async function syncNow(args: {
  store: Store; transport: Transport; now?: Date; force?: boolean;
  refreshMasters?: boolean;
}): Promise<SyncReport> {
  const { store, transport } = args;
  const now = args.now ?? new Date();
  const force = args.force ?? false;

  const report: SyncReport = {
    sessionsSent: 0, sessionsRefused: 0, photosSent: 0, photosRefused: 0,
    stillQueued: 0, mastersRefreshed: false, problems: [], retryAfterSeconds: null,
  };

  for (const uuid of await dueSessions(store, now, force)) {
    await sendSession(store, transport, uuid, report, now);
  }
  for (const photo of await duePhotos(store, now, force)) {
    await sendPhoto(store, transport, photo, report, now);
  }

  if (args.refreshMasters) {
    const r = await transport.getBundle().catch(() => null);
    if (r && r.status === 200) {
      report.mastersRefreshed = true;
      await log(store, 'MASTERS', null, true, 200, null);
    } else if (r) {
      report.problems.push(`Could not refresh the machine list (${r.status}).`);
      await log(store, 'MASTERS', null, false, r.status, null);
    }
  }

  const left = await store.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session WHERE sync_state IN ('queued','sending')`);
  const leftPhotos = await store.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photo WHERE sync_state IN ('queued','sending')`);
  report.stillQueued = (left?.n ?? 0) + (leftPhotos?.n ?? 0);

  if (report.stillQueued > 0) {
    const worst = await store.getFirstAsync<{ a: number }>(
      `SELECT MIN(sync_attempts) AS a FROM session WHERE sync_state IN ('queued','sending')`);
    report.retryAfterSeconds = backoffSeconds(worst?.a ?? 0);
  }

  return report;
}

async function mark(store: Store, uuid: string, state: SyncState,
                    error: string | null, now: Date, bumpAttempt: boolean) {
  await store.runAsync(
    `UPDATE session SET sync_state = ?, sync_error = ?,
            last_sync_attempt_at = ?,
            sync_attempts = sync_attempts + ?
      WHERE client_uuid = ?`,
    [state, error, now.toISOString(), bumpAttempt ? 1 : 0, uuid],
  );
}

async function sendSession(store: Store, transport: Transport, uuid: string,
                           report: SyncReport, now: Date): Promise<void> {
  await store.runAsync(
    `UPDATE session SET sync_state = 'sending' WHERE client_uuid = ?`, [uuid]);

  let payload: Record<string, unknown>;
  try {
    payload = await payloadFor(store, uuid);
  } catch (e) {
    // The record cannot even be read. Kept and surfaced, not dropped.
    await mark(store, uuid, 'rejected',
               e instanceof Error ? e.message : String(e), now, true);
    report.sessionsRefused++;
    report.problems.push('A handover on this tablet could not be read.');
    return;
  }

  let answer: { status: number; body: any };
  try {
    answer = await transport.postSession(payload);
  } catch (e) {
    // No network. NOT a failure of the record -- it stays queued, and the
    // attempt count rises so the backoff lengthens.
    await mark(store, uuid, 'queued',
               e instanceof Error ? e.message : 'no connection', now, true);
    await log(store, 'SESSION', uuid, false, null, 'no connection');
    return;
  }

  if (answer.status === 200 || answer.status === 201) {
    await store.runAsync(
      `UPDATE session SET sync_state = 'synced', sync_error = NULL,
              server_session_id = ?, server_session_ref = ?,
              status = COALESCE(?, status),
              last_sync_attempt_at = ?
        WHERE client_uuid = ?`,
      [answer.body?.session_id ?? null, answer.body?.session_ref ?? null,
       answer.body?.status ?? null, now.toISOString(), uuid]);
    report.sessionsSent++;
    await log(store, 'SESSION', uuid, true, answer.status,
              answer.body?.session_ref ?? null);
    return;
  }

  if (answer.status === 409) {
    // The server holds a different record under this key. Retained for a
    // supervisor rather than overwritten in either direction: both are real
    // records of something somebody did.
    await mark(store, uuid, 'conflict', describe(answer.body), now, true);
    report.sessionsRefused++;
    report.problems.push(
      'A handover clashes with one already filed. Show a supervisor.');
    await log(store, 'SESSION', uuid, false, 409, describe(answer.body));
    return;
  }

  if (isRetryable(answer.status)) {
    await mark(store, uuid, 'queued', describe(answer.body), now, true);
    await log(store, 'SESSION', uuid, false, answer.status, describe(answer.body));
    return;
  }

  // A 4xx. Sending it again unchanged gets the same answer forever.
  await mark(store, uuid, 'rejected', describe(answer.body), now, true);
  report.sessionsRefused++;
  report.problems.push(`A handover was refused: ${describe(answer.body)}`);
  await log(store, 'SESSION', uuid, false, answer.status, describe(answer.body));
}

interface PhotoRow {
  photo_uuid: string; session_uuid: string; item_id: number | null;
  local_path: string; sha256: string; captured_at: string;
  sync_attempts: number; last_attempt_at?: string | null;
}

/**
 * Photos whose session has already synced.
 *
 * The join is the point: a photo whose handover is still queued is not due,
 * however long it has waited, because the server cannot attach it to anything
 * yet. Sending it would earn a 409 and burn one of the few seconds of signal
 * the tablet gets.
 */
export async function duePhotos(
  store: Store, now = new Date(), force = false,
): Promise<PhotoRow[]> {
  const rows = await store.getAllAsync<PhotoRow>(
    `SELECT p.photo_uuid, p.session_uuid, p.item_id, p.local_path, p.sha256,
            p.captured_at, p.sync_attempts
       FROM photo p
       JOIN session s ON s.client_uuid = p.session_uuid
      WHERE p.sync_state IN ('queued', 'sending')
        AND s.sync_state = 'synced'
      ORDER BY p.captured_at`,
  );
  if (force) return rows;
  return rows;
}

async function sendPhoto(store: Store, transport: Transport, p: PhotoRow,
                         report: SyncReport, now: Date): Promise<void> {
  await store.runAsync(
    `UPDATE photo SET sync_state = 'sending' WHERE photo_uuid = ?`, [p.photo_uuid]);

  let answer: { status: number; body: any };
  try {
    answer = await transport.postPhoto({
      photoUuid: p.photo_uuid, clientUuid: p.session_uuid, itemId: p.item_id,
      localPath: p.local_path, sha256: p.sha256, capturedAt: p.captured_at,
    });
  } catch {
    await store.runAsync(
      `UPDATE photo SET sync_state = 'queued', sync_attempts = sync_attempts + 1
        WHERE photo_uuid = ?`, [p.photo_uuid]);
    await log(store, 'PHOTO', p.photo_uuid, false, null, 'no connection');
    return;
  }

  if (answer.status === 200 || answer.status === 201) {
    await store.runAsync(
      `UPDATE photo SET sync_state = 'synced', server_ref = ?
        WHERE photo_uuid = ?`,
      [answer.body?.photo_id != null ? String(answer.body.photo_id) : null, p.photo_uuid]);
    report.photosSent++;
    await log(store, 'PHOTO', p.photo_uuid, true, answer.status, null);
    return;
  }

  if (answer.status === 409) {
    const why = describe(answer.body);
    if (/no handover has been filed/i.test(why)) {
      // Ordering, not content. Stays queued; the session will go first next
      // time. This is why duePhotos joins on the session being synced -- this
      // branch should be unreachable, and is here because "should be" is not
      // the same as "is".
      await store.runAsync(
        `UPDATE photo SET sync_state = 'queued', sync_attempts = sync_attempts + 1
          WHERE photo_uuid = ?`, [p.photo_uuid]);
      await log(store, 'PHOTO', p.photo_uuid, false, 409, 'session not filed yet');
      return;
    }
    // The bytes did not survive. Queued again: the file on disk is still
    // intact, and the next attempt re-reads it.
    await store.runAsync(
      `UPDATE photo SET sync_state = 'queued', sync_attempts = sync_attempts + 1
        WHERE photo_uuid = ?`, [p.photo_uuid]);
    await log(store, 'PHOTO', p.photo_uuid, false, 409, why);
    return;
  }

  if (isRetryable(answer.status)) {
    await store.runAsync(
      `UPDATE photo SET sync_state = 'queued', sync_attempts = sync_attempts + 1
        WHERE photo_uuid = ?`, [p.photo_uuid]);
    await log(store, 'PHOTO', p.photo_uuid, false, answer.status, describe(answer.body));
    return;
  }

  await store.runAsync(
    `UPDATE photo SET sync_state = 'rejected', sync_attempts = sync_attempts + 1
      WHERE photo_uuid = ?`, [p.photo_uuid]);
  report.photosRefused++;
  report.problems.push(`A photo was refused: ${describe(answer.body)}`);
  await log(store, 'PHOTO', p.photo_uuid, false, answer.status, describe(answer.body));
}

/** The server's words, not ours. A paraphrase loses the thing a supervisor needs. */
export function describe(body: any): string {
  if (!body) return 'no answer from the server';
  const d = body.detail ?? body;
  if (typeof d === 'string') return d;
  if (Array.isArray(d?.problems)) return d.problems.join('; ');
  if (typeof d?.message === 'string') return d.message;
  return JSON.stringify(d).slice(0, 300);
}

/** What the home screen's banner needs, in one read. */
export async function status(store: Store): Promise<{
  queued: number; sending: number; synced: number; rejected: number;
  conflict: number; photosQueued: number; photosRejected: number;
  oldestQueuedAt: string | null; lastSyncAt: string | null;
}> {
  const s = await store.getAllAsync<{ sync_state: SyncState; n: number }>(
    `SELECT sync_state, COUNT(*) AS n FROM session GROUP BY sync_state`);
  const p = await store.getAllAsync<{ sync_state: string; n: number }>(
    `SELECT sync_state, COUNT(*) AS n FROM photo GROUP BY sync_state`);
  const oldest = await store.getFirstAsync<{ at: string | null }>(
    `SELECT MIN(captured_at) AS at FROM session WHERE sync_state IN ('queued','sending')`);
  const last = await store.getFirstAsync<{ value: string | null }>(
    `SELECT value FROM meta WHERE key = 'last_sync_at'`);

  const at = (rows: { sync_state: string; n: number }[], k: string) =>
    rows.find((r) => r.sync_state === k)?.n ?? 0;

  return {
    queued: at(s, 'queued'), sending: at(s, 'sending'), synced: at(s, 'synced'),
    rejected: at(s, 'rejected'), conflict: at(s, 'conflict'),
    photosQueued: at(p, 'queued') + at(p, 'sending'),
    photosRejected: at(p, 'rejected'),
    oldestQueuedAt: oldest?.at ?? null,
    lastSyncAt: last?.value ?? null,
  };
}
