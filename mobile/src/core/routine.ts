/**
 * Which checks may be answered in one action, and which may never be.
 *
 * ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────
 * Because it is the one place in this app where a tap stands in for somebody
 * looking at a machine, and the rule about what it must never cover is worth
 * more than the convenience it buys. Buried in a screen it would be changed by
 * whoever next finds the button slow; here it is a function with tests against
 * it, and a test that fails loudly if a critical item ever becomes answerable
 * in bulk.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * A check may be answered in bulk only when all three hold:
 *   * it is not critical -- nothing that can stop a machine;
 *   * it does not take a reading -- a number has to be read off a gauge;
 *   * it has not been answered already -- an operator's own answer is never
 *     overwritten, including an adverse one.
 *
 * The handover records that this was used, so a record filled in one tap is
 * not indistinguishable from a walk-round. See migration 111.
 */

import type { Answer, ResponseType } from './enums';
import type { ChecklistItem, RawResponse } from './evaluation';

/**
 * What "nothing wrong" is for each kind of routine check.
 *
 * YES_NO maps to NO because the mine phrases these as problems -- "Exhaust
 * smoke (excessive)", "Leaks", "Unusual noise" -- so NO is the clean answer.
 * A template that ever asks one the other way round ("Fire extinguisher
 * present?") would be passed wrongly by this. That is a reason to phrase such
 * an item as a problem, or to mark it critical, and the comment is here so
 * whoever writes the next template knows it.
 */
export const ROUTINE_PASS: Partial<Record<ResponseType, Answer>> = {
  OK_CAUTION_NOTOK: 'OK',
  YES_NO: 'NO',
  LEVEL: 'NORMAL',
};

export interface BulkPlan {
  /** The items that would be answered, and with what. */
  fill: { item: ChecklistItem; answer: Answer }[];
  /** Critical items still unanswered. These are never filled. */
  criticalLeft: ChecklistItem[];
  /** Readings still unanswered. These are never filled either. */
  readingsLeft: ChecklistItem[];
}

/**
 * Work out what a single "mark the routine checks OK" would do.
 *
 * Returns a plan rather than performing it, so a screen can say exactly what
 * is about to happen -- and what is deliberately left -- before it happens,
 * and so this can be tested without a database.
 */
export function planRoutineAnswers(
  items: ChecklistItem[], answers: Map<number, RawResponse>,
): BulkPlan {
  const fill: { item: ChecklistItem; answer: Answer }[] = [];
  const criticalLeft: ChecklistItem[] = [];
  const readingsLeft: ChecklistItem[] = [];

  for (const item of items) {
    const a = answers.get(item.itemId);
    const answered = a?.answer != null || a?.numericValue != null;

    if (item.isCritical) {
      if (!answered) criticalLeft.push(item);
      continue;                       // NEVER filled, answered or not
    }
    if (item.responseType === 'NUMERIC') {
      if (!answered) readingsLeft.push(item);
      continue;                       // a number has to be read off a gauge
    }
    if (answered) continue;           // never overwrite somebody's own answer

    const good = ROUTINE_PASS[item.responseType];
    if (good) fill.push({ item, answer: good });
  }

  return { fill, criticalLeft, readingsLeft };
}
