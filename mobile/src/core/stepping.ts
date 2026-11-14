/**
 * The walk-round one check at a time.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * "All OK" filled every routine check with one tap. That is fast, and it is
 * also a record that says twenty things were looked at when one button was
 * pressed. The mine asked for the opposite: press it and be asked each check
 * in turn, so every answer on the record is an answer somebody gave to a
 * question they were shown (issue B3).
 *
 * It stays quick. A clean answer moves straight on to the next check -- one tap
 * per check, no scrolling, no hunting for the next unanswered one. A fault
 * stops and waits for what it needs (what is wrong, and a photo where the
 * check asks for one) before going on, because that is the moment the
 * operator is still looking at the fault.
 *
 * Pure, so the order is tested without a screen.
 */

import { evaluateOne, type ChecklistItem, type RawResponse } from './evaluation';

const answered = (r: RawResponse | undefined): boolean =>
  r != null && (r.answer != null || r.numericValue != null);

/**
 * The next check to ask after `index`: the first unanswered one after it, or,
 * failing that, the first unanswered one before it. Null when every check has
 * an answer. `index` itself is never returned, so "skip for now" always moves.
 */
export function nextToAsk(
  items: ChecklistItem[], answers: Map<number, RawResponse>, index: number,
): number | null {
  for (let i = index + 1; i < items.length; i++) {
    if (!answered(answers.get(items[i]!.itemId))) return i;
  }
  for (let i = 0; i < Math.min(index, items.length); i++) {
    if (!answered(answers.get(items[i]!.itemId))) return i;
  }
  return null;
}

/** Where to start: the item asked for, or the first unanswered, or the first. */
export function startAt(
  items: ChecklistItem[], answers: Map<number, RawResponse>, itemId?: number | null,
): number {
  if (itemId != null) {
    const i = items.findIndex((x) => x.itemId === itemId);
    if (i >= 0) return i;
  }
  const first = items.findIndex((x) => !answered(answers.get(x.itemId)));
  return first >= 0 ? first : 0;
}

/**
 * Whether this answer lets the walk-round move on by itself.
 *
 * Only a clean, complete answer. A fault needs saying what is wrong (and often
 * a photo) and the operator moves on themself once it has them; a reading is
 * typed, digit by digit, and jumping away after the first digit would be a
 * trap.
 */
export function movesOnByItself(item: ChecklistItem, raw: RawResponse | undefined,
                                photoCount = 0): boolean {
  if (!answered(raw) || item.responseType === 'NUMERIC') return false;
  const ev = evaluateOne(item, { ...raw!, photoCount });
  return !ev.isAdverse && ev.problems.length === 0;
}

/** Whether "Next" may be pressed: answered, and nothing about it still owed. */
export function isSettled(item: ChecklistItem, raw: RawResponse | undefined,
                          photoCount = 0): boolean {
  if (!answered(raw)) return false;
  return evaluateOne(item, { ...raw!, photoCount }).problems.length === 0;
}

/** How many still have no answer at all. */
export function leftToAsk(items: ChecklistItem[], answers: Map<number, RawResponse>): number {
  return items.filter((x) => !answered(answers.get(x.itemId))).length;
}
