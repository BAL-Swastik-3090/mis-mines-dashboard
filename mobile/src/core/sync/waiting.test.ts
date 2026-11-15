import { openTestStore, seed, type TestStore } from '../capture/testStore';
import * as masters from '../capture/masters';
import * as session from '../capture/session';
import { waiting } from './engine';
import { isLocked, tryLock, unlock } from './lock';

describe('one send at a time', () => {
  afterEach(() => unlock());

  it('refuses a second sender while the first is going', () => {
    expect(tryLock(1000)).toBe(true);
    expect(tryLock(2000)).toBe(false);
    unlock();
    expect(tryLock(3000)).toBe(true);
  });

  it('does not stay locked for ever when a send was killed mid-way', () => {
    expect(tryLock(0)).toBe(true);
    expect(isLocked(60_000)).toBe(true);
    expect(tryLock(4 * 60_000)).toBe(true);     // three minutes is stale
  });
});

describe('what is waiting on the network', () => {
  let store: TestStore;
  beforeEach(async () => { store = openTestStore(); await seed(store); });
  afterEach(() => store.close());

  const uuid = '11111111-1111-4111-8111-111111111111';
  const photo = (id: string) => store.runAsync(`INSERT INTO photo
      (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at)
     VALUES (?, ?, 101, '/tmp/p.jpg', 1, 'x', '2026-11-15T10:00:00Z')`, [id, uuid]);

  it('does not count a photograph on a handover nobody has finished', async () => {
    const a = (await masters.asset(store, 25))!;
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uuid });
    await photo('p1');
    // Counting it would keep the tablet trying to send something it is not
    // allowed to, and the screen blaming the network for an unfinished form.
    expect(await waiting(store)).toMatchObject({ sessions: 0, photos: 0, total: 0 });
  });

  it('counts the handover and its photograph once it is confirmed', async () => {
    const a = (await masters.asset(store, 25))!;
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uuid });
    await photo('p1');
    await store.runAsync(`UPDATE session SET sync_state = 'queued' WHERE client_uuid = ?`, [uuid]);
    expect(await waiting(store)).toMatchObject({ sessions: 1, photos: 1 });
  });

  it('counts positions the office is waiting for', async () => {
    await store.runAsync(`INSERT INTO location_queue (client_uuid, recorded_at, lat, lon)
                          VALUES ('l1', '2026-11-15T10:00:00Z', 21.0, 85.7)`);
    expect(await waiting(store)).toMatchObject({ positions: 1, total: 1 });
  });
});
