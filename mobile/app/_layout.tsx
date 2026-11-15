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
import { sendFromBackground } from '@/core/sync/background';
import { useLang, useT } from '@/i18n';
import { GuideHost } from '@/ui/Guide';
import { AppHeader } from '@/ui/AppHeader';
import { TermsScreen } from '@/ui/Terms';
import { covers, useTerms } from '@/legal/acceptance';
import { requeueDeviceRefusals } from '@/core/sync/engine';
import { removeEmptyDraftsWithoutChecklist } from '@/core/capture/session';
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
  // Through the same lock as the screens and the position tracker, so a run
  // the OS grants while either is mid-send does not post everything twice.
  // Success even when nothing went: a failed send stays queued and the
  // tracker or the screens try again, so there is nothing for the OS to retry.
  await sendFromBackground({ force: true });
  return BackgroundTask.BackgroundTaskResult.Success;
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
  const { t } = useT();
  const loadLang = useLang((s) => s.load);
  // The tablet's language, before the first screen is drawn.
  useEffect(() => { void loadLang(); }, [loadLang]);
  // Whether these terms of use have been accepted on this tablet.
  const termsReady = useTerms((s) => s.ready);
  const accepted = useTerms((s) => s.accepted);
  const loadTerms = useTerms((s) => s.load);
  useEffect(() => { void loadTerms(); }, [loadTerms]);
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
      // Anything parked as "refused by the office" when it was the TABLET the
      // office refused (401/403) goes back in the queue. See engine.ts.
      await requeueDeviceRefusals(store).catch(() => undefined);
      // And drafts that can never be finished (no checklist, nothing in them).
      await removeEmptyDraftsWithoutChecklist(store).catch(() => undefined);
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

  // ── TERMS OF USE FIRST ────────────────────────────────────────────────────
  // Before setting up the device and before any handover: whoever installs the
  // app accepts its terms, and a new version of them is accepted again.
  // Nothing new can be captured until this passes. Handovers already on the
  // tablet keep going to the office meanwhile: they were captured under the
  // terms in force at the time, and holding them back would only risk them.
  if (!termsReady) {
    return <View style={styles.centre}><ActivityIndicator size="large" /></View>;
  }
  if (!covers(accepted)) {
    return <SafeAreaProvider><TermsScreen mode="accept" /></SafeAreaProvider>;
  }

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
      {/* Every screen arrives the same way (E3): forward slides in from the
          right, back slides out, and a modal rises from below. Android's
          default was a fade that made moving on and going back look the
          same. The background is set here too, so nothing flashes white
          between two grey screens mid-slide. */}
      <Stack screenOptions={{ // Drawn by the app, not Android: the native bar cancelled
                              // a finger's press on EN and ? (see AppHeader).
                              header: (props) => <AppHeader {...props} />,
                              animation: 'slide_from_right',
                              contentStyle: { backgroundColor: '#f3f6f9' } }}>
        <Stack.Screen name="index" options={{ title: t('Handover') }} />
        <Stack.Screen name="capture/machine" options={{ title: t('Which machine') }} />
        <Stack.Screen name="capture/operator" options={{ title: t('Who is in this handover') }} />
        <Stack.Screen name="capture/checklist" options={{ title: t('Walk-round') }} />
        <Stack.Screen name="capture/step" options={{ title: t('One check at a time') }} />
        <Stack.Screen name="capture/readings" options={{ title: t('Readings') }} />
        <Stack.Screen name="capture/confirm" options={{ title: t('Confirm') }} />
        <Stack.Screen name="capture/scan" options={{ title: t('Scan the cab') }} />
        <Stack.Screen name="capture/photo"
                      options={{ title: t('Photo'), presentation: 'modal',
                                 animation: 'slide_from_bottom' }} />
        <Stack.Screen name="sync" options={{ title: t('Still on this tablet') }} />
        <Stack.Screen name="history" options={{ title: t('Done on this tablet') }} />
        <Stack.Screen name="settings" options={{ title: t('Settings') }} />
        <Stack.Screen name="terms" options={{ title: t('Terms of use') }} />
        <Stack.Screen name="enrol" options={{ title: t('Set up this device') }} />
      </Stack>
      {/* Drawn once, above every screen: the header buttons only open it. */}
      <GuideHost />
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
