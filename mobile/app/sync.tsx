/**
 * What is still on this tablet, and why.
 *
 * ── THE SCREEN A SUPERVISOR IS SENT TO ───────────────────────────────────────
 * The home screen says how many are waiting. This says which, how long, how
 * many times it has been tried, and what the server actually said — in the
 * server's own words, not a paraphrase. "Sync failed" is not something anybody
 * can act on; "unanswered: Parking brake" is.
 *
 * ── REFUSALS AND CLASHES ARE NOT FAILURES TO RETRY ───────────────────────────
 * They are shown in their own section with no retry button, because pressing it
 * would get the same answer forever. They need a person: a supervisor who can
 * look at the handover and decide what actually happened.
 */

import { useCallback, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSync } from '@/ui/useSync';
import { useCapture } from '@/ui/useCapture';

interface Waiting {
  client_uuid: string;
  fleet_code: string | null;
  status: string;
  sync_state: string;
  sync_attempts: number;
  sync_error: string | null;
  captured_at: string;
  server_session_ref: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

const howLong = (iso: string) => {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  if (h < 1) return 'less than an hour';
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${Math.floor(h / 24)} days`;
};

export default function Sync() {
  const store = useCapture((s) => s.store);
  const run = useSync((s) => s.run);
  const refresh = useSync((s) => s.refresh);
  const running = useSync((s) => s.running);
  const report = useSync((s) => s.lastReport);
  const status = useSync((s) => s.status);

  const [rows, setRows] = useState<Waiting[]>([]);

  const load = useCallback(async () => {
    if (!store) return;
    await refresh();
    setRows(await store.getAllAsync<Waiting>(
      `SELECT s.client_uuid, a.fleet_code, s.status, s.sync_state, s.sync_attempts,
              s.sync_error, s.captured_at, s.server_session_ref
         FROM session s LEFT JOIN cached_asset a ON a.asset_id = s.asset_id
        WHERE s.sync_state <> 'synced'
        ORDER BY s.captured_at`));
  }, [store, refresh]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const waiting = rows.filter((r) => r.sync_state === 'queued' || r.sync_state === 'sending');
  const stuck = rows.filter((r) => r.sync_state === 'rejected' || r.sync_state === 'conflict');
  const drafts = rows.filter((r) => r.sync_state === 'draft');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}
    >
      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>
          {waiting.length === 0 && (status?.photosQueued ?? 0) === 0
            ? 'Nothing is waiting'
            : `${waiting.length} handover${waiting.length === 1 ? '' : 's'}` +
              `${(status?.photosQueued ?? 0) > 0
                  ? ` and ${status?.photosQueued} photo(s)` : ''} waiting`}
        </Text>
        {status?.lastSyncAt && (
          <Text style={styles.summaryNote}>Machine list last refreshed {when(status.lastSyncAt)}</Text>
        )}
        {status?.oldestQueuedAt && (
          <Text style={styles.summaryWarn}>
            The oldest has been here {howLong(status.oldestQueuedAt)}.
          </Text>
        )}
      </View>

      <Pressable
        testID="sync-now"
        disabled={running}
        style={[styles.primary, running && styles.primaryOff]}
        onPress={() => void run({ force: true, refreshMasters: true })}
      >
        {running ? <ActivityIndicator color="#fff" />
                 : <Text style={styles.primaryText}>Sync now</Text>}
      </Pressable>

      {report && !running && (
        <View style={styles.report}>
          <Text style={styles.reportLine}>
            Sent {report.sessionsSent} handover(s) and {report.photosSent} photo(s).
            {report.stillQueued > 0 ? ` ${report.stillQueued} still waiting.` : ''}
          </Text>
          {report.problems.map((p) => (
            <Text key={p} style={styles.reportProblem}>{p}</Text>
          ))}
        </View>
      )}

      {waiting.length > 0 && (
        <Section title="Waiting to be sent">
          {waiting.map((r) => (
            <View key={r.client_uuid} style={styles.row}>
              <Text style={styles.code}>{r.fleet_code ?? 'unknown machine'}</Text>
              <Text style={styles.meta}>
                {when(r.captured_at)} · {r.status}
                {r.sync_attempts > 0 ? ` · tried ${r.sync_attempts} time${
                  r.sync_attempts === 1 ? '' : 's'}` : ''}
              </Text>
              {r.sync_error && <Text style={styles.why}>{r.sync_error}</Text>}
            </View>
          ))}
        </Section>
      )}

      {stuck.length > 0 && (
        <Section title="Need a supervisor">
          {/* No retry button on purpose: the server has read these and declined
              them, and pressing send again gets the same answer forever. */}
          {stuck.map((r) => (
            <View key={r.client_uuid} style={[styles.row, styles.rowBad]}>
              <Text style={styles.code}>{r.fleet_code ?? 'unknown machine'}</Text>
              <Text style={styles.meta}>
                {when(r.captured_at)} ·{' '}
                {r.sync_state === 'conflict'
                  ? 'clashes with a handover already filed'
                  : 'refused by the office'}
              </Text>
              {/* The server's own words. */}
              {r.sync_error && <Text style={styles.whyBad}>{r.sync_error}</Text>}
            </View>
          ))}
        </Section>
      )}

      {drafts.length > 0 && (
        <Section title="Not finished">
          <Text style={styles.note}>
            These have not been confirmed by anybody, so they are not sent.
          </Text>
          {drafts.map((r) => (
            <View key={r.client_uuid} style={styles.row}>
              <Text style={styles.code}>{r.fleet_code ?? 'unknown machine'}</Text>
              <Text style={styles.meta}>started {when(r.captured_at)}</Text>
            </View>
          ))}
        </Section>
      )}

      {(status?.photosRejected ?? 0) > 0 && (
        <Section title="Photos the office refused">
          <Text style={styles.note}>
            {status?.photosRejected} photo(s). The handovers they belong to are
            filed; only the pictures were refused.
          </Text>
        </Section>
      )}

      <Text style={styles.footnote}>
        Closing the app does not send anything. Bring the tablet within signal
        and leave it open, or press Sync now.
      </Text>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 14, paddingBottom: 40 },

  summary: { backgroundColor: '#16202b', borderRadius: 10, padding: 16, gap: 3 },
  summaryTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  summaryNote: { color: '#aeb8c4', fontSize: 13 },
  summaryWarn: { color: '#ffcf80', fontSize: 14, fontWeight: '600' },

  primary: { minHeight: 68, borderRadius: 10, backgroundColor: '#1e5f8a',
             alignItems: 'center', justifyContent: 'center' },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  report: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 4,
            borderWidth: 1, borderColor: '#d8dee6' },
  reportLine: { fontSize: 15, color: '#16202b' },
  reportProblem: { fontSize: 14, color: '#c0392b', fontWeight: '600' },

  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.6 },
  note: { fontSize: 14, color: '#5b6a7a' },

  row: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 2,
         borderWidth: 1, borderColor: '#d8dee6' },
  rowBad: { borderColor: '#c0392b', borderWidth: 1.5, backgroundColor: '#fff6f5' },
  code: { fontSize: 17, fontWeight: '700', color: '#16202b' },
  meta: { fontSize: 13, color: '#5b6a7a' },
  why: { fontSize: 13, color: '#8a97a5', fontStyle: 'italic' },
  whyBad: { fontSize: 14, color: '#c0392b', fontWeight: '600' },

  footnote: { fontSize: 13, color: '#5b6a7a', textAlign: 'center', marginTop: 6 },
});
