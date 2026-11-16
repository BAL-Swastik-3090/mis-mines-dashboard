/**
 * What the office changed reaches the people holding the tablet.
 *
 * Tested through syncNow, the way a tablet actually refreshes, as well as the
 * comparison on its own: the masters cache has been quietly disconnected from
 * the sync once already (see sync/masters.test.ts), and a notice list that is
 * only proven in isolation could be disconnected the same way.
 */

import { openTestStore, seed, type TestStore } from './capture/testStore';
import { syncNow, type Transport } from './sync/engine';
import {
  clearAll, diff, KEEP_DAYS, list, markAllRead, MANY, record, unreadCount, type Snapshot,
} from './notices';
import { mastersOlderThan } from './sync/background';

jest.mock('./db/open', () => ({ adapt: jest.fn(), openDb: jest.fn() }));
jest.mock('./sync/transport', () => ({ httpTransport: jest.fn() }));
jest.mock('./sync/enrolment', () => ({ storedBaseUrl: jest.fn(), storedToken: jest.fn() }));

let store: TestStore;
beforeEach(async () => {
  store = openTestStore();
  await seed(store);
});
afterEach(() => store.close());

const tipperList = (version = 1, template_id = 5) => ({
  template_id, asset_type_id: 7, name: 'Tipper handover', version,
  sections: [{ section_id: 50 + template_id, name: 'Brakes', display_order: 1, items: [{
    item_id: 500 + template_id, label: 'Parking brake', response_type: 'OK_CAUTION_NOTOK',
    is_critical: true, requires_photo_if_not_ok: true, default_severity: 'HIGH', display_order: 1,
  }] }],
});

const bundle = (over: Record<string, unknown> = {}) => ({
  server_time: new Date().toISOString(),
  assets: [
    { asset_id: 1, fleet_code: 'TIP-77', asset_type_id: 7, asset_type_name: 'Tipper' },
    { asset_id: 2, fleet_code: 'DOZ-99', asset_type_id: 8, asset_type_name: 'Dozer' },
  ],
  operators: [
    { operator_id: 10, emp_id: 'OPR-10', name: 'Abhimanyu Mohanta' },
    { operator_id: 11, emp_id: 'OPR-11', name: 'Prakash Parida' },
  ],
  locations: [{ location_id: 1, name: 'Kaliapani' }],
  templates: [tipperList()],
  ...over,
});

const serving = (b: () => unknown): Transport => ({
  postSession: async () => ({ status: 201, body: {} }),
  postPhoto: async () => ({ status: 201, body: {} }),
  postLocations: async () => ({ status: 200, body: {} }),
  getBundle: async () => ({ status: 200, body: b() }),
});

const refresh = (b: () => unknown) =>
  syncNow({ store, transport: serving(b), force: true, refreshMasters: true });

describe('through a refresh', () => {
  test('the first refresh on a new tablet announces nothing', async () => {
    const r = await refresh(() => bundle());
    expect(r.mastersRefreshed).toBe(true);
    expect(r.changes).toEqual([]);
    expect(await unreadCount(store)).toBe(0);
  });

  test('a new operator, a new machine and a changed checklist are each recorded once', async () => {
    await refresh(() => bundle());

    const next = bundle({
      operators: [
        { operator_id: 10, emp_id: 'OPR-10', name: 'Abhimanyu Mohanta' },
        { operator_id: 11, emp_id: 'OPR-11', name: 'Prakash Parida' },
        { operator_id: 12, emp_id: 'OPR-12', name: 'Ramesh Sahu' },
      ],
      assets: [
        { asset_id: 1, fleet_code: 'TIP-77', asset_type_id: 7, asset_type_name: 'Tipper' },
        { asset_id: 2, fleet_code: 'DOZ-99', asset_type_id: 8, asset_type_name: 'Dozer' },
        { asset_id: 3, fleet_code: 'GRD-01', asset_type_id: 9, asset_type_name: 'Grader' },
      ],
      templates: [tipperList(2, 6)],
    });
    const r = await refresh(() => next);

    expect(r.changes).toEqual(expect.arrayContaining([
      { kind: 'OPERATOR_ADDED', subject: 'Ramesh Sahu', detail: 'OPR-12', n: 1 },
      { kind: 'MACHINE_ADDED', subject: 'GRD-01', detail: 'Grader', n: 1 },
      { kind: 'CHECKLIST_UPDATED', subject: 'Tipper handover', detail: '2', n: 1 },
    ]));
    expect(r.changes).toHaveLength(3);
    expect(await unreadCount(store)).toBe(3);

    // The same lists again: nothing new, nothing recorded twice.
    const again = await refresh(() => next);
    expect(again.changes).toEqual([]);
    expect(await unreadCount(store)).toBe(3);
  });

  test('somebody taken off the list is said too', async () => {
    await refresh(() => bundle());
    const r = await refresh(() => bundle({
      operators: [{ operator_id: 10, emp_id: 'OPR-10', name: 'Abhimanyu Mohanta' }],
      assets: [{ asset_id: 1, fleet_code: 'TIP-77', asset_type_id: 7, asset_type_name: 'Tipper' }],
    }));
    expect(r.changes).toEqual(expect.arrayContaining([
      { kind: 'OPERATOR_REMOVED', subject: 'Prakash Parida', detail: 'OPR-11', n: 1 },
      { kind: 'MACHINE_REMOVED', subject: 'DOZ-99', detail: 'Dozer', n: 1 },
    ]));
  });

  test('a refresh that fails part-way records no notices and keeps the old lists', async () => {
    await refresh(() => bundle());
    const r = await refresh(() => bundle({
      operators: [
        { operator_id: 10, emp_id: 'OPR-10', name: 'Abhimanyu Mohanta' },
        { operator_id: 99, emp_id: 'OPR-99', name: 'New Person' },
      ],
      // A machine with no fleet code cannot be stored: the transaction fails.
      assets: [{ asset_id: 1, fleet_code: null, asset_type_id: 7, asset_type_name: 'Tipper' }],
    }));
    expect(r.mastersRefreshed).toBe(false);
    expect(r.changes).toEqual([]);
    expect(await unreadCount(store)).toBe(0);
    const ops = await store.getAllAsync<{ name: string }>(`SELECT name FROM cached_operator`);
    expect(ops.map((o) => o.name).sort()).toEqual(['Abhimanyu Mohanta', 'Prakash Parida']);
  });
});

describe('the list', () => {
  test('newest first; seen once the screen is opened; cleared on request', async () => {
    await record(store, [{ kind: 'OPERATOR_ADDED', subject: 'A', detail: '1', n: 1 }],
                 new Date('2026-11-16T08:00:00Z'));
    await record(store, [{ kind: 'MACHINE_ADDED', subject: 'M', detail: 'Tipper', n: 1 }],
                 new Date('2026-11-16T09:00:00Z'));
    const rows = await list(store);
    expect(rows.map((r) => r.subject)).toEqual(['M', 'A']);
    expect(await unreadCount(store)).toBe(2);

    await markAllRead(store);
    expect(await unreadCount(store)).toBe(0);
    expect(await list(store)).toHaveLength(2);

    await clearAll(store);
    expect(await list(store)).toHaveLength(0);
  });

  test(`kept for ${KEEP_DAYS} days`, async () => {
    const now = new Date('2026-11-16T08:00:00Z');
    await record(store, [{ kind: 'OPERATOR_ADDED', subject: 'Old', detail: '1', n: 1 }],
                 new Date(now.getTime() - (KEEP_DAYS + 1) * 86_400_000));
    await record(store, [{ kind: 'OPERATOR_ADDED', subject: 'New', detail: '2', n: 1 }], now);
    expect((await list(store)).map((r) => r.subject)).toEqual(['New']);
  });
});

describe('the comparison', () => {
  const before: Snapshot = {
    operators: new Map([[1, { name: 'A', emp_id: 'E1' }]]),
    machines: new Map([[1, { fleet_code: 'TIP-1', type: 'Tipper' }]]),
    checklists: new Map([[7, { template_id: 5, name: 'Tipper handover', version: 1 }]]),
  };

  test('a checklist for a type that had none is a new one; a type that loses its list is said', () => {
    const c = diff(before, {
      operators: [{ operator_id: 1, emp_id: 'E1', name: 'A' }],
      assets: [{ asset_id: 1, fleet_code: 'TIP-1', asset_type_name: 'Tipper' }],
      templates: [{ template_id: 9, asset_type_id: 9, name: 'Grader handover', version: 1 }],
    });
    expect(c).toEqual([
      { kind: 'CHECKLIST_ADDED', subject: 'Grader handover', detail: '1', n: 1 },
      { kind: 'CHECKLIST_REMOVED', subject: 'Tipper handover', detail: '1', n: 1 },
    ]);
  });

  test(`more than ${MANY} of one kind is one line with a count`, () => {
    const many = Array.from({ length: MANY + 5 }, (_, i) =>
      ({ operator_id: 100 + i, emp_id: `E${i}`, name: `P${i}` }));
    const c = diff(before, {
      operators: [{ operator_id: 1, emp_id: 'E1', name: 'A' }, ...many],
      assets: [{ asset_id: 1, fleet_code: 'TIP-1', asset_type_name: 'Tipper' }],
      templates: [{ template_id: 5, asset_type_id: 7, name: 'Tipper handover', version: 1 }],
    });
    expect(c).toEqual([{ kind: 'OPERATOR_ADDED', subject: null, detail: null, n: MANY + 5 }]);
  });

  test('nothing changed is nothing to say', () => {
    expect(diff(before, {
      operators: [{ operator_id: 1, emp_id: 'E1', name: 'A' }],
      assets: [{ asset_id: 1, fleet_code: 'TIP-1', asset_type_name: 'Tipper' }],
      templates: [{ template_id: 5, asset_type_id: 7, name: 'Tipper handover', version: 1 }],
    })).toEqual([]);
  });
});

describe('the background refresh', () => {
  test('is due when the lists were never fetched, or are older than asked', async () => {
    const now = Date.parse('2026-11-16T10:00:00Z');
    expect(await mastersOlderThan(store, 30 * 60_000, now)).toBe(true);
    await store.runAsync(`INSERT INTO meta (key, value) VALUES ('last_sync_at', ?)`,
                         ['2026-11-16T09:50:00Z']);
    expect(await mastersOlderThan(store, 30 * 60_000, now)).toBe(false);
    expect(await mastersOlderThan(store, 5 * 60_000, now)).toBe(true);
  });
});
