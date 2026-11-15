import { openTestStore, seed, type TestStore } from './testStore';
import * as masters from './masters';
import * as session from './session';
import {
  doneOnTablet, filledInBy, people, periodBounds, summary, whereItIs, type DoneRow,
} from './history';
import type { ChecklistItem } from '../evaluation';

let store: TestStore;
beforeEach(async () => { store = openTestStore(); await seed(store); });
afterEach(() => store.close());

const U = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;

/** A confirmed handover on MAN-11, filled in by `recorder` (default: the operator). */
async function confirmed(n: number, at: Date, recorderEmp?: string) {
  const a = (await masters.asset(store, 25))!;
  const uuid = U(n);
  await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uuid, now: at });
  const ramesh = (await masters.operatorByEmpId(store, '4101'))!;
  await session.identify(store, uuid, ramesh, 'PIN', a);
  await session.setCounterpart(store, uuid, null, true);
  if (recorderEmp) await session.setRecorder(store, uuid, (await masters.operatorByEmpId(store, recorderEmp))!);
  await session.setReadings(store, uuid, { meterReading: 7700 });
  const items: ChecklistItem[] = (await masters.resolveTemplate(store, 1, '2026-11-09'))!.items;
  for (const i of items) {
    await session.answer(store, uuid, i, i.responseType === 'NUMERIC'
      ? { itemId: i.itemId, numericValue: ((i.minValue ?? 0) + (i.maxValue ?? 100)) / 2 }
      : { itemId: i.itemId, answer: i.responseType === 'LEVEL' ? 'NORMAL' : 'OK' });
  }
  const out = await session.confirm({ store, uuid, items, asset: a, confirmedBy: '4101', now: at });
  if (!out.queued) throw new Error(out.problems.join('; '));
  return uuid;
}

describe('what was done on this tablet', () => {
  const now = new Date(2026, 10, 15, 18, 0);          // 15 Nov, 18:00 local

  it('lists the handovers confirmed today, newest first', async () => {
    await confirmed(1, new Date(2026, 10, 15, 7, 0));
    await confirmed(2, new Date(2026, 10, 15, 14, 0), '4102');
    const rows = await doneOnTablet(store, 'today', now);
    expect(rows.map((r) => r.client_uuid)).toEqual([U(2), U(1)]);
    expect(rows[0]).toMatchObject({ fleet_code: 'MAN-11', session_type: 'START_HANDOVER' });
  });

  it('keeps yesterday out of today, and in yesterday', async () => {
    await confirmed(1, new Date(2026, 10, 14, 22, 30));
    await confirmed(2, new Date(2026, 10, 15, 6, 0));
    expect((await doneOnTablet(store, 'today', now)).map((r) => r.client_uuid)).toEqual([U(2)]);
    expect((await doneOnTablet(store, 'yesterday', now)).map((r) => r.client_uuid)).toEqual([U(1)]);
    expect(await doneOnTablet(store, 'week', now)).toHaveLength(2);
  });

  it('leaves out drafts nobody has confirmed', async () => {
    const a = (await masters.asset(store, 25))!;
    await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER',
                               clientUuid: U(3), now: new Date(2026, 10, 15, 9, 0) });
    expect(await doneOnTablet(store, 'today', now)).toHaveLength(0);
  });

  it('says who filled each one in, so it can be narrowed to one person', async () => {
    await confirmed(1, new Date(2026, 10, 15, 7, 0));                 // the operator themself
    await confirmed(2, new Date(2026, 10, 15, 8, 0), '4102');         // a supervisor
    await confirmed(4, new Date(2026, 10, 15, 9, 0), '4102');
    const rows = await doneOnTablet(store, 'today', now);
    expect(rows.map(filledInBy)).toEqual(['SUNIL BEHERA', 'SUNIL BEHERA', 'RAMESH NAIK']);
    expect(people(rows)).toEqual([{ name: 'SUNIL BEHERA', n: 2 }, { name: 'RAMESH NAIK', n: 1 }]);
  });

  it('counts machines, not just handovers', async () => {
    await confirmed(1, new Date(2026, 10, 15, 7, 0));
    await confirmed(2, new Date(2026, 10, 15, 8, 0));
    const s = summary(await doneOnTablet(store, 'today', now));
    expect(s).toMatchObject({ handovers: 2, machines: 1, waiting: 2, atOffice: 0 });
  });
});

describe('where each one has got to', () => {
  const r = (over: Partial<DoneRow>): DoneRow => ({
    client_uuid: 'x', asset_id: 1, fleet_code: 'MAN-11', registration_no: null,
    session_type: 'START_HANDOVER', captured_at: '', confirmed_at: null, status: 'SUBMITTED',
    blocked_reason: null, sync_state: 'synced', sync_error: null, server_session_ref: 'HOTO-1',
    operator_id: 7, operator_name: 'A', recorded_by_operator_id: 7, recorder_name: 'A',
    counterpart_name: null, counterpart_absent: 1, findings: 0, photos_waiting: 0, ...over,
  });

  it('is at the office only when its photographs are too', () => {
    expect(whereItIs(r({}))).toBe('office');
    expect(whereItIs(r({ photos_waiting: 1 }))).toBe('waiting');
  });

  it('is waiting while queued, and refused when the office said no', () => {
    expect(whereItIs(r({ sync_state: 'queued' }))).toBe('waiting');
    expect(whereItIs(r({ sync_state: 'rejected' }))).toBe('refused');
    expect(whereItIs(r({ sync_state: 'conflict' }))).toBe('refused');
  });

  it('says "not recorded" for a handover filed before who-filled-it-in existed', () => {
    expect(filledInBy(r({ recorded_by_operator_id: null, recorder_name: null }))).toBe('Not recorded');
  });
});

describe('the periods', () => {
  it('run from local midnight', () => {
    const b = periodBounds('today', new Date(2026, 10, 15, 0, 30));
    expect(new Date(b.from).getHours()).toBe(0);
    expect(new Date(b.to).getTime() - new Date(b.from).getTime()).toBe(24 * 3600 * 1000);
    const w = periodBounds('week', new Date(2026, 10, 15, 12));
    expect((new Date(w.to).getTime() - new Date(w.from).getTime()) / (24 * 3600 * 1000)).toBe(7);
  });
});
