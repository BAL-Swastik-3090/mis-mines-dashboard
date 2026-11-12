/**
 * Writing the server's sync bundle into the device's cache.
 *
 * ── WHOLESALE REPLACEMENT, IN ONE TRANSACTION ────────────────────────────────
 * The cached tables are the server's data; the device holds a copy. Merging
 * would mean deciding what a missing row means — deleted, or just not in this
 * page — and getting that wrong leaves a machine on the tablet that the mine
 * sold last month. So each sync replaces the lot, inside one transaction, and
 * an interrupted sync leaves the previous cache intact rather than a half-
 * replaced one.
 *
 * Captured records are NEVER touched here. They are the device's own, and a
 * sync that could drop an unsent handover would be the single worst bug this
 * app could have.
 */

import type { Store } from './store';

/** The shape of GET /api/hoto/sync. Only the fields the device stores. */
export interface SyncBundle {
  server_time: string;
  assets: {
    asset_id: number; fleet_code: string; nickname?: string | null;
    asset_type_id: number; asset_type_name: string; qr_code?: string | null;
    meter_uom?: string | null; last_meter_reading?: number | null;
    last_meter_at?: string | null; operational_state?: string | null;
    open_defect_count?: number | null; has_critical_defect?: boolean | number | null;
    home_location_id?: number | null;
  }[];
  operators: {
    operator_id: number; emp_id: string; name: string;
    competent_type_ids?: number[] | null; competency_valid_to?: string | null;
  }[];
  locations: { location_id: number; name: string }[];
  shifts?: {
    shift_id: number; code: string; name: string;
    start_time: string; end_time: string; crosses_midnight: boolean | number;
  }[];
  templates?: {
    template_id: number; asset_type_id: number; name: string; version: number;
    plant_id?: number | null; org_unit_id?: number | null; effective_from?: string | null;
    sections: {
      section_id: number; name: string; display_order: number;
      items: {
        item_id: number; label: string; response_type: string;
        unit?: string | null; min_value?: number | null; max_value?: number | null;
        category?: string | null; is_critical: boolean | number;
        requires_photo_if_not_ok: boolean | number;
        adverse_answer?: string | null;
        default_severity: string; display_order: number;
      }[];
    }[];
  }[];
}

const bit = (v: boolean | number | null | undefined): number => (v ? 1 : 0);

export async function cacheBundle(
  store: Store, bundle: SyncBundle, now = new Date(),
): Promise<{ assets: number; operators: number; templates: number; items: number }> {
  const at = now.toISOString();
  let items = 0;

  await store.withTransactionAsync(async () => {
    // Children first: the schema has ON DELETE CASCADE, but being explicit
    // means this does not depend on PRAGMA foreign_keys being on, which it is
    // not guaranteed to be on every SQLite build.
    await store.runAsync(`DELETE FROM cached_item`);
    await store.runAsync(`DELETE FROM cached_section`);
    await store.runAsync(`DELETE FROM cached_template`);
    await store.runAsync(`DELETE FROM cached_asset`);
    await store.runAsync(`DELETE FROM cached_operator`);
    await store.runAsync(`DELETE FROM cached_location`);
    await store.runAsync(`DELETE FROM cached_shift`);

    for (const a of bundle.assets) {
      await store.runAsync(
        `INSERT INTO cached_asset
           (asset_id, fleet_code, nickname, asset_type_id, asset_type_name, qr_code,
            meter_uom, last_meter_reading, last_meter_at, operational_state,
            open_defect_count, has_critical_defect, home_location_id, cached_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [a.asset_id, a.fleet_code, a.nickname ?? null, a.asset_type_id,
         a.asset_type_name, a.qr_code ?? null, a.meter_uom ?? null,
         a.last_meter_reading ?? null, a.last_meter_at ?? null,
         a.operational_state ?? null, a.open_defect_count ?? 0,
         bit(a.has_critical_defect), a.home_location_id ?? null, at],
      );
    }

    for (const o of bundle.operators) {
      await store.runAsync(
        `INSERT INTO cached_operator
           (operator_id, emp_id, name, photo_path, competent_type_ids,
            competency_valid_to, cached_at)
         VALUES (?,?,?,NULL,?,?,?)`,
        [o.operator_id, o.emp_id, o.name,
         JSON.stringify(o.competent_type_ids ?? []),
         o.competency_valid_to ?? null, at],
      );
    }

    for (const l of bundle.locations) {
      await store.runAsync(
        `INSERT INTO cached_location (location_id, name, cached_at) VALUES (?,?,?)`,
        [l.location_id, l.name, at]);
    }

    for (const sh of bundle.shifts ?? []) {
      await store.runAsync(
        `INSERT INTO cached_shift
           (shift_id, code, name, start_time, end_time, crosses_midnight)
         VALUES (?,?,?,?,?,?)`,
        [sh.shift_id, sh.code, sh.name, sh.start_time, sh.end_time,
         bit(sh.crosses_midnight)]);
    }

    for (const t of bundle.templates ?? []) {
      await store.runAsync(
        `INSERT INTO cached_template
           (template_id, asset_type_id, name, version, plant_id, org_unit_id,
            effective_from, cached_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [t.template_id, t.asset_type_id, t.name, t.version,
         t.plant_id ?? null, t.org_unit_id ?? null, t.effective_from ?? null, at]);

      for (const s of t.sections) {
        await store.runAsync(
          `INSERT INTO cached_section (section_id, template_id, name, display_order)
           VALUES (?,?,?,?)`,
          [s.section_id, t.template_id, s.name, s.display_order]);

        for (const i of s.items) {
          await store.runAsync(
            `INSERT INTO cached_item
               (item_id, section_id, label, response_type, unit, min_value, max_value,
                category, is_critical, requires_photo_if_not_ok, default_severity,
                display_order, adverse_answer)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [i.item_id, s.section_id, i.label, i.response_type, i.unit ?? null,
             i.min_value ?? null, i.max_value ?? null, i.category ?? null,
             bit(i.is_critical), bit(i.requires_photo_if_not_ok),
             i.default_severity, i.display_order, i.adverse_answer ?? null]);
          items++;
        }
      }
    }

    await store.runAsync(
      `INSERT INTO meta (key, value) VALUES ('last_sync_at', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [at]);
    await store.runAsync(
      `INSERT INTO meta (key, value) VALUES ('server_time_at_sync', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [bundle.server_time]);
  });

  return {
    assets: bundle.assets.length,
    operators: bundle.operators.length,
    templates: (bundle.templates ?? []).length,
    items,
  };
}

/**
 * The device's clock against the server's, in seconds.
 *
 * Worth knowing because `captured_at` is a device reading and every report
 * downstream trusts it. A tablet whose clock is an hour out files handovers
 * into the wrong shift, and nothing about the record itself would show it.
 */
export function clockDriftSeconds(serverTime: string, deviceNow = new Date()): number {
  const server = Date.parse(serverTime);
  if (Number.isNaN(server)) return 0;
  return Math.round((deviceNow.getTime() - server) / 1000);
}

export const DRIFT_WARN_SECONDS = 120;
