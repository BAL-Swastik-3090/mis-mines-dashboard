/**
 * The unfinished handovers on this tablet, in the order they matter.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The home screen listed them as near-identical cards, most saying "nobody
 * identified yet", newest first (issue E5). A draft on a machine that has
 * already failed a critical check -- a machine that must not change hands --
 * sat among abandoned walk-rounds from two days ago, looking exactly like
 * them. So each one now carries what makes it urgent, and they are ordered by
 * it:
 *
 *   1. a critical check failed: the machine is held and the record of why is
 *      not filed yet;
 *   2. something was found;
 *   3. everything else, newest first.
 *
 * Ordering and wording are pure and tested; the query is the only part that
 * touches the database.
 */

import type { Store } from './store';
import type { SessionType } from '../enums';

export interface DraftSummary {
  client_uuid: string;
  asset_id: number;
  fleet_code: string | null;
  registration_no: string | null;
  session_type: SessionType;
  captured_at: string;
  operator_id: number | null;
  operator_name: string | null;
  meter_reading: number | null;
  /** Checks with an answer. */
  answered: number;
  /** Checks on the checklist it was started against. */
  total: number;
  /** Answers that report a fault. */
  findings: number;
  /** Faults on checks that stop the machine. */
  blocking: number;
}

export async function draftSummaries(store: Store): Promise<DraftSummary[]> {
  return store.getAllAsync<DraftSummary>(
    `SELECT s.client_uuid, s.asset_id, a.fleet_code, a.registration_no,
            s.session_type, s.captured_at, s.operator_id, o.name AS operator_name, s.meter_reading,
            (SELECT count(*) FROM response r
              WHERE r.session_uuid = s.client_uuid
                AND (r.answer IS NOT NULL OR r.numeric_value IS NOT NULL)) AS answered,
            (SELECT count(*) FROM cached_item i
               JOIN cached_section c ON c.section_id = i.section_id
              WHERE c.template_id = s.template_id) AS total,
            -- severity is resolved at capture and set only on an adverse answer
            (SELECT count(*) FROM response r
              WHERE r.session_uuid = s.client_uuid AND r.severity IS NOT NULL) AS findings,
            (SELECT count(*) FROM response r
               JOIN cached_item i ON i.item_id = r.item_id
              WHERE r.session_uuid = s.client_uuid AND r.severity IS NOT NULL
                AND i.is_critical = 1) AS blocking
       FROM session s
       LEFT JOIN cached_asset a ON a.asset_id = s.asset_id
       LEFT JOIN cached_operator o ON o.operator_id = s.operator_id
      WHERE s.sync_state = 'draft'`,
  );
}

/** How urgent: lower comes first. */
export function urgency(d: DraftSummary): 0 | 1 | 2 {
  if (d.blocking > 0) return 0;
  if (d.findings > 0) return 1;
  return 2;
}

/** Held machines first, then anything found, then newest first. */
export function byUrgency(list: DraftSummary[]): DraftSummary[] {
  return [...list].sort((a, b) =>
    urgency(a) - urgency(b) || Date.parse(b.captured_at) - Date.parse(a.captured_at));
}

/** A draft this old was most likely walked away from, not interrupted. */
export const STALE_DRAFT_HOURS = 12;

/** "just now", "25 min ago", "3 h ago", "yesterday", "4 days ago". */
export function ago(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function isStale(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(iso) > STALE_DRAFT_HOURS * 3600 * 1000;
}
