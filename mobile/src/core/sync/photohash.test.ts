/**
 * A photo whose hash the device got wrong.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Because the device hashed the base64 TEXT of a photo while the server hashed
 * its BYTES, so every photo a device ever uploaded was refused as corrupt —
 * and because that refusal is retryable by design, each one retried on every
 * sync, for ever, and the queue could never drain.
 *
 * It survived three phases of tests. The photo contract test uploads its own
 * bytes and hashes them correctly, so the server was proven and the device's
 * own hashing was never once exercised. These tests drive the engine, which is
 * where the two sides actually meet.
 */

import { openTestStore, seed, type TestStore } from '../capture/testStore';
import { setRehash, syncNow, type Transport } from './engine';
import { bytesFromBase64, hex } from '../capture/photoBytes';

let store: TestStore;
beforeEach(async () => {
  store = openTestStore();
  await seed(store);
  setRehash(async () => GOOD_HASH);
});
afterEach(() => store.close());

const SESSION = '11111111-1111-4111-8111-111111111111';
const PHOTO = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const GOOD_HASH = 'a'.repeat(64);
const BAD_HASH = 'b'.repeat(64);

async function queuePhoto(sha = BAD_HASH): Promise<void> {
  await store.runAsync(
    `INSERT INTO session (client_uuid, asset_id, session_type, sequence_no,
                          status, sync_state, captured_at, captured_offline)
     VALUES (?, 25, 'START_HANDOVER', 1, 'SUBMITTED', 'synced', ?, 0)`,
    [SESSION, new Date().toISOString()]);
  await store.runAsync(
    `INSERT INTO photo (photo_uuid, session_uuid, item_id, local_path, bytes,
                        sha256, sync_state, captured_at)
     VALUES (?, ?, 500, '/tmp/p.jpg', 1234, ?, 'queued', ?)`,
    [PHOTO, SESSION, sha, new Date().toISOString()]);
}

const photoRow = async () => store.getFirstAsync<{
  sync_state: string; sha256: string; sync_attempts: number;
  rehashed_at: string | null; sync_error: string | null;
}>(`SELECT * FROM photo WHERE photo_uuid = ?`, [PHOTO]);

function transport(over: Partial<Transport> = {}): Transport & { sent: any[] } {
  const sent: any[] = [];
  return {
    sent,
    postSession: over.postSession ?? (async () => ({ status: 201, body: {} })),
    postLocations: over.postLocations ?? (async () => ({ status: 200, body: {} })),
    getBundle: over.getBundle ?? (async () => ({
      status: 200,
      body: { server_time: new Date().toISOString(), assets: [], operators: [],
              locations: [], templates: [] },
    })),
    postPhoto: over.postPhoto ?? (async (p) => {
      sent.push(p);
      // The server as it really behaves: it recomputes the hash and refuses
      // anything that does not match.
      if (p.sha256 !== GOOD_HASH) {
        return { status: 409,
                 body: { detail: { problems: ['the photo did not arrive intact — '
                   + 'the device computed ' + p.sha256.slice(0, 12) + '… and '
                   + GOOD_HASH.slice(0, 12) + '… arrived.'] } } };
      }
      return { status: 201, body: { photo_id: 7 } };
    }),
  };
}

test('a photo with a wrong hash is re-hashed from the file and then goes', async () => {
  await queuePhoto(BAD_HASH);
  const t = transport();

  // First sync: refused, re-hashed, still queued.
  await syncNow({ store, transport: t, force: true });
  let row = await photoRow();
  expect(row!.sync_state).toBe('queued');
  expect(row!.sha256).toBe(GOOD_HASH);
  expect(row!.rehashed_at).not.toBeNull();

  // Second sync: the corrected hash is accepted.
  const r = await syncNow({ store, transport: t, force: true });
  row = await photoRow();
  expect(row!.sync_state).toBe('synced');
  expect(r.photosSent).toBe(1);
});

test('a photo whose bytes really have gone bad is refused, not retried for ever',
  async () => {
    await queuePhoto(BAD_HASH);
    // Re-reading the file produces another wrong answer: the file is damaged.
    setRehash(async () => 'c'.repeat(64));
    const t = transport();

    await syncNow({ store, transport: t, force: true });   // re-hashed once
    await syncNow({ store, transport: t, force: true });   // still wrong

    const row = await photoRow();
    expect(row!.sync_state).toBe('rejected');
    expect(row!.sync_error).toMatch(/did not arrive intact/i);
  });

test('a photo is only ever re-hashed once', async () => {
  await queuePhoto(BAD_HASH);
  let rehashes = 0;
  setRehash(async () => { rehashes++; return 'c'.repeat(64); });
  const t = transport();

  await syncNow({ store, transport: t, force: true });
  await syncNow({ store, transport: t, force: true });
  await syncNow({ store, transport: t, force: true });

  expect(rehashes).toBe(1);
});

test('a photo that was always correct is sent first time and never re-hashed', async () => {
  await queuePhoto(GOOD_HASH);
  let rehashes = 0;
  setRehash(async () => { rehashes++; return GOOD_HASH; });
  const t = transport();

  const r = await syncNow({ store, transport: t, force: true });
  expect(r.photosSent).toBe(1);
  expect(rehashes).toBe(0);
  expect((await photoRow())!.rehashed_at).toBeNull();
});

test('a refusal because the handover has not arrived is NOT treated as a bad hash',
  async () => {
    await queuePhoto(GOOD_HASH);
    let rehashes = 0;
    setRehash(async () => { rehashes++; return GOOD_HASH; });
    const t = transport({
      postPhoto: async () => ({ status: 409, body: { detail: { problems: [
        'no handover has been filed under abc yet — send the handover first'] } } }),
    });

    await syncNow({ store, transport: t, force: true });

    const row = await photoRow();
    expect(row!.sync_state).toBe('queued');
    expect(rehashes).toBe(0);          // ordering, not content
    expect(row!.rehashed_at).toBeNull();
  });

/* ── the decoder the hash is built on ─────────────────────────────────────── */

test('base64 decodes to the right bytes', () => {
  // "Man" -> TWFu, the canonical example, and the padded cases either side.
  expect(Array.from(bytesFromBase64('TWFu'))).toEqual([77, 97, 110]);
  expect(Array.from(bytesFromBase64('TWE='))).toEqual([77, 97]);
  expect(Array.from(bytesFromBase64('TQ=='))).toEqual([77]);
});

test('base64 decoding survives the line breaks a file read can contain', () => {
  expect(Array.from(bytesFromBase64('TW\nFu'))).toEqual([77, 97, 110]);
});

test('bytes that are not text decode exactly', () => {
  // A JPEG starts FF D8 FF — high bytes are where a text-based decoder slips.
  expect(Array.from(bytesFromBase64('/9j/'))).toEqual([0xff, 0xd8, 0xff]);
});

test('hex is lower-case and padded, because the server compares strings', () => {
  const buf = new Uint8Array([0x00, 0x0f, 0xff, 0xa0]).buffer;
  expect(hex(buf)).toBe('000fffa0');
});
