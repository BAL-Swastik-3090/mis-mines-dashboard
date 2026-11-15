/**
 * What one tap may and may not answer.
 *
 * The first three tests are the point of the file. If any of them ever fails,
 * a button in a cab can pass a check nobody made, and the handover record
 * stops meaning anything.
 */

import { cleanAnswerFor, planRoutineAnswers, ROUTINE_PASS } from './routine';
import type { ChecklistItem, RawResponse } from './evaluation';
import type { ResponseType } from './enums';

const item = (
  itemId: number, responseType: ResponseType, isCritical = false,
  adverseAnswer: 'YES' | 'NO' | null = null,
): ChecklistItem => ({
  itemId,
  label: `item ${itemId}`,
  responseType,
  isCritical,
  requiresPhotoIfNotOk: false,
  defaultSeverity: 'MEDIUM',
  adverseAnswer,
});

const none = new Map<number, RawResponse>();

test('a critical check is NEVER answered in bulk', () => {
  const items = [
    item(1, 'OK_CAUTION_NOTOK', true),   // parking brake
    item(2, 'OK_CAUTION_NOTOK', false),  // a mirror
  ];
  const plan = planRoutineAnswers(items, none);

  expect(plan.fill.map((f) => f.item.itemId)).toEqual([2]);
  expect(plan.criticalLeft.map((i) => i.itemId)).toEqual([1]);
});

test('a reading is NEVER answered in bulk', () => {
  const items = [item(1, 'NUMERIC'), item(2, 'LEVEL')];
  const plan = planRoutineAnswers(items, none);

  expect(plan.fill.map((f) => f.item.itemId)).toEqual([2]);
  expect(plan.readingsLeft.map((i) => i.itemId)).toEqual([1]);
});

test('an answer the operator already gave is never overwritten', () => {
  const items = [item(1, 'OK_CAUTION_NOTOK'), item(2, 'OK_CAUTION_NOTOK')];
  const answers = new Map<number, RawResponse>([
    // He found something. One tap must not quietly turn this into OK.
    [1, { itemId: 1, answer: 'NOT_OK', remark: 'cracked' }],
  ]);
  const plan = planRoutineAnswers(items, answers);

  expect(plan.fill.map((f) => f.item.itemId)).toEqual([2]);
});

test('each kind of routine check gets its clean answer', () => {
  const items = [
    item(1, 'OK_CAUTION_NOTOK'), item(2, 'YES_NO', false, 'YES'), item(3, 'LEVEL'),
  ];
  const plan = planRoutineAnswers(items, none);

  expect(plan.fill.map((f) => f.answer)).toEqual(['OK', 'NO', 'NORMAL']);
});

test('a yes/no item is answered from ITS OWN classification, not a guess', () => {
  // "Exhaust smoke (excessive)" — YES is the finding, so NO is clean.
  // "Grease points done"        — NO is the finding, so YES is clean.
  // Assuming NO for both would have recorded every machine as ungreased.
  const smoke = item(1, 'YES_NO', false, 'YES');
  const grease = item(2, 'YES_NO', false, 'NO');
  const plan = planRoutineAnswers([smoke, grease], none);

  expect(cleanAnswerFor(smoke)).toBe('NO');
  expect(cleanAnswerFor(grease)).toBe('YES');
  expect(plan.fill.map((f) => f.answer)).toEqual(['NO', 'YES']);
});

test('an unclassified yes/no item is left for a person, not guessed', () => {
  const unknown = item(1, 'YES_NO', false, null);
  const plan = planRoutineAnswers([unknown], none);

  expect(plan.fill).toHaveLength(0);
  expect(plan.unclassified.map((i) => i.itemId)).toEqual([1]);
  expect(cleanAnswerFor(unknown)).toBeNull();
});

test('ROUTINE_PASS no longer carries a yes/no answer at all', () => {
  // It cannot: the clean answer depends on the question, not the type.
  expect(ROUTINE_PASS.YES_NO).toBeUndefined();
});

test('a critical check that was already answered is not reported as left', () => {
  const items = [item(1, 'OK_CAUTION_NOTOK', true)];
  const answers = new Map<number, RawResponse>([[1, { itemId: 1, answer: 'OK' }]]);
  const plan = planRoutineAnswers(items, answers);

  expect(plan.criticalLeft).toHaveLength(0);
  expect(plan.fill).toHaveLength(0);
});

test('a whole tipper checklist leaves exactly the critical items and the gauges', () => {
  const items = [
    item(1, 'NUMERIC'),                  // oil pressure
    item(2, 'NUMERIC'),                  // water temperature
    item(3, 'YES_NO', false, 'YES'),     // exhaust smoke
    item(4, 'NUMERIC', true),            // air pressure — stops the machine
    item(5, 'OK_CAUTION_NOTOK', true),   // service brake — stops the machine
    item(6, 'OK_CAUTION_NOTOK', true),   // parking brake — stops the machine
    item(7, 'OK_CAUTION_NOTOK'),         // tyres
    item(8, 'LEVEL'),                    // brake fluid
  ];
  const plan = planRoutineAnswers(items, none);

  expect(plan.fill.map((f) => f.item.itemId)).toEqual([3, 7, 8]);
  expect(plan.criticalLeft.map((i) => i.itemId)).toEqual([4, 5, 6]);
  expect(plan.readingsLeft.map((i) => i.itemId)).toEqual([1, 2]);
});

test('nothing to do on an already-complete checklist', () => {
  const items = [item(1, 'OK_CAUTION_NOTOK'), item(2, 'YES_NO', false, 'YES')];
  const answers = new Map<number, RawResponse>([
    [1, { itemId: 1, answer: 'OK' }],
    [2, { itemId: 2, answer: 'NO' }],
  ]);
  expect(planRoutineAnswers(items, answers).fill).toHaveLength(0);
});

test('an empty template is not an error', () => {
  const plan = planRoutineAnswers([], none);
  expect(plan.fill).toHaveLength(0);
  expect(plan.criticalLeft).toHaveLength(0);
});
