/**
 * The capture flow, against a real SQLite database.
 *
 * What is actually being asserted here is the set of decisions a handover
 * depends on: that an interrupted walk-round resumes instead of restarting,
 * that a failed critical check still gets recorded rather than discarded, that
 * re-answering an item overwrites, and that an operator on a machine he is not
 * signed off on is warned and not stopped.
 */

import { openTestStore, seed, type TestStore } from './testStore';
import * as masters from './masters';
import * as session from './session';
import { localDay } from './shifts';
import type { ChecklistItem } from '../evaluation';

/** Stable, valid UUIDs per test name, so assertions can still refer to 'u1'. */
const UU: Record<string, string> = {
  u1: '11111111-1111-4111-8111-111111111111',
  u2: '22222222-2222-4222-8222-222222222222',
  u7: '77777777-7777-4777-8777-777777777777',
  u8: '88888888-8888-4888-8888-888888888888',
  u9: '99999999-9999-4999-8999-999999999999',
};
const uu = (k: string): string => UU[k] ?? k;

let store: TestStore;
beforeEach(async () => {
  store = openTestStore();
  await seed(store);
});
afterEach(() => store.close());

const MAN11 = async () => {
  const a = await masters.asset(store, 25);
  if (!a) throw new Error('fixture missing');
  return a;
};
const items = async (): Promise<ChecklistItem[]> => {
  const t = await masters.resolveTemplate(store, 1, '2026-11-09');
  return t?.items ?? [];
};
const byId = (list: ChecklistItem[], id: number): ChecklistItem => {
  const i = list.find((x) => x.itemId === id);
  if (!i) throw new Error(`no item ${id}`);
  return i;
};

/** Answer everything cleanly, so a test can then spoil one thing on purpose. */
async function answerAllClean(key: string, list: ChecklistItem[]): Promise<void> {
  const uuid = uu(key);
  for (const item of list) {
    if (item.responseType === 'NUMERIC') {
      const mid = ((item.minValue ?? 0) + (item.maxValue ?? 100)) / 2;
      await session.answer(store, uuid, item, { itemId: item.itemId, numericValue: mid });
    } else if (item.responseType === 'LEVEL') {
      await session.answer(store, uuid, item, { itemId: item.itemId, answer: 'NORMAL' });
    } else {
      await session.answer(store, uuid, item, { itemId: item.itemId, answer: 'OK' });
    }
  }
}

describe('which checklist a machine gets', () => {
  it('resolves the template for its type', async () => {
    const t = await masters.resolveTemplate(store, 1, '2026-11-09');
    expect(t?.name).toBe('Tipper daily handover');
    expect(t?.items.map((i) => i.itemId)).toEqual([101, 102, 103, 104]);
  });

  it('groups the items into the sections they are asked in', async () => {
    const t = await masters.resolveTemplate(store, 1, '2026-11-09');
    expect(t?.sections.map((s) => s.name)).toEqual(['Brakes and steering', 'Fluids']);
    expect(t?.sections[0]?.items.map((i) => i.label))
      .toEqual(['Service brake response', 'Parking brake']);
  });

  it('prefers a plant-scoped template over an unscoped one, as the server does', async () => {
    const s2 = openTestStore();
    await seed(s2, { withPlantOverride: true });
    const t = await masters.resolveTemplate(s2, 1, '2026-11-09');
    expect(t?.template_id).toBe(2);
    s2.close();
  });

  it('ignores a template that is not yet effective', async () => {
    const t = await masters.resolveTemplate(store, 1, '2025-06-01');
    expect(t).toBeNull();
  });

  it('returns nothing for a machine type with no checklist on this tablet', async () => {
    expect(await masters.resolveTemplate(store, 99, '2026-11-09')).toBeNull();
  });

  it('carries the gauge range and the criticality the rules need', async () => {
    const air = byId(await items(), 103);
    expect(air).toMatchObject({ unit: 'psi', minValue: 80, maxValue: 120, isCritical: true });
  });
});

describe('finding a machine', () => {
  it('is found by the QR sticker on the cab', async () => {
    expect((await masters.assetByQr(store, 'QR-MAN-11'))?.fleet_code).toBe('MAN-11');
  });

  it('puts the machines with a critical defect at the top of the list', async () => {
    const list = await masters.assets(store);
    expect(list.map((a) => a.fleet_code)).toEqual(['MAN-11', 'BD-80-15306']);
  });

  it('searches on fleet code, case-insensitively', async () => {
    expect((await masters.assets(store, 'man')).map((a) => a.fleet_code)).toEqual(['MAN-11']);
  });
});

describe('starting a handover', () => {
  it('writes the draft before the first question is answered', async () => {
    const { session: s, resumed } = await session.startDraft({
      store, asset: await MAN11(), sessionType: 'START_HANDOVER', clientUuid: uu('u1'),
    });
    expect(resumed).toBe(false);
    expect(s.sync_state).toBe('draft');
    expect(s.status).toBe('DRAFT');
    expect(s.template_id).toBe(1);
    expect(s.meter_uom).toBe('HOURS');
  });

  it('refuses a client_uuid that is not a UUID, at the cab rather than at the gate', async () => {
    await expect(session.startDraft({
      store, asset: await MAN11(), sessionType: 'START_HANDOVER',
      clientUuid: 'contract-1794221456582-8vy2ws',
    })).rejects.toThrow(/must be a UUID/);
  });

  it('resumes an interrupted walk-round rather than starting a second one', async () => {
    const a = await MAN11();
    const first = await session.startDraft({
      store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const again = await session.startDraft({
      store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u2') });

    expect(again.resumed).toBe(true);
    expect(again.session.client_uuid).toBe(first.session.client_uuid);
    // And crucially has not burnt a sequence number, which would make the
    // record look like two handovers happened.
    expect(again.session.sequence_no).toBe(1);
    const n = await store.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session');
    expect(n?.n).toBe(1);
  });

  it('numbers the next handover of the same kind in sequence', async () => {
    const a = await MAN11();
    const first = await session.startDraft({
      store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    await store.runAsync(`UPDATE session SET sync_state = 'queued' WHERE client_uuid = ?`,
                         [first.session.client_uuid]);
    const second = await session.startDraft({
      store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u2') });
    expect(second.resumed).toBe(false);
    expect(second.session.sequence_no).toBe(2);
  });

  it('keeps a start and an end handover apart', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const end = await session.startDraft({
      store, asset: a, sessionType: 'END_HANDOVER', clientUuid: uu('u2') });
    expect(end.resumed).toBe(false);
    expect(end.session.sequence_no).toBe(1);
  });

  it('records how stale the tablet’s masters were', async () => {
    const s3 = openTestStore();
    await seed(s3, { cachedHoursAgo: 50 });
    const a = await masters.asset(s3, 25);
    const { session: s } = await session.startDraft({
      store: s3, asset: a!, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    expect(s.master_cache_age_hours).toBe(50);
    s3.close();
  });
});

describe('identifying the operator', () => {
  it('records who attested and how', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const op = await masters.operatorByEmpId(store, '4101');
    await session.identify(store, uu('u1'), op!, 'PIN', a);

    const s = await session.byUuid(store, uu('u1'));
    expect(s).toMatchObject({ operator_id: 7, operator_emp_id: '4101', identified_by: 'PIN' });
  });

  it('warns about a machine he is not signed off on, and does not stop him', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const op = await masters.operatorByEmpId(store, '4102');   // competent on nothing

    const advisories = await session.identify(store, uu('u1'), op!, 'EMPNO', a);
    expect(advisories.map((x) => x.kind)).toContain('COMPETENCY');
    // Recorded, not refused.
    expect((await session.byUuid(store, uu('u1')))?.operator_id).toBe(8);
  });

  it('says so when the machine is already held by a critical defect', async () => {
    const a = await MAN11();
    const op = await masters.operatorByEmpId(store, '4101');
    const advisories = session.advisoriesFor(op, a);
    expect(advisories.map((x) => x.kind)).toContain('MACHINE_HELD');
  });

  it('counts open defects without calling them critical', async () => {
    const dozer = await masters.asset(store, 44);
    await store.runAsync(`UPDATE cached_asset SET open_defect_count = 3 WHERE asset_id = 44`);
    const again = await masters.asset(store, 44);
    const op = await masters.operatorByEmpId(store, '4101');
    const kinds = session.advisoriesFor(op, again!).map((x) => x.kind);
    expect(kinds).toContain('OPEN_DEFECTS');
    expect(kinds).not.toContain('MACHINE_HELD');
    expect(dozer?.has_critical_defect).toBe(0);
  });

  it('treats a malformed competency cache as no competency, not as a crash', async () => {
    await store.runAsync(`UPDATE cached_operator SET competent_type_ids = 'not json' WHERE operator_id = 7`);
    const op = await masters.operator(store, 7);
    const kinds = session.advisoriesFor(op, await MAN11()).map((x) => x.kind);
    expect(kinds).toContain('COMPETENCY');
  });

  it('can identify an operator the mine has no employee number for', async () => {
    // 32 of 269 real operators are in this position, and the server allows a
    // session with a null operator_emp_id, so the tablet must not be the thing
    // that makes them unusable.
    await store.runAsync(
      `INSERT INTO cached_operator
         (operator_id, emp_id, name, competent_type_ids, cached_at)
       VALUES (9, NULL, 'ADITYA PAPA ROUT', '[1]', '2026-11-09T10:00:00Z')`);
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });

    const byName = await masters.operatorsByName(store, 'aditya');
    expect(byName.map((o) => o.operator_id)).toEqual([9]);
    expect(byName[0]?.emp_id).toBeNull();

    await session.identify(store, uu('u1'), byName[0]!, 'BADGE', a);
    const s = await session.byUuid(store, uu('u1'));
    expect(s).toMatchObject({ operator_id: 9, operator_emp_id: null });
  });

  it('does not match an operator on an empty employee number', async () => {
    await store.runAsync(
      `INSERT INTO cached_operator (operator_id, emp_id, name, competent_type_ids, cached_at)
       VALUES (9, NULL, 'ADITYA PAPA ROUT', '[]', '2026-11-09T10:00:00Z')`);
    expect(await masters.operatorByEmpId(store, '')).toBeNull();
    expect(await masters.operatorByEmpId(store, '   ')).toBeNull();
  });

  it('flags an expired competency separately from no competency', async () => {
    await store.runAsync(
      `UPDATE cached_operator SET competency_valid_to = '2026-01-31' WHERE operator_id = 7`);
    const op = await masters.operator(store, 7);
    const kinds = session.advisoriesFor(op, await MAN11(), new Date('2026-11-09'))
      .map((x) => x.kind);
    expect(kinds).toContain('COMPETENCY_EXPIRED');
    expect(kinds).not.toContain('COMPETENCY');
  });
});

describe('answering', () => {
  it('stores the verdict resolved at capture, not at read time', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const air = byId(await items(), 103);
    await session.answer(store, uu('u1'), air,
                         { itemId: 103, numericValue: 60, remark: 'low', photoCount: 1 });

    const [r] = await session.responses(store, uu('u1'));
    expect(r).toMatchObject({ item_id: 103, numeric_value: 60, in_range: 0, severity: 'CRITICAL' });
    // The label is COPIED, so re-wording the item later cannot change what this
    // record says it answered.
    expect(r?.item_label).toBe('Air pressure');
  });

  it('overwrites when an item is answered again, rather than duplicating it', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const brakes = byId(await items(), 101);
    await session.answer(store, uu('u1'), brakes,
                         { itemId: 101, answer: 'NOT_OK', remark: 'spongy', photoCount: 1 });
    await session.answer(store, uu('u1'), brakes, { itemId: 101, answer: 'OK' });

    const rows = await session.responses(store, uu('u1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ answer: 'OK', severity: null });
  });

  it('leaves an unbounded gauge unjudged', async () => {
    const a = await MAN11();
    await store.runAsync(
      `UPDATE cached_item SET min_value = NULL, max_value = NULL WHERE item_id = 103`);
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const air = byId(await items(), 103);
    await session.answer(store, uu('u1'), air, { itemId: 103, numericValue: 9999 });

    const [r] = await session.responses(store, uu('u1'));
    expect(r?.in_range).toBeNull();
    expect(r?.severity).toBeNull();
  });
});

describe('confirming', () => {
  const setUp = async (key = 'u1') => {
    const uuid = uu(key);
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uuid });
    const op = await masters.operatorByEmpId(store, '4101');
    await session.identify(store, uuid, op!, 'PIN', a);
    const handedBy = await masters.operatorByEmpId(store, '4102');
    await session.setCounterpart(store, uuid, handedBy!);
    await session.setReadings(store, uuid, { meterReading: 7700 });
    return { asset: a, list: await items() };
  };

  it('refuses while anything is unanswered, and says what', async () => {
    const { asset, list } = await setUp();
    const out = await session.confirm({
      store, uuid: uu('u1'), items: list, asset, confirmedBy: '4101' });
    expect(out.queued).toBe(false);
    expect(out.problems.some((p) => p.includes('not answered'))).toBe(true);
    expect((await session.byUuid(store, uu('u1')))?.sync_state).toBe('draft');
  });

  it('refuses while nobody has been identified', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u9') });
    await session.setReadings(store, uu('u9'), { meterReading: 7700 });
    const list = await items();
    await answerAllClean('u9', list);
    const out = await session.confirm({
      store, uuid: uu('u9'), items: list, asset: a, confirmedBy: '4101' });
    expect(out.problems).toContain('Nobody has been identified as the operator');
  });

  it('refuses while the meter has not been read', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u8') });
    const op = await masters.operatorByEmpId(store, '4101');
    await session.identify(store, uu('u8'), op!, 'PIN', a);
    const list = await items();
    await answerAllClean('u8', list);
    const out = await session.confirm({
      store, uuid: uu('u8'), items: list, asset: a, confirmedBy: '4101' });
    expect(out.problems).toContain('The meter reading has not been entered');
  });

  it('queues a clean handover as SUBMITTED', async () => {
    const { asset, list } = await setUp();
    await answerAllClean('u1', list);
    const out = await session.confirm({
      store, uuid: uu('u1'), items: list, asset, confirmedBy: '4101' });

    expect(out).toMatchObject({ queued: true, status: 'SUBMITTED' });
    const s = await session.byUuid(store, uu('u1'));
    // CONFIRM IS NOT SEND. The operator has attested; the tablet still owns it.
    expect(s?.sync_state).toBe('queued');
    expect(s?.confirmed_by).toBe('4101');
  });

  it('queues a BLOCKED handover too, with a reason anybody can act on', async () => {
    const { asset, list } = await setUp();
    await answerAllClean('u1', list);
    const brakes = byId(list, 101);
    await store.runAsync(`INSERT INTO photo
        (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at)
       VALUES ('p1', '11111111-1111-4111-8111-111111111111', 101, '/tmp/p1.jpg', 1, 'x', '2026-11-09T10:00:00Z')`);
    await session.answer(store, uu('u1'), brakes,
                         { itemId: 101, answer: 'NOT_OK', remark: 'pedal goes to the floor' });

    const out = await session.confirm({
      store, uuid: uu('u1'), items: list, asset, confirmedBy: '4101' });

    expect(out).toMatchObject({ queued: true, status: 'BLOCKED' });
    expect(out.verdict.blockedReason).toBe('Service brake response not ok');
    expect((await session.byUuid(store, uu('u1')))?.sync_state).toBe('queued');
  });

  it('refuses an adverse answer with no photo where the item demands one', async () => {
    const { asset, list } = await setUp();
    await answerAllClean('u1', list);
    await session.answer(store, uu('u1'), byId(list, 101),
                         { itemId: 101, answer: 'NOT_OK', remark: 'spongy' });
    const out = await session.confirm({
      store, uuid: uu('u1'), items: list, asset, confirmedBy: '4101' });
    expect(out.queued).toBe(false);
    expect(out.problems.some((p) => p.includes('Add a photo'))).toBe(true);
  });

  it('queries a meter that went backwards instead of accepting it', async () => {
    const { asset, list } = await setUp();
    await answerAllClean('u1', list);
    await session.setReadings(store, uu('u1'), { meterReading: 7000 });   // was 7598
    const out = await session.confirm({
      store, uuid: uu('u1'), items: list, asset, confirmedBy: '4101' });
    expect(out.queued).toBe(false);
    expect(out.problems.some((p) => p.includes('check the reading'))).toBe(true);
  });

  it('cannot be confirmed twice', async () => {
    const { asset, list } = await setUp();
    await answerAllClean('u1', list);
    await session.confirm({ store, uuid: uu('u1'), items: list, asset, confirmedBy: '4101' });
    const s1 = await session.byUuid(store, uu('u1'));

    await session.confirm({ store, uuid: uu('u1'), items: list, asset, confirmedBy: '9999' });
    const s2 = await session.byUuid(store, uu('u1'));
    // The UPDATE is guarded on sync_state = 'draft', so a second confirm after
    // the record has joined the outbox cannot rewrite who signed it.
    expect(s2?.confirmed_by).toBe(s1?.confirmed_by);
  });

  it('says there is no checklist rather than silently accepting an empty one', async () => {
    const dozer = await masters.asset(store, 44);        // type 2, no template seeded
    await session.startDraft({
      store, asset: dozer!, sessionType: 'START_HANDOVER', clientUuid: uu('u7') });
    const op = await masters.operatorByEmpId(store, '4101');
    await session.identify(store, uu('u7'), op!, 'PIN', dozer!);
    await session.setReadings(store, uu('u7'), { meterReading: 1300 });

    const out = await session.confirm({
      store, uuid: uu('u7'), items: [], asset: dozer!, confirmedBy: '4101' });
    expect(out.queued).toBe(false);
    expect(out.problems.some((p) => p.includes('No checklist is published'))).toBe(true);
  });
});

describe('everyone in the handover', () => {
  // The form asked for one person and the record has three. These are the
  // rules that keep them apart -- see migration 115 on the server.
  const draft = async (key: string, type: 'START_HANDOVER' | 'END_HANDOVER' | 'MID_SHIFT') => {
    const uuid = uu(key);
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: type, clientUuid: uuid });
    const ramesh = await masters.operatorByEmpId(store, '4101');
    const sunil = await masters.operatorByEmpId(store, '4102');
    await session.identify(store, uuid, ramesh!, 'PIN', a);
    await session.setReadings(store, uuid, { meterReading: 7700 });
    const list = await items();
    await answerAllClean(key, list);
    return { uuid, asset: a, list, ramesh: ramesh!, sunil: sunil! };
  };

  it('refuses a takeover that does not say who handed it over', async () => {
    const { uuid, asset, list } = await draft('u1', 'START_HANDOVER');
    const out = await session.confirm({ store, uuid, items: list, asset, confirmedBy: '4101' });
    expect(out.queued).toBe(false);
    expect(out.problems).toContain('Say who handed the machine over, or that nobody did');
  });

  it('asks a handover the other way round', async () => {
    const { uuid, asset, list } = await draft('u1', 'END_HANDOVER');
    const out = await session.confirm({ store, uuid, items: list, asset, confirmedBy: '4101' });
    expect(out.problems).toContain('Say who is taking the machine over, or that nobody is');
  });

  it('accepts "nobody" as an answer, and keeps it distinct from not asked', async () => {
    const { uuid, asset, list } = await draft('u1', 'START_HANDOVER');
    await session.setCounterpart(store, uuid, null, true);
    const out = await session.confirm({ store, uuid, items: list, asset, confirmedBy: '4101' });
    expect(out.queued).toBe(true);
    const p = await session.payloadFor(store, uuid);
    expect(p).toMatchObject({ counterpart_operator_id: null, counterpart_absent: true });
  });

  it('will not record somebody as both named and absent', async () => {
    const { uuid, sunil } = await draft('u1', 'START_HANDOVER');
    await expect(session.setCounterpart(store, uuid, sunil, true)).rejects.toThrow();
  });

  it('does not ask a mid-shift check about another side, and never sends one', async () => {
    const { uuid, asset, list, sunil } = await draft('u1', 'MID_SHIFT');
    // Even if one somehow got stored, it must not reach the server, which
    // refuses a mid-shift check that names a second party.
    await session.setCounterpart(store, uuid, sunil);
    const out = await session.confirm({ store, uuid, items: list, asset, confirmedBy: '4101' });
    expect(out.queued).toBe(true);
    const p = await session.payloadFor(store, uuid);
    expect(p).toMatchObject({ counterpart_operator_id: null, counterpart_absent: false });
  });

  it('records the operator as having filled it in, when nobody else was named', async () => {
    const { uuid, asset, list, sunil } = await draft('u1', 'START_HANDOVER');
    await session.setCounterpart(store, uuid, sunil);
    await session.confirm({ store, uuid, items: list, asset, confirmedBy: '4101' });
    const p = await session.payloadFor(store, uuid);
    expect(p).toMatchObject({
      operator_id: 7, counterpart_operator_id: 8, counterpart_emp_id: '4102',
      recorded_by_operator_id: 7, recorded_by_emp_id: '4101',
    });
  });

  it('records somebody else who held the tablet', async () => {
    const { uuid, asset, list, sunil } = await draft('u1', 'START_HANDOVER');
    await session.setCounterpart(store, uuid, null, true);
    await session.setRecorder(store, uuid, sunil);
    await session.confirm({ store, uuid, items: list, asset, confirmedBy: '4101' });
    const p = await session.payloadFor(store, uuid);
    expect(p).toMatchObject({ operator_id: 7, recorded_by_operator_id: 8,
                              recorded_by_emp_id: '4102' });
  });

  it('names whoever the operator finally is, not whoever was picked first', async () => {
    const { uuid, asset, list, sunil } = await draft('u1', 'START_HANDOVER');
    await session.setCounterpart(store, uuid, null, true);
    await session.identify(store, uuid, sunil, 'PIN', asset);   // changed their mind
    await session.confirm({ store, uuid, items: list, asset, confirmedBy: '4102' });
    const p = await session.payloadFor(store, uuid);
    expect(p).toMatchObject({ operator_id: 8, recorded_by_operator_id: 8 });
  });

  const operatorPhotos = async (uuid: string) =>
    (await store.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM photo WHERE session_uuid = ? AND kind = 'OPERATOR'`,
      [uuid]))?.n;
  const photograph = (uuid: string) => store.runAsync(`INSERT INTO photo
        (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at, kind)
       VALUES ('op1', ?, NULL, '/tmp/ramesh.jpg', 1, 'x', '2026-11-09T10:00:00Z', 'OPERATOR')`,
    [uuid]);

  it('removes the photograph of the previous operator when the operator is changed', async () => {
    const { uuid, asset, sunil } = await draft('u1', 'START_HANDOVER');
    await photograph(uuid);
    await session.identify(store, uuid, sunil, 'PIN', asset);
    expect(await operatorPhotos(uuid)).toBe(0);
  });

  it('keeps the photograph when the same operator is picked again', async () => {
    const { uuid, asset, ramesh } = await draft('u1', 'START_HANDOVER');
    await photograph(uuid);
    await session.identify(store, uuid, ramesh, 'PIN', asset);
    expect(await operatorPhotos(uuid)).toBe(1);
  });
});

describe('what the tablet is holding', () => {
  it('offers to resume an unfinished walk-round', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const drafts = await session.openDrafts(store);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.fleet_code).toBe('MAN-11');
  });

  it('counts the outbox, so the sync banner can tell the truth', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    await store.runAsync(`UPDATE session SET sync_state='queued' WHERE client_uuid='11111111-1111-4111-8111-111111111111'`);
    await store.runAsync(`INSERT INTO photo
        (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at)
       VALUES ('p1','11111111-1111-4111-8111-111111111111',101,'/tmp/p.jpg',1,'x','2026-11-09T10:00:00Z')`);

    expect(await session.outboxDepth(store)).toMatchObject({ queued: 1, photos: 1, rejected: 0 });
  });
});

describe('the payload the server will receive', () => {
  it('is built from the stored record, so what is sent is what was signed', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const op = await masters.operatorByEmpId(store, '4101');
    await session.identify(store, uu('u1'), op!, 'PIN', a);
    await session.setCounterpart(store, uu('u1'), null, true);
    await session.setReadings(store, uu('u1'), { meterReading: 7700, fuelLevel: 60 });
    await session.setPosition(store, uu('u1'), { lat: 21.0, lon: 85.8, accuracyM: 8, status: 'OK' });
    const list = await items();
    await answerAllClean('u1', list);
    await session.confirm({ store, uuid: uu('u1'), items: list, asset: a, confirmedBy: '4101' });

    const p = await session.payloadFor(store, uu('u1'));
    expect(p).toMatchObject({
      client_uuid: uu('u1'), asset_id: 25, session_type: 'START_HANDOVER',
      operator_id: 7, template_id: 1, template_version: 1,
      meter_reading: 7700, meter_uom: 'HOURS', fuel_level: 60,
      status: 'SUBMITTED', captured_offline: true, gps_status: 'OK',
    });
    expect((p.responses as unknown[])).toHaveLength(4);
    // The production day travels with it: the server must never infer it from
    // a device clock that may have drifted.
    // The LOCAL day. This compared with the UTC slice of captured_at -- the very
    // rule fixed on 13 Nov -- so it passed all day and failed between midnight
    // and 05:30 IST, the night shift, which is when it was found (16 Nov, 00:55).
    expect(p.production_day).toBe(localDay(String(p.captured_at)));
  });

  it('carries the photo count per item, which is what the server checks', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const list = await items();
    await session.answer(store, uu('u1'), byId(list, 101),
                         { itemId: 101, answer: 'NOT_OK', remark: 'spongy' });
    await store.runAsync(`INSERT INTO photo
        (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at)
       VALUES ('p1','11111111-1111-4111-8111-111111111111',101,'/tmp/p.jpg',1,'x','2026-11-09T10:00:00Z')`);

    const p = await session.payloadFor(store, uu('u1'));
    const r = (p.responses as { item_id: number; photo_count: number }[])[0];
    expect(r).toMatchObject({ item_id: 101, photo_count: 1 });
  });
});


describe('drafts that can never be finished', () => {
  it('are removed when no checklist was found and nothing is in them', async () => {
    const dozer = (await masters.asset(store, 44))!;        // type 2: no checklist seeded
    await session.startDraft({ store, asset: dozer, sessionType: 'START_HANDOVER',
                               clientUuid: uu('u7') });
    expect(await session.removeEmptyDraftsWithoutChecklist(store)).toBe(1);
    expect(await session.openDrafts(store)).toHaveLength(0);
  });

  it('never touch a draft that has a checklist, or anything in it', async () => {
    const a = await MAN11();
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uu('u1') });
    const dozer = (await masters.asset(store, 44))!;
    await session.startDraft({ store, asset: dozer, sessionType: 'START_HANDOVER',
                               clientUuid: uu('u7') });
    await store.runAsync(`INSERT INTO photo
        (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at)
       VALUES ('p9', ?, NULL, '/tmp/p.jpg', 1, 'x', '2026-11-16T01:00:00Z')`, [uu('u7')]);
    expect(await session.removeEmptyDraftsWithoutChecklist(store)).toBe(0);
    expect(await session.openDrafts(store)).toHaveLength(2);
  });
});
