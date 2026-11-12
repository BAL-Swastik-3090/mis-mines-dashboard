/**
 * The app shell. Opens the database before anything can render.
 *
 * ── NOTHING RENDERS UNTIL THE DATABASE IS OPEN ───────────────────────────────
 * Not a loading spinner over a usable screen — nothing. Every screen in this
 * app reads from SQLite, and a screen that renders before the database is
 * ready shows an empty machine list, which an operator at the face reads as
 * "my machine is not here" rather than "wait a moment".
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { adapt, openDb } from '@/core/db/open';
import { useCapture } from '@/ui/useCapture';
import { useSync } from '@/ui/useSync';
import Enrol from './enrol';
import { BACKGROUND_TASK, registerBackgroundSync, useSyncTriggers } from '@/ui/syncTriggers';
import { httpTransport } from '@/core/sync/transport';
import { setRehash, syncNow } from '@/core/sync/engine';
import { hashPhotoFile } from '@/core/capture/photoHash';
import { storedBaseUrl, storedToken } from '@/core/sync/enrolment';
import { applyTrackingSettings } from '@/core/location/tracker';

/**
 * The background task must be DEFINED at module scope, before React renders.
 * Android calls into it on a cold start with no component tree, so a definition
 * inside a hook is registered too late to ever be called.
 */
/**
 * Wrapped in try/catch because Expo Go has no background-task module, and a
 * throw at module scope takes the whole app down before anything renders. In
 * Expo Go the registration simply does not happen, which costs nothing: the
 * background task is best-effort even on a real build (see useSync.ts), and
 * everything the trial actually tests is driven by the other four triggers.
 */
try {
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    const base = await storedBaseUrl();
    if (!base) return BackgroundTask.BackgroundTaskResult.Success;   // nothing to do
    const db = await openDb();
    await syncNow({
      store: adapt(db),
      transport: httpTransport({ baseUrl: storedBaseUrl, deviceToken: storedToken }),
      force: true,
    });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
} catch {
  console.warn('[hoto] background sync is not available in this runtime ' +
               '(expected in Expo Go). Sync on open, on reconnect, after a ' +
               'capture and the Sync now button all still work.');
}

// The engine re-hashes a refused photo from its file; this is where the real
// implementation is supplied (the tests supply their own).
setRehash(hashPhotoFile);

export default function RootLayout() {
  const attach = useCapture((s) => s.attach);
  const attachSync = useSync((s) => s.attach);
  const [state, setState] = useState<'opening' | 'ready' | 'failed' | 'unenrolled'>('opening');
  const [why, setWhy] = useState<string>('');

  /**
   * Open the database and decide whether this device may work yet.
   *
   * CALLABLE, not a one-shot effect. It used to run once at startup, which
   * meant a device that was approved WHILE THE APP WAS OPEN -- the normal
   * case, since somebody is standing there waiting for it -- stayed on the
   * waiting screen until the app was killed and reopened. The join screen
   * collected its credential perfectly and then had nowhere to go, because
   * the navigator below is not mounted while this says 'unenrolled', so its
   * `router.replace('/')` acted on nothing. Reported from the field,
   * 10 Nov 2026: "when I approve, application does not refresh automatically".
   */
  const boot = useCallback(async (): Promise<void> => {
    try {
      const db = await openDb();
      const store = adapt(db);
      attach(store);

      // A device with no credential cannot sync, so it is sent to be set up
      // rather than left looking like it is working. Its captured records are
      // untouched and still there afterwards.
      const base = await storedBaseUrl();
      const token = await storedToken();
      if (!base || !token) {
        setState('unenrolled');
        return;
      }

      attachSync(store, httpTransport({
        baseUrl: storedBaseUrl,
        deviceToken: storedToken,
      }));
      void registerBackgroundSync();
      // Whatever the office last told this device about reporting its
      // position. Deliberately not awaited: it asks for permissions, and a
      // device must be usable for capture while somebody decides about that.
      void applyTrackingSettings();
      setState('ready');
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e));
      setState('failed');
    }
  }, [attach, attachSync]);

  useEffect(() => { void boot(); }, [boot]);

  // Only once the database is open — a trigger that fires before it is
  // would try to read an outbox that is not there yet.
  useSyncTriggers(state === 'ready');

  if (state === 'opening') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" />
        <Text style={styles.note}>Opening the device database…</Text>
      </View>
    );
  }

  if (state === 'unenrolled') {
    // onJoined is what makes approval take effect without anybody touching
    // the device: the join screen has just stored a credential, so this runs
    // the whole startup again and the navigator below comes up.
    return <Enrol onJoined={() => { void boot(); }} />;
  }

  if (state === 'failed') {
    return (
      <View style={styles.centre}>
        <Text style={styles.failTitle}>This tablet cannot open its records</Text>
        {/* Said plainly, because the recovery is not something the operator can
            do: it needs IT, and anything unsynced is already gone. Pretending
            otherwise wastes a shift. */}
        <Text style={styles.note}>
          Nothing can be captured until this is fixed. Report it to IT and use
          paper for this shift.
        </Text>
        <Text style={styles.detail}>{why}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerStyle: { backgroundColor: '#16202b' },
                              headerTintColor: '#fff',
                              headerTitleStyle: { fontSize: 18 } }}>
        <Stack.Screen name="index" options={{ title: 'Handover' }} />
        <Stack.Screen name="capture/machine" options={{ title: 'Which machine' }} />
        <Stack.Screen name="capture/operator" options={{ title: 'Who is taking it' }} />
        <Stack.Screen name="capture/checklist" options={{ title: 'Walk-round' }} />
        <Stack.Screen name="capture/readings" options={{ title: 'Readings' }} />
        <Stack.Screen name="capture/confirm" options={{ title: 'Confirm' }} />
        <Stack.Screen name="capture/scan" options={{ title: 'Scan the cab' }} />
        <Stack.Screen name="capture/photo" options={{ title: 'Photo', presentation: 'modal' }} />
        <Stack.Screen name="sync" options={{ title: 'Still on this tablet' }} />
        <Stack.Screen name="enrol" options={{ title: 'Set up this device' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28,
            backgroundColor: '#f3f6f9', gap: 12 },
  note: { fontSize: 16, color: '#5b6a7a', textAlign: 'center' },
  failTitle: { fontSize: 20, fontWeight: '700', color: '#c0392b', textAlign: 'center' },
  detail: { fontSize: 12, color: '#8a97a5', textAlign: 'center', marginTop: 10 },
});
