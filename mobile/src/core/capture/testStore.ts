/**
 * A real SQLite database, in memory, behind the {@link Store} interface.
 *
 * Deliberately not a hand-written fake. The capture logic's hardest parts are
 * SQL — the template resolver's "most specific scope wins", the UPSERT that
 * makes re-answering an item overwrite rather than duplicate, the sequence
 * number per machine and shift. A fake would be my own reading of those
 * queries rather than SQLite's, which is exactly the thing worth testing.
 *
 * Uses node:sqlite, so it needs nothing installed. **Test-only** — the app
 * itself goes through expo-sqlite, which satisfies the same interface.
 */

import { DatabaseSync } from 'node:sqlite';
import type { Store } from './store';
import { MIGRATIONS } from '../db/schema';

export interface TestStore extends Store {
  raw: DatabaseSync;
  close(): void;
}

/** Rewrites expo-sqlite's `?1` placeholders to the `?` node:sqlite accepts. */
function normalise(sql: string, params: unknown[]): [string, unknown[]] {
  if (!/\?\d/.test(sql)) return [sql, params];
  const order: number[] = [];
  const out = sql.replace(/\?(\d+)/g, (_m, d: string) => {
    order.push(Number(d) - 1);
    return '?';
  });
  return [out, order.map((i) => params[i])];
}

const bindable = (v: unknown): string | number | bigint | null | Uint8Array => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  return String(v);
};

export function openTestStore(): TestStore {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const statements of MIGRATIONS) {
    for (const sql of statements) {
      if (/^\s*PRAGMA\s+journal_mode/i.test(sql)) continue;   // no WAL in memory
      db.exec(sql);
    }
  }

  return {
    raw: db,
    close: () => db.close(),

    async runAsync(sql, params = []) {
      const [q, p] = normalise(sql, params);
      const r = db.prepare(q).run(...p.map(bindable));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },

    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      const [q, p] = normalise(sql, params);
      return db.prepare(q).all(...p.map(bindable)) as T[];
    },

    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      const [q, p] = normalise(sql, params);
      return (db.prepare(q).get(...p.map(bindable)) as T | undefined) ?? null;
    },

    async withTransactionAsync(fn) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/* ── fixtures, taken from the real seeded library (migration 105) ─────────── */

export interface SeedOpts {
  /** Hours ago the masters were cached. Default 1. */
  cachedHoursAgo?: number;
  /** Give the tipper template a plant-scoped second version. */
  withPlantOverride?: boolean;
}

export async function seed(store: Store, opts: SeedOpts = {}): Promise<void> {
  const ago = opts.cachedHoursAgo ?? 1;
  const cachedAt = new Date(Date.now() - ago * 3_600_000).toISOString();

  await store.runAsync(
    `INSERT INTO cached_asset
       (asset_id, fleet_code, nickname, asset_type_id, asset_type_name, qr_code,
        meter_uom, last_meter_reading, last_meter_at, operational_state,
        open_defect_count, has_critical_defect, home_location_id, cached_at)
     VALUES (25, 'MAN-11', NULL, 1, 'Tipper', 'QR-MAN-11', 'HOURS', 7598,
             ?, 'LOCKED', 2, 1, NULL, ?)`, [cachedAt, cachedAt]);
  await store.runAsync(
    `INSERT INTO cached_asset
       (asset_id, fleet_code, nickname, asset_type_id, asset_type_name, qr_code,
        meter_uom, last_meter_reading, last_meter_at, operational_state,
        open_defect_count, has_critical_defect, home_location_id, cached_at)
     VALUES (44, 'BD-80-15306', NULL, 2, 'Dozer', 'QR-BD-80', 'HOURS', 1200,
             ?, 'AVAILABLE', 0, 0, NULL, ?)`, [cachedAt, cachedAt]);

  await store.runAsync(
    `INSERT INTO cached_operator
       (operator_id, emp_id, name, photo_path, competent_type_ids,
        competency_valid_to, cached_at)
     VALUES (7, '4101', 'RAMESH NAIK', NULL, '[1]', '2027-03-31', ?)`, [cachedAt]);
  await store.runAsync(
    `INSERT INTO cached_operator
       (operator_id, emp_id, name, photo_path, competent_type_ids,
        competency_valid_to, cached_at)
     VALUES (8, '4102', 'SUNIL BEHERA', NULL, '[]', NULL, ?)`, [cachedAt]);

  // v1, unscoped.
  await store.runAsync(
    `INSERT INTO cached_template
       (template_id, asset_type_id, name, version, plant_id, org_unit_id,
        effective_from, cached_at)
     VALUES (1, 1, 'Tipper daily handover', 1, NULL, NULL, '2026-01-01', ?)`, [cachedAt]);
  await store.runAsync(
    `INSERT INTO cached_section (section_id, template_id, name, display_order)
     VALUES (10, 1, 'Brakes and steering', 1), (11, 1, 'Fluids', 2)`);
  await store.runAsync(
    `INSERT INTO cached_item
       (item_id, section_id, label, response_type, unit, min_value, max_value,
        category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
     VALUES
       (101, 10, 'Service brake response', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
        'SAFETY', 1, 1, 'CRITICAL', 1),
       (102, 10, 'Parking brake', 'OK_CAUTION_NOTOK', NULL, NULL, NULL,
        'SAFETY', 0, 1, 'HIGH', 2),
       (103, 11, 'Air pressure', 'NUMERIC', 'psi', 80, 120,
        'MECHANICAL', 1, 1, 'CRITICAL', 1),
       (104, 11, 'Engine oil level', 'LEVEL', NULL, NULL, NULL,
        'MECHANICAL', 0, 0, 'MEDIUM', 2)`);

  if (opts.withPlantOverride) {
    // Same type, scoped to a plant, same effective date. Must win on
    // specificity alone — which is the rule the server applies.
    await store.runAsync(
      `INSERT INTO cached_template
         (template_id, asset_type_id, name, version, plant_id, org_unit_id,
          effective_from, cached_at)
       VALUES (2, 1, 'Tipper daily handover (Kaliapani)', 1, 1, NULL, '2026-01-01', ?)`,
      [cachedAt]);
    await store.runAsync(
      `INSERT INTO cached_section (section_id, template_id, name, display_order)
       VALUES (20, 2, 'Brakes', 1)`);
    await store.runAsync(
      `INSERT INTO cached_item
         (item_id, section_id, label, response_type, unit, min_value, max_value,
          category, is_critical, requires_photo_if_not_ok, default_severity, display_order)
       VALUES (201, 20, 'Service brake response', 'OK_CAUTION_NOTOK', NULL, NULL,
               NULL, 'SAFETY', 1, 1, 'CRITICAL', 1)`);
  }
}
