import { openTestStore, seed, type TestStore } from './testStore';
import * as masters from './masters';
import * as session from './session';
import { ago, byUrgency, draftSummaries, isStale, type DraftSummary } from './drafts';

const d = (over: Partial<DraftSummary>): DraftSummary => ({
  client_uuid: 'x', asset_id: 1, fleet_code: 'MAN-11', registration_no: null,
  session_type: 'START_HANDOVER', captured_at: '2026-11-14T08:00:00Z',
  operator_id: null, operator_name: null, meter_reading: null, answered: 0, total: 4, findings: 0, blocking: 0,
  ...over,
});

describe('the order unfinished handovers are listed in', () => {
  it('puts a held machine first, however old', () => {
    const list = byUrgency([
      d({ client_uuid: 'new', captured_at: '2026-11-14T09:00:00Z' }),
      d({ client_uuid: 'held', captured_at: '2026-11-13T09:00:00Z', findings: 1, blocking: 1 }),
    ]);
    expect(list[0]?.client_uuid).toBe('held');
  });

  it('puts something found ahead of a clean walk-round', () => {
    const list = byUrgency([
      d({ client_uuid: 'clean', captured_at: '2026-11-14T09:00:00Z' }),
      d({ client_uuid: 'found', captured_at: '2026-11-14T07:00:00Z', findings: 2 }),
    ]);
    expect(list.map((x) => x.client_uuid)).toEqual(['found', 'clean']);
  });

  it('otherwise lists the newest first', () => {
    const list = byUrgency([
      d({ client_uuid: 'old', captured_at: '2026-11-14T06:00:00Z' }),
      d({ client_uuid: 'new', captured_at: '2026-11-14T09:00:00Z' }),
    ]);
    expect(list.map((x) => x.client_uuid)).toEqual(['new', 'old']);
  });
});

describe('how long ago, in words', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  it('reads the way somebody would say it', () => {
    expect(ago('2026-11-14T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-11-14T11:35:00Z', now)).toBe('25 min ago');
    expect(ago('2026-11-14T09:00:00Z', now)).toBe('3 h ago');
    expect(ago('2026-11-13T10:00:00Z', now)).toBe('yesterday');
    expect(ago('2026-11-10T12:00:00Z', now)).toBe('4 days ago');
  });

  it('calls a draft stale once it is half a day old', () => {
    expect(isStale('2026-11-14T01:00:00Z', now)).toBe(false);
    expect(isStale('2026-11-13T23:00:00Z', now)).toBe(true);
  });
});

describe('what each unfinished handover reports', () => {
  let store: TestStore;
  beforeEach(async () => { store = openTestStore(); await seed(store); });
  afterEach(() => store.close());

  it('counts answers, faults and the faults that hold the machine', async () => {
    const a = (await masters.asset(store, 25))!;
    const uuid = '11111111-1111-4111-8111-111111111111';
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uuid });
    const op = await masters.operatorByEmpId(store, '4101');
    await session.identify(store, uuid, op!, 'PIN', a);
    const items = (await masters.resolveTemplate(store, 1, '2026-11-09'))!.items;
    const brakes = items.find((i) => i.isCritical && i.responseType !== 'NUMERIC')!;
    const other = items.find((i) => !i.isCritical && i.responseType !== 'NUMERIC')!;
    await session.answer(store, uuid, brakes, { itemId: brakes.itemId, answer: 'NOT_OK' });
    await session.answer(store, uuid, other, { itemId: other.itemId, answer: 'OK' });

    const [s] = await draftSummaries(store);
    expect(s).toMatchObject({
      fleet_code: 'MAN-11', operator_name: 'RAMESH NAIK',
      answered: 2, total: items.length, findings: 1, blocking: 1,
    });
  });
});
