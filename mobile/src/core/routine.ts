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
 * What "nothing wrong" is for a three-way or level check.
 *
 * A yes/no item is NOT here, and that is the point. It used to map to NO on
 * the assumption that the mine phrases these as problems. Five of the six in
 * the fleet's templates are phrased that way; "Grease points done" is the
 * sixth, and under that assumption one tap would have recorded every machine
 * as ungreased, every shift. A rule that is wrong one time in six is worse
 * than no rule, because it is wrong quietly.
 *
 * So a yes/no item is answered from its own `adverseAnswer` -- the opposite of
 * whichever answer reports a problem -- and an item nobody has classified is
 * left for a person. See migration 112.
 */
export const ROUTINE_PASS: Partial<Record<ResponseType, Answer>> = {
  OK_CAUTION_NOTOK: 'OK',
  LEVEL: 'NORMAL',
};

/** The clean answer for one item, or null when it cannot be known. */
export function cleanAnswerFor(item: ChecklistItem): Answer | null {
  if (item.responseType === 'YES_NO') {
    if (item.adverseAnswer === 'YES') return 'NO';
    if (item.adverseAnswer === 'NO') return 'YES';
    return null;                       // unclassified: a person answers it
  }
  return ROUTINE_PASS[item.responseType] ?? null;
}

export interface BulkPlan {
  /** The items that would be answered, and with what. */
  fill: { item: ChecklistItem; answer: Answer }[];
  /** Critical items still unanswered. These are never filled. */
  criticalLeft: ChecklistItem[];
  /** Readings still unanswered. These are never filled either. */
  readingsLeft: ChecklistItem[];
  /** Yes/no items with no classification, so no answer can be assumed safe. */
  unclassified: ChecklistItem[];
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
  const unclassified: ChecklistItem[] = [];

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

    const good = cleanAnswerFor(item);
    if (good) fill.push({ item, answer: good });
    else unclassified.push(item);
  }

  return { fill, criticalLeft, readingsLeft, unclassified };
}
