/**
 * Does the device's payload actually fit the server?
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────────────
 * Every other test here proves the device is self-consistent. None of them
 * proves the server will accept what the device produces, and that is the
 * failure that costs the most: it surfaces after an operator has finished a
 * walk-round and walked away from the machine, by which point the handover is
 * gone and the machine has been driven.
 *
 * So this takes the REAL sync bundle from a running backend, caches it through
 * the device's own code, drives a capture through the device's own rules, and
 * POSTs the device's own payload. Nothing is hand-assembled; a field the device
 * forgets to send is a field this test fails on.
 *
 * ── HOW TO RUN IT ────────────────────────────────────────────────────────────
 *   HOTO_API=http://127.0.0.1:8990 HOTO_COOKIE=<session cookie> npx jest contract
 *
 * It SKIPS, loudly, when those are absent — a contract test that silently
 * passes because it never ran is worse than no contract test, so it says which
 * it did.
 */

import { randomUUID } from 'node:crypto';
import { openTestStore, type TestStore } from './testStore';
import { cacheBundle, clockDriftSeconds, type SyncBundle } from './cache';
import * as masters from './masters';
import * as session from './session';
import type { ChecklistItem } from '../evaluation';

const API = process.env.HOTO_API;
const COOKIE = process.env.HOTO_COOKIE;
const live = Boolean(API && COOKIE);
const describeLive = live ? describe : describe.skip;

if (!live) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  contract.test.ts SKIPPED — set HOTO_API and HOTO_COOKIE to run it ' +
    'against a live backend.\n',
  );
}

/** Who signed. The employee number where there is one, the operator id where
 *  there is not -- 32 of the mine's operators have no reference on record. */
const attester = (o: { emp_id: string | null; operator_id: number }): string =>
  o.emp_id ?? `operator:${o.operator_id}`;

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Cookie: `mines_session=${COOKIE}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: r.status, body: json as Record<string, unknown> };
}

describeLive('the device against a live server', () => {
  let store: TestStore;
  let bundle: SyncBundle;

  beforeAll(async () => {
    const r = await call('GET', '/api/hoto/sync');
    expect(r.status).toBe(200);
    bundle = r.body as unknown as SyncBundle;
  }, 60_000);

  beforeEach(() => { store = openTestStore(); });
  afterEach(() => store.close());

  it('caches the whole bundle the server actually sends', async () => {
    const n = await cacheBundle(store, bundle);
    expect(n.assets).toBeGreaterThan(0);
    expect(n.templates).toBeGreaterThan(0);
    expect(n.items).toBeGreaterThan(0);

    // Every cached item must satisfy the device's own rules engine, or the
    // operator sees a question the app cannot evaluate.
    const types = await store.getAllAsync<{ response_type: string; n: number }>(
      `SELECT response_type, COUNT(*) AS n FROM cached_item GROUP BY response_type`);
    for (const t of types) {
      expect(['OK_CAUTION_NOTOK', 'NUMERIC', 'YES_NO', 'LEVEL']).toContain(t.response_type);
    }
    const sev = await store.getAllAsync<{ default_severity: string }>(
      `SELECT DISTINCT default_severity FROM cached_item`);
    for (const s of sev) {
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(s.default_severity);
    }
  }, 60_000);

  it('resolves the same template the server resolved for the same machine', async () => {
    await cacheBundle(store, bundle);
    // The server sent one resolved template per asset type present in the
    // fleet. The device's own resolver must land on those same templates.
    for (const t of bundle.templates ?? []) {
      const mine = await masters.resolveTemplate(store, t.asset_type_id);
      expect(mine?.template_id).toBe(t.template_id);
      expect(mine?.version).toBe(t.version);
    }
  }, 60_000);

  it('notices if this machine’s clock disagrees with the server', () => {
    const drift = Math.abs(clockDriftSeconds(bundle.server_time));
    // Not an assertion about the clock being right — an assertion that the
    // measurement works and is reported in seconds, not nonsense.
    expect(Number.isFinite(drift)).toBe(true);
  });

  it('files a capture the server accepts, built entirely by device code', async () => {
    await cacheBundle(store, bundle);

    // A machine whose type the tablet holds a checklist for.
    const withChecklist = (bundle.templates ?? []).map((t) => t.asset_type_id);
    const picked = bundle.assets.find((a) => withChecklist.includes(a.asset_type_id));
    expect(picked).toBeDefined();
    const asset = await masters.asset(store, picked!.asset_id);
    expect(asset).not.toBeNull();

    const uuid = randomUUID();
    const { session: draft } = await session.startDraft({
      store, asset: asset!, sessionType: 'START_HANDOVER', clientUuid: uuid,
    });
    expect(draft.template_id).toBe(
      (bundle.templates ?? []).find((t) => t.asset_type_id === asset!.asset_type_id)?.template_id,
    );

    const op = bundle.operators[0];
    const cached = await masters.operator(store, op!.operator_id);
    await session.identify(store, uuid, cached!, 'EMPNO', asset!);
    // Every handover says who was on the other side, or that nobody was.
    await session.setCounterpart(store, uuid, null, true);

    const template = await masters.resolveTemplate(store, asset!.asset_type_id);
    const items: ChecklistItem[] = template?.items ?? [];
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      if (item.responseType === 'NUMERIC') {
        const lo = item.minValue ?? 0, hi = item.maxValue ?? 100;
        await session.answer(store, uuid, item,
                             { itemId: item.itemId, numericValue: (lo + hi) / 2 });
      } else if (item.responseType === 'LEVEL') {
        await session.answer(store, uuid, item, { itemId: item.itemId, answer: 'NORMAL' });
      } else if (item.responseType === 'YES_NO') {
        // Whichever answer is NOT the finding: 'YES' to "Abnormal sound" is a fault.
        await session.answer(store, uuid, item, { itemId: item.itemId,
          answer: (item.adverseAnswer ?? 'YES') === 'YES' ? 'NO' : 'YES' });
      } else {
        await session.answer(store, uuid, item, { itemId: item.itemId, answer: 'OK' });
      }
    }

    const meter = (asset!.last_meter_reading ?? 0) + 7;
    await session.setReadings(store, uuid, { meterReading: meter, fuelLevel: 55,
                                             remarks: 'contract test' });
    await session.setPosition(store, uuid, { lat: 21.05, lon: 85.78, accuracyM: 9, status: 'OK' });

    const out = await session.confirm({
      store, uuid, items, asset: asset!, confirmedBy: op!.emp_id,
    });
    expect(out.problems).toEqual([]);
    expect(out.queued).toBe(true);

    const payload = await session.payloadFor(store, uuid);
    const posted = await call('POST', '/api/hoto/sessions', payload);
    if (posted.status !== 201 && posted.status !== 200) {
      throw new Error(`server refused the device's payload: ${posted.status} ` +
                      JSON.stringify(posted.body));
    }
    expect(posted.body.session_ref).toBeTruthy();

    // The server stored what the device sent, including the fields that only
    // exist because the capture was offline.
    const ref = posted.body.session_id as number;
    const back = await call('GET', `/api/hoto/register/${ref}`);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({
      client_uuid: payload.client_uuid,
      asset_id: payload.asset_id,
      session_type: 'START_HANDOVER',
      status: out.status,
    });
    expect((back.body.sections as unknown[])?.length).toBeGreaterThan(0);

    // And a replay of the same capture is the SAME record, not a second
    // handover. This is the whole reason client_uuid exists.
    const replay = await call('POST', '/api/hoto/sessions', payload);
    expect([200, 201]).toContain(replay.status);
    expect(replay.body.session_id).toBe(ref);
  }, 120_000);

  it('a blocked capture reaches the server as BLOCKED, with its reason', async () => {
    await cacheBundle(store, bundle);
    const withChecklist = (bundle.templates ?? []).map((t) => t.asset_type_id);
    const picked = bundle.assets.find((a) => withChecklist.includes(a.asset_type_id));
    const asset = await masters.asset(store, picked!.asset_id);
    const template = await masters.resolveTemplate(store, asset!.asset_type_id);
    const items = template?.items ?? [];
    const critical = items.find((i) => i.isCritical && i.responseType !== 'NUMERIC');
    if (!critical) {
      // Worth saying out loud rather than passing quietly: a template with no
      // critical non-numeric item cannot exercise this path.
      expect(critical).toBeDefined();
      return;
    }

    const uuid = randomUUID();
    await session.startDraft({
      store, asset: asset!, sessionType: 'START_HANDOVER', clientUuid: uuid });
    const cached = await masters.operator(store, bundle.operators[0]!.operator_id);
    await session.identify(store, uuid, cached!, 'EMPNO', asset!);
    // Every handover says who was on the other side, or that nobody was.
    await session.setCounterpart(store, uuid, null, true);

    for (const item of items) {
      if (item.itemId === critical.itemId) continue;
      if (item.responseType === 'NUMERIC') {
        const lo = item.minValue ?? 0, hi = item.maxValue ?? 100;
        await session.answer(store, uuid, item, { itemId: item.itemId, numericValue: (lo + hi) / 2 });
      } else if (item.responseType === 'LEVEL') {
        await session.answer(store, uuid, item, { itemId: item.itemId, answer: 'NORMAL' });
      } else if (item.responseType === 'YES_NO') {
        // Whichever answer is NOT the finding: 'YES' to "Abnormal sound" is a fault.
        await session.answer(store, uuid, item, { itemId: item.itemId,
          answer: (item.adverseAnswer ?? 'YES') === 'YES' ? 'NO' : 'YES' });
      } else {
        await session.answer(store, uuid, item, { itemId: item.itemId, answer: 'OK' });
      }
    }
    await session.answer(store, uuid, critical,
                         { itemId: critical.itemId, answer: 'NOT_OK',
                           remark: 'found on the walk-round' });
    if (critical.requiresPhotoIfNotOk) {
      await store.runAsync(
        `INSERT INTO photo (photo_uuid, session_uuid, item_id, local_path, bytes,
                            sha256, captured_at)
         VALUES (?,?,?,?,?,?,?)`,
        [`${uuid}-p1`, uuid, critical.itemId, '/tmp/p.jpg', 1, 'x',
         new Date().toISOString()]);
    }
    await session.setReadings(store, uuid,
                              { meterReading: (asset!.last_meter_reading ?? 0) + 3 });

    const out = await session.confirm({
      store, uuid, items, asset: asset!, confirmedBy: attester(cached!) });
    expect(out.problems).toEqual([]);
    expect(out.status).toBe('BLOCKED');
    expect(out.verdict.blockedReason).toBeTruthy();

    const payload = await session.payloadFor(store, uuid);
    const posted = await call('POST', '/api/hoto/sessions', payload);
    if (posted.status !== 201 && posted.status !== 200) {
      throw new Error(`server refused the blocked payload: ${posted.status} ` +
                      JSON.stringify(posted.body));
    }
    // THE SERVER DECIDES AGAIN. The device said BLOCKED; the server must have
    // reached the same verdict from the same inputs.
    expect(posted.body.status).toBe('BLOCKED');
    expect(posted.body.blocked_reason).toBeTruthy();
  }, 120_000);
});
