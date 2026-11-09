/**
 * The narrow slice of SQLite the capture logic actually uses.
 *
 * Declared as an interface rather than importing expo-sqlite directly so the
 * capture rules can be tested in plain node against an in-memory fake. The
 * rules are the part that decides whether a machine changes hands; they should
 * not need an emulator to prove.
 *
 * The shape matches expo-sqlite's SQLiteDatabase, so the real database
 * satisfies it with no adapter.
 */

export interface Store {
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
}
