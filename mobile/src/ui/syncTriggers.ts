/**
 * Wiring the sync engine to the things that should set it off.
 *
 * Kept apart from the store so the triggers can be read as a list, and so the
 * engine stays testable without any of expo's listeners in the way.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { useSync } from './useSync';
import { waiting } from '@/core/sync/engine';

const NETWORK_POLL_MS = 15_000;
/** The machine and operator lists, refreshed this often while there is a network. */
const MASTERS_EVERY_MS = 30 * 60_000;
export const BACKGROUND_TASK = 'hoto-sync';

/**
 * Sync on open, whenever anything is waiting and there is a network, and when
 * the app comes back to the front.
 *
 * ── IT KEEPS TRYING, NOT ONLY WHEN THE NETWORK COMES BACK ────────────────────
 * This used to send only on REGAINING a network. A tablet that stayed on wifi
 * the whole time -- but could not reach the server: server down, address
 * moved, VPN -- never tried again until the app was reopened. One sat on
 * working wifi for thirty-five hours with a handover and a photograph, tried
 * twice, and told its operator to "bring the tablet within signal". Found on
 * the tablet itself, 15 Nov 2026.
 *
 * Now every tick with something waiting and a network makes an attempt. The
 * engine's backoff (15 s doubling to 5 min per record) still decides which
 * records are actually due, so a server that is down is asked every few
 * minutes, not every fifteen seconds.
 *
 * ── WHY IT POLLS RATHER THAN LISTENS ─────────────────────────────────────────
 * expo-network's event does fire, but on the Android builds in this fleet it
 * reports "connected" for a captive gate wifi that carries nothing, and misses
 * the transition out of aeroplane mode about a third of the time. A fifteen
 * second poll of `isInternetReachable` is unglamorous and does not miss the one
 * window of signal the tablet gets passing the workshop. It costs nothing while
 * the queue is empty, because `run` returns immediately with nothing to do.
 */
export function useSyncTriggers(enabled: boolean): void {
  const run = useSync((s) => s.run);
  const refresh = useSync((s) => s.refresh);
  const wasOnline = useRef<boolean | null>(null);
  const lastMasters = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    // 1. On open.
    void (async () => {
      await refresh();
      await run({ refreshMasters: true });
      lastMasters.current = Date.now();
    })();

    // 2. Every tick: on regaining a network, and whenever anything is waiting.
    const timer = setInterval(() => {
      void (async () => {
        if (!alive) return;
        const state = await Network.getNetworkStateAsync().catch(() => null);
        // isInternetReachable is about the INTERNET, which this server may
        // not be on (a LAN, a cable to a laptop). Connected is the test;
        // whether the office answers is for the attempt to find out.
        const online = Boolean(state?.isConnected);
        const regained = online && wasOnline.current === false;
        wasOnline.current = online;
        if (!online) { await refresh(); return; }

        const mastersDue = Date.now() - lastMasters.current > MASTERS_EVERY_MS;
        const store = useSync.getState().store;
        const pending = store ? (await waiting(store).catch(() => null))?.total ?? 0 : 0;
        if (regained || mastersDue || pending > 0) {
          await run({ refreshMasters: regained || mastersDue });
          if (regained || mastersDue) lastMasters.current = Date.now();
        }
      })();
    }, NETWORK_POLL_MS);

    // 3. Back to the front: whatever happened while it was in a pocket.
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && alive) void run({ refreshMasters: true });
    });

    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, [enabled, run, refresh]);
}

/**
 * Register the background task. Best-effort by design — see useSync's header.
 *
 * Called once at startup. A failure to register is not worth surfacing to an
 * operator, because nothing he does depends on it; it is logged and ignored.
 */
export async function registerBackgroundSync(): Promise<boolean> {
  try {
    if (!TaskManager.isTaskDefined(BACKGROUND_TASK)) return false;
    const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (already) return true;
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, {
      // The OS treats this as a hint and will mostly ignore it. Asking for
      // fifteen minutes rather than an hour costs nothing and occasionally
      // gets a run on a tablet that happens to be charging.
      minimumInterval: 15,
    });
    return true;
  } catch {
    return false;
  }
}
