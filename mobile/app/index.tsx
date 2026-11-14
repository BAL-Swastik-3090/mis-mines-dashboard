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
import { plural, verb } from '../src/core/words';
import {
  ago, byUrgency, draftSummaries, isStale, type DraftSummary,
} from '@/core/capture/drafts';
import { FadeIn, PressableScale } from '@/ui/motion';

const TYPE_LABEL: Record<DraftSummary['session_type'], string> = {
  START_HANDOVER: 'Taking over', END_HANDOVER: 'Handing over', MID_SHIFT: 'Mid-shift',
};

export default function Home() {
  const router = useRouter();
  const store = useCapture((s) => s.store);
  const resume = useCapture((s) => s.resume);
  const discard = useCapture((s) => s.discard);

  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
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
    setDrafts(byUrgency(await draftSummaries(store)));
    setOutbox(await session.outboxDepth(store));
    setCacheAge(await masters.cacheAgeHours(store));
    const { track: wanted } = await trackingSettings();
    setTrack({ wanted, running: await isTracking(), queued: await queuedCount(store) });
  }, [store]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const stale = cacheAge != null && cacheAge >= masters.STALE_AFTER_HOURS;
  const waiting = (outbox?.queued ?? 0) + (outbox?.sending ?? 0);

  /* "EVERYTHING HAS REACHED THE OFFICE" MUST MEAN EVERYTHING.
     This counted handovers only, so the green banner sat directly above the
     line "6 photos waiting to upload" and claimed the tablet was clear. A
     photograph is the evidence behind a defect; a handover that arrived
     without its photographs has not arrived. */
  const photosWaiting = outbox?.photos ?? 0;
  const allClear = waiting === 0 && photosWaiting === 0;

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
                 style={[styles.banner, allClear ? styles.bannerClear : styles.bannerWaiting]}>
        <Text style={styles.bannerTitle}>
          {allClear
            ? 'Everything on this tablet has reached the office'
            : waiting > 0
              ? `${plural(waiting, 'handover')} still on this tablet`
              : `${plural(photosWaiting, 'photograph')} still on this tablet`}
        </Text>
        {waiting > 0 && (
          <Text style={styles.bannerNote}>
            {photosWaiting > 0
              ? `With ${plural(photosWaiting, 'photograph')}. They are safe here but not filed — bring the tablet within signal.`
              : 'They are safe here but not filed. Bring the tablet within signal to send them.'}
          </Text>
        )}
        {waiting === 0 && photosWaiting > 0 && (
          <Text style={styles.bannerNote}>
            The handovers have been filed. Their photographs have not, so the
            evidence behind any fault is still on this tablet.
          </Text>
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
                : sent > 0 ? `Sent ${plural(r.sessionsSent, 'handover')} and ${plural(r.photosSent, 'photograph')}.`
                : r.photosAwaitingSession > 0 && r.stillQueued === r.photosAwaitingSession
                  ? `${plural(r.photosAwaitingSession, 'photograph')} ${verb(r.photosAwaitingSession, 'belongs', 'belong')} to a handover `
                    + 'nobody has confirmed yet. Finish it and they go with it.'
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
            This tablet last synced {plural(Math.floor((cacheAge ?? 0) / 24), 'day')} ago
          </Text>
          <Text style={styles.bannerNote}>
            Machine and operator details may have changed. Handovers can still
            be captured; each one records how old this list was.
          </Text>
        </View>
      )}

      {/* ── resume ──────────────────────────────────────────────────────────
          Ordered by what matters (E5): a machine that failed a check that
          stops it comes first, then anything with a fault, then the rest,
          newest first. Each card says what it is, who, how far it got and
          how long ago -- these were six identical cards, most of them
          "nobody identified yet". Logic and tests in core/capture/drafts.ts. */}
      {drafts.length > 0 && (
        <View style={styles.block}>
          <View style={styles.blockHead}>
            <Text style={styles.blockTitle}>UNFINISHED</Text>
            <Text style={styles.blockCount}>{drafts.length}</Text>
          </View>
          {drafts.map((d, i) => {
            const stale = isStale(d.captured_at);
            const level = d.blocking > 0 ? 'held' : d.findings > 0 ? 'found'
              : stale ? 'stale' : 'open';
            const pct = d.total > 0 ? Math.min(1, d.answered / d.total) : 0;
            return (
              <FadeIn key={d.client_uuid} delay={Math.min(i, 6) * 45}>
                <PressableScale
                  testID={`resume-${d.client_uuid}`}
                  scaleTo={0.985}
                  style={[styles.draft, LEVEL_EDGE[level]]}
                  onPress={async () => {
                    // Back to where it stopped: nobody identified means the
                    // people screen, not a walk-round with no name on it.
                    if (await resume(d.client_uuid)) {
                      router.push(d.operator_id ? '/capture/checklist' : '/capture/operator');
                    }
                  }}
                >
                  <View style={styles.draftTop}>
                    <View style={styles.draftId}>
                      <Text style={styles.draftCode}>
                        {d.fleet_code ?? `Machine ${d.asset_id}`}
                        {d.registration_no ? <Text style={styles.draftReg}>  {d.registration_no}</Text> : null}
                      </Text>
                      <Text style={[styles.draftWho, !d.operator_name && styles.draftNobody]}>
                        {d.operator_name ?? 'Nobody identified yet'}
                      </Text>
                    </View>
                    <View style={styles.typeChip}>
                      <Text style={styles.typeChipText}>{TYPE_LABEL[d.session_type]}</Text>
                    </View>
                  </View>

                  {level === 'held' && (
                    <Text style={styles.heldLine}>
                      A check that stops this machine failed. Finish and confirm
                      it, so the fault reaches the workshop.
                    </Text>
                  )}

                  <View style={styles.progressRow}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${pct * 100}%` },
                                    level === 'held' && styles.progressHeld,
                                    level === 'found' && styles.progressFound]} />
                    </View>
                    <Text style={styles.progressText}>
                      {d.answered} of {d.total} checks
                      {d.findings > 0 ? ` · ${plural(d.findings, 'fault')}` : ''}
                    </Text>
                  </View>

                  <View style={styles.draftBottom}>
                    <Text style={[styles.draftWhen, stale && styles.draftStale]}>
                      Started {ago(d.captured_at)}{stale ? ' — still needed?' : ''}
                    </Text>
                    <Text style={styles.resumeText}>Resume ›</Text>
                  </View>
                </PressableScale>
              </FadeIn>
            );
          })}
        </View>
      )}

      <PressableScale
        testID="new-handover"
        style={styles.primary}
        onPress={() => { discard(); router.push('/capture/machine'); }}
      >
        <Text style={styles.primaryText}>Start a handover</Text>
      </PressableScale>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /* ── READABLE ON A TABLET ─────────────────────────────────────────────
     This is a phone layout, and on a 1600px tablet in a dock every row
     stretched the full width: a checklist item's label sat at the far left
     and its three buttons at the far right, with a hand's width of nothing
     between them. An operator in a cab reads across that gap for every one
     of twenty-four checks.

     One column, capped and centred. Nothing changes on a phone, where the
     screen is narrower than the cap. See app/capture/checklist.tsx for the
     same cap applied to a list. */

  sendBox: { gap: 6 },
  send: { minHeight: 64, borderRadius: 10, backgroundColor: '#1e5f8a',
          alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: '#aeb8c4' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sendNote: { fontSize: 13, color: '#5b6a7a', textAlign: 'center' },
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 14,
             width: '100%', maxWidth: 820, alignSelf: 'center' },

  banner: { borderRadius: 10, padding: 14, borderWidth: 1, gap: 4 },
  bannerClear: { backgroundColor: '#eefaf1', borderColor: '#9ad6ac' },
  bannerWaiting: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a' },
  bannerStale: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a' },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#16202b' },
  bannerNote: { fontSize: 14, color: '#5b6a7a' },
  bannerBad: { fontSize: 14, color: '#c0392b', fontWeight: '700' },

  block: { gap: 10 },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockTitle: { fontSize: 12, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.8 },
  blockCount: { fontSize: 12, fontWeight: '800', color: '#fff', backgroundColor: '#5b6a7a',
                borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
  draft: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 10,
           borderWidth: 1, borderColor: '#d8dee6', borderLeftWidth: 5 },
  draftTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  draftId: { flex: 1, gap: 2 },
  draftCode: { fontSize: 19, fontWeight: '800', color: '#16202b' },
  draftReg: { fontSize: 14, fontWeight: '700', color: '#5b6a7a', letterSpacing: 0.4 },
  draftWho: { fontSize: 15, fontWeight: '600', color: '#3c4a58' },
  draftNobody: { fontWeight: '400', fontStyle: 'italic', color: '#8a97a5' },
  typeChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
              backgroundColor: '#eef3f8', borderWidth: 1, borderColor: '#d3dde8' },
  typeChipText: { fontSize: 12, fontWeight: '800', color: '#3c4a58' },
  heldLine: { fontSize: 14, fontWeight: '700', color: '#c0392b' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#e8edf2',
                   overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: '#1e5f8a' },
  progressHeld: { backgroundColor: '#c0392b' },
  progressFound: { backgroundColor: '#d98300' },
  progressText: { fontSize: 13, fontWeight: '600', color: '#3c4a58',
                  fontVariant: ['tabular-nums'] },
  draftBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  draftWhen: { fontSize: 13, color: '#5b6a7a' },
  draftStale: { color: '#8a5a00', fontWeight: '600' },
  resumeText: { fontSize: 15, fontWeight: '800', color: '#1e5f8a' },

  primary: { minHeight: 68, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 19, fontWeight: '700' },
});

/** The left edge says how urgent a card is before a word of it is read. */
const LEVEL_EDGE = StyleSheet.create({
  held: { borderLeftColor: '#c0392b', backgroundColor: '#fff8f7' },
  found: { borderLeftColor: '#d98300' },
  stale: { borderLeftColor: '#c4ccd6' },
  open: { borderLeftColor: '#1e5f8a' },
});
