/**
 * Which fix is allowed to stand as "where this was taken".
 *
 * The rule has two halves and both are safety matters: use a recent fix rather
 * than record nothing (half the photographs on record had no position because
 * nothing asked the tracker), and refuse a stale one rather than record a place
 * the machine was not (a position in a safety record is read as a fact).
 */

import { pickFix, lastQueuedFix, MAX_AGE_S } from './recent';
import { openTestStore, type TestStore } from '../capture/testStore';

const NOW = Date.parse('2026-11-13T10:00:00+05:30');
const agoS = (s: number) => NOW - s * 1000;

const at = (s: number, over: Partial<{ lat: number; lon: number; accuracyM: number | null }> = {}) =>
  ({ lat: 21.034675, lon: 85.758628, accuracyM: 20, atMs: agoS(s), ...over });

test('a live fix wins, and reads as the shutter position', () => {
  const got = pickFix([at(0), at(90)], NOW);
  expect(got!.ageS).toBe(0);
});

test('with no live fix, a recent one is used rather than nothing', () => {
  // The whole point of the file. Before this, the answer here was null and the
  // photograph went into the record with no position at all.
  const got = pickFix([null, at(90, { lat: 21.1, lon: 85.7 })], NOW);
  expect(got).not.toBeNull();
  expect(got!.lat).toBeCloseTo(21.1);
  expect(got!.ageS).toBe(90);
});

test('the freshest is chosen, not the most accurate', () => {
  // A tight fix from three minutes ago is a tight fix of somewhere else.
  const got = pickFix([at(100, { accuracyM: 5 }), at(10, { accuracyM: 60 })], NOW);
  expect(got!.ageS).toBe(10);
  expect(got!.accuracyM).toBe(60);
});

test('a stale fix is refused — no position beats a wrong one', () => {
  expect(pickFix([at(MAX_AGE_S + 1)], NOW)).toBeNull();
  expect(pickFix([at(3600)], NOW)).toBeNull();
});

test('the boundary itself is allowed', () => {
  expect(pickFix([at(MAX_AGE_S)], NOW)).not.toBeNull();
});

test('null island is not a position', () => {
  // What a broken location layer returns when it returns something.
  expect(pickFix([{ lat: 0, lon: 0, accuracyM: 5, atMs: NOW }], NOW)).toBeNull();
});

test('a nonsense coordinate is refused', () => {
  expect(pickFix([{ lat: NaN, lon: 85.7, accuracyM: 5, atMs: NOW }], NOW)).toBeNull();
});

test('a fix from the far future is refused, a small skew is not', () => {
  expect(pickFix([at(-5)], NOW)).not.toBeNull();     // clock a few seconds ahead
  expect(pickFix([at(-7200)], NOW)).toBeNull();      // clock badly wrong
});

test('nothing available stays null', () => {
  expect(pickFix([null, undefined], NOW)).toBeNull();
  expect(pickFix([], NOW)).toBeNull();
});

test('missing accuracy is carried through as null, not invented', () => {
  const got = pickFix([at(30, { accuracyM: null })], NOW);
  expect(got!.accuracyM).toBeNull();
});

// ── the queue the tracker fills ─────────────────────────────────────────────
describe('the tracker’s own queue', () => {
  let store: TestStore;
  beforeEach(() => { store = openTestStore(); });
  afterEach(() => store.close());

  const queue = (uuid: string, recordedAt: string, lat: number, acc: number | null) =>
    store.runAsync(
      `INSERT INTO location_queue (client_uuid, recorded_at, lat, lon, accuracy_m, source)
       VALUES (?, ?, ?, ?, ?, 'BACKGROUND')`,
      [uuid, recordedAt, lat, 85.758628, acc]);

  test('an empty queue is null, not a crash', async () => {
    expect(await lastQueuedFix(store)).toBeNull();
  });

  test('the newest queued fix is the one returned', async () => {
    await queue('a', '2026-11-13T09:55:00+05:30', 21.01, 30);
    await queue('b', '2026-11-13T09:59:30+05:30', 21.09, 12);
    await queue('c', '2026-11-13T09:58:00+05:30', 21.05, 8);

    const got = await lastQueuedFix(store);
    expect(got!.lat).toBeCloseTo(21.09);
    expect(got!.accuracyM).toBe(12);
  });

  test('a queued fix flows through the rule and lands on the photograph',
    async () => {
      // Asserted end to end, because every geotag bug in this project survived
      // a passing unit test of the piece just before the one that was wrong.
      await queue('a', new Date(agoS(45)).toISOString(), 21.0347, 25);

      const got = pickFix([null, await lastQueuedFix(store)], NOW);
      expect(got!.lat).toBeCloseTo(21.0347);
      expect(got!.ageS).toBe(45);
    });

  test('a queue holding only yesterday’s fixes yields no position', async () => {
    await queue('old', '2026-11-12T16:49:00+05:30', 21.0347, 25);
    expect(pickFix([await lastQueuedFix(store)], NOW)).toBeNull();
  });
});
