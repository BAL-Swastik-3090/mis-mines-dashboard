/**
 * Photographs kept where Android cannot clear them, and let go once the office
 * has had them for a week.
 */

import { openTestStore, seed, type TestStore } from './testStore';
import * as masters from './masters';
import * as session from './session';
import { keepPhoto, pruneSentPhotos, rescueCachedPhotos, type Files } from './photoFiles';

const DOCS = 'file:///data/user/0/app/files/';
const CACHE = 'file:///data/user/0/app/cache/ImageManipulator/';
const U1 = '11111111-1111-4111-8111-111111111111';

/** A file system in memory: a set of paths that exist. */
function fakeFiles(existing: string[] = []): Files & { files: Set<string> } {
  const files = new Set(existing);
  return {
    files,
    documentDirectory: DOCS,
    getInfoAsync: async (uri) => ({ exists: files.has(uri) || [...files].some((f) => f.startsWith(uri)) }),
    makeDirectoryAsync: async (uri) => { files.add(uri); },
    moveAsync: async ({ from, to }) => {
      if (!files.has(from)) throw new Error(`no such file ${from}`);
      files.delete(from); files.add(to);
    },
    deleteAsync: async (uri) => { files.delete(uri); },
  };
}

let store: TestStore;
beforeEach(async () => {
  store = openTestStore();
  await seed(store);
  const a = (await masters.asset(store, 25))!;
  await session.startDraft({ store, asset: a, sessionType: 'START_HANDOVER', clientUuid: U1,
                             now: new Date(2026, 10, 16, 6, 0) });
});

const photo = (uuid: string, path: string, state = 'queued', at = '2026-11-16T06:00:00Z') =>
  store.runAsync(`INSERT INTO photo
      (photo_uuid, session_uuid, item_id, local_path, bytes, sha256, captured_at, sync_state)
     VALUES (?, ?, NULL, ?, 1, 'x', ?, ?)`, [uuid, U1, path, at, state]);
const pathOf = async (uuid: string) => (await store.getFirstAsync<{ local_path: string }>(
  `SELECT local_path FROM photo WHERE photo_uuid = ?`, [uuid]))?.local_path;

describe('a photograph just taken', () => {
  it('is moved out of the cache into the app\'s own storage, under its own id', async () => {
    const fs = fakeFiles([`${CACHE}abc.jpg`]);
    const to = await keepPhoto(fs, `${CACHE}abc.jpg`, 'p1');
    expect(to).toBe(`${DOCS}photos/p1.jpg`);
    expect(fs.files.has(`${CACHE}abc.jpg`)).toBe(false);
    expect(fs.files.has(to)).toBe(true);
  });
});

describe('photographs an older version left in the cache', () => {
  it('are moved at start-up, and their records follow them', async () => {
    const fs = fakeFiles([`${CACHE}a.jpg`]);
    await photo('p1', `${CACHE}a.jpg`);
    expect(await rescueCachedPhotos(store, fs)).toEqual({ moved: 1, lost: 0 });
    expect(await pathOf('p1')).toBe(`${DOCS}photos/p1.jpg`);
  });

  it('ones Android already cleared are counted as lost, not hidden', async () => {
    await photo('p1', `${CACHE}gone.jpg`);
    expect(await rescueCachedPhotos(store, fakeFiles())).toEqual({ moved: 0, lost: 1 });
  });

  it('running it again moves nothing twice', async () => {
    const fs = fakeFiles([`${CACHE}a.jpg`]);
    await photo('p1', `${CACHE}a.jpg`);
    await rescueCachedPhotos(store, fs);
    expect(await rescueCachedPhotos(store, fs)).toEqual({ moved: 0, lost: 0 });
  });

  it('leaves alone what the office already has', async () => {
    const fs = fakeFiles([`${CACHE}sent.jpg`]);
    await photo('p1', `${CACHE}sent.jpg`, 'synced');
    expect(await rescueCachedPhotos(store, fs)).toEqual({ moved: 0, lost: 0 });
  });
});

describe('once the office has had a photograph for a week', () => {
  const now = new Date('2026-11-30T06:00:00Z');

  it('its file is deleted and its record kept', async () => {
    const fs = fakeFiles([`${DOCS}photos/p1.jpg`]);
    await photo('p1', `${DOCS}photos/p1.jpg`, 'synced', '2026-11-16T06:00:00Z');
    expect(await pruneSentPhotos(store, fs, now)).toBe(1);
    expect(fs.files.has(`${DOCS}photos/p1.jpg`)).toBe(false);
    expect(await pathOf('p1')).toBe(`${DOCS}photos/p1.jpg`);
  });

  it('a photograph not yet sent is never deleted, however old', async () => {
    const fs = fakeFiles([`${DOCS}photos/p1.jpg`]);
    await photo('p1', `${DOCS}photos/p1.jpg`, 'queued', '2026-11-01T06:00:00Z');
    expect(await pruneSentPhotos(store, fs, now)).toBe(0);
    expect(fs.files.has(`${DOCS}photos/p1.jpg`)).toBe(true);
  });

  it('one sent this week is kept, in case the office asks for it again', async () => {
    const fs = fakeFiles([`${DOCS}photos/p1.jpg`]);
    await photo('p1', `${DOCS}photos/p1.jpg`, 'synced', '2026-11-28T06:00:00Z');
    expect(await pruneSentPhotos(store, fs, now)).toBe(0);
  });
});
