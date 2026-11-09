/**
 * Wiring the sync engine to the things that should set it off.
 *
 * Kept apart from the store so the triggers can be read as a list, and so the
 * engine stays testable without any of expo's listeners in the way.
 */

import { useEffect, useRef } from 'react';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { useSync } from './useSync';

const NETWORK_POLL_MS = 15_000;
export const BACKGROUND_TASK = 'hoto-sync';

/**
 * Sync on open, and whenever the tablet regains a network while the app is up.
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

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    // 1. On open.
    void (async () => {
      await refresh();
      await run({ refreshMasters: true });
    })();

    // 2. On regaining a network.
    const timer = setInterval(() => {
      void (async () => {
        if (!alive) return;
        const state = await Network.getNetworkStateAsync().catch(() => null);
        const online = Boolean(state?.isConnected && state?.isInternetReachable !== false);
        const regained = online && wasOnline.current === false;
        wasOnline.current = online;
        if (regained) await run({ refreshMasters: true });
      })();
    }, NETWORK_POLL_MS);

    return () => { alive = false; clearInterval(timer); };
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
