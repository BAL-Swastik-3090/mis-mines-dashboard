/**
 * What has been done on this tablet, and by whom.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * A supervisor doing the handovers for a section had no way to see, on the
 * tablet in their hand, which machines they had already done. The home screen
 * showed only what was unfinished or still waiting to send; a handover that
 * had reached the office vanished from the app entirely, though the tablet
 * keeps every one it ever confirmed.
 *
 * So this reads them back: every confirmed handover in a period, with who
 * filled it in, so the list can be narrowed to one person -- "which vehicles
 * did I do today" -- and whether each has reached the office.
 *
 * Read from the tablet's own records, so it works with no signal. It shows
 * what was done ON THIS TABLET; handovers done on another tablet are on the
 * dashboard.
 */

import type { Store } from './store';
import type { SessionType } from '../enums';

export interface DoneRow {
  client_uuid: string;
  asset_id: number;
  fleet_code: string | null;
  registration_no: string | null;
  session_type: SessionType;
  captured_at: string;
  confirmed_at: string | null;
  status: string;
  blocked_reason: string | null;
  sync_state: string;
  sync_error: string | null;
  server_session_ref: string | null;
  operator_id: number | null;
  operator_name: string | null;
  recorded_by_operator_id: number | null;
  recorder_name: string | null;
  counterpart_name: string | null;
  counterpart_absent: number;
  findings: number;
  photos_waiting: number;
}

export type Period = 'today' | 'yesterday' | 'week';

/** Local-time bounds of a period, as the ISO strings captured_at is stored in. */
export function periodBounds(p: Period, now: Date = new Date()): { from: string; to: string } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 24 * 3600 * 1000;
  const from = p === 'today' ? midnight
    : p === 'yesterday' ? new Date(midnight.getTime() - day)
    : new Date(midnight.getTime() - 6 * day);
  const to = p === 'yesterday' ? midnight : new Date(midnight.getTime() + day);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function doneOnTablet(
  store: Store, period: Period, now: Date = new Date(),
): Promise<DoneRow[]> {
  const { from, to } = periodBounds(period, now);
  return store.getAllAsync<DoneRow>(
    `SELECT s.client_uuid, s.asset_id, a.fleet_code, a.registration_no, s.session_type,
            s.captured_at, s.confirmed_at, s.status, s.blocked_reason,
            s.sync_state, s.sync_error, s.server_session_ref,
            s.operator_id, o.name AS operator_name,
            s.recorded_by_operator_id, r.name AS recorder_name,
            c.name AS counterpart_name, s.counterpart_absent,
            (SELECT count(*) FROM response x
              WHERE x.session_uuid = s.client_uuid AND x.severity IS NOT NULL) AS findings,
            (SELECT count(*) FROM photo p
              WHERE p.session_uuid = s.client_uuid AND p.sync_state <> 'synced') AS photos_waiting
       FROM session s
       LEFT JOIN cached_asset a    ON a.asset_id = s.asset_id
       LEFT JOIN cached_operator o ON o.operator_id = s.operator_id
       LEFT JOIN cached_operator r ON r.operator_id = s.recorded_by_operator_id
       LEFT JOIN cached_operator c ON c.operator_id = s.counterpart_operator_id
      WHERE s.sync_state <> 'draft'
        AND s.captured_at >= ? AND s.captured_at < ?
      ORDER BY s.captured_at DESC`,
    [from, to],
  );
}

/** Who filled it in, as a name -- the operator themself when nobody else was named. */
export function filledInBy(r: DoneRow): string {
  if (r.recorder_name) return r.recorder_name;
  if (r.recorded_by_operator_id == null) return 'Not recorded';
  return r.operator_name ?? 'The operator';
}

/** The people who filled handovers in, most first, for the filter. */
export function people(rows: DoneRow[]): { name: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(filledInBy(r), (m.get(filledInBy(r)) ?? 0) + 1);
  return [...m].map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/** Where a handover has got to, in the words the screen uses. */
export function whereItIs(r: DoneRow): 'office' | 'waiting' | 'refused' {
  if (r.sync_state === 'synced') return r.photos_waiting > 0 ? 'waiting' : 'office';
  if (r.sync_state === 'rejected' || r.sync_state === 'conflict') return 'refused';
  return 'waiting';
}

export function summary(rows: DoneRow[]): {
  handovers: number; machines: number; atOffice: number; waiting: number;
  refused: number; withFaults: number; held: number;
} {
  return {
    handovers: rows.length,
    machines: new Set(rows.map((r) => r.asset_id)).size,
    atOffice: rows.filter((r) => whereItIs(r) === 'office').length,
    waiting: rows.filter((r) => whereItIs(r) === 'waiting').length,
    refused: rows.filter((r) => whereItIs(r) === 'refused').length,
    withFaults: rows.filter((r) => r.findings > 0).length,
    held: rows.filter((r) => r.status === 'BLOCKED').length,
  };
}
