/**
 * The sync engine, driven against a transport that fails on purpose.
 *
 * Almost everything worth asserting here is about failure: what happens when
 * the network drops mid-upload, when the server refuses, when the same record
 * is sent twice, when a photo's session has not arrived yet. A sync engine that
 * only works when the network works is not a sync engine.
 */

import { openTestStore, seed, type TestStore } from '../capture/testStore';
import * as masters from '../capture/masters';
import * as session from '../capture/session';
import {
  backoffSeconds, describe as describeBody, dueSessions, duePhotos, isRetryable,
  status, syncNow, MAX_BACKOFF_SECONDS, type Transport,
} from './engine';
import type { ChecklistItem } from '../evaluation';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

let store: TestStore;
beforeEach(async () => {
  store = openTestStore();
  await seed(store);
});
afterEach(() => store.close());

/** A transport whose every answer the test chooses. */
function fakeTransport(over: Partial<Transport> = {}): Transport & {
  sessions: Record<string, unknown>[]; photos: unknown[]; fixes: unknown[];
} {
  const sessions: Record<string, unknown>[] = [];
  const photos: unknown[] = [];
  const fixes: unknown[] = [];
  return {
    sessions, photos, fixes,
    postLocations: over.postLocations ?? (async (batch) => {
      fixes.push(...batch);
      return { status: 200, body: { stored: batch.length, skipped: 0, duplicates: 0 } };
    }),
    postSession: over.postSession ?? (async (p) => {
      sessions.push(p);
      return { status: 201, body: { session_id: 500 + sessions.length,
                                    session_ref: `HOTO-TEST-${sessions.length}`,
                                    status: p.status } };
    }),
    postPhoto: over.postPhoto ?? (async (p) => {
      photos.push(p);
      return { status: 201, body: { photo_id: 900 + photos.length } };
    }),
    getBundle: over.getBundle ?? (async () => ({ status: 200, body: {
      server_time: new Date().toISOString(), assets: [], operators: [],
      locations: [], templates: [] } })),
    ...(over.postSession ? { postSession: over.postSession } : {}),
    ...(over.postPhoto ? { postPhoto: over.postPhoto } : {}),
    ...(over.getBundle ? { getBundle: over.getBundle } : {}),
  };
}

const items = async (): Promise<ChecklistItem[]> =>
  (await masters.resolveTemplate(store, 1, '2026-11-09'))?.items ?? [];

/** A confirmed, queued handover on MAN-11. */
async function queuedHandover(uuid = U1): Promise<void> {
  const asset = await masters.asset(store, 25);
  await session.startDraft({ store, asset: asset!, sessionType: 'START_HANDOVER',
                             clientUuid: uuid });
  const op = await masters.operatorByEmpId(store, '4101');
  await session.identify(store, uuid, op!, 'PIN', asset!);
  // Every handover now says who was on the other side, or that nobody was.
  await session.setCounterpart(store, uuid, null, true);
  await session.setReadings(store, uuid, { meterReading: 7700 });
  const list = await items();
  for (const i of list) {
    if (i.responseType === 'NUMERIC') {
      const lo = i.minValue ?? 0, hi = i.maxValue ?? 100;
      await session.answer(store, uuid, i, { itemId: i.itemId, numericValue: (lo + hi) / 2 });
    } else if (i.responseType === 'LEVEL') {
      await session.answer(store, uuid, i, { itemId: i.itemId, answer: 'NORMAL' });
    } else {
      await session.answer(store, uuid, i, { itemId: i.itemId, answer: 'OK' });
    }
  }
  const out = await session.confirm({
    store, uuid, items: list, asset: asset!, confirmedBy: '4101' });
  if (!out.queued) throw new Error(`fixture did not queue: ${out.problems.join('; ')}`);
}

const stateOf = async (uuid: string) =>
  (await store.getFirstAsync<{ sync_state: string; sync_error: string | null;
                               sync_attempts: number; server_session_ref: string | null }>(
    `SELECT sync_state, sync_error, sync_attempts, server_session_ref
       FROM session WHERE client_uuid = ?`, [uuid]))!;

describe('the backoff', () => {
  it('lengthens with each attempt', () => {
    expect(backoffSeconds(0)).toBe(15);
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
  });

  it('is capped short, because a window of signal is seconds long', () => {
    // An hour-long backoff would sleep through every gate the tablet passes.
    expect(backoffSeconds(20)).toBe(MAX_BACKOFF_SECONDS);
    expect(MAX_BACKOFF_SECONDS).toBeLessThanOrEqual(300);
  });
});

describe('which failures are worth retrying', () => {
  it('retries the server being broken or busy', () => {
    for (const s of [500, 502, 503, 504, 429, 408]) expect(isRetryable(s)).toBe(true);
  });

  it('does not retry the server declining the content', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) expect(isRetryable(s)).toBe(false);
  });
});

describe('sending a handover', () => {
  it('sends it and records what the server called it', async () => {
    await queuedHandover();
    const t = fakeTransport();
    const r = await syncNow({ store, transport: t, force: true });

    expect(r.sessionsSent).toBe(1);
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0]).toMatchObject({ client_uuid: U1, asset_id: 25 });

    const s = await stateOf(U1);
    expect(s.sync_state).toBe('synced');
    expect(s.server_session_ref).toBe('HOTO-TEST-1');
    expect(s.sync_error).toBeNull();
  });

  it('does not send it twice', async () => {
    await queuedHandover();
    const t = fakeTransport();
    await syncNow({ store, transport: t, force: true });
    await syncNow({ store, transport: t, force: true });
    expect(t.sessions).toHaveLength(1);
  });

  it('leaves it queued when there is no network, and lengthens the wait', async () => {
    await queuedHandover();
    const t = fakeTransport({ postSession: async () => { throw new Error('offline'); } });

    await syncNow({ store, transport: t, force: true });
    const a = await stateOf(U1);
    expect(a.sync_state).toBe('queued');
    expect(a.sync_attempts).toBe(1);

    await syncNow({ store, transport: t, force: true });
    const b = await stateOf(U1);
    expect(b.sync_attempts).toBe(2);
    // And it is still there to send. The record is never the casualty of the
    // network.
    expect(b.sync_state).toBe('queued');
  });

  it('keeps a refused handover instead of discarding it', async () => {
    await queuedHandover();
    const t = fakeTransport({
      postSession: async () => ({ status: 422, body: {
        detail: { message: 'The handover was not filed.',
                  problems: ['unanswered: Parking brake'] } } }),
    });
    const r = await syncNow({ store, transport: t, force: true });

    expect(r.sessionsRefused).toBe(1);
    const s = await stateOf(U1);
    // KEPT. Deleting it would destroy the only evidence a handover was
    // attempted, and the server's own words are what a supervisor needs.
    expect(s.sync_state).toBe('rejected');
    expect(s.sync_error).toContain('unanswered: Parking brake');
  });

  it('marks a clash as a conflict rather than overwriting anything', async () => {
    await queuedHandover();
    const t = fakeTransport({
      postSession: async () => ({ status: 409, body: {
        detail: 'client_uuid already filed as HOTO-0000012 for a different machine' } }),
    });
    const r = await syncNow({ store, transport: t, force: true });

    expect(r.sessionsRefused).toBe(1);
    const s = await stateOf(U1);
    expect(s.sync_state).toBe('conflict');
    expect(s.sync_error).toContain('HOTO-0000012');
    expect(r.problems.some((p) => /supervisor/i.test(p))).toBe(true);
  });

  it('retries a 503 instead of giving up on it', async () => {
    await queuedHandover();
    const t = fakeTransport({
      postSession: async () => ({ status: 503, body: { detail: 'database unavailable' } }),
    });
    await syncNow({ store, transport: t, force: true });
    const s = await stateOf(U1);
    expect(s.sync_state).toBe('queued');
    expect(s.sync_error).toContain('database unavailable');
  });

  it('never sends a draft — only what the operator has attested to', async () => {
    const asset = await masters.asset(store, 25);
    await session.startDraft({ store, asset: asset!, sessionType: 'START_HANDOVER',
                               clientUuid: U2 });
    const t = fakeTransport();
    await syncNow({ store, transport: t, force: true });
    expect(t.sessions).toHaveLength(0);
  });

  it('writes down what it tried and what came back', async () => {
    await queuedHandover();
    await syncNow({ store, transport: fakeTransport(), force: true });
    const rows = await store.getAllAsync<{ kind: string; ok: number; http_status: number }>(
      `SELECT kind, ok, http_status FROM sync_log ORDER BY local_id`);
    expect(rows).toEqual([expect.objectContaining({ kind: 'SESSION', ok: 1, http_status: 201 })]);
  });
});

describe('the backoff in practice', () => {
  it('holds a record back until its wait has elapsed', async () => {
    await queuedHandover();
    const t = fakeTransport({ postSession: async () => { throw new Error('offline'); } });
    const t0 = new Date('2026-11-09T10:00:00Z');
    await syncNow({ store, transport: t, now: t0, force: true });

    // One attempt in, the wait is 30s (attempts is now 1).
    expect(await dueSessions(store, new Date('2026-11-09T10:00:20Z'))).toEqual([]);
    expect(await dueSessions(store, new Date('2026-11-09T10:00:40Z'))).toEqual([U1]);
  });

  it('ignores the wait when a person presses the button', async () => {
    await queuedHandover();
    const t = fakeTransport({ postSession: async () => { throw new Error('offline'); } });
    const t0 = new Date('2026-11-09T10:00:00Z');
    await syncNow({ store, transport: t, now: t0, force: true });

    // A human pressing Sync now has information the backoff does not.
    expect(await dueSessions(store, new Date('2026-11-09T10:00:01Z'), true)).toEqual([U1]);
  });

  it('reports when to try again when something is still waiting', async () => {
    await queuedHandover();
    const t = fakeTransport({ postSession: async () => { throw new Error('offline'); } });
    const r = await syncNow({ store, transport: t, force: true });
    expect(r.stillQueued).toBe(1);
    expect(r.retryAfterSeconds).toBe(30);
  });

  it('reports nothing to wait for when the queue is empty', async () => {
    await queuedHandover();
    const r = await syncNow({ store, transport: fakeTransport(), force: true });
    expect(r.stillQueued).toBe(0);
    expect(r.retryAfterSeconds).toBeNull();
  });
});

describe('photos', () => {
  const addPhoto = async (sessionUuid = U1, uuid = P1) =>
    store.runAsync(
      `INSERT INTO photo (photo_uuid, session_uuid, item_id, local_path, bytes,
                          sha256, sync_state, captured_at)
       VALUES (?, ?, 101, '/tmp/p.jpg', 240000, 'abc123', 'queued', ?)`,
      [uuid, sessionUuid, new Date().toISOString()]);

  it('are not sent before their handover has arrived', async () => {
    await queuedHandover();
    await addPhoto();
    // The session is queued, not synced. The server could not attach the photo
    // to anything, and trying would burn the few seconds of signal there are.
    expect(await duePhotos(store)).toEqual([]);
  });

  it('are sent once their handover has arrived', async () => {
    await queuedHandover();
    await addPhoto();
    const t = fakeTransport();
    const r = await syncNow({ store, transport: t, force: true });

    expect(r.sessionsSent).toBe(1);
    expect(r.photosSent).toBe(1);
    expect(t.photos[0]).toMatchObject({ photoUuid: P1, clientUuid: U1, itemId: 101 });
  });

  it('send the session first, in one pass, without being told twice', async () => {
    await queuedHandover();
    await addPhoto();
    const order: string[] = [];
    const t = fakeTransport({
      postSession: async () => { order.push('session');
        return { status: 201, body: { session_id: 1, session_ref: 'R' } }; },
      postPhoto: async () => { order.push('photo');
        return { status: 201, body: { photo_id: 2 } }; },
    });
    await syncNow({ store, transport: t, force: true });
    expect(order).toEqual(['session', 'photo']);
  });

  it('keep a photo queued when the bytes did not survive the journey', async () => {
    await queuedHandover();
    await addPhoto();
    const t = fakeTransport({
      postPhoto: async () => ({ status: 409, body: { detail: { problems: [
        'the photo did not arrive intact — the device computed abc… and def… arrived. ' +
        'Keep it queued and send it again.'] } } }),
    });
    await syncNow({ store, transport: t, force: true });

    const p = await store.getFirstAsync<{ sync_state: string; sync_attempts: number }>(
      `SELECT sync_state, sync_attempts FROM photo WHERE photo_uuid = ?`, [P1]);
    // The file on disk is intact; the next attempt re-reads it.
    expect(p?.sync_state).toBe('queued');
    expect(p?.sync_attempts).toBe(1);
  });

  it('keep a photo queued when the server says the handover is not filed yet', async () => {
    await queuedHandover();
    await addPhoto();
    const t = fakeTransport({
      postPhoto: async () => ({ status: 409, body: { detail: { problems: [
        'no handover has been filed under 1111… yet — send the handover first'] } } }),
    });
    await syncNow({ store, transport: t, force: true });
    const p = await store.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM photo WHERE photo_uuid = ?`, [P1]);
    expect(p?.sync_state).toBe('queued');
  });

  it('stop sending a photo the server refuses outright', async () => {
    await queuedHandover();
    await addPhoto();
    const t = fakeTransport({
      postPhoto: async () => ({ status: 422, body: { detail: { problems: [
        'image/tiff is not an image type this accepts'] } } }),
    });
    const r = await syncNow({ store, transport: t, force: true });
    const p = await store.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM photo WHERE photo_uuid = ?`, [P1]);
    expect(p?.sync_state).toBe('rejected');
    expect(r.photosRefused).toBe(1);
  });

  it('retry a photo when the network drops, without losing it', async () => {
    await queuedHandover();
    await addPhoto();
    const t = fakeTransport({ postPhoto: async () => { throw new Error('offline'); } });
    await syncNow({ store, transport: t, force: true });
    const p = await store.getFirstAsync<{ sync_state: string; sync_attempts: number }>(
      `SELECT sync_state, sync_attempts FROM photo WHERE photo_uuid = ?`, [P1]);
    expect(p).toMatchObject({ sync_state: 'queued', sync_attempts: 1 });
  });

  it('counts a photo still waiting in what is left', async () => {
    await queuedHandover();
    await addPhoto();
    const t = fakeTransport({ postPhoto: async () => { throw new Error('offline'); } });
    const r = await syncNow({ store, transport: t, force: true });
    expect(r.sessionsSent).toBe(1);
    expect(r.stillQueued).toBe(1);
  });
});

describe('what the banner reads', () => {
  it('counts every state separately, so nothing is rounded into "fine"', async () => {
    await queuedHandover(U1);
    await syncNow({ store, transport: fakeTransport(), force: true });
    await queuedHandover(U2);

    const s = await status(store);
    expect(s).toMatchObject({ synced: 1, queued: 1, rejected: 0, conflict: 0 });
    expect(s.oldestQueuedAt).not.toBeNull();
  });

  it('says how long the oldest thing has been sitting here', async () => {
    await queuedHandover();
    const s = await status(store);
    expect(Date.parse(s.oldestQueuedAt!)).toBeLessThanOrEqual(Date.now());
  });
});

describe('the server’s own words', () => {
  it('are passed through rather than paraphrased', () => {
    expect(describeBody({ detail: { problems: ['say what was done'] } }))
      .toBe('say what was done');
    expect(describeBody({ detail: 'plain refusal' })).toBe('plain refusal');
    expect(describeBody({ detail: { message: 'Refused.' } })).toBe('Refused.');
    expect(describeBody(null)).toBe('no answer from the server');
  });
});
