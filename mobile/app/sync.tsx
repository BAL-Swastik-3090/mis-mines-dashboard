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
  TextInput,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSync } from '@/ui/useSync';
import { useCapture } from '@/ui/useCapture';
import { plural, verb } from '../src/core/words';
import {
  setBaseUrlOverride, storedBaseUrl, storedCode, storedLabel,
} from '@/core/sync/enrolment';

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
  const router = useRouter();
  const store = useCapture((s) => s.store);
  const run = useSync((s) => s.run);
  const refresh = useSync((s) => s.refresh);
  const running = useSync((s) => s.running);
  const report = useSync((s) => s.lastReport);
  const status = useSync((s) => s.status);

  const [rows, setRows] = useState<Waiting[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const [tablet, setTablet] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    if (!store) return;
    await refresh();
    const base = await storedBaseUrl();
    setServer(base);
    setDraft(base ?? '');
    setTablet(await storedLabel());
    setCode(await storedCode());
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
                  ? ` and ${plural(status?.photosQueued ?? 0, 'photograph')}` : ''} waiting`}
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
        // Reload AFTER the run. Without this the list still shows the
        // handovers that have just gone -- the engine updated the rows
        // underneath it, but this screen read them once on focus. A
        // supervisor sees 'Sent 1 handover' above a list that still says
        // it is waiting, and presses Sync again. Seen on a tablet,
        // 12 Nov 2026.
        onPress={async () => { await run({ force: true, refreshMasters: true });
                               await load(); }}
      >
        {running ? <ActivityIndicator color="#fff" />
                 : <Text style={styles.primaryText}>Sync now</Text>}
      </Pressable>

      {report && !running && (
        <View style={styles.report}>
          <Text style={styles.reportLine}>
            Sent {plural(report.sessionsSent, 'handover')} and {plural(report.photosSent, 'photograph')}.
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
            {plural(status?.photosRejected ?? 0, 'photograph')}. The handovers they belong to are
            filed; only the pictures were refused.
          </Text>
        </Section>
      )}

      <Text style={styles.footnote}>
        It sends by itself: every few minutes while the app is open, and in the
        background while this device is reporting its position. Sync now sends
        straight away.
      </Text>

      {/* ── which server, and how to change it ──────────────────────────────
          A development backend runs on somebody's laptop and a laptop's
          address moves. Changing it here does NOT touch the credential: this
          device is still the same approved device, talking to the same server
          at a different address. An earlier version threw the credential away
          as well, which meant somebody in an office had to approve the device
          a second time for what was really a DHCP lease expiring. */}
      <View style={styles.serverBox}>
        <Text style={styles.serverLabel}>This device</Text>
        <Text style={styles.serverValue}>{tablet ?? 'not set up'}{code ? ` · ${code}` : ''}</Text>
        <Text style={styles.serverLabel}>Sends to</Text>
        <Text style={styles.serverValue}>{server ?? '—'}</Text>

        {editingServer ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={styles.resetWarn}>
              Only change this if IT told you to. Nothing captured on this
              device is affected, and it stays the same approved device.
            </Text>
            <TextInput
              testID="server-draft"
              style={styles.serverInput}
              value={draft}
              onChangeText={setDraft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.10:8990"
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                testID="server-save"
                style={[styles.primary, { flex: 1 }]}
                onPress={async () => {
                  const v = draft.trim().replace(/\/+$/, '');
                  if (v && !/^https?:\/\//i.test(v)) return;
                  await setBaseUrlOverride(v || null);
                  setEditingServer(false);
                  await load();
                  void run({ force: true, refreshMasters: true });
                }}
              >
                <Text style={styles.primaryText}>Use this server</Text>
              </Pressable>
              <Pressable style={[styles.primary, { flex: 1, backgroundColor: '#5b6a7a' }]}
                         onPress={() => setEditingServer(false)}>
                <Text style={styles.primaryText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable testID="change-server" onPress={() => setEditingServer(true)}>
            <Text style={styles.serverChange}>Server moved? Change the address</Text>
          </Pressable>
        )}
      </View>
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
  /* ── READABLE ON A TABLET ─────────────────────────────────────────────
     This is a phone layout, and on a 1600px tablet in a dock every row
     stretched the full width: a checklist item's label sat at the far left
     and its three buttons at the far right, with a hand's width of nothing
     between them. An operator in a cab reads across that gap for every one
     of twenty-four checks.

     One column, capped and centred. Nothing changes on a phone, where the
     screen is narrower than the cap. See app/capture/checklist.tsx for the
     same cap applied to a list. */

  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 14, paddingBottom: 40,
             width: '100%', maxWidth: 820, alignSelf: 'center' },

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

  serverBox: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 2,
               borderWidth: 1, borderColor: '#d8dee6', marginTop: 4 },
  serverLabel: { fontSize: 11, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.5,
                 marginTop: 6 },
  serverValue: { fontSize: 15, color: '#16202b' },
  serverChange: { fontSize: 14, color: '#1e5f8a', fontWeight: '600', marginTop: 12 },
  resetWarn: { fontSize: 13, color: '#16202b' },
  serverInput: { minHeight: 52, borderWidth: 1.5, borderColor: '#aeb8c4',
                 borderRadius: 8, paddingHorizontal: 12, fontSize: 15,
                 backgroundColor: '#fff', color: '#16202b' },
});
