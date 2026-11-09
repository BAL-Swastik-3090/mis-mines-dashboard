/**
 * Opening the device database, under SQLCipher.
 *
 * ── WHY THE KEY IS GENERATED HERE AND NEVER TRAVELS ──────────────────────────
 * The database holds hashed operator credentials and handovers nobody has sent
 * yet, and it lives in a cab on a mine site. The key is made on first open,
 * kept in the platform keystore through expo-secure-store, and never leaves the
 * device — not in a backup, not in a sync payload, not in a log. A key the
 * server also knows would mean a server compromise reads every tablet.
 *
 * ── WHY A MISSING KEY IS NOT RECOVERABLE, AND THAT IS CORRECT ────────────────
 * If the keystore entry is gone -- a factory reset, a cleared app -- the
 * existing database cannot be opened by anybody, including us. It is deleted
 * and recreated empty. That loses unsynced handovers, which is why `sync.ts`
 * does not treat a long queue as normal: anything only on the device is one
 * wipe from gone, and the app says so on the sync screen rather than implying
 * the data is safe because it is visible.
 */

import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import type { Store } from '../capture/store';

const DB_NAME = 'hoto.db';
const KEY_ENTRY = 'hoto.db.key';

export type DB = SQLite.SQLiteDatabase;

let handle: DB | null = null;

/** 32 random bytes as hex. Generated once per device, ever. */
async function keyFor(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ENTRY);
  if (existing) return existing;

  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_ENTRY, key, {
    // The tablet is shared and unlocked all shift; requiring authentication to
    // read the key would mean the app could not open at all at the face.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

/**
 * Open the database, running any migrations the file has not had.
 *
 * Migrations run inside ONE transaction. A tablet is interrupted constantly --
 * a flat battery halfway through an upgrade must leave the old schema intact
 * rather than a half-migrated one, because a half-migrated database is the one
 * state no later version knows how to repair.
 */
export async function openDb(): Promise<DB> {
  if (handle) return handle;

  const key = await keyFor();
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // Must be the first statement on the connection, before any read.
  await db.execAsync(`PRAGMA key = '${key}';`);

  await migrate(db);
  handle = db;
  return db;
}

export async function migrate(db: DB): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const at = row?.user_version ?? 0;
  if (at >= SCHEMA_VERSION) return at;

  for (let v = at; v < SCHEMA_VERSION; v++) {
    const statements = MIGRATIONS[v];
    if (!statements) throw new Error(`no migration defined for schema version ${v + 1}`);
    await db.withTransactionAsync(async () => {
      for (const sql of statements) {
        // PRAGMAs cannot run inside a transaction on SQLite and are harmless
        // to repeat, so they are applied outside it.
        if (/^\s*PRAGMA/i.test(sql)) continue;
        await db.execAsync(sql);
      }
    });
    for (const sql of statements) {
      if (/^\s*PRAGMA/i.test(sql)) await db.execAsync(sql);
    }
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return SCHEMA_VERSION;
}

/**
 * The database behind the {@link Store} interface the capture logic takes.
 *
 * expo-sqlite overloads `runAsync` and types its bind params narrowly, so it is
 * not assignable to `Store` directly even though the shapes look the same. This
 * is the whole of the difference.
 */
export function adapt(db: DB): Store {
  return {
    runAsync: (sql, params = []) =>
      db.runAsync(sql, params as SQLite.SQLiteBindParams)
        .then((r) => ({ changes: r.changes, lastInsertRowId: r.lastInsertRowId })),
    getAllAsync: <T>(sql: string, params: unknown[] = []) =>
      db.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams),
    getFirstAsync: <T>(sql: string, params: unknown[] = []) =>
      db.getFirstAsync<T>(sql, params as SQLite.SQLiteBindParams),
    withTransactionAsync: (fn) => db.withTransactionAsync(fn),
  };
}

/** Tests only. Drops the cached handle so the next open re-runs migrations. */
export function _resetHandleForTests(): void {
  handle = null;
}
