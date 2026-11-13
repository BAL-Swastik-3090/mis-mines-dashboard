/**
 * The attestation.
 *
 * ── THE BUTTON DOES NOT SAY "SUBMIT" ─────────────────────────────────────────
 * It says what actually happens: the operator attests, and the handover waits
 * on this tablet until it reaches the office. On a mine with no signal at the
 * face, a button saying "Submit" followed by a tick is a lie the app tells
 * several hundred times a day, and the first anybody knows of it is when a
 * supervisor cannot find a handover that was definitely done.
 *
 * ── A BLOCKED HANDOVER IS CONFIRMED, NOT ABANDONED ───────────────────────────
 * The screen is emphatic that the machine does not change hands, and equally
 * emphatic that the record must still be filed. The record of what was found
 * is the thing that gets the machine repaired.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { shiftAt, type ResolvedShift } from '@/core/capture/shifts';

export default function Confirm() {
  const router = useRouter();
  const asset = useCapture((s) => s.asset);
  const operator = useCapture((s) => s.operator);
  const row = useCapture((s) => s.row);
  const verdict = useCapture((s) => s.verdict);
  const blockers = useCapture((s) => s.blockers);
  const refreshVerdict = useCapture((s) => s.refreshVerdict);
  const confirm = useCapture((s) => s.confirm);
  const discard = useCapture((s) => s.discard);
  const busy = useCapture((s) => s.busy);
  const store = useCapture((s) => s.store);

  // From the mine's own calendar, cached by the last sync. Null is said out
  // loud rather than guessed: a device that has never synced cannot name a
  // shift, and inventing one on a confirm screen is worse than admitting it.
  const [shift, setShift] = useState<ResolvedShift | null>(null);
  useEffect(() => {
    void (async () => {
      if (!store || !row?.captured_at) return;
      setShift(await shiftAt(store, new Date(row.captured_at)));
    })();
  }, [store, row?.captured_at]);

  const [done, setDone] = useState<{ status: string } | null>(null);
  const [refused, setRefused] = useState<string[]>([]);

  useFocusEffect(useCallback(() => { void refreshVerdict(); }, [refreshVerdict]));

  if (!asset || !row) {
    return <View style={styles.screen}><Text style={styles.empty}>Nothing to confirm.</Text></View>;
  }

  if (done) {
    const held = done.status === 'BLOCKED';
    return (
      /* Anchored rather than floating. This was a screen of white with four
         lines adrift in the middle of it: a card holds the outcome, the
         button sits under it at full width, and the screen has a top and a
         bottom instead of a centre. */
      <View style={[styles.screen, styles.doneScreen]}>
        <View style={styles.doneCard}>
          <View style={[styles.doneMark, held && styles.doneMarkHeld]}>
            <Text style={styles.doneMarkText}>{held ? '!' : '✓'}</Text>
          </View>

          <Text style={styles.doneTitle}>
            {held ? 'Recorded — the machine is held' : 'Recorded'}
          </Text>
          <Text style={styles.doneNote}>
            {asset.fleet_code}, signed by {operator?.name ?? 'the operator'}.
          </Text>

          {/* THE HONEST SENTENCE, as a labelled fact rather than a paragraph.
              It was three lines of amber prose saying one thing, which is
              how a warning stops being read. */}
          <View style={styles.doneState}>
            <Text style={styles.doneStateTitle}>Saved on this tablet</Text>
            <Text style={styles.doneStateNote}>
              It reaches the office at the next signal. Not filed yet.
            </Text>
          </View>
        </View>

        <Pressable testID="done" style={styles.primary}
                   onPress={() => { discard(); router.replace('/'); }}>
          <Text style={styles.primaryText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const stopping = [...blockers, ...(verdict?.problems ?? []),
                    ...(verdict?.unanswered ?? []).map((i) => `${i.label}: not answered`)];
  const ready = stopping.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <Text style={styles.code}>{asset.fleet_code}</Text>
        {/* On the record somebody is putting their name to. */}
        {asset.registration_no ? (
          <Text style={styles.reg}>{asset.registration_no}</Text>
        ) : null}
        <Text style={styles.meta}>{asset.asset_type_name}</Text>
        <Text style={styles.meta}>
          {row.session_type.replace(/_/g, ' ').toLowerCase()} · meter {row.meter_reading ?? '—'}{' '}
          {row.meter_uom ?? ''}
        </Text>
        {/* WHICH SHIFT. The office resolves this from the time of capture and
            stores it on the record (migration 113), but the person signing
            should see which shift they are filing against -- near a shift
            boundary it is the difference between their shift and the next
            one, and they are the only person who can say it is wrong. */}
        <Text style={styles.meta}>
          {shift ? `shift ${shift.code} · ${shift.productionDay}`
                 : 'shift not known on this device — the office will set it'}
        </Text>
        <Text style={styles.meta}>
          {operator ? `${operator.name} (${operator.emp_id ?? 'no number'})`
                    : 'nobody identified'}
        </Text>
      </View>

      {verdict?.isBlocked && (
        <View style={styles.blocked}>
          <Text style={styles.blockedTitle}>This machine does not change hands</Text>
          <Text style={styles.blockedWhy}>{verdict.blockedReason}</Text>
          <Text style={styles.blockedNote}>
            Confirm it anyway. The record of what you found is what gets it
            repaired, and a handover nobody filed leaves the fault invisible.
          </Text>
        </View>
      )}

      {(verdict?.adverseCount ?? 0) > 0 && (
        <View style={styles.findings}>
          <Text style={styles.findingsTitle}>
            {verdict?.adverseCount} finding{verdict?.adverseCount === 1 ? '' : 's'}
          </Text>
          {verdict?.responses.filter((r) => r.isAdverse).map((r) => (
            <View key={r.item.itemId} style={styles.finding}>
              <Text style={styles.findingLabel}>
                {r.item.label}
                {r.severity ? ` · ${r.severity.toLowerCase()}` : ''}
              </Text>
              <Text style={styles.findingWhat}>
                {r.raw.numericValue != null ? `${r.raw.numericValue} ${r.item.unit ?? ''}`
                                            : String(r.raw.answer).replace(/_/g, ' ').toLowerCase()}
                {r.raw.remark ? ` — ${r.raw.remark}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!ready && (
        <View style={styles.stopping} testID="stopping">
          <Text style={styles.stoppingTitle}>Not finished</Text>
          {stopping.map((p) => <Text key={p} style={styles.stoppingItem}>{p}</Text>)}
        </View>
      )}

      {refused.length > 0 && (
        <View style={styles.stopping}>
          {refused.map((p) => <Text key={p} style={styles.stoppingItem}>{p}</Text>)}
        </View>
      )}

      <Pressable
        testID="attest"
        disabled={!ready || busy}
        style={[styles.primary, (!ready || busy) && styles.primaryOff]}
        onPress={async () => {
          const out = await confirm(operator?.emp_id ?? `operator:${operator?.operator_id}`);
          if (out.queued) setDone({ status: out.status });
          else setRefused(out.problems);
        }}
      >
        <Text style={styles.primaryText}>
          {ready
            ? 'I confirm this is what I found'
            : `${stopping.length} thing${stopping.length === 1 ? '' : 's'} left`}
        </Text>
      </Pressable>

      <Text style={styles.footnote}>
        Confirming saves it on this tablet. It reaches the office when there is
        signal.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  reg: { fontSize: 15, fontWeight: '700', color: '#16202b', textAlign: 'center',
         letterSpacing: 0.4 },
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
  centre: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },

  summary: { backgroundColor: '#16202b', borderRadius: 10, padding: 16, gap: 2 },
  code: { color: '#fff', fontSize: 22, fontWeight: '700' },
  meta: { color: '#aeb8c4', fontSize: 14 },

  blocked: { backgroundColor: '#c0392b', borderRadius: 10, padding: 14, gap: 4 },
  blockedTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  blockedWhy: { color: '#fff', fontSize: 15 },
  blockedNote: { color: '#ffd9d4', fontSize: 13 },

  findings: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 10,
              borderWidth: 1, borderColor: '#d8dee6' },
  findingsTitle: { fontSize: 15, fontWeight: '800', color: '#16202b' },
  finding: { gap: 1 },
  findingLabel: { fontSize: 15, fontWeight: '600', color: '#16202b' },
  findingWhat: { fontSize: 14, color: '#5b6a7a' },

  stopping: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1,
              borderRadius: 10, padding: 14, gap: 4 },
  stoppingTitle: { fontSize: 15, fontWeight: '800', color: '#16202b' },
  stoppingItem: { fontSize: 14, color: '#16202b' },

  /* WIDTH, not just height. `centre` sets alignItems: 'center', which makes
     every child shrink to its content -- so on the Done screen this button
     became as wide as the word "Done" and clipped it. alignSelf: 'stretch'
     makes it fill the column it is in wherever it is used, and the padding
     keeps it a real target on a tablet in a cab with gloves on. */
  primary: { minHeight: 72, borderRadius: 10, backgroundColor: '#1e8449',
             alignItems: 'center', justifyContent: 'center',
             alignSelf: 'stretch', paddingHorizontal: 24,
             /* A pressed button that does not move does not feel pressed. */
             shadowColor: '#0b3d23', shadowOpacity: 0.18, shadowRadius: 6,
             shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  footnote: { fontSize: 13, color: '#5b6a7a', textAlign: 'center' },

  doneScreen: { padding: 16, gap: 16, justifyContent: 'center',
                width: '100%', maxWidth: 820, alignSelf: 'center' },
  doneCard: { backgroundColor: '#fff', borderRadius: 14, padding: 24, gap: 8,
              alignItems: 'center', borderWidth: 1, borderColor: '#d8dee6' },
  doneMark: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#1e8449',
              alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  doneMarkHeld: { backgroundColor: '#c0392b' },
  doneMarkText: { color: '#fff', fontSize: 28, fontWeight: '800', lineHeight: 34 },
  doneTitle: { fontSize: 24, fontWeight: '800', color: '#16202b', textAlign: 'center' },
  doneNote: { fontSize: 16, color: '#5b6a7a', textAlign: 'center' },
  doneState: { alignSelf: 'stretch', marginTop: 12, borderRadius: 10, padding: 12,
               backgroundColor: '#fff8e6', borderWidth: 1, borderColor: '#e0bf6a' },
  doneStateTitle: { fontSize: 15, fontWeight: '800', color: '#8a5a00' },
  doneStateNote: { fontSize: 14, color: '#8a5a00', marginTop: 2 },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 40 },
});
