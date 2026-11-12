/**
 * Reading the cached masters, and resolving which checklist a machine gets.
 *
 * ── WHY THE DEVICE RESOLVES THE TEMPLATE ITSELF ──────────────────────────────
 * It has to. There is no network at the face, and "which checklist does this
 * tipper get" must be answered before the operator can be shown anything. So
 * the resolver here mirrors `hoto_masters.resolve_template` on the server:
 * most specific scope first, then the newest effective version.
 *
 * The server resolves it AGAIN on receipt and records any disagreement
 * (`template_drift`). That is deliberate: a device holding three-day-old
 * masters may legitimately answer last week's version, and throwing away a
 * handover that actually happened because the template moved would be worse
 * than recording which version was answered.
 */

import type { Store } from './store';
import type { ChecklistItem } from '../evaluation';
import type { Answer, ResponseType, Severity } from '../enums';

export interface CachedAsset {
  asset_id: number;
  fleet_code: string;
  nickname: string | null;
  asset_type_id: number;
  asset_type_name: string;
  qr_code: string | null;
  meter_uom: string | null;
  last_meter_reading: number | null;
  last_meter_at: string | null;
  operational_state: string | null;
  open_defect_count: number;
  has_critical_defect: number;
  home_location_id: number | null;
  cached_at: string;
}

export interface CachedOperator {
  operator_id: number;
  /** Null for the operators the mine has no employee reference for. */
  emp_id: string | null;
  name: string;
  photo_path: string | null;
  competent_type_ids: string;
  competency_valid_to: string | null;
  cached_at: string;
}

export interface ResolvedTemplate {
  template_id: number;
  asset_type_id: number;
  name: string;
  version: number;
  sections: { section_id: number; name: string; display_order: number; items: ChecklistItem[] }[];
  items: ChecklistItem[];
}

interface ItemRow {
  item_id: number;
  section_id: number;
  section_name: string;
  section_order: number;
  label: string;
  response_type: ResponseType;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  category: string | null;
  is_critical: number;
  requires_photo_if_not_ok: number;
  adverse_answer: string | null;
  default_severity: Severity;
  display_order: number;
}

/**
 * Separators are noise, so neither side of a search keeps them.
 *
 * The fleet writes MAN-11 and the operator types "MAN 11", or "man11", because
 * the sticker on the cab is stencilled with a gap in it and nobody types a
 * hyphen on a phone keyboard in a pit. A LIKE on the raw code answers "no
 * machine on this tablet matches MAN 11" while MAN-11 is sitting in the
 * cache -- which reads as "my machine is not here" and sends the operator to
 * paper. Found in the field on 10 Nov 2026.
 */
const STRIP = /[^A-Z0-9]+/g;
export const normaliseCode = (s: string): string => s.toUpperCase().replace(STRIP, '');

/** The same stripping, in SQLite, which has no regex. */
const SQL_NORM = (col: string) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(${col}),` +
  `' ',''),'-',''),'_',''),'.',''),'/',''),'#','')`;

/** Machines the operator can pick from, the ones needing attention first. */
export async function assets(store: Store, search?: string): Promise<CachedAsset[]> {
  const q = normaliseCode(search ?? '');
  const like = q ? `%${q}%` : null;
  return store.getAllAsync<CachedAsset>(
    `SELECT * FROM cached_asset
      WHERE (?1 IS NULL
             OR ${SQL_NORM('fleet_code')} LIKE ?1
             OR ${SQL_NORM("COALESCE(nickname,'')")} LIKE ?1)
      ORDER BY has_critical_defect DESC, open_defect_count DESC, fleet_code`,
    [like],
  );
}

/** How many machines this tablet holds at all -- an empty search is not an empty cache. */
export async function assetCount(store: Store): Promise<number> {
  const r = await store.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM cached_asset`);
  return r?.n ?? 0;
}

/** A machine by the QR sticker on its cab, which is how it is meant to be picked. */
export async function assetByQr(store: Store, qr: string): Promise<CachedAsset | null> {
  return store.getFirstAsync<CachedAsset>(
    `SELECT * FROM cached_asset WHERE qr_code = ?`, [qr.trim()],
  );
}

export async function asset(store: Store, assetId: number): Promise<CachedAsset | null> {
  return store.getFirstAsync<CachedAsset>(
    `SELECT * FROM cached_asset WHERE asset_id = ?`, [assetId],
  );
}

export async function operator(store: Store, operatorId: number): Promise<CachedOperator | null> {
  return store.getFirstAsync<CachedOperator>(
    `SELECT * FROM cached_operator WHERE operator_id = ?`, [operatorId],
  );
}

/** Null `empId` never matches: an operator with no reference is found by name. */
export async function operatorByEmpId(store: Store, empId: string): Promise<CachedOperator | null> {
  const wanted = empId.trim();
  if (!wanted) return null;
  return store.getFirstAsync<CachedOperator>(
    `SELECT * FROM cached_operator WHERE emp_id = ?`, [wanted],
  );
}

/** By name, which is the only way to reach an operator with no employee number. */
export async function operatorsByName(store: Store, search: string): Promise<CachedOperator[]> {
  return store.getAllAsync<CachedOperator>(
    `SELECT * FROM cached_operator
      WHERE UPPER(name) LIKE ? ORDER BY name LIMIT 40`,
    [`%${search.trim().toUpperCase()}%`],
  );
}

/**
 * The checklist in force for this machine type, on this day.
 *
 * Ordering mirrors the server exactly: a template scoped to a plant beats one
 * scoped to nothing, then the latest `effective_from`, then the highest
 * version. The device only caches ACTIVE templates, so status is not a factor
 * here the way it is on the server.
 */
export async function resolveTemplate(
  store: Store, assetTypeId: number, onDate?: string,
): Promise<ResolvedTemplate | null> {
  const day = onDate ?? new Date().toISOString().slice(0, 10);

  const head = await store.getFirstAsync<{
    template_id: number; asset_type_id: number; name: string; version: number;
  }>(
    `SELECT template_id, asset_type_id, name, version
       FROM cached_template
      WHERE asset_type_id = ?
        AND (effective_from IS NULL OR effective_from <= ?)
      ORDER BY (CASE WHEN plant_id IS NOT NULL THEN 1 ELSE 0 END)
             + (CASE WHEN org_unit_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
               effective_from DESC,
               version DESC
      LIMIT 1`,
    [assetTypeId, day],
  );
  if (!head) return null;

  const rows = await store.getAllAsync<ItemRow>(
    `SELECT i.item_id, i.section_id, s.name AS section_name,
            s.display_order AS section_order,
            i.label, i.response_type, i.unit, i.min_value, i.max_value,
            i.category, i.is_critical, i.requires_photo_if_not_ok,
            -- Which answer is the finding. Stored by the cache and mapped by
            -- toItem, and for one build simply not selected here -- so every
            -- yes/no check on every device read as unclassified, raised
            -- nothing, and was skipped by the one-tap routine answer. Caught
            -- on a tablet: "Mark the 18 routine checks OK" filled 13.
            i.adverse_answer,
            i.default_severity, i.display_order
       FROM cached_item i
       JOIN cached_section s ON s.section_id = i.section_id
      WHERE s.template_id = ?
      ORDER BY s.display_order, i.display_order, i.item_id`,
    [head.template_id],
  );

  const items: ChecklistItem[] = rows.map(toItem);
  const sections: ResolvedTemplate['sections'] = [];
  for (const r of rows) {
    let sec = sections.find((s) => s.section_id === r.section_id);
    if (!sec) {
      sec = { section_id: r.section_id, name: r.section_name,
              display_order: r.section_order, items: [] };
      sections.push(sec);
    }
    sec.items.push(toItem(r));
  }

  return { ...head, sections, items };
}

function toItem(r: ItemRow): ChecklistItem {
  return {
    itemId: r.item_id,
    label: r.label,
    responseType: r.response_type,
    isCritical: r.is_critical === 1,
    requiresPhotoIfNotOk: r.requires_photo_if_not_ok === 1,
    adverseAnswer: (r.adverse_answer as Answer | null) ?? null,
    defaultSeverity: r.default_severity,
    unit: r.unit,
    minValue: r.min_value,
    maxValue: r.max_value,
    category: r.category,
  };
}

/**
 * How stale the cached masters are, in whole hours.
 *
 * Recorded on every capture. A handover taken against three-day-old
 * assignments is still a handover, but a supervisor reviewing it later should
 * be able to see that rather than having to infer it — and an operator should
 * be warned before he starts, not after.
 */
export async function cacheAgeHours(store: Store, now = new Date()): Promise<number | null> {
  const row = await store.getFirstAsync<{ cached_at: string | null }>(
    `SELECT MIN(cached_at) AS cached_at FROM cached_asset`,
  );
  if (!row?.cached_at) return null;
  const then = Date.parse(row.cached_at);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 3_600_000));
}

/** Masters this old are shown with a warning before the operator starts. */
export const STALE_AFTER_HOURS = 24;
