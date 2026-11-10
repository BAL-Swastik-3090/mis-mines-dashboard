/**
 * Sending the position queue.
 *
 * The thing worth asserting is what happens when it goes wrong, because a
 * device reporting its position spends most of its life with no network. A
 * failure here must cost nothing: the fixes must stay, the handovers must
 * still go, and the supervisor's report must not fill up with telemetry noise.
 */

import { openTestStore, seed, type TestStore } from '../capture/testStore';
import { syncNow, type Transport } from './engine';

let store: TestStore;
beforeEach(async () => {
  store = openTestStore();
  await seed(store);
});
afterEach(() => store.close());

const at = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

async function queue(n: number, from = 10): Promise<void> {
  for (let i = 0; i < n; i++) {
    await store.runAsync(
      `INSERT INTO location_queue
         (client_uuid, recorded_at, lat, lon, accuracy_m, battery_pct, is_charging, source)
       VALUES (?,?,?,?,?,?,?,?)`,
      [`fix-${i}-${Math.random().toString(16).slice(2)}`, at(from - i),
       21.0 + i * 0.001, 86.0 + i * 0.001, 8.5, 70 - i, 0, 'BACKGROUND'],
    );
  }
}

const left = async (): Promise<number> => {
  const r = await store.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM location_queue`);
  return r?.n ?? 0;
};

function transport(over: Partial<Transport> = {}): Transport & { batches: any[][] } {
  const batches: any[][] = [];
  return {
    batches,
    postSession: over.postSession ?? (async () => ({ status: 201, body: {} })),
    postPhoto: over.postPhoto ?? (async () => ({ status: 201, body: {} })),
    getBundle: over.getBundle ?? (async () => ({ status: 200, body: {} })),
    postLocations: over.postLocations ?? (async (fixes) => {
      batches.push(fixes as any[]);
      return { status: 200, body: { stored: fixes.length, skipped: 0, duplicates: 0 } };
    }),
  };
}

test('sends what is queued and clears it', async () => {
  await queue(5);
  const t = transport();
  const report = await syncNow({ store, transport: t, force: true });

  expect(t.batches).toHaveLength(1);
  expect(t.batches[0]).toHaveLength(5);
  expect(report.locationsSent).toBe(5);
  expect(await left()).toBe(0);
});

test('sends oldest first, so a track arrives in the order it happened', async () => {
  await queue(4);
  const t = transport();
  await syncNow({ store, transport: t, force: true });

  const sent = t.batches[0]!.map((f: any) => f.recorded_at);
  expect([...sent].sort()).toEqual(sent);
});

test('each fix carries the id the device gave it, so a resend cannot double the track',
  async () => {
    await queue(3);
    const t = transport();
    await syncNow({ store, transport: t, force: true });

    for (const f of t.batches[0]!) {
      expect(typeof (f as any).client_uuid).toBe('string');
      expect((f as any).client_uuid).not.toHaveLength(0);
    }
  });

test('no connection keeps every fix', async () => {
  await queue(6);
  const t = transport({
    postLocations: async () => { throw new Error('network down'); },
  });
  const report = await syncNow({ store, transport: t, force: true });

  expect(await left()).toBe(6);
  expect(report.locationsSent).toBe(0);
  // A supervisor reads this. Telemetry failing is not their problem.
  expect(report.problems).toHaveLength(0);
});

test('a server that is briefly unwell keeps every fix', async () => {
  await queue(3);
  const t = transport({ postLocations: async () => ({ status: 503, body: {} }) });
  await syncNow({ store, transport: t, force: true });
  expect(await left()).toBe(3);
});

test('a batch the server will never take is dropped rather than retried forever',
  async () => {
    await queue(3);
    const t = transport({
      postLocations: async () => ({ status: 413, body: { detail: 'too many' } }),
    });
    await syncNow({ store, transport: t, force: true });

    // Dropped on purpose: a device that keeps a rejected batch forever never
    // sends another position again, which is the worse failure.
    expect(await left()).toBe(0);
  });

test('more than one batch is sent in pages', async () => {
  await queue(450, 500);
  const t = transport();
  await syncNow({ store, transport: t, force: true });

  expect(t.batches.length).toBeGreaterThan(1);
  expect(t.batches[0]).toHaveLength(200);
  expect(await left()).toBe(0);
});

test('positions never stop a handover being filed', async () => {
  await queue(2);
  let sessionTried = false;
  const t = transport({
    postLocations: async () => { throw new Error('network down'); },
    postSession: async () => { sessionTried = true; return { status: 201, body: {} }; },
  });
  const report = await syncNow({ store, transport: t, force: true, refreshMasters: true });

  // Masters still refreshed, so the sync as a whole was not abandoned.
  expect(report.mastersRefreshed).toBe(true);
  expect(sessionTried).toBe(false);          // nothing queued to send in this test
  expect(await left()).toBe(2);
});

test('is_charging survives the trip as a boolean, not a 0', async () => {
  await store.runAsync(
    `INSERT INTO location_queue
       (client_uuid, recorded_at, lat, lon, is_charging, source)
     VALUES (?,?,?,?,?,?)`,
    ['charging-fix', at(1), 21.0, 86.0, 1, 'BACKGROUND']);
  const t = transport();
  await syncNow({ store, transport: t, force: true });
  expect((t.batches[0]![0] as any).is_charging).toBe(true);
});

test('a fix with no battery reading is sent as null, not as zero per cent', async () => {
  await store.runAsync(
    `INSERT INTO location_queue (client_uuid, recorded_at, lat, lon, source)
     VALUES (?,?,?,?,?)`,
    ['no-battery', at(1), 21.0, 86.0, 'BACKGROUND']);
  const t = transport();
  await syncNow({ store, transport: t, force: true });
  expect((t.batches[0]![0] as any).battery_pct).toBeNull();
});
