/**
 * What the office changed, told to the people holding the tablet.
 *
 * Asked for on 16 Nov 2026: when somebody adds an operator, a machine or a
 * checklist on the dashboard, the tablet should say so -- not only quietly
 * know it. A supervisor looking for a new driver's name, or a checklist that
 * has just been put in force for the graders, should not have to guess
 * whether the tablet has caught up.
 *
 * ── WORKED OUT ON THE TABLET, BY COMPARING ITS OWN COPY ───────────────────────
 * The tablet already replaces its copy of the machine, operator and checklist
 * lists on every refresh (capture/cache.ts). Comparing the copy it had with
 * the one it is given says exactly what changed FOR THIS TABLET -- its own
 * site, since its last refresh -- with nothing new on the server and nothing
 * the server has to remember about each device. A tablet that was off for a
 * week is told everything that changed in that week, once.
 *
 * ── NOT ON THE FIRST REFRESH ──────────────────────────────────────────────────
 * A tablet that has just been set up has no copy to compare with, and being
 * told about 269 "new" operators is noise that teaches people to ignore the
 * list. The first refresh records nothing.
 *
 * ── A FLOOD BECOMES ONE LINE ──────────────────────────────────────────────────
 * A tablet moved to another site sees most of both lists change at once. More
 * than MANY of one kind is recorded as a single "{n} new operators" line.
 *
 * Plain SQL against the Store, so it is tested in node like the rest of core.
 */

import type { Store } from './capture/store';

export type NoticeKind =
  | 'OPERATOR_ADDED' | 'OPERATOR_REMOVED'
  | 'MACHINE_ADDED' | 'MACHINE_REMOVED'
  | 'CHECKLIST_ADDED' | 'CHECKLIST_UPDATED' | 'CHECKLIST_REMOVED';

/**
 * One thing that changed. `subject` names it (a person, a fleet code, a
 * checklist); `detail` is the second fact (employee number, machine type,
 * checklist version). A collapsed line has n > 1 and no subject.
 */
export interface Change { kind: NoticeKind; subject: string | null; detail: string | null; n: number }

export interface Notice extends Change { notice_id: number; created_at: string; read_at: string | null }

/** More than this many of one kind in one refresh is said as a count. */
export const MANY = 12;
/** Kept for this long, and never more than KEEP_ROWS of them. */
export const KEEP_DAYS = 60;
export const KEEP_ROWS = 300;

/** What the tablet held before a refresh. */
export interface Snapshot {
  operators: Map<number, { name: string; emp_id: string }>;
  machines: Map<number, { fleet_code: string; type: string }>;
  /** Keyed by machine type: one checklist in force per type on a tablet. */
  checklists: Map<number, { template_id: number; name: string; version: number }>;
}

/** The parts of the server's bundle this compares. */
export interface Incoming {
  operators: { operator_id: number; emp_id: string; name: string }[];
  assets: { asset_id: number; fleet_code: string; asset_type_name: string }[];
  templates?: { template_id: number; asset_type_id: number; name: string; version: number }[];
}

/** Read the tablet's current copy. Null when it has never refreshed. */
export async function snapshot(store: Store): Promise<Snapshot | null> {
  const had = await store.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'last_sync_at'`);
  if (!had?.value) return null;

  const ops = await store.getAllAsync<{ operator_id: number; name: string; emp_id: string }>(
    `SELECT operator_id, name, emp_id FROM cached_operator`);
  const machines = await store.getAllAsync<{ asset_id: number; fleet_code: string; asset_type_name: string }>(
    `SELECT asset_id, fleet_code, asset_type_name FROM cached_asset`);
  const lists = await store.getAllAsync<{
    template_id: number; asset_type_id: number; name: string; version: number;
  }>(`SELECT template_id, asset_type_id, name, version FROM cached_template`);

  return {
    operators: new Map(ops.map((o) => [o.operator_id, { name: o.name, emp_id: o.emp_id }])),
    machines: new Map(machines.map((m) => [m.asset_id,
      { fleet_code: m.fleet_code, type: m.asset_type_name }])),
    checklists: new Map(lists.map((t) => [t.asset_type_id,
      { template_id: t.template_id, name: t.name, version: t.version }])),
  };
}

/** What changed between the copy the tablet had and the one it is given. Pure. */
export function diff(before: Snapshot, after: Incoming): Change[] {
  const out: Change[] = [];
  const one = (kind: NoticeKind, subject: string, detail: string | null): Change =>
    ({ kind, subject, detail, n: 1 });

  // ── people ──
  const opsNow = new Map(after.operators.map((o) => [o.operator_id, o]));
  const addedOps = after.operators.filter((o) => !before.operators.has(o.operator_id))
    .map((o) => one('OPERATOR_ADDED', o.name, o.emp_id));
  const goneOps = [...before.operators.entries()].filter(([id]) => !opsNow.has(id))
    .map(([, o]) => one('OPERATOR_REMOVED', o.name, o.emp_id));

  // ── machines ──
  const machinesNow = new Set(after.assets.map((a) => a.asset_id));
  const addedMachines = after.assets.filter((a) => !before.machines.has(a.asset_id))
    .map((a) => one('MACHINE_ADDED', a.fleet_code, a.asset_type_name));
  const goneMachines = [...before.machines.entries()].filter(([id]) => !machinesNow.has(id))
    .map(([, m]) => one('MACHINE_REMOVED', m.fleet_code, m.type));

  // ── checklists, one per machine type ──
  const lists: Change[] = [];
  const listsNow = new Map((after.templates ?? []).map((t) => [t.asset_type_id, t]));
  for (const [type, t] of listsNow) {
    const had = before.checklists.get(type);
    if (!had) lists.push(one('CHECKLIST_ADDED', t.name, String(t.version)));
    else if (had.template_id !== t.template_id || had.version !== t.version)
      lists.push(one('CHECKLIST_UPDATED', t.name, String(t.version)));
  }
  for (const [type, t] of before.checklists) {
    if (!listsNow.has(type)) lists.push(one('CHECKLIST_REMOVED', t.name, String(t.version)));
  }

  // Checklists are never collapsed: there are a handful, and each one changes
  // what can be done on a machine type.
  out.push(...lists);
  for (const group of [addedOps, goneOps, addedMachines, goneMachines]) {
    const first = group[0];
    if (first && group.length > MANY) out.push({ kind: first.kind, subject: null, detail: null, n: group.length });
    else out.push(...group);
  }
  return out;
}

/** Keep these changes for the people who will read them. Inside the caller's transaction. */
export async function record(store: Store, changes: Change[], now = new Date()): Promise<void> {
  const at = now.toISOString();
  for (const c of changes) {
    await store.runAsync(
      `INSERT INTO notice (kind, subject, detail, n, created_at) VALUES (?,?,?,?,?)`,
      [c.kind, c.subject, c.detail, c.n, at]);
  }
  await prune(store, now);
}

async function prune(store: Store, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  await store.runAsync(`DELETE FROM notice WHERE created_at < ?`, [cutoff]);
  await store.runAsync(
    `DELETE FROM notice WHERE notice_id NOT IN
       (SELECT notice_id FROM notice ORDER BY notice_id DESC LIMIT ?)`, [KEEP_ROWS]);
}

/** Newest first. */
export async function list(store: Store, limit = KEEP_ROWS): Promise<Notice[]> {
  return store.getAllAsync<Notice>(
    `SELECT notice_id, kind, subject, detail, n, created_at, read_at
       FROM notice ORDER BY notice_id DESC LIMIT ?`, [limit]);
}

export async function unreadCount(store: Store): Promise<number> {
  const r = await store.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notice WHERE read_at IS NULL`);
  return r?.n ?? 0;
}

export async function markAllRead(store: Store, now = new Date()): Promise<void> {
  await store.runAsync(`UPDATE notice SET read_at = ? WHERE read_at IS NULL`, [now.toISOString()]);
}

export async function clearAll(store: Store): Promise<void> {
  await store.runAsync(`DELETE FROM notice`);
}

/** How many of each kind, for a one-line summary. */
export function countByKind(changes: Change[]): Partial<Record<NoticeKind, number>> {
  const out: Partial<Record<NoticeKind, number>> = {};
  for (const c of changes) out[c.kind] = (out[c.kind] ?? 0) + c.n;
  return out;
}
