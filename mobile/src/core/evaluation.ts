/**
 * The rules that decide what an answer means.
 *
 * ── WHY THIS LIVES ON THE DEVICE ────────────────────────────────────────────
 * There is no network at the face. An operator who fails the brake check must
 * be told *there and then* that the machine is blocked — telling him when the
 * tablet next reaches the gate is useless, because by then the machine has been
 * driven.
 *
 * So the device decides, and the server decides again on receipt. Both must
 * reach the same verdict: the inputs are identical (the item carries its own
 * range and severity, migration 105) and the rules below are the server's
 * rules. Where they could ever disagree the server wins, and the difference is
 * recorded rather than smoothed over — a capture whose verdict changed on
 * arrival is something a supervisor needs to see.
 *
 * Keep this file and the server's evaluator in step. They are two
 * implementations of one specification, and that is a deliberate cost of
 * working offline, not an accident to tidy away later.
 */

import {
  type Answer, type ResponseType, type Severity, type SessionType,
  answersFor, isAdverse, isNotApplicable, isMoreSevere,
} from './enums';

/** One checklist item, as cached from the server. */
export interface ChecklistItem {
  itemId: number;
  label: string;
  responseType: ResponseType;
  isCritical: boolean;
  requiresPhotoIfNotOk: boolean;
  defaultSeverity: Severity;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  category?: string | null;
}

/** What the operator put in. */
export interface RawResponse {
  itemId: number;
  answer?: Answer | null;
  numericValue?: number | null;
  remark?: string | null;
  photoCount?: number;
}

/** What the rules make of it. */
export interface EvaluatedResponse {
  item: ChecklistItem;
  raw: RawResponse;
  /** NOT OK, CAUTION, or a reading outside its range. */
  isAdverse: boolean;
  /** Null for anything that is not a bounded numeric. */
  inRange: boolean | null;
  /** Resolved at capture, so the stored record does not depend on limits that
   *  may since have changed. Null when the answer is not adverse. */
  severity: Severity | null;
  /** Why this cannot be submitted yet. Empty means it can. */
  problems: string[];
  /** A critical item answered adversely is what blocks a handover. */
  blocks: boolean;
}

export interface SessionVerdict {
  responses: EvaluatedResponse[];
  /** Critical items answered adversely. Non-empty means the machine does not
   *  change hands. */
  blockingItems: EvaluatedResponse[];
  adverseCount: number;
  highestSeverity: Severity | null;
  unanswered: ChecklistItem[];
  problems: string[];
  isBlocked: boolean;
  canSubmit: boolean;
  /** Goes into `hoto_session.blocked_reason`. The server requires one on any
   *  BLOCKED row, and "critical check failed" is not a reason anybody can act
   *  on six weeks later. */
  blockedReason: string | null;
}

const num = (v: number): string => (Number.isInteger(v) ? String(v) : String(v));

/** How a range reads on screen: "80–120 psi", "≥ 2 bar", "≤ 95 °C". */
export function rangeLabel(item: ChecklistItem): string | null {
  const { minValue: lo, maxValue: hi, unit } = item;
  if (lo == null && hi == null) return null;
  const u = unit ? ` ${unit}` : '';
  if (lo != null && hi != null) return `${num(lo)}–${num(hi)}${u}`;
  return lo != null ? `≥ ${num(lo)}${u}` : `≤ ${num(hi as number)}${u}`;
}

/** Evaluate one answer against its item. */
export function evaluateOne(item: ChecklistItem, raw: RawResponse): EvaluatedResponse {
  const problems: string[] = [];
  let inRange: boolean | null = null;
  let adverse = false;

  const answered = raw.answer != null || raw.numericValue != null;
  if (!answered) {
    return { item, raw, isAdverse: false, inRange: null, severity: null,
             problems: ['Not answered'], blocks: false };
  }

  if (item.responseType === 'NUMERIC') {
    const v = raw.numericValue;
    if (v == null) {
      problems.push('Needs a reading');
    } else if (item.minValue != null || item.maxValue != null) {
      // An unbounded numeric is recorded, not judged. Boom pressure has no
      // range in the mine's own list, and inventing one here would start
      // blocking machines on a limit nobody agreed.
      inRange =
        (item.minValue == null || v >= item.minValue) &&
        (item.maxValue == null || v <= item.maxValue);
      adverse = !inRange;
    }
  } else {
    const a = raw.answer;
    if (a == null) {
      problems.push('Needs an answer');
    } else if (!answersFor(item.responseType).includes(a)) {
      problems.push(`${a} is not an answer to a ${item.responseType} item`);
    } else if (isNotApplicable(a)) {
      // A critical item cannot be waved away. If the fire extinguisher
      // genuinely does not apply to this machine, that is a template
      // correction in the admin panel, not a tap in a cab.
      if (item.isCritical) problems.push('A critical item cannot be marked Not applicable');
    } else {
      adverse = isAdverse(a);
    }
  }

  // An adverse finding needs saying why, and usually a photo. "Brakes not OK"
  // is an argument; "brakes not OK, and here is the photo" is a defect somebody
  // can act on.
  if (adverse) {
    if (!raw.remark || raw.remark.trim() === '') problems.push('Say what is wrong');
    if (item.requiresPhotoIfNotOk && (raw.photoCount ?? 0) === 0) problems.push('Add a photo');
  }

  return {
    item, raw,
    isAdverse: adverse,
    inRange,
    severity: adverse ? item.defaultSeverity : null,
    problems,
    blocks: adverse && item.isCritical,
  };
}

/** Evaluate a whole session. */
export function evaluateSession(args: {
  items: ChecklistItem[];
  answers: Map<number, RawResponse>;
  sessionType: SessionType;
  meterReading?: number | null;
  lastMeterReading?: number | null;
}): SessionVerdict {
  const { items, answers, meterReading, lastMeterReading } = args;

  const responses: EvaluatedResponse[] = [];
  const unanswered: ChecklistItem[] = [];

  for (const item of items) {
    const raw = answers.get(item.itemId);
    if (!raw || (raw.answer == null && raw.numericValue == null)) {
      unanswered.push(item);
      continue;
    }
    responses.push(evaluateOne(item, raw));
  }

  const blockingItems = responses.filter((r) => r.blocks);
  const adverse = responses.filter((r) => r.isAdverse);

  let highestSeverity: Severity | null = null;
  for (const r of adverse) {
    if (r.severity && (highestSeverity === null || isMoreSevere(r.severity, highestSeverity))) {
      highestSeverity = r.severity;
    }
  }

  const problems: string[] = [];
  for (const r of responses) {
    for (const p of r.problems) problems.push(`${r.item.label}: ${p}`);
  }

  // The meter is the only honest boundary between two operators' work, so a
  // reading that went backwards is queried at the machine rather than
  // reconciled by somebody in an office next week.
  if (meterReading != null && lastMeterReading != null && meterReading < lastMeterReading) {
    problems.push(
      `Meter reads ${num(meterReading)} but was last ${num(lastMeterReading)} — check the reading`,
    );
  }

  const blockedReason = blockingItems.length === 0 ? null :
    blockingItems.map((r) => {
      if (r.item.responseType === 'NUMERIC' && r.raw.numericValue != null) {
        return `${r.item.label} ${num(r.raw.numericValue)}${r.item.unit ?? ''}` +
               ` outside ${rangeLabel(r.item)}`;
      }
      return `${r.item.label} ${String(r.raw.answer).replace('_', ' ').toLowerCase()}`;
    }).join('; ');

  return {
    responses,
    blockingItems,
    adverseCount: adverse.length,
    highestSeverity,
    unanswered,
    problems,
    isBlocked: blockingItems.length > 0,
    canSubmit: problems.length === 0 && unanswered.length === 0,
    blockedReason,
  };
}
