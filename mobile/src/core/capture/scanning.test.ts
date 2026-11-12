/**
 * What a scanned sticker is allowed to be.
 *
 * Scanning is the intended way to pick a machine, because a fleet with MAN-50
 * through MAN-55 in it is one where typing the number picks the wrong machine
 * eventually — and a handover filed against the wrong machine is worse than
 * none, since the right machine then looks checked.
 *
 * So the rule has two halves, and both matter: accept the forms a sticker can
 * legitimately take, and refuse anything ambiguous rather than guess.
 */

import { openTestStore, type TestStore } from './testStore';
import * as masters from './masters';
import { cacheBundle } from './cache';

let store: TestStore;

const bundle = (assets: any[]) => ({
  server_time: new Date().toISOString(),
  assets, operators: [], locations: [], templates: [],
});

const asset = (id: number, fleet: string, qr: string | null) => ({
  asset_id: id, fleet_code: fleet, asset_type_id: 8, asset_type_name: 'Tipper',
  qr_code: qr, meter_uom: 'HOURS', open_defect_count: 0, has_critical_defect: false,
});

beforeEach(async () => {
  store = openTestStore();
  await cacheBundle(store, bundle([
    asset(25, 'MAN-11', 'EQP-2026-0025'),
    asset(26, 'MAN-12', 'EQP-2026-0026'),
    asset(44, 'BD-80-15306', null),          // no reference printed yet
  ]) as any);
});
afterEach(() => store.close());

test('the reference the mine prints finds the machine', async () => {
  const a = await masters.assetByQr(store, 'EQP-2026-0025');
  expect(a?.fleet_code).toBe('MAN-11');
});

test('surrounding whitespace from a scanner is ignored', async () => {
  const a = await masters.assetByQr(store, '  EQP-2026-0025\n');
  expect(a?.fleet_code).toBe('MAN-11');
});

test('a code wrapped in a URL still finds the machine', async () => {
  // Plenty of QR tools emit a URL whether or not you asked for one.
  const a = await masters.assetByQr(store, 'https://mines.example/a/EQP-2026-0026');
  expect(a?.fleet_code).toBe('MAN-12');
});

test('a sticker carrying the fleet code works too', async () => {
  // What a person would print on a label if nobody told them otherwise.
  expect((await masters.assetByQr(store, 'MAN-11'))?.asset_id).toBe(25);
  expect((await masters.assetByQr(store, 'man 11'))?.asset_id).toBe(25);
  expect((await masters.assetByQr(store, 'MAN11'))?.asset_id).toBe(25);
});

test('a machine with no reference is still reachable by its fleet code', async () => {
  const a = await masters.assetByQr(store, 'BD-80-15306');
  expect(a?.asset_id).toBe(44);
});

test('a code that matches nothing is refused, not guessed', async () => {
  expect(await masters.assetByQr(store, 'EQP-9999-0001')).toBeNull();
  expect(await masters.assetByQr(store, 'SOME-OEM-BARCODE')).toBeNull();
});

test('an empty scan is refused', async () => {
  expect(await masters.assetByQr(store, '')).toBeNull();
  expect(await masters.assetByQr(store, '   ')).toBeNull();
});

test('a partial code does NOT match — it is not a search box', async () => {
  // "MAN-1" must not reach MAN-11. Scanning is exact by design; the search
  // box is where partial matching belongs.
  expect(await masters.assetByQr(store, 'MAN-1')).toBeNull();
  expect(await masters.assetByQr(store, 'EQP-2026')).toBeNull();
});

test('two machines answering to one sticker is refused rather than chosen between',
  async () => {
    // A fleet problem. Picking one here would hide it, and a 50% chance of
    // the wrong machine is the thing scanning exists to prevent.
    await cacheBundle(store, bundle([
      asset(1, 'TIP-7', 'DUP-1'),
      asset(2, 'TIP 7', 'DUP-2'),      // same code once separators are ignored
    ]) as any);

    expect(await masters.assetByQr(store, 'TIP7')).toBeNull();
    // Each is still reachable by its own exact reference.
    expect((await masters.assetByQr(store, 'DUP-1'))?.asset_id).toBe(1);
    expect((await masters.assetByQr(store, 'DUP-2'))?.asset_id).toBe(2);
  });
