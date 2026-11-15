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
import {
  cacheBundle, clockDriftSeconds, DRIFT_WARN_SECONDS, type SyncBundle,
} from '../capture/cache';
import type { SyncState } from '../enums';

export interface Transport {
  /** POST the session payload. Resolves for any HTTP answer; rejects only for
   *  a network failure, which is the distinction the engine turns on. */
  postSession(payload: Record<string, unknown>): Promise<{ status: number; body: any }>;
  postPhoto(args: {
    photoUuid: string; clientUuid: string; itemId: number | null;
    localPath: string; sha256: string; capturedAt: string;
    /** ITEM (evidence against a check) or OPERATOR (who took the machine on). */
    kind?: string | null;
    /** Where the photo was taken. Null when no fix was available in time. */
    lat?: number | null; lon?: number | null; accuracyM?: number | null;
  }): Promise<{ status: number; body: any }>;
  getBundle(): Promise<{ status: number; body: any }>;
  /** A batch of position fixes. Idempotent per fix on the server. */
  postLocations(fixes: Record<string, unknown>[]): Promise<{ status: number; body: any }>;
}

export interface SyncReport {
  sessionsSent: number;
  sessionsRefused: number;
  photosSent: number;
  photosRefused: number;
  locationsSent: number;
  /** Photos held back because the handover they belong to is still a draft.
   *  Not a failure: nothing was attempted for them. */
  photosAwaitingSession: number;
  /** How many machines this device now holds. Null when masters were not refreshed. */
  machinesCached: number | null;
  /** The device's clock against the server's, in seconds. */
  clockDriftSeconds: number | null;
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
    locationsSent: 0, photosAwaitingSession: 0,
    machinesCached: null, clockDriftSeconds: null,
    stillQueued: 0, mastersRefreshed: false, problems: [], retryAfterSeconds: null,
  };

  for (const uuid of await dueSessions(store, now, force)) {
    await sendSession(store, transport, uuid, report, now);
  }
  for (const photo of await duePhotos(store, now, force)) {
    await sendPhoto(store, transport, photo, report, now);
  }

  await sendLocations(store, transport, report);

  if (args.refreshMasters) {
    // THE BUNDLE IS STORED HERE. It was not, for the whole of phases 10-14:
    // this block fetched the machine list, set mastersRefreshed, wrote a
    // success line to the sync log, and dropped the data on the floor.
    // `cacheBundle` had no caller outside its own tests, so every device ever
    // set up held an empty machine list and the capture flow was unreachable
    // -- "this tablet holds no machines yet", on a device that had just
    // synced successfully. Found on a phone in the field, 10 Nov 2026.
    //
    // mastersRefreshed now means STORED, not fetched. Those are the two
    // things this bug confused, and the difference is the entire app.
    const r = await transport.getBundle().catch(() => null);
    if (r && r.status === 200 && Array.isArray(r.body?.assets)) {
      try {
        const n = await cacheBundle(store, r.body as SyncBundle, now);
        report.mastersRefreshed = true;
        report.machinesCached = n.assets;
        await log(store, 'MASTERS', null, true, 200,
                  `${n.assets} machines, ${n.operators} operators, ` +
                  `${n.templates} checklists, ${n.items} checks`);

        // A device whose clock is out files handovers into the wrong shift,
        // and nothing about the record itself would ever show it.
        const drift = clockDriftSeconds(r.body.server_time, now);
        report.clockDriftSeconds = drift;
        if (Math.abs(drift) > DRIFT_WARN_SECONDS) {
          report.problems.push(
            `This device's clock is ${Math.abs(Math.round(drift / 60))} minutes ` +
            `${drift > 0 ? 'ahead of' : 'behind'} the office. Handovers may be ` +
            `filed into the wrong shift until it is corrected.`);
        }
      } catch (e) {
        // Fetched but not stored is a failure, and must read as one.
        report.problems.push(
          'The machine list arrived but could not be stored on this device.');
        await log(store, 'MASTERS', null, false, 200,
                  e instanceof Error ? e.message : String(e));
      }
    } else if (r && r.status === 200) {
      report.problems.push('The server sent no machine list.');
      await log(store, 'MASTERS', null, false, 200, 'no assets in the bundle');
    } else if (r) {
      report.problems.push(`Could not refresh the machine list (${r.status}).`);
      await log(store, 'MASTERS', null, false, r.status, null);
    }
  }

  // A photo on an unconfirmed draft is not waiting on the network -- it is
  // waiting on somebody to finish the handover. Counted separately so the
  // screen does not send them hunting a connection problem that is not there.
  const held = await store.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photo p
       JOIN session s ON s.client_uuid = p.session_uuid
      WHERE p.sync_state IN ('queued','sending') AND s.sync_state <> 'synced'`);
  report.photosAwaitingSession = held?.n ?? 0;

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
  kind?: string | null;
  lat?: number | null; lon?: number | null; accuracy_m?: number | null;
  /** When this photo's hash was recomputed after a mismatch. Once only. */
  rehashed_at?: string | null;
}

/**
 * Re-read a photo and hash its bytes.
 *
 * Injected rather than imported so the engine stays testable without a file
 * system -- the tests supply their own, the app supplies the real one.
 */
let rehash: (uri: string) => Promise<string> =
  async () => { throw new Error('no re-hash function has been installed'); };
export function setRehash(fn: (uri: string) => Promise<string>): void { rehash = fn; }

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
            p.captured_at, p.sync_attempts, p.kind, p.lat, p.lon, p.accuracy_m,
            p.rehashed_at
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
      kind: p.kind ?? 'ITEM',
      lat: p.lat ?? null, lon: p.lon ?? null, accuracyM: p.accuracy_m ?? null,
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
    // The hash the server computed does not match the one sent. Re-reading
    // the file and hashing it again is the whole remedy when the stored hash
    // was computed wrongly -- which, for every photo taken before 12 Nov
    // 2026, it was (see core/capture/photoHash.ts). Without this those rows
    // retry for ever and the queue never drains.
    //
    // Done once per photo, guarded by rehashed_at, because if the file really
    // has gone bad then re-hashing it just produces a new wrong answer and
    // the loop is the same loop.
    if (!p.rehashed_at) {
      try {
        const fresh = await rehash(p.local_path);
        await store.runAsync(
          `UPDATE photo SET sha256 = ?, rehashed_at = ?, sync_state = 'queued',
                            sync_attempts = sync_attempts + 1
            WHERE photo_uuid = ?`,
          [fresh, now.toISOString(), p.photo_uuid]);
        await log(store, 'PHOTO', p.photo_uuid, false, 409,
                  'hash did not match; recomputed from the file');
        return;
      } catch {
        // Could not read it back at all -- no re-hash function installed, or
        // the file is unreadable this moment. Keep it queued, which is the
        // old behaviour and the safe one: a photo is evidence, and refusing
        // it because this device could not open it once is worse than
        // carrying it.
        await store.runAsync(
          `UPDATE photo SET sync_state = 'queued', sync_attempts = sync_attempts + 1
            WHERE photo_uuid = ?`, [p.photo_uuid]);
        await log(store, 'PHOTO', p.photo_uuid, false, 409, why);
        return;
      }
    }

    // Re-hashed once already and still refused. The bytes really are not what
    // the device thinks they are, and sending them again gets the same answer.
    await store.runAsync(
      `UPDATE photo SET sync_state = 'rejected', sync_error = ?
        WHERE photo_uuid = ?`, [why, p.photo_uuid]);
    report.photosRefused++;
    report.problems.push('A photo could not be sent: ' + why);
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
/**
 * Send whatever positions have piled up, oldest first, and delete what landed.
 *
 * LAST in the sync, and deliberately quiet about failing. A handover is the
 * thing somebody signed and the thing a shift depends on; a position is
 * telemetry. If the window of signal is only wide enough for one of them it
 * must be the handover, and a failure here must never add a problem to a
 * report a supervisor reads, nor stop the sync being counted as a success.
 */
const LOCATION_BATCH = 200;

export async function sendLocations(
  store: Store, transport: Transport, report: SyncReport,
): Promise<void> {
  for (;;) {
    const rows = await store.getAllAsync<{
      local_id: number; client_uuid: string; recorded_at: string;
      lat: number; lon: number; accuracy_m: number | null;
      altitude_m: number | null; speed_mps: number | null; heading: number | null;
      battery_pct: number | null; is_charging: number | null; source: string;
    }>(`SELECT * FROM location_queue ORDER BY recorded_at LIMIT ${LOCATION_BATCH}`);
    if (rows.length === 0) return;

    let answer: { status: number; body: any };
    try {
      answer = await transport.postLocations(rows.map((r) => ({
        client_uuid: r.client_uuid,
        recorded_at: r.recorded_at,
        lat: r.lat, lon: r.lon,
        accuracy_m: r.accuracy_m, altitude_m: r.altitude_m,
        speed_mps: r.speed_mps, heading: r.heading,
        battery_pct: r.battery_pct,
        is_charging: r.is_charging === null ? null : r.is_charging === 1,
        source: r.source,
      })));
    } catch {
      return;                       // no connection; they keep until next time
    }

    if (answer.status === 200) {
      // Deleted on success only. A batch the server accepted is already
      // idempotent on its side, so a delete that fails here costs one
      // duplicate request, not a duplicated track.
      const ids = rows.map((r) => r.local_id).join(',');
      await store.runAsync(`DELETE FROM location_queue WHERE local_id IN (${ids})`);
      report.locationsSent += Number(answer.body?.stored ?? rows.length);
      await log(store, 'LOCATIONS', null, true, 200, `${rows.length} sent`);
      if (rows.length < LOCATION_BATCH) return;
      continue;                     // more waiting: keep going
    }

    if (!isRetryable(answer.status)) {
      // The server will never take these. Dropping them is right: a device
      // that keeps a rejected batch forever never sends another position
      // again, which is a worse failure than losing some telemetry.
      const ids = rows.map((r) => r.local_id).join(',');
      await store.runAsync(`DELETE FROM location_queue WHERE local_id IN (${ids})`);
      await log(store, 'LOCATIONS', null, false, answer.status, describe(answer.body));
    }
    return;
  }
}

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

/**
 * What is waiting on the NETWORK, as opposed to waiting on a person.
 *
 * A photo attached to an unfinished draft is held back until the handover is
 * confirmed, so it is not counted: the triggers would otherwise keep trying to
 * send something that is not allowed to go, and the screen would blame the
 * signal for a handover nobody has finished. Positions are counted, because
 * the office is waiting on those too.
 */
export async function waiting(store: Store): Promise<{
  sessions: number; photos: number; positions: number; total: number;
}> {
  const s = await store.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session WHERE sync_state IN ('queued','sending')`);
  const p = await store.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photo ph
       JOIN session s ON s.client_uuid = ph.session_uuid
      WHERE ph.sync_state IN ('queued','sending') AND s.sync_state <> 'draft'`);
  let positions = 0;
  try {
    const l = await store.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM location_queue`);
    positions = l?.n ?? 0;
  } catch { /* a device on a schema before v2 has no queue */ }
  const sessions = s?.n ?? 0;
  const photos = p?.n ?? 0;
  return { sessions, photos, positions, total: sessions + photos + positions };
}

/**
 * The most recent attempt to reach the office, and how it went.
 *
 * So the screen can say "the office did not answer 2 minutes ago" rather than
 * "bring the tablet within signal" -- which is what it said to a tablet sitting
 * on working wifi for thirty-five hours while the server it was looking for
 * was simply somewhere else.
 */
export async function lastAttempt(store: Store): Promise<{
  at: string; ok: boolean; status: number | null; detail: string | null; kind: string;
} | null> {
  const r = await store.getFirstAsync<{
    at: string; ok: number; http_status: number | null; detail: string | null; kind: string;
  }>(
    `SELECT at, ok, http_status, detail, kind FROM sync_log
      WHERE kind IN ('SESSION','PHOTO','LOCATIONS','MASTERS')
      ORDER BY local_id DESC LIMIT 1`);
  return r ? { at: r.at, ok: r.ok === 1, status: r.http_status, detail: r.detail, kind: r.kind } : null;
}
