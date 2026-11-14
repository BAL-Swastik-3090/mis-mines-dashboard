/**
 * The capture in progress, as the screens see it.
 *
 * ── THE STORE IS A VIEW, NOT THE RECORD ──────────────────────────────────────
 * Every mutation writes to SQLite first and then re-reads. The screens never
 * hold an answer that the database does not already have, because the whole
 * point of writing the draft early is that killing the app mid-walk-round
 * costs the last tap and nothing more. A store that buffered answers and
 * flushed them later would undo that.
 */

import { create } from 'zustand';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { positionNow } from '../core/location/positionNow';
import type { Store } from '@/core/capture/store';
import type { CachedAsset, CachedOperator, ResolvedTemplate } from '@/core/capture/masters';
import * as masters from '@/core/capture/masters';
import * as session from '@/core/capture/session';
import type { Advisory, SessionRow } from '@/core/capture/session';
import type { ChecklistItem, RawResponse, SessionVerdict } from '@/core/evaluation';
import type { IdentificationMethod, SessionType } from '@/core/enums';

interface CaptureState {
  store: Store | null;
  uuid: string | null;
  asset: CachedAsset | null;
  operator: CachedOperator | null;
  /** The other side of the handover, when somebody was named. */
  counterpart: CachedOperator | null;
  /** The operator said nobody was on the other side. */
  counterpartAbsent: boolean;
  /** Somebody other than the operator holding the tablet; null when it is the operator. */
  recorder: CachedOperator | null;
  template: ResolvedTemplate | null;
  row: SessionRow | null;
  answers: Map<number, RawResponse>;
  /** The routine checks were answered together rather than one at a time. */
  bulkAnswered: boolean;
  advisories: Advisory[];
  verdict: SessionVerdict | null;
  blockers: string[];
  busy: boolean;

  attach: (store: Store) => void;
  begin: (asset: CachedAsset, type: SessionType, uuid: string) => Promise<boolean>;
  resume: (uuid: string) => Promise<boolean>;
  identify: (op: CachedOperator, how: IdentificationMethod) => Promise<void>;
  /** `null, true` is "nobody"; `null, false` clears the answer so it is asked again. */
  setCounterpart: (op: CachedOperator | null, absent?: boolean) => Promise<void>;
  /** `null` means the operator is filling it in themself. */
  setRecorder: (op: CachedOperator | null) => Promise<void>;
  setAnswer: (item: ChecklistItem, raw: RawResponse) => Promise<void>;
  setReadings: (r: { meterReading?: number; fuelLevel?: number; remarks?: string }) => Promise<void>;
  refreshVerdict: () => Promise<void>;
  confirm: (by: string) => Promise<{ queued: boolean; status: string; problems: string[] }>;
  discard: () => void;
}

/** The other side and the tablet-holder, read back from a stored draft. */
async function peopleOf(store: Store, row: SessionRow): Promise<{
  counterpart: CachedOperator | null; counterpartAbsent: boolean; recorder: CachedOperator | null;
}> {
  return {
    counterpart: row.counterpart_operator_id
      ? await masters.operator(store, row.counterpart_operator_id) : null,
    counterpartAbsent: row.counterpart_absent === 1,
    // Only somebody OTHER than the operator is a recorder worth showing. On a
    // draft it is never the operator -- that is written at confirm.
    recorder: row.recorded_by_operator_id && row.recorded_by_operator_id !== row.operator_id
      ? await masters.operator(store, row.recorded_by_operator_id) : null,
  };
}

const need = (s: Store | null): Store => {
  if (!s) throw new Error('the database has not been opened yet');
  return s;
};

export const useCapture = create<CaptureState>()((set, get) => ({
  store: null, uuid: null, asset: null, operator: null, template: null,
  counterpart: null, counterpartAbsent: false, recorder: null,
  row: null, answers: new Map(), advisories: [], verdict: null, blockers: [],
  bulkAnswered: false,
  busy: false,

  attach: (store) => set({ store }),

  begin: async (asset, type, uuid) => {
    const store = need(get().store);
    set({ busy: true });
    try {
      const { session: row } = await session.startDraft({
        store, asset, sessionType: type, clientUuid: uuid,
      });
      const template = await masters.resolveTemplate(store, asset.asset_type_id);
      const age = await masters.cacheAgeHours(store);
      const existing = await session.responses(store, row.client_uuid);

      set({
        uuid: row.client_uuid, asset, row, template,
        // A resumed draft brings its answers back with it.
        answers: new Map(existing.map((r) => [r.item_id, {
          itemId: r.item_id, answer: r.answer, numericValue: r.numeric_value,
          remark: r.remark,
        }])),
        operator: row.operator_id ? await masters.operator(store, row.operator_id) : null,
        ...(await peopleOf(store, row)),
        // A draft filled in one tap before 14 Nov still says so.
        bulkAnswered: (row as { bulk_answered?: number }).bulk_answered === 1,
        advisories: session.advisoriesFor(null, asset, new Date(), age),
        verdict: null, blockers: [],
      });
      return template != null;
    } finally {
      set({ busy: false });
    }
  },

  resume: async (uuid) => {
    const store = need(get().store);
    const row = await session.byUuid(store, uuid);
    if (!row) return false;
    const asset = await masters.asset(store, row.asset_id);
    if (!asset) return false;
    const template = await masters.resolveTemplate(store, asset.asset_type_id);
    const existing = await session.responses(store, uuid);
    set({
      uuid, row, asset, template,
      operator: row.operator_id ? await masters.operator(store, row.operator_id) : null,
      ...(await peopleOf(store, row)),
      // A draft filled in one tap before 14 Nov still says so.
      bulkAnswered: (row as { bulk_answered?: number }).bulk_answered === 1,
      answers: new Map(existing.map((r) => [r.item_id, {
        itemId: r.item_id, answer: r.answer, numericValue: r.numeric_value, remark: r.remark,
      }])),
      advisories: [], verdict: null, blockers: [],
    });
    return true;
  },

  identify: async (op, how) => {
    const { store, uuid, asset } = get();
    if (!uuid || !asset) return;
    // A changed operator takes the previous one's photograph off the record
    // (session.identify). The file goes too, so a picture of somebody who is
    // no longer on this handover is not left lying in the tablet's storage.
    const before = await need(store).getAllAsync<{ photo_uuid: string; local_path: string }>(
      `SELECT photo_uuid, local_path FROM photo WHERE session_uuid = ? AND kind = 'OPERATOR'`,
      [uuid]);
    const advisories = await session.identify(need(store), uuid, op, how, asset);
    for (const p of before) {
      const still = await need(store).getFirstAsync<{ n: number }>(
        `SELECT count(*) AS n FROM photo WHERE photo_uuid = ?`, [p.photo_uuid]);
      if (!still?.n) {
        try { await FileSystem.deleteAsync(p.local_path, { idempotent: true }); } catch { /* best effort */ }
      }
    }
    const age = await masters.cacheAgeHours(need(store));
    set({
      operator: op,
      advisories: [...advisories, ...session.advisoriesFor(null, asset, new Date(), age)],
      row: await session.byUuid(need(store), uuid),
    });
  },

  setCounterpart: async (op, absent = false) => {
    const { store, uuid } = get();
    if (!uuid) return;
    await session.setCounterpart(need(store), uuid, op, absent);
    set({ counterpart: op, counterpartAbsent: absent,
          row: await session.byUuid(need(store), uuid) });
  },

  setRecorder: async (op) => {
    const { store, uuid } = get();
    if (!uuid) return;
    await session.setRecorder(need(store), uuid, op);
    set({ recorder: op, row: await session.byUuid(need(store), uuid) });
  },

  // "Mark the routine checks OK" used to live here: one tap that answered
  // every routine check. Withdrawn 14 Nov at the mine's request (issue B3) --
  // the walk-round now asks each check in turn (app/capture/step.tsx). The
  // rule for what may never be bulk-answered stays in core/routine.ts, tested,
  // and records filed with it still carry bulk_answered.

  setAnswer: async (item, raw) => {
    const { store, uuid } = get();
    if (!uuid) return;
    await session.answer(need(store), uuid, item, raw);
    const next = new Map(get().answers);
    next.set(item.itemId, raw);
    set({ answers: next });
  },

  setReadings: async (r) => {
    const { store, uuid } = get();
    if (!uuid) return;
    await session.setReadings(need(store), uuid, r);
    set({ row: await session.byUuid(need(store), uuid) });
  },

  refreshVerdict: async () => {
    const { store, uuid, template, asset } = get();
    if (!uuid || !asset) return;
    const { verdict, blockers } = await session.review(
      need(store), uuid, template?.items ?? [], asset);
    set({ verdict, blockers });
  },

  confirm: async (by) => {
    const { store, uuid, template, asset } = get();
    if (!uuid || !asset) return { queued: false, status: 'DRAFT', problems: ['nothing to confirm'] };
    set({ busy: true });
    try {
      // WHERE THE HANDOVER WAS SIGNED.
      //
      // session.setPosition has existed since phase 4 and was never once
      // called, so captured_lat and captured_lon were null on every record
      // ever filed -- while the photos attached to the same handover carried
      // a position. Taken at confirm rather than at the start, because that
      // is the moment somebody puts their name to it, and recorded as found
      // rather than as hoped: a refusal or a timeout is stored as such.
      // Same fault as the camera had: this asked only for a LIVE fix and
      // recorded UNAVAILABLE when none arrived within eight seconds, which is
      // why every handover before the twelfth says nothing about where it was
      // signed. positionNow falls back to the recent fix the tracker already
      // holds, so a confirm pressed in a workshop still records a place.
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          await session.setPosition(need(store), uuid, { status: 'DENIED' });
        } else {
          const fix = await positionNow(need(store));
          await session.setPosition(need(store), uuid, fix
            ? { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM, status: 'OK' }
            : { status: 'UNAVAILABLE' });
        }
      } catch {
        await session.setPosition(need(store), uuid, { status: 'UNAVAILABLE' });
      }

      const out = await session.confirm({
        store: need(store), uuid, items: template?.items ?? [], asset, confirmedBy: by,
      });
      set({ verdict: out.verdict, row: await session.byUuid(need(store), uuid) });
      return { queued: out.queued, status: out.status, problems: out.problems };
    } finally {
      set({ busy: false });
    }
  },

  /** Leaves the draft in the database on purpose. Walking away is not discarding. */
  discard: () => set({
    uuid: null, asset: null, operator: null, template: null, row: null,
    counterpart: null, counterpartAbsent: false, recorder: null,
    answers: new Map(), advisories: [], verdict: null, blockers: [],
    bulkAnswered: false,
  }),
}));
