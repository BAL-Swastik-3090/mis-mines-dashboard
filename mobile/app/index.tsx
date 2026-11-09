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
import * as session from '@/core/capture/session';
import * as masters from '@/core/capture/masters';

export default function Home() {
  const router = useRouter();
  const store = useCapture((s) => s.store);
  const resume = useCapture((s) => s.resume);
  const discard = useCapture((s) => s.discard);

  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof session.openDrafts>>>([]);
  const [outbox, setOutbox] = useState<Awaited<ReturnType<typeof session.outboxDepth>> | null>(null);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!store) return;
    setDrafts(await session.openDrafts(store));
    setOutbox(await session.outboxDepth(store));
    setCacheAge(await masters.cacheAgeHours(store));
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
