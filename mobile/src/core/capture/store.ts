/**
 * The narrow slice of SQLite the capture logic actually uses.
 *
 * Declared as an interface rather than importing expo-sqlite directly so the
 * capture rules can be tested in plain node against an in-memory fake. The
 * rules are the part that decides whether a machine changes hands; they should
 * not need an emulator to prove.
 *
 * It is close to expo-sqlite's SQLiteDatabase but NOT assignable from it: that
 * API overloads `runAsync` and types its bind params narrowly, so `params?:
 * unknown[]` does not fit. `adapt()` in db/open.ts does the (small) conversion.
 * The first version of this file claimed no adapter was needed; the typechecker
 * disagreed, which is the sort of claim worth having checked.
 */

export interface Store {
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
}
