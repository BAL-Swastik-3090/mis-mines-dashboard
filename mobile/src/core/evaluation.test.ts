import { evaluateOne, evaluateSession, rangeLabel, type ChecklistItem } from './evaluation';

/** Items taken from the real seeded library (migration 105), not invented. */
const airPressure: ChecklistItem = {
  itemId: 1, label: 'Air pressure', responseType: 'NUMERIC',
  isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
  unit: 'psi', minValue: 80, maxValue: 120,
};
const boomPressure: ChecklistItem = {
  itemId: 2, label: 'Boom pressure', responseType: 'NUMERIC',
  isCritical: false, requiresPhotoIfNotOk: true, defaultSeverity: 'HIGH',
  unit: 'bar', minValue: null, maxValue: null,
};
const brakes: ChecklistItem = {
  itemId: 3, label: 'Service brake response', responseType: 'OK_CAUTION_NOTOK',
  isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
};
const lights: ChecklistItem = {
  itemId: 4, label: 'Lights', responseType: 'OK_CAUTION_NOTOK',
  isCritical: false, requiresPhotoIfNotOk: false, defaultSeverity: 'LOW',
};
const extinguisher: ChecklistItem = {
  itemId: 5, label: 'Fire extinguisher (charge + date)', responseType: 'YES_NO',
  isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
};

const ok = (i: ChecklistItem) => ({ itemId: i.itemId, answer: 'OK' as const });

describe('a gauge reading', () => {
  it('inside its range is not adverse', () => {
    const r = evaluateOne(airPressure, { itemId: 1, numericValue: 95 });
    expect(r.inRange).toBe(true);
    expect(r.isAdverse).toBe(false);
    expect(r.severity).toBeNull();
  });

  it('below its range blocks, because the item is critical', () => {
    const r = evaluateOne(airPressure, {
      itemId: 1, numericValue: 74, remark: 'bleeding down overnight', photoCount: 1,
    });
    expect(r.inRange).toBe(false);
    expect(r.isAdverse).toBe(true);
    expect(r.severity).toBe('CRITICAL');
    expect(r.blocks).toBe(true);
  });

  it('is recorded but not judged when the item has no range', () => {
    // Boom pressure carries no limits in the mine's own list. Inventing one
    // here would start blocking machines on a figure nobody agreed.
    const r = evaluateOne(boomPressure, { itemId: 2, numericValue: 310 });
    expect(r.inRange).toBeNull();
    expect(r.isAdverse).toBe(false);
    expect(r.blocks).toBe(false);
  });

  it('out of range still needs a reason and a photo', () => {
    const r = evaluateOne(airPressure, { itemId: 1, numericValue: 74 });
    expect(r.problems).toContain('Say what is wrong');
    expect(r.problems).toContain('Add a photo');
    expect(r.isComplete ?? r.problems.length === 0).toBe(false);
  });
});

describe('CAUTION', () => {
  it('counts as adverse — a machine that runs but needs watching is the point', () => {
    const r = evaluateOne(lights, {
      itemId: 4, answer: 'CAUTION', remark: 'nearside dim', photoCount: 0,
    });
    expect(r.isAdverse).toBe(true);
    expect(r.severity).toBe('LOW');
  });

  it('on a critical item blocks, same as NOT OK', () => {
    const r = evaluateOne(brakes, {
      itemId: 3, answer: 'CAUTION', remark: 'slow to bite', photoCount: 1,
    });
    expect(r.blocks).toBe(true);
  });
});

describe('Not applicable', () => {
  it('is refused on a critical item', () => {
    const r = evaluateOne(extinguisher, { itemId: 5, answer: 'NA' });
    expect(r.problems).toContain('A critical item cannot be marked Not applicable');
  });

  it('is accepted on an ordinary one, and is not adverse', () => {
    const r = evaluateOne(lights, { itemId: 4, answer: 'NA' });
    expect(r.problems).toHaveLength(0);
    expect(r.isAdverse).toBe(false);
  });
});

describe('a whole session', () => {
  const items = [airPressure, brakes, lights, extinguisher];

  it('cannot be submitted while an item is unanswered', () => {
    const v = evaluateSession({
      items, sessionType: 'END_HANDOVER',
      answers: new Map([[1, { itemId: 1, numericValue: 95 }], [3, ok(brakes)]]),
    });
    expect(v.unanswered.map((i) => i.label)).toEqual(['Lights', 'Fire extinguisher (charge + date)']);
    expect(v.canSubmit).toBe(false);
  });

  it('blocks on a failed critical item and says why, in words', () => {
    const v = evaluateSession({
      items, sessionType: 'START_HANDOVER',
      answers: new Map<number, any>([
        [1, { itemId: 1, numericValue: 74, remark: 'low', photoCount: 1 }],
        [3, { itemId: 3, answer: 'NOT_OK', remark: 'travels to the floor', photoCount: 2 }],
        [4, ok(lights)],
        [5, { itemId: 5, answer: 'YES' }],
      ]),
    });
    expect(v.isBlocked).toBe(true);
    expect(v.blockingItems).toHaveLength(2);
    expect(v.highestSeverity).toBe('CRITICAL');
    // The server requires a reason on any BLOCKED row, and "critical check
    // failed" is not something anybody can act on six weeks later.
    expect(v.blockedReason).toBe(
      'Air pressure 74psi outside 80–120 psi; Service brake response not ok',
    );
  });

  it('passes clean when everything is in order', () => {
    const v = evaluateSession({
      items, sessionType: 'END_HANDOVER',
      answers: new Map<number, any>([
        [1, { itemId: 1, numericValue: 95 }],
        [3, ok(brakes)], [4, ok(lights)],
        [5, { itemId: 5, answer: 'YES' }],
      ]),
    });
    expect(v.isBlocked).toBe(false);
    expect(v.adverseCount).toBe(0);
    expect(v.canSubmit).toBe(true);
    expect(v.blockedReason).toBeNull();
  });

  it('queries a meter that went backwards', () => {
    const v = evaluateSession({
      items: [lights], sessionType: 'END_HANDOVER',
      answers: new Map([[4, ok(lights)]]),
      meterReading: 12400, lastMeterReading: 12480,
    });
    expect(v.problems.join(' ')).toContain('Meter reads 12400 but was last 12480');
    expect(v.canSubmit).toBe(false);
  });
});

describe('range labels', () => {
  it('read the way a fitter would write them', () => {
    expect(rangeLabel(airPressure)).toBe('80–120 psi');
    expect(rangeLabel(boomPressure)).toBeNull();
    expect(rangeLabel({ ...airPressure, maxValue: null })).toBe('≥ 80 psi');
    expect(rangeLabel({ ...airPressure, minValue: null })).toBe('≤ 120 psi');
  });
});
