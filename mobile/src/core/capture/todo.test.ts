import { whatIsLeft, fuelProblem, type TodoInput } from './todo';
import { evaluateSession, type ChecklistItem, type RawResponse } from '../evaluation';

const lights: ChecklistItem = {
  itemId: 1, label: 'Lights', responseType: 'OK_CAUTION_NOTOK',
  isCritical: false, requiresPhotoIfNotOk: false, defaultSeverity: 'LOW',
};
const brakes: ChecklistItem = {
  itemId: 2, label: 'Brakes', responseType: 'OK_CAUTION_NOTOK',
  isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
};
const items = [lights, brakes];

const input = (answers: Map<number, RawResponse>, over: Partial<TodoInput> = {}): TodoInput => ({
  sessionType: 'START_HANDOVER', operatorId: 7, counterpartOperatorId: 8,
  counterpartAbsent: false, hasTemplate: true, assetTypeName: 'Tipper',
  meterReading: 7700, lastMeterReading: 7598, fuelLevel: 60, remarks: null, items,
  verdict: evaluateSession({ items, answers, sessionType: 'START_HANDOVER' }),
  ...over,
});

describe('what is left, and where it is fixed', () => {
  it('is nothing when everything is done', () => {
    const all = new Map<number, RawResponse>([
      [1, { itemId: 1, answer: 'OK' }], [2, { itemId: 2, answer: 'OK' }]]);
    expect(whatIsLeft(input(all))).toEqual([]);
  });

  it('names each unanswered check and points at it', () => {
    const left = whatIsLeft(input(new Map([[1, { itemId: 1, answer: 'OK' }]])));
    expect(left).toEqual([{ where: 'ITEM', itemId: 2, text: 'Brakes: not answered' }]);
  });

  it('puts everything one check still owes on one line', () => {
    const left = whatIsLeft(input(new Map<number, RawResponse>([
      [1, { itemId: 1, answer: 'OK' }], [2, { itemId: 2, answer: 'NOT_OK' }]])));
    expect(left).toEqual([{ where: 'ITEM', itemId: 2,
                            text: 'Brakes: say what is wrong, add a photo' }]);
  });

  it('asks in the order the flow does: people, checks, readings', () => {
    const left = whatIsLeft(input(new Map(), {
      operatorId: null, counterpartOperatorId: null, meterReading: null }));
    expect(left.map((f) => f.where)).toEqual(['PEOPLE', 'PEOPLE', 'ITEM', 'ITEM', 'READINGS']);
  });

  it('accepts "nobody" as the other side', () => {
    const all = new Map<number, RawResponse>([
      [1, { itemId: 1, answer: 'OK' }], [2, { itemId: 2, answer: 'OK' }]]);
    expect(whatIsLeft(input(all, { counterpartOperatorId: null, counterpartAbsent: true })))
      .toEqual([]);
  });

  it('does not ask a mid-shift check about another side', () => {
    const all = new Map<number, RawResponse>([
      [1, { itemId: 1, answer: 'OK' }], [2, { itemId: 2, answer: 'OK' }]]);
    expect(whatIsLeft(input(all, { sessionType: 'MID_SHIFT', counterpartOperatorId: null })))
      .toEqual([]);
  });

  it('sends a lower meter back to the readings, until it is explained', () => {
    const all = new Map<number, RawResponse>([
      [1, { itemId: 1, answer: 'OK' }], [2, { itemId: 2, answer: 'OK' }]]);
    expect(whatIsLeft(input(all, { meterReading: 7000 }))[0]?.where).toBe('READINGS');
    expect(whatIsLeft(input(all, { meterReading: 7000, remarks: 'meter replaced' }))).toEqual([]);
  });

  it('says plainly when nothing on the tablet can fix it', () => {
    const left = whatIsLeft(input(new Map(), { hasTemplate: false, verdict: null }));
    expect(left.find((f) => f.where === 'NOWHERE')?.text)
      .toContain('No checklist is published for Tipper');
  });
});

describe('fuel', () => {
  // The office's database refuses anything outside 0-100, and a handover it
  // refuses is retried for ever from a tablet that cannot fix it.
  it('is a percentage', () => {
    expect(fuelProblem(55)).toBeNull();
    expect(fuelProblem(0)).toBeNull();
    expect(fuelProblem(100)).toBeNull();
    expect(fuelProblem(150)).not.toBeNull();
    expect(fuelProblem(-1)).not.toBeNull();
    expect(fuelProblem(null)).toBeNull();
  });
});
