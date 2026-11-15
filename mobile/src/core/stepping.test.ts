import { nextToAsk, startAt, movesOnByItself, isSettled, leftToAsk } from './stepping';
import type { ChecklistItem, RawResponse } from './evaluation';

const item = (itemId: number, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  itemId, label: `Check ${itemId}`, responseType: 'OK_CAUTION_NOTOK',
  isCritical: false, requiresPhotoIfNotOk: false, defaultSeverity: 'LOW', ...over,
});
const items = [item(1), item(2), item(3), item(4)];
const said = (...pairs: [number, RawResponse][]) => new Map<number, RawResponse>(pairs);
const ok = (id: number): [number, RawResponse] => [id, { itemId: id, answer: 'OK' }];

describe('the order checks are asked in', () => {
  it('starts at the first one nobody has answered', () => {
    expect(startAt(items, said(ok(1), ok(2)))).toBe(2);
  });

  it('starts where it is sent, when it is sent somewhere', () => {
    // From the confirm screen: "Lights: say what is wrong" goes to Lights.
    expect(startAt(items, said(), 3)).toBe(2);
  });

  it('starts at the first check when every one is answered', () => {
    expect(startAt(items, said(ok(1), ok(2), ok(3), ok(4)))).toBe(0);
  });

  it('goes on to the next unanswered, passing over ones already answered', () => {
    expect(nextToAsk(items, said(ok(1), ok(2)), 0)).toBe(2);
  });

  it('comes back round for one that was skipped', () => {
    // Skipped check 2, answered 3 and 4: the walk-round is not finished.
    expect(nextToAsk(items, said(ok(1), ok(3), ok(4)), 3)).toBe(1);
  });

  it('never stays where it is, so "skip for now" always moves', () => {
    expect(nextToAsk(items, said(ok(1), ok(3), ok(4)), 1)).toBeNull();
    expect(nextToAsk(items, said(), 1)).toBe(2);
  });

  it('says when there is nothing left to ask', () => {
    expect(nextToAsk(items, said(ok(1), ok(2), ok(3), ok(4)), 2)).toBeNull();
    expect(leftToAsk(items, said(ok(1), ok(2)))).toBe(2);
  });
});

describe('moving on by itself', () => {
  it('moves on after a clean answer', () => {
    expect(movesOnByItself(item(1), { itemId: 1, answer: 'OK' })).toBe(true);
  });

  it('waits on a fault, because the fault still needs saying what is wrong', () => {
    expect(movesOnByItself(item(1), { itemId: 1, answer: 'NOT_OK' })).toBe(false);
    expect(movesOnByItself(item(1), { itemId: 1, answer: 'CAUTION' })).toBe(false);
  });

  it('waits on a yes/no answer that is the fault for that check', () => {
    const smoke = item(5, { responseType: 'YES_NO', adverseAnswer: 'YES' });
    expect(movesOnByItself(smoke, { itemId: 5, answer: 'YES' })).toBe(false);
    expect(movesOnByItself(smoke, { itemId: 5, answer: 'NO' })).toBe(true);
  });

  it('never jumps away from a reading being typed', () => {
    const air = item(6, { responseType: 'NUMERIC', minValue: 80, maxValue: 120, unit: 'psi' });
    expect(movesOnByItself(air, { itemId: 6, numericValue: 100 })).toBe(false);
  });

  it('lets a fault be left once it has what it needs', () => {
    const brakes = item(7, { isCritical: true, requiresPhotoIfNotOk: true });
    const raw = { itemId: 7, answer: 'NOT_OK' as const, remark: 'pedal to the floor' };
    expect(isSettled(brakes, raw, 0)).toBe(false);   // still owes a photo
    expect(isSettled(brakes, raw, 1)).toBe(true);
  });
});
