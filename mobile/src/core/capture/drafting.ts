/**
 * Two things about the handovers on this tablet that are not the record:
 * throwing away an unfinished one, and who usually fills them in.
 *
 * ── DISCARDING (gap G1) ──────────────────────────────────────────────────────
 * An unfinished handover -- the wrong machine picked, started by mistake, a
 * second one for the same machine -- sat on the home screen for ever, because
 * nothing could remove it. "Walking away is not discarding" is still true:
 * leaving a draft keeps it. Discarding is a separate, deliberate act with a
 * reason, and it is refused for anything already confirmed -- a confirmed
 * handover is signed, and only the office can withdraw it.
 *
 * ── WHO USUALLY FILLS THEM IN (gap G4) ───────────────────────────────────────
 * A supervisor doing a section's handovers picked their own name on every one.
 * The tablet now remembers who filled the last one in, and starts the next
 * one with them -- but only within a shift (12 hours), and only when it was
 * somebody OTHER than the operator: an operator doing their own handover
 * leaves nothing behind for the next person. The people screen shows the
 * choice plainly, with "the operator is filling it in" one tap away, so a
 * remembered name is a default that can be seen, not a guess that cannot.
 */

import type { Store } from './store';
import type { CachedOperator } from './masters';
import * as masters from './masters';

export const DISCARD_REASONS = ['WRONG_MACHINE', 'BY_MISTAKE', 'DUPLICATE', 'OTHER'] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

/**
 * Remove an unfinished handover and everything captured for it.
 * Returns the photo files the caller should delete from storage.
 */
export async function discardDraft(
  store: Store, uuid: string, reason: DiscardReason, now: Date = new Date(),
): Promise<{ photoPaths: string[] }> {
  const s = await store.getFirstAsync<{ sync_state: string; asset_id: number }>(
    `SELECT sync_state, asset_id FROM session WHERE client_uuid = ?`, [uuid]);
  if (!s) throw new Error('no such handover on this tablet');
  if (s.sync_state !== 'draft') {
    throw new Error('this handover has been confirmed and cannot be discarded on the tablet');
  }
  const photos = await store.getAllAsync<{ local_path: string }>(
    `SELECT local_path FROM photo WHERE session_uuid = ?`, [uuid]);
  const answered = await store.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM response WHERE session_uuid = ?`, [uuid]);

  await store.runAsync(`DELETE FROM photo WHERE session_uuid = ?`, [uuid]);
  await store.runAsync(`DELETE FROM response WHERE session_uuid = ?`, [uuid]);
  await store.runAsync(`DELETE FROM session WHERE client_uuid = ? AND sync_state = 'draft'`, [uuid]);
  // Kept on the tablet: the one trace that an unfinished handover existed and
  // why it was thrown away.
  await store.runAsync(
    `INSERT INTO sync_log (at, kind, subject_uuid, ok, http_status, detail)
     VALUES (?, 'DISCARD', ?, 1, NULL, ?)`,
    [now.toISOString(), uuid,
     `${reason}; machine ${s.asset_id}; ${answered?.n ?? 0} answers; ${photos.length} photos`]);
  return { photoPaths: photos.map((p) => p.local_path) };
}

/** How long a remembered "filled in by" lasts: one shift, with room to spare. */
export const RECORDER_MEMORY_HOURS = 12;
const KEY = 'last_recorder';

/**
 * Note who filled in a handover just confirmed. Called from confirm().
 * Somebody other than the operator is remembered; the operator themself
 * clears the memory, so the next person does not inherit a stale name.
 */
export async function rememberRecorder(
  store: Store, recorder: { operator_id: number | null; is_operator: boolean },
  now: Date = new Date(),
): Promise<void> {
  const value = recorder.is_operator || recorder.operator_id == null
    ? JSON.stringify({ self: true, at: now.toISOString() })
    : JSON.stringify({ operator_id: recorder.operator_id, at: now.toISOString() });
  await store.runAsync(
    `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [KEY, value]);
}

/** The person to start the next handover with, or null for "the operator". */
export async function rememberedRecorder(
  store: Store, now: Date = new Date(),
): Promise<CachedOperator | null> {
  const row = await store.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = ?`, [KEY]);
  if (!row) return null;
  let v: { self?: boolean; operator_id?: number; at?: string };
  try { v = JSON.parse(row.value); } catch { return null; }
  if (v.self || !v.operator_id || !v.at) return null;
  if (now.getTime() - Date.parse(v.at) > RECORDER_MEMORY_HOURS * 3600 * 1000) return null;
  return masters.operator(store, v.operator_id);
}
