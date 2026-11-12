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
import type { Store } from '@/core/capture/store';
import type { CachedAsset, CachedOperator, ResolvedTemplate } from '@/core/capture/masters';
import * as masters from '@/core/capture/masters';
import * as session from '@/core/capture/session';
import type { Advisory, SessionRow } from '@/core/capture/session';
import type { ChecklistItem, RawResponse, SessionVerdict } from '@/core/evaluation';
import type { IdentificationMethod, SessionType } from '@/core/enums';
import { planRoutineAnswers } from '@/core/routine';

interface CaptureState {
  store: Store | null;
  uuid: string | null;
  asset: CachedAsset | null;
  operator: CachedOperator | null;
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
  setAnswer: (item: ChecklistItem, raw: RawResponse) => Promise<void>;
  /** Answer every routine check at once. Returns how many it filled. */
  answerRoutineChecks: () => Promise<number>;
  setReadings: (r: { meterReading?: number; fuelLevel?: number; remarks?: string }) => Promise<void>;
  refreshVerdict: () => Promise<void>;
  confirm: (by: string) => Promise<{ queued: boolean; status: string; problems: string[] }>;
  discard: () => void;
}

const need = (s: Store | null): Store => {
  if (!s) throw new Error('the database has not been opened yet');
  return s;
};

export const useCapture = create<CaptureState>()((set, get) => ({
  store: null, uuid: null, asset: null, operator: null, template: null,
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
    const advisories = await session.identify(need(store), uuid, op, how, asset);
    const age = await masters.cacheAgeHours(need(store));
    set({
      operator: op,
      advisories: [...advisories, ...session.advisoriesFor(null, asset, new Date(), age)],
      row: await session.byUuid(need(store), uuid),
    });
  },

  /**
   * Mark the routine checks OK in one action.
   *
   * ── WHAT IT DELIBERATELY WILL NOT TOUCH ────────────────────────────────
   * Anything critical -- the checks that stop a machine -- and anything that
   * takes a reading. A button that could pass a brake test nobody made is not
   * a convenience, it is the failure a checklist exists to prevent. Those are
   * answered one at a time or not at all.
   *
   * The rest is drudgery: twenty-odd taps on a shift where nothing is wrong,
   * which is most shifts. Friction there is what sends a section back to
   * paper, and paper records nothing at all.
   *
   * The handover records that this was used (`bulk_answered`), so a record
   * filled in one tap is not indistinguishable from a walk-round. See
   * migration 111.
   */
  answerRoutineChecks: async () => {
    const { template, answers, setAnswer } = get();
    if (!template) return 0;
    // The rule itself lives in core/routine.ts, with tests against it. This
    // only carries out the plan.
    const plan = planRoutineAnswers(template.items, answers);
    for (const { item, answer } of plan.fill) {
      const existing = answers.get(item.itemId) ?? { itemId: item.itemId };
      await setAnswer(item, { ...existing, answer });
    }
    const filled = plan.fill.length;
    if (filled > 0) {
      const { store, uuid } = get();
      if (store && uuid) {
        await store.runAsync(
          `UPDATE session SET bulk_answered = 1 WHERE client_uuid = ?`, [uuid]);
      }
      set({ bulkAnswered: true });
    }
    return filled;
  },

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
    answers: new Map(), advisories: [], verdict: null, blockers: [],
    bulkAnswered: false,
  }),
}));
