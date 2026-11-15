import { openTestStore, seed, type TestStore } from './testStore';
import * as masters from './masters';
import * as session from './session';
import { discardDraft, rememberedRecorder } from './drafting';
import type { ChecklistItem } from '../evaluation';

let store: TestStore;
beforeEach(async () => { store = openTestStore(); await seed(store); });
afterEach(() => store.close());

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

async function draft(uuid: string, at = new Date(2026, 10, 16, 6, 0)) {
  const a = (await masters.asset(store, 25))!;
  await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: uuid, now: at });
  return a;
}

async function confirmed(uuid: string, at: Date, recorderEmp?: string) {
  const a = await draft(uuid, at);
  await session.identify(store, uuid, (await masters.operatorByEmpId(store, '4101'))!, 'PIN', a);
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
}

describe('discarding an unfinished handover (G1)', () => {
  it('removes the draft, its answers and its photos, and says which files to delete', async () => {
    await draft(U1);
    const items = (await masters.resolveTemplate(store, 1, '2026-11-09'))!.items;
    await session.answer(store, U1, items[0]!, { itemId: items[0]!.itemId, answer: 'OK' });
    await store.runAsync(`INSERT INTO photo
        (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at)
       VALUES ('p1', ?, NULL, '/tmp/a.jpg', 1, 'x', '2026-11-16T06:00:00Z')`, [U1]);

    const out = await discardDraft(store, U1, 'WRONG_MACHINE');
    expect(out.photoPaths).toEqual(['/tmp/a.jpg']);
    expect(await session.byUuid(store, U1)).toBeNull();
    expect((await store.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM response WHERE session_uuid = ?`, [U1]))?.n).toBe(0);
  });

  it('keeps a trace of what was thrown away, and why', async () => {
    await draft(U1);
    await discardDraft(store, U1, 'DUPLICATE');
    const log = await store.getFirstAsync<{ kind: string; detail: string }>(
      `SELECT kind, detail FROM sync_log WHERE subject_uuid = ?`, [U1]);
    expect(log).toMatchObject({ kind: 'DISCARD' });
    expect(log?.detail).toContain('DUPLICATE');
  });

  it('refuses a handover that has been confirmed -- that one is signed', async () => {
    await confirmed(U1, new Date(2026, 10, 16, 6, 0));
    await expect(discardDraft(store, U1, 'BY_MISTAKE')).rejects.toThrow(/confirmed/);
    expect(await session.byUuid(store, U1)).not.toBeNull();
  });

  it('leaves every other draft alone', async () => {
    await draft(U1);
    const dozer = (await masters.asset(store, 44))!;
    await session.startDraft({ store, asset: dozer, sessionType: 'START_HANDOVER', clientUuid: U2 });
    await discardDraft(store, U1, 'OTHER');
    expect(await session.byUuid(store, U2)).not.toBeNull();
  });
});

describe('who usually fills them in (G4)', () => {
  const six = new Date(2026, 10, 16, 6, 0);

  it('remembers a supervisor who filled one in for an operator', async () => {
    await confirmed(U1, six, '4102');
    const r = await rememberedRecorder(store, new Date(2026, 10, 16, 9, 0));
    expect(r?.name).toBe('SUNIL BEHERA');
  });

  it('remembers nobody when the operator did their own', async () => {
    await confirmed(U1, six, '4102');
    await confirmed(U2, new Date(2026, 10, 16, 7, 0));          // the operator themself
    expect(await rememberedRecorder(store, new Date(2026, 10, 16, 8, 0))).toBeNull();
  });

  it('forgets after a shift, so tomorrow does not start with tonight\'s name', async () => {
    await confirmed(U1, six, '4102');
    expect(await rememberedRecorder(store, new Date(2026, 10, 16, 17, 0))).not.toBeNull();
    expect(await rememberedRecorder(store, new Date(2026, 10, 16, 19, 0))).toBeNull();
  });

  it('remembers nobody on a tablet nobody has used', async () => {
    expect(await rememberedRecorder(store)).toBeNull();
  });
});
