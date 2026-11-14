/**
 * What is standing between this handover and confirm, and where to fix each.
 *
 * ── WHY NOT JUST THE LIST OF STRINGS ─────────────────────────────────────────
 * The confirm screen had that list, in a box below the fold, and a button that
 * said "6 things left". It did not say which six and could not take anybody to
 * them, so an operator with one unanswered check out of twenty-four scrolled
 * the whole walk-round looking for it (issue B2). Each thing left now carries
 * where it is fixed, so the screen can take them straight there.
 *
 * In the order the flow asks: people, then the checks in checklist order, then
 * the readings. The first one is the one to do first.
 */

import type { ChecklistItem, SessionVerdict } from '../evaluation';
import type { SessionType } from '../enums';
import { counterpartQuestion, fuelProblem } from './session';

export { fuelProblem };

export type Fix =
  /** Fixed on the identify screen. */
  | { where: 'PEOPLE'; text: string }
  /** Fixed on one checklist item. */
  | { where: 'ITEM'; text: string; itemId: number }
  /** Fixed on the readings screen. */
  | { where: 'READINGS'; text: string }
  /** Nothing on this tablet can fix it; somebody has to be told. */
  | { where: 'NOWHERE'; text: string };

export interface TodoInput {
  sessionType: SessionType;
  operatorId: number | null;
  counterpartOperatorId: number | null;
  counterpartAbsent: boolean;
  hasTemplate: boolean;
  assetTypeName: string;
  meterReading: number | null;
  lastMeterReading: number | null;
  fuelLevel: number | null;
  remarks: string | null;
  items: ChecklistItem[];
  verdict: SessionVerdict | null;
}

export function whatIsLeft(t: TodoInput): Fix[] {
  const out: Fix[] = [];

  // ── people ──
  if (!t.operatorId) out.push({ where: 'PEOPLE', text: 'Say who the operator is' });
  const q = counterpartQuestion(t.sessionType);
  if (q && t.counterpartOperatorId == null && !t.counterpartAbsent) {
    out.push({ where: 'PEOPLE', text: q.missing });
  }

  // ── the checklist ──
  if (!t.hasTemplate) {
    out.push({ where: 'NOWHERE',
               text: `No checklist is published for ${t.assetTypeName} on this tablet. ` +
                     `Sync the tablet, or tell the office.` });
  } else if (t.verdict) {
    // One line per item, in the order the checklist asks them. An item with
    // two problems ("say what is wrong", "add a photo") is one place to go,
    // so it is one line.
    const byItem = new Map(t.verdict.responses.map((r) => [r.item.itemId, r]));
    const unanswered = new Set(t.verdict.unanswered.map((i) => i.itemId));
    for (const item of t.items) {
      if (unanswered.has(item.itemId)) {
        out.push({ where: 'ITEM', itemId: item.itemId, text: `${item.label}: not answered` });
        continue;
      }
      const r = byItem.get(item.itemId);
      if (r && r.problems.length > 0) {
        out.push({ where: 'ITEM', itemId: item.itemId,
                   text: `${item.label}: ${r.problems.join(', ').toLowerCase()}` });
      }
    }
  }

  // ── readings ──
  if (t.meterReading == null) {
    out.push({ where: 'READINGS', text: 'Enter the hour meter reading' });
  } else if (t.lastMeterReading != null && t.meterReading < t.lastMeterReading
             && !(t.remarks ?? '').trim()) {
    out.push({ where: 'READINGS',
               text: `Meter reads ${t.meterReading}, lower than the last ${t.lastMeterReading}. ` +
                     `Check it, or say why in the remarks` });
  }
  const fuel = fuelProblem(t.fuelLevel);
  if (fuel) out.push({ where: 'READINGS', text: fuel });

  return out;
}
