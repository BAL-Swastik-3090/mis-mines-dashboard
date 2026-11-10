/**
 * Refreshing the machine list, asserted at the cache rather than at the wire.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Because its absence cost a fortnight. `cacheBundle` had thorough tests and a
 * contract test against the real server, and both passed throughout: they
 * proved the server's bundle COULD be stored. Nothing asserted that syncing
 * actually stored it — and it did not. The engine fetched the bundle, set
 * `mastersRefreshed`, wrote a success line to the sync log and discarded the
 * data, so every device ever set up held an empty machine list.
 *
 * So every test here ends by reading the cache. A sync that reports success
 * and leaves the device empty is the failure being guarded against, and it is
 * invisible to any assertion made on the request.
 */

import { openTestStore, seed, type TestStore } from '../capture/testStore';
import * as masters from '../capture/masters';
import { syncNow, type Transport } from './engine';

let store: TestStore;
beforeEach(async () => {
  store = openTestStore();
  await seed(store);
});
afterEach(() => store.close());

const bundle = (over: Record<string, unknown> = {}) => ({
  server_time: new Date().toISOString(),
  assets: [
    { asset_id: 1, fleet_code: 'TIP-77', asset_type_id: 7,
      asset_type_name: 'Tipper', meter_uom: 'km', open_defect_count: 0,
      has_critical_defect: false },
    { asset_id: 2, fleet_code: 'DOZ-99', asset_type_id: 8,
      asset_type_name: 'Dozer', meter_uom: 'hr', open_defect_count: 2,
      has_critical_defect: true },
  ],
  operators: [{ operator_id: 10, emp_id: '3090', name: 'A Operator' }],
  locations: [{ location_id: 1, name: 'Kaliapani' }],
  templates: [{
    template_id: 5, asset_type_id: 7, name: 'Tipper walk-round', version: 2,
    sections: [{
      section_id: 50, name: 'Brakes', display_order: 1,
      items: [{
        item_id: 500, label: 'Parking brake', response_type: 'OK_NOT_OK',
        is_critical: true, requires_photo_if_not_ok: true,
        default_severity: 'HIGH', display_order: 1,
      }],
    }],
  }],
  ...over,
});

function transport(over: Partial<Transport> = {}): Transport {
  return {
    postSession: over.postSession ?? (async () => ({ status: 201, body: {} })),
    postPhoto: over.postPhoto ?? (async () => ({ status: 201, body: {} })),
    postLocations: over.postLocations ?? (async () => ({ status: 200, body: {} })),
    getBundle: over.getBundle ?? (async () => ({ status: 200, body: bundle() })),
  };
}

test('a sync that refreshes masters leaves the machines ON THE DEVICE', async () => {
  // The assertion that was missing. Everything else here is a variation of it.
  // Asserted on CONTENT, not a count: the device starts with seeded machines,
  // and a count alone cannot tell "the bundle was stored" from "nothing
  // happened", which is exactly the confusion that hid the bug.
  expect(await masters.assets(store, 'TIP-77')).toHaveLength(0);

  const report = await syncNow({
    store, transport: transport(), force: true, refreshMasters: true });

  expect(await masters.assets(store, 'TIP-77')).toHaveLength(1);
  expect(await masters.assetCount(store)).toBe(2);
  expect(report.machinesCached).toBe(2);
  expect(report.mastersRefreshed).toBe(true);
});

test('the machines can then be found by the picker', async () => {
  await syncNow({ store, transport: transport(), force: true, refreshMasters: true });

  // Typed the way somebody types it, with a space instead of the hyphen.
  const found = await masters.assets(store, 'tip 77');
  expect(found).toHaveLength(1);
  expect(found[0]!.fleet_code).toBe('TIP-77');
});

test('a checklist arrives with the machine it belongs to', async () => {
  await syncNow({ store, transport: transport(), force: true, refreshMasters: true });

  const t = await masters.resolveTemplate(store, 7);
  expect(t).not.toBeNull();
  expect(t!.items).toHaveLength(1);
  expect(t!.items[0]!.label).toBe('Parking brake');
});

test('mastersRefreshed means STORED, not fetched', async () => {
  // The exact confusion behind the bug: a 200 whose body is useless must not
  // be reported as a successful refresh.
  const report = await syncNow({
    store,
    transport: transport({ getBundle: async () => ({ status: 200, body: {} }) }),
    force: true, refreshMasters: true,
  });

  expect(report.mastersRefreshed).toBe(false);
  expect(report.problems.join(' ')).toMatch(/no machine list/i);
  // Nothing was stored, and what the device already had is untouched.
  expect(await masters.assets(store, 'TIP-77')).toHaveLength(0);
  expect(await masters.assets(store, 'MAN-11')).toHaveLength(1);
});

test('a refresh that fails leaves the machines it already had', async () => {
  await syncNow({ store, transport: transport(), force: true, refreshMasters: true });
  expect(await masters.assetCount(store)).toBe(2);

  const report = await syncNow({
    store,
    transport: transport({ getBundle: async () => ({ status: 503, body: null }) }),
    force: true, refreshMasters: true,
  });

  // A failed refresh must never empty a device that is about to go down a pit.
  expect(await masters.assetCount(store)).toBe(2);
  expect(report.mastersRefreshed).toBe(false);
  expect(report.problems.join(' ')).toMatch(/could not refresh/i);
});

test('a second refresh replaces rather than duplicates', async () => {
  await syncNow({ store, transport: transport(), force: true, refreshMasters: true });
  await syncNow({ store, transport: transport(), force: true, refreshMasters: true });
  expect(await masters.assetCount(store)).toBe(2);
});

test('a machine the mine has sold is gone after the next sync', async () => {
  await syncNow({ store, transport: transport(), force: true, refreshMasters: true });

  const fewer = bundle({ assets: [bundle().assets[0]] });
  await syncNow({
    store,
    transport: transport({ getBundle: async () => ({ status: 200, body: fewer }) }),
    force: true, refreshMasters: true,
  });

  expect(await masters.assetCount(store)).toBe(1);
  expect(await masters.assets(store, 'DOZ-99')).toHaveLength(0);
});

test('a device whose clock is well out is told so', async () => {
  const skewed = bundle({
    server_time: new Date(Date.now() - 45 * 60_000).toISOString(),
  });
  const report = await syncNow({
    store,
    transport: transport({ getBundle: async () => ({ status: 200, body: skewed }) }),
    force: true, refreshMasters: true,
  });

  expect(report.clockDriftSeconds).toBeGreaterThan(2000);
  expect(report.problems.join(' ')).toMatch(/clock/i);
  // Still stored: a wrong clock is a warning, not a reason to leave a device
  // with no machine list.
  expect(await masters.assetCount(store)).toBe(2);
});

test('a clock that agrees produces no warning', async () => {
  const report = await syncNow({
    store, transport: transport(), force: true, refreshMasters: true });
  expect(Math.abs(report.clockDriftSeconds ?? 0)).toBeLessThan(120);
  expect(report.problems).toHaveLength(0);
});

test('not asking for masters leaves them alone', async () => {
  await syncNow({ store, transport: transport(), force: true, refreshMasters: true });
  const report = await syncNow({ store, transport: transport(), force: true });

  expect(report.machinesCached).toBeNull();
  expect(await masters.assetCount(store)).toBe(2);
});
