/**
 * Which shift a handover belongs to.
 *
 * The night-shift cases are the point. A handover at 02:00 belongs to the day
 * the shift STARTED, and getting that backwards splits one night's work across
 * two production days in every report that follows.
 */

import { resolveShift, type CachedShift } from './shifts';

// The mine's own hours, as the server sends them.
const CALENDAR: CachedShift[] = [
  { shift_id: 1, code: 'A', name: 'A shift', start_time: '06:00:00',
    end_time: '14:00:00', crosses_midnight: 0 },
  { shift_id: 4, code: 'GENERAL', name: 'General shift', start_time: '09:00:00',
    end_time: '17:30:00', crosses_midnight: 0 },
  { shift_id: 2, code: 'B', name: 'B shift', start_time: '14:00:00',
    end_time: '22:00:00', crosses_midnight: 0 },
  { shift_id: 3, code: 'C', name: 'C shift', start_time: '22:00:00',
    end_time: '06:00:00', crosses_midnight: 1 },
];

const at = (iso: string) => new Date(iso);

test('a morning handover is A shift', () => {
  expect(resolveShift(CALENDAR, at('2026-11-12T07:30:00'))?.code).toBe('A');
});

test('an afternoon handover is B shift', () => {
  expect(resolveShift(CALENDAR, at('2026-11-12T15:00:00'))?.code).toBe('B');
});

test('GENERAL never wins, even though its hours overlap A and B', () => {
  // It is an office day, not a production shift. A handover never belongs to it.
  expect(resolveShift(CALENDAR, at('2026-11-12T10:00:00'))?.code).toBe('A');
  expect(resolveShift(CALENDAR, at('2026-11-12T16:00:00'))?.code).toBe('B');
});

test('before midnight on night shift, the production day is today', () => {
  const r = resolveShift(CALENDAR, at('2026-11-12T23:30:00'));
  expect(r?.code).toBe('C');
  expect(r?.productionDay).toBe('2026-11-12');
});

test('AFTER midnight on night shift, the production day is yesterday', () => {
  // The case everything downstream depends on.
  const r = resolveShift(CALENDAR, at('2026-11-13T02:00:00'));
  expect(r?.code).toBe('C');
  expect(r?.productionDay).toBe('2026-11-12');
});

test('the first minute of a shift belongs to it, the last minute does not', () => {
  expect(resolveShift(CALENDAR, at('2026-11-12T14:00:00'))?.code).toBe('B');
  expect(resolveShift(CALENDAR, at('2026-11-12T13:59:00'))?.code).toBe('A');
  expect(resolveShift(CALENDAR, at('2026-11-12T22:00:00'))?.code).toBe('C');
});

test('06:00 ends the night shift and starts the morning one', () => {
  expect(resolveShift(CALENDAR, at('2026-11-13T05:59:00'))?.code).toBe('C');
  expect(resolveShift(CALENDAR, at('2026-11-13T06:00:00'))?.code).toBe('A');
});

test('a month boundary at 02:00 rolls the production day back correctly', () => {
  const r = resolveShift(CALENDAR, at('2026-12-01T02:00:00'));
  expect(r?.productionDay).toBe('2026-11-30');
});

test('a device with no cached calendar says it does not know', () => {
  // Better than naming a shift it cannot stand behind.
  expect(resolveShift([], at('2026-11-12T07:30:00'))).toBeNull();
});

test('a calendar with a gap says it does not know, rather than guessing', () => {
  const gapped: CachedShift[] = [CALENDAR[0]!];   // A shift only
  expect(resolveShift(gapped, at('2026-11-12T20:00:00'))).toBeNull();
});
