/**
 * The home screen: what this tablet is holding, and the one button.
 *
 * ── THE OUTBOX IS SHOWN WHETHER OR NOT IT IS INTERESTING ─────────────────────
 * Anything still on this tablet is one wipe from gone. An app that hides a
 * three-day-old queue behind a tidy green tick is telling the operator his
 * handovers are filed when they are sitting in a cab, and that is the single
 * most misleading thing this screen could do.
 */

import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { useSync } from '@/ui/useSync';
import * as session from '@/core/capture/session';
import * as masters from '@/core/capture/masters';
import {
  applyTrackingSettings, isTracking, queuedCount,
} from '@/core/location/tracker';
import { trackingSettings } from '@/core/sync/enrolment';

export default function Home() {
  const router = useRouter();
  const store = useCapture((s) => s.store);
  const resume = useCapture((s) => s.resume);
  const discard = useCapture((s) => s.discard);

  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof session.openDrafts>>>([]);
  const [outbox, setOutbox] = useState<Awaited<ReturnType<typeof session.outboxDepth>> | null>(null);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [track, setTrack] = useState<{ wanted: boolean; running: boolean; queued: number } | null>(null);
  const [trackProblem, setTrackProblem] = useState<string | null>(null);

  const runSync = useSync((s) => s.run);
  const syncing = useSync((s) => s.running);
  const lastReport = useSync((s) => s.lastReport);
  const [sendNote, setSendNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store) return;
    setDrafts(await session.openDrafts(store));
    setOutbox(await session.outboxDepth(store));
    setCacheAge(await masters.cacheAgeHours(store));
    const { track: wanted } = await trackingSettings();
    setTrack({ wanted, running: await isTracking(), queued: await queuedCount(store) });
  }, [store]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const stale = cacheAge != null && cacheAge >= masters.STALE_AFTER_HOURS;
  const waiting = (outbox?.queued ?? 0) + (outbox?.sending ?? 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true); await load(); setRefreshing(false);
        }} />
      }
    >
      {/* ── what is still here ───────────────────────────────────────────── */}
      <Pressable testID="open-sync" onPress={() => router.push('/sync')}
                 style={[styles.banner, waiting > 0 ? styles.bannerWaiting : styles.bannerClear]}>
        <Text style={styles.bannerTitle}>
          {waiting === 0
            ? 'Everything on this tablet has reached the office'
            : `${waiting} handover${waiting === 1 ? '' : 's'} still on this tablet`}
        </Text>
        {waiting > 0 && (
          <Text style={styles.bannerNote}>
            They are safe here but not filed. Bring the tablet within signal to
            send them.
          </Text>
        )}
        {(outbox?.photos ?? 0) > 0 && (
          <Text style={styles.bannerNote}>{outbox?.photos} photo(s) waiting to upload.</Text>
        )}
        {(outbox?.rejected ?? 0) > 0 && (
          <Text style={styles.bannerBad}>
            {outbox?.rejected} refused by the office — show a supervisor.
          </Text>
        )}
        {(outbox?.conflict ?? 0) > 0 && (
          <Text style={styles.bannerBad}>
            {outbox?.conflict} clash with a handover already filed — show a supervisor.
          </Text>
        )}
      </Pressable>

      {/* ── sending by hand, when sending by itself has not worked ───────
          The app syncs on open, on reconnect and after a capture, and most of
          the time nobody needs this. But "most of the time" is not a plan: a
          tablet that has quietly failed to send for two days needs somebody
          able to DO something about it where they are standing, not a screen
          telling them to bring it within signal when it already is.
          So the button is here, on the first screen, whenever anything is
          waiting -- and it says what the server actually said when it fails,
          because "sync failed" is not something anybody can act on. */}
      {waiting + (outbox?.photos ?? 0) > 0 && (
        <View style={styles.sendBox}>
          <Pressable
            testID="send-now"
            disabled={syncing}
            style={[styles.send, syncing && styles.sendOff]}
            onPress={async () => {
              setSendNote(null);
              const r = await runSync({ force: true, refreshMasters: true });
              await load();
              if (!r) { setSendNote('Could not reach the office. Try again within signal.'); return; }
              const sent = r.sessionsSent + r.photosSent;
              // "Nothing was due" and "could not be reached" are different
              // facts. Saying the second when the first is true sends somebody
              // looking for a network problem that is not there.
              setSendNote(
                r.problems.length > 0 ? r.problems.join(' ')
                : sent > 0 ? `Sent ${r.sessionsSent} handover(s) and ${r.photosSent} photo(s).`
                : r.stillQueued > 0
                  ? 'Could not reach the office. It is still waiting here.'
                  : 'Nothing was waiting to be sent.');
            }}
          >
            <Text style={styles.sendText}>{syncing ? 'Sending…' : 'Send now'}</Text>
          </Pressable>
          {sendNote && <Text style={styles.sendNote}>{sendNote}</Text>}
          {!sendNote && lastReport && lastReport.problems.length > 0 && (
            <Text style={styles.sendNote}>{lastReport.problems[0]}</Text>
          )}
        </View>
      )}

      {/* ── position reporting ───────────────────────────────────────────
          Shown only when the office has asked for it AND Android is not
          actually doing it. That gap is invisible otherwise: the app looks
          fine, the dashboard shows nothing, and nobody finds out for a week.
          Android needs location set to "Allow all the time", which is two
          screens deep and not what its first prompt offers. */}
      {track?.wanted && !track.running && (
        <Pressable
          testID="fix-tracking"
          style={[styles.banner, styles.bannerStale]}
          onPress={async () => {
            const r = await applyTrackingSettings();
            setTrackProblem(r.ok ? null : r.message);
            await load();
          }}
        >
          <Text style={styles.bannerTitle}>This device is not reporting its position</Text>
          <Text style={styles.bannerNote}>
            {trackProblem ?? 'The office has asked this device to report where it is. Tap to allow it.'}
          </Text>
        </Pressable>
      )}

      {stale && (
        <View style={[styles.banner, styles.bannerStale]}>
          <Text style={styles.bannerTitle}>
            This tablet last synced {Math.floor((cacheAge ?? 0) / 24)} day(s) ago
          </Text>
          <Text style={styles.bannerNote}>
            Machine and operator details may have changed. Handovers can still
            be captured; each one records how old this list was.
          </Text>
        </View>
      )}

      {/* ── resume ──────────────────────────────────────────────────────── */}
      {drafts.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Unfinished</Text>
          {drafts.map((d) => (
            <Pressable
              key={d.client_uuid}
              testID={`resume-${d.client_uuid}`}
              style={styles.draft}
              onPress={async () => {
                if (await resume(d.client_uuid)) router.push('/capture/checklist');
              }}
            >
              <Text style={styles.draftCode}>{d.fleet_code ?? `Machine ${d.asset_id}`}</Text>
              <Text style={styles.draftWhen}>
                started {new Date(d.captured_at).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  hour12: false })}
                {d.operator_emp_id ? ` · ${d.operator_emp_id}` : ' · nobody identified yet'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        testID="new-handover"
        style={styles.primary}
        onPress={() => { discard(); router.push('/capture/machine'); }}
      >
        <Text style={styles.primaryText}>Start a handover</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sendBox: { gap: 6 },
  send: { minHeight: 64, borderRadius: 10, backgroundColor: '#1e5f8a',
          alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: '#aeb8c4' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sendNote: { fontSize: 13, color: '#5b6a7a', textAlign: 'center' },
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 14 },

  banner: { borderRadius: 10, padding: 14, borderWidth: 1, gap: 4 },
  bannerClear: { backgroundColor: '#eefaf1', borderColor: '#9ad6ac' },
  bannerWaiting: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a' },
  bannerStale: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a' },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#16202b' },
  bannerNote: { fontSize: 14, color: '#5b6a7a' },
  bannerBad: { fontSize: 14, color: '#c0392b', fontWeight: '700' },

  block: { gap: 8 },
  blockTitle: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.6 },
  draft: { backgroundColor: '#fff', borderRadius: 10, padding: 14, minHeight: 64,
           borderWidth: 1, borderColor: '#d8dee6', justifyContent: 'center' },
  draftCode: { fontSize: 18, fontWeight: '700', color: '#16202b' },
  draftWhen: { fontSize: 13, color: '#5b6a7a', marginTop: 2 },

  primary: { minHeight: 68, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 19, fontWeight: '700' },
});
