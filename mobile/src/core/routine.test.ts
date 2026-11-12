/**
 * What one tap may and may not answer.
 *
 * The first three tests are the point of the file. If any of them ever fails,
 * a button in a cab can pass a check nobody made, and the handover record
 * stops meaning anything.
 */

import { planRoutineAnswers, ROUTINE_PASS } from './routine';
import type { ChecklistItem, RawResponse } from './evaluation';
import type { ResponseType } from './enums';

const item = (
  itemId: number, responseType: ResponseType, isCritical = false,
): ChecklistItem => ({
  itemId,
  label: `item ${itemId}`,
  responseType,
  isCritical,
  requiresPhotoIfNotOk: false,
  defaultSeverity: 'MEDIUM',
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
    item(1, 'OK_CAUTION_NOTOK'), item(2, 'YES_NO'), item(3, 'LEVEL'),
  ];
  const plan = planRoutineAnswers(items, none);

  expect(plan.fill.map((f) => f.answer)).toEqual(['OK', 'NO', 'NORMAL']);
});

test('YES_NO passes as NO, because the mine phrases these as problems', () => {
  // "Exhaust smoke (excessive)" — NO is the clean answer, YES is the finding.
  expect(ROUTINE_PASS.YES_NO).toBe('NO');
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
    item(3, 'YES_NO'),                   // exhaust smoke
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
  const items = [item(1, 'OK_CAUTION_NOTOK'), item(2, 'YES_NO')];
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
