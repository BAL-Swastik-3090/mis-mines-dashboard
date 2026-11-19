/**
 * Where the tablet keeps photographs until the office has them.
 *
 * ── NOT THE CACHE ────────────────────────────────────────────────────────────
 * The camera and the resizer both write into the app's cache folder, and that
 * is where every photograph used to stay until it was sent. Android may empty
 * a cache folder whenever storage runs low, without asking: a photograph of a
 * fault, taken on a shift with no signal, could be gone before the tablet next
 * reached the office -- and with it the evidence behind the fault. Found
 * 16 Nov while writing the terms of use, which promise the opposite.
 *
 * So a photograph is moved, the moment it is taken, into a folder of the app's
 * own permanent storage, and photographs an older version left in the cache
 * are moved there when the app starts.
 *
 * ── AND NOT FOR EVER ─────────────────────────────────────────────────────────
 * Permanent storage is not emptied by anyone, so once the office has had a
 * photograph for a week its file is deleted here. The row stays, so the record
 * of what was sent does. A week, not at once: a photo the server later
 * refuses as damaged is re-read from its file (engine.ts, rehash).
 *
 * The file system is passed in, so this runs under test without a device.
 */

import type { Store } from './store';

/** The parts of expo-file-system used here. */
export interface Files {
  documentDirectory: string | null;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean }>;
  makeDirectoryAsync: (uri: string, opts?: { intermediates?: boolean }) => Promise<void>;
  moveAsync: (opts: { from: string; to: string }) => Promise<void>;
  deleteAsync: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
}

/** How long a sent photograph's file is kept, in days. */
export const KEEP_SENT_DAYS = 7;

export function photoDir(fs: Files): string {
  if (!fs.documentDirectory) throw new Error('this device has no app storage');
  return `${fs.documentDirectory}photos/`;
}

const isKept = (fs: Files, uri: string) => uri.startsWith(photoDir(fs));

/** Move a photograph just taken into permanent storage; returns where it now is. */
export async function keepPhoto(fs: Files, tempUri: string, photoUuid: string): Promise<string> {
  const dir = photoDir(fs);
  if (!(await fs.getInfoAsync(dir)).exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
  const to = `${dir}${photoUuid}.jpg`;
  await fs.moveAsync({ from: tempUri, to });
  return to;
}

/**
 * Photographs still in the cache, moved to permanent storage and their rows
 * pointed at the new place. Ones the cache has already lost are counted, so
 * the loss is at least known. Run at start-up; safe to run again.
 */
export async function rescueCachedPhotos(store: Store, fs: Files): Promise<{ moved: number; lost: number }> {
  const rows = await store.getAllAsync<{ photo_uuid: string; local_path: string }>(
    `SELECT photo_uuid, local_path FROM photo WHERE sync_state <> 'synced'`);
  let moved = 0;
  let lost = 0;
  for (const r of rows) {
    if (isKept(fs, r.local_path)) continue;
    if (!(await fs.getInfoAsync(r.local_path)).exists) { lost += 1; continue; }
    const to = await keepPhoto(fs, r.local_path, r.photo_uuid);
    await store.runAsync(`UPDATE photo SET local_path = ? WHERE photo_uuid = ?`, [to, r.photo_uuid]);
    moved += 1;
  }
  return { moved, lost };
}

/** Delete the files of photographs the office has had for a week. Rows stay. */
export async function pruneSentPhotos(
  store: Store, fs: Files, now: Date = new Date(), keepDays: number = KEEP_SENT_DAYS,
): Promise<number> {
  const before = new Date(now.getTime() - keepDays * 86_400_000).toISOString();
  const rows = await store.getAllAsync<{ local_path: string }>(
    `SELECT local_path FROM photo WHERE sync_state = 'synced' AND captured_at < ?`, [before]);
  let deleted = 0;
  for (const r of rows) {
    if (!(await fs.getInfoAsync(r.local_path)).exists) continue;
    await fs.deleteAsync(r.local_path, { idempotent: true });
    deleted += 1;
  }
  return deleted;
}
