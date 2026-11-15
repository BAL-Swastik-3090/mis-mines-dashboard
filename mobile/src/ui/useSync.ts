/**
 * When syncing happens, and what the screens are told about it.
 *
 * ── FOUR TRIGGERS, AND ANDROID WILL NOT HONOUR A FIFTH ───────────────────────
 *   1. on open                 — the tablet has just been picked up
 *   2. on regaining a network  — while the app is open and in front of somebody
 *   3. after a capture is confirmed — the one moment we know there is new work
 *   4. Sync now                — a person pressing the button, which always wins
 *
 * A fifth — real background sync while the app is closed — is what everybody
 * asks for and Android does not reliably give. `expo-background-task` schedules
 * work at the OS's discretion, which on a Doze-ed tablet in a cab means hours
 * or never. It is registered because when it does run it is free, but nothing
 * in this design depends on it, and the home screen never implies that closing
 * the app will get anything sent.
 *
 * ── ONLY ONE SYNC AT A TIME ──────────────────────────────────────────────────
 * Two concurrent passes would both mark the same session `sending` and both
 * post it. The server's idempotency makes that survivable rather than
 * duplicating a handover, but it also spends the tablet's few seconds of signal
 * twice on the same record.
 */

import { create } from 'zustand';
import type { Store } from '@/core/capture/store';
import type { Transport, SyncReport } from '@/core/sync/engine';
import { status as readStatus, syncNow } from '@/core/sync/engine';
import { tryLock, unlock } from '@/core/sync/lock';

export type SyncStatus = Awaited<ReturnType<typeof readStatus>>;

interface SyncState {
  store: Store | null;
  transport: Transport | null;
  running: boolean;
  lastReport: SyncReport | null;
  lastError: string | null;
  status: SyncStatus | null;

  attach: (store: Store, transport: Transport) => void;
  refresh: () => Promise<void>;
  run: (opts?: { force?: boolean; refreshMasters?: boolean }) => Promise<SyncReport | null>;
}

export const useSync = create<SyncState>()((set, get) => ({
  store: null, transport: null, running: false,
  lastReport: null, lastError: null, status: null,

  attach: (store, transport) => set({ store, transport }),

  refresh: async () => {
    const { store } = get();
    if (!store) return;
    set({ status: await readStatus(store) });
  },

  run: async (opts) => {
    const { store, transport, running } = get();
    if (!store || !transport) return null;
    // See the header: a second concurrent pass spends the signal twice. The
    // lock is shared with the background sender (core/sync/background.ts),
    // which may be mid-send when somebody presses the button.
    if (running || !tryLock()) return null;

    set({ running: true, lastError: null });
    try {
      const report = await syncNow({
        store, transport,
        force: opts?.force ?? false,
        refreshMasters: opts?.refreshMasters ?? false,
      });
      set({ lastReport: report, status: await readStatus(store) });
      return report;
    } catch (e) {
      // The engine is meant to absorb transport failures itself, so reaching
      // here means something structural. Surfaced rather than swallowed.
      set({ lastError: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      unlock();
      set({ running: false });
    }
  },
}));
