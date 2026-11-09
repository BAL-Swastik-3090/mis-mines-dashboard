/**
 * The vocabulary this app shares with the server.
 *
 * Every string value here must match a CHECK constraint in
 * `minehub/migrations/105_*.sql` and `106_*.sql` exactly. If one drifts, the
 * server rejects the capture after the operator has walked away from the
 * machine — the worst possible moment to find out. `enums.test.ts` asserts
 * these against the migrations so a rename cannot pass review silently.
 */

/** What kind of answer an item asks for. `hoto_checklist_item.response_type`. */
export const RESPONSE_TYPES = ['OK_CAUTION_NOTOK', 'NUMERIC', 'YES_NO', 'LEVEL'] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

/** `hoto_response.answer`. */
export const ANSWERS = ['OK', 'CAUTION', 'NOT_OK', 'YES', 'NO', 'LOW', 'NORMAL', 'HIGH', 'NA'] as const;
export type Answer = (typeof ANSWERS)[number];

/** `hoto_checklist_item.default_severity` and `hoto_response.severity`. */
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** `hoto_session.session_type`. */
export const SESSION_TYPES = ['START_HANDOVER', 'MID_SHIFT', 'END_HANDOVER'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/**
 * `hoto_session.status` — the SERVER's state.
 *
 * Deliberately separate from {@link SyncState}: "the operator confirmed this"
 * and "the server has it" are different facts, and a screen that conflates
 * them tells somebody their handover is filed while it sits in a cab.
 */
export const SESSION_STATUSES = [
  'DRAFT', 'SUBMITTED', 'BLOCKED', 'ACCEPTED', 'REJECTED', 'CANCELLED',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** `hoto_device.profile`. */
export const DEVICE_PROFILES = ['PERSONAL', 'COMPANY'] as const;
export type DeviceProfile = (typeof DEVICE_PROFILES)[number];

/** `hoto_session.gps_status`. Recorded as found, never as hoped. */
export const GPS_STATUSES = ['OK', 'DENIED', 'STALE', 'UNAVAILABLE'] as const;
export type GpsStatus = (typeof GPS_STATUSES)[number];

/** How the operator was identified. Audit only — never a login session. */
export const IDENTIFICATION_METHODS = ['PIN', 'BADGE', 'EMPNO'] as const;
export type IdentificationMethod = (typeof IDENTIFICATION_METHODS)[number];

/** Where a locally captured record has got to. **Local only — never sent.** */
export type SyncState =
  /** Being filled in. Nobody has confirmed it. */
  | 'draft'
  /** Confirmed and complete on the device, waiting for a network. */
  | 'queued'
  /** Being sent now. */
  | 'sending'
  /** The server has it and returned a reference. */
  | 'synced'
  /** The server refused it. Kept, never discarded — a refusal is evidence. */
  | 'rejected'
  /** The server holds a different record for the same machine, shift and type.
   *  Retained for a supervisor rather than silently overwritten. */
  | 'conflict';

export const isPending = (s: SyncState): boolean => s === 'queued' || s === 'sending';

/** The answers a given item type accepts. A NUMERIC item takes a reading instead. */
export function answersFor(t: ResponseType): readonly Answer[] {
  switch (t) {
    case 'OK_CAUTION_NOTOK': return ['OK', 'CAUTION', 'NOT_OK', 'NA'];
    case 'YES_NO': return ['YES', 'NO', 'NA'];
    case 'LEVEL': return ['LOW', 'NORMAL', 'HIGH', 'NA'];
    case 'NUMERIC': return [];
  }
}

/**
 * Whether an answer is an adverse finding that should raise a defect.
 *
 * **CAUTION counts.** A machine that runs but needs watching is the most
 * useful thing a handover records, and treating it as a pass is how it gets
 * lost.
 */
export const isAdverse = (a: Answer): boolean => a === 'NOT_OK' || a === 'CAUTION';

/** NA is not an answer — it declares the question does not apply. */
export const isNotApplicable = (a: Answer): boolean => a === 'NA';

const SEVERITY_RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export const severityRank = (s: Severity): number => SEVERITY_RANK[s];
export const isMoreSevere = (a: Severity, b: Severity): boolean => SEVERITY_RANK[a] > SEVERITY_RANK[b];

/** Only a start handover can be accepted or refused — the server CHECKs this too. */
export const canBeAcceptedOrRejected = (t: SessionType): boolean => t === 'START_HANDOVER';

export const isHandover = (t: SessionType): boolean => t !== 'MID_SHIFT';

/** Whether an identified operator may persist between captures on this device. */
export const mayInheritIdentity = (p: DeviceProfile): boolean => p === 'PERSONAL';
