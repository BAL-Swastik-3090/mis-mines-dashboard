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
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { shiftAt, type ResolvedShift } from '@/core/capture/shifts';
import { counterpartQuestion } from '@/core/capture/session';
import { whatIsLeft, type Fix } from '@/core/capture/todo';
import { plural } from '@/core/words';
import { FadeIn, PopIn } from '@/ui/motion';
import { FlowProgress } from '@/ui/FlowProgress';

export default function Confirm() {
  const router = useRouter();
  const asset = useCapture((s) => s.asset);
  const operator = useCapture((s) => s.operator);
  const counterpart = useCapture((s) => s.counterpart);
  const counterpartAbsent = useCapture((s) => s.counterpartAbsent);
  const recorder = useCapture((s) => s.recorder);
  const row = useCapture((s) => s.row);
  const verdict = useCapture((s) => s.verdict);
  const template = useCapture((s) => s.template);
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
        {/* It LANDS: the card rises in and the mark springs into place, so
            the moment the record is saved is a moment, not a page swap. */}
        <FadeIn style={styles.doneCard}>
          <PopIn style={[styles.doneMark, held && styles.doneMarkHeld]} delay={140}>
            <Text style={styles.doneMarkText}>{held ? '!' : '✓'}</Text>
          </PopIn>

          <Text style={styles.doneTitle}>
            {held ? 'Recorded — the machine is held' : 'Recorded'}
          </Text>
          <Text style={styles.doneNote}>
            {asset.fleet_code}, signed by {operator?.name ?? 'the operator'}
            {recorder ? `, filled in by ${recorder.name}` : ''}.
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
        </FadeIn>

        <Pressable testID="done" style={styles.primary}
                   onPress={() => { discard(); router.replace('/'); }}>
          <Text style={styles.primaryText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // Each thing left knows where it is fixed, so the screen can take the
  // operator there rather than leave them scrolling for it (issue B2). The
  // same rules as session.confirm(), which still refuses on its own.
  const fixes = whatIsLeft({
    sessionType: row.session_type,
    operatorId: row.operator_id,
    counterpartOperatorId: row.counterpart_operator_id,
    counterpartAbsent: row.counterpart_absent === 1,
    hasTemplate: row.template_id != null && template != null,
    assetTypeName: asset.asset_type_name,
    meterReading: row.meter_reading,
    lastMeterReading: asset.last_meter_reading,
    fuelLevel: row.fuel_level,
    remarks: row.remarks,
    items: template?.items ?? [],
    verdict,
  });
  const ready = verdict != null && fixes.length === 0;

  const go = (f: Fix) => {
    switch (f.where) {
      // Back to the screen already in the stack, not a second copy of it.
      case 'PEOPLE': router.dismissTo('/capture/operator'); break;
      case 'READINGS': router.dismissTo('/capture/readings'); break;
      case 'ITEM':
        router.push({ pathname: '/capture/step',
                      params: { item: String(f.itemId), from: 'confirm' } });
        break;
      case 'NOWHERE': break;
    }
  };

  return (
    <View style={styles.screen}>
    <FlowProgress at="confirm" />
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <Text style={styles.code}>{asset.fleet_code}</Text>
        {/* On the record somebody is putting their name to. */}
        {asset.registration_no ? (
          <Text style={styles.reg}>{asset.registration_no}</Text>
        ) : null}
        <Text style={styles.meta}>{asset.asset_type_name}</Text>
        <Text style={styles.meta}>
          {row.session_type === 'START_HANDOVER' ? 'Taking over' : row.session_type === 'END_HANDOVER' ? 'Handing over' : 'Mid-shift check'} · meter {row.meter_reading ?? '—'}{' '}
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
      </View>

      {/* ── WHO IS ON THIS RECORD ──────────────────────────────────────────
          Three people, not one. The person signing reads every name they are
          putting on the record before they put their own to it -- this was a
          single line that named the operator and implied the rest. */}
      <View style={styles.people} testID="people">
        <Person role={row.session_type === 'START_HANDOVER' ? 'Taking over'
                      : row.session_type === 'END_HANDOVER' ? 'Handing over' : 'Operator'}
                name={operator?.name} emp={operator?.emp_id} />
        {counterpartQuestion(row.session_type) && (
          <Person role={counterpartQuestion(row.session_type)!.label}
                  name={counterpart?.name ?? (counterpartAbsent ? 'Nobody' : undefined)}
                  emp={counterpart?.emp_id}
                  note={counterpartAbsent
                    ? (row.session_type === 'START_HANDOVER' ? 'the machine was parked'
                                                             : 'the machine is being parked')
                    : undefined} />
        )}
        <Person role="Filled in by"
                name={recorder?.name ?? operator?.name}
                emp={recorder?.emp_id ?? operator?.emp_id}
                note={recorder ? undefined : 'the operator themself'} last />
      </View>

      {/* ── WHAT IS LEFT, AND THE WAY TO EACH ───────────────────────────────
          Was a box of text below the findings, under a button that said
          "6 things left" and went nowhere. */}
      {fixes.length > 0 && (
        <View style={styles.stopping} testID="stopping">
          <Text style={styles.stoppingTitle}>
            {plural(fixes.length, 'thing')} left before you can confirm
          </Text>
          {fixes.map((f, i) => (
            <Pressable key={`${f.where}-${i}`} testID={`fix-${i}`}
                       disabled={f.where === 'NOWHERE'}
                       style={({ pressed }) => [styles.fix, i > 0 && styles.fixRule,
                                                pressed && styles.fixPressed]}
                       onPress={() => go(f)}>
              <Text style={styles.fixText}>{f.text}</Text>
              {f.where !== 'NOWHERE' && <Text style={styles.fixGo}>›</Text>}
            </Pressable>
          ))}
        </View>
      )}

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

      {refused.length > 0 && (
        <View style={styles.stopping}>
          {refused.map((p) => <Text key={p} style={styles.stoppingItem}>{p}</Text>)}
        </View>
      )}

      <Pressable
        testID="attest"
        disabled={busy || verdict == null || (!ready && fixes[0]?.where === 'NOWHERE')}
        style={({ pressed }) => [styles.primary, !ready && styles.primaryTodo,
                                 // Saving keeps its colour: greyed out reads as refused.
                                 !busy && verdict == null && styles.primaryOff,
                                 pressed && styles.pressed]}
        onPress={async () => {
          // Not ready: the button takes them to the first thing left, rather
          // than sitting there counting it.
          if (!ready) { if (fixes[0]) go(fixes[0]); return; }
          const out = await confirm(operator?.emp_id ?? `operator:${operator?.operator_id}`);
          if (out.queued) setDone({ status: out.status });
          else setRefused(out.problems);
        }}
      >
        {busy ? (
          // Saving takes a moment -- the position fix alone can take seconds
          // -- and a button that shows nothing invites a second press.
          <View style={styles.saving}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.primaryText}>Saving on this tablet…</Text>
          </View>
        ) : (
        <Text style={styles.primaryText}>
          {ready ? 'I confirm this is what I found'
            : fixes.length === 1 ? 'Fix the one thing left'
            : `Fix the first of ${fixes.length} things left`}
        </Text>
        )}
      </Pressable>

      <Text style={styles.footnote}>
        Confirming saves it on this tablet. It reaches the office when there is
        signal.
      </Text>
    </ScrollView>
    </View>
  );
}

/** One labelled name. Missing is said, never left blank. */
function Person({ role, name, emp, note, last }: {
  role: string; name?: string | null; emp?: string | null; note?: string; last?: boolean;
}) {
  return (
    <View style={[styles.person, !last && styles.personRule]}>
      <Text style={styles.personRole}>{role}</Text>
      <View style={styles.personWho}>
        <Text style={[styles.personName, !name && styles.personMissing]}>
          {name ?? 'Not answered'}
        </Text>
        {(emp || note) ? (
          <Text style={styles.personEmp}>{[emp, note].filter(Boolean).join(' · ')}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  people: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14,
            borderWidth: 1, borderColor: '#d8dee6' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  personRule: { borderBottomWidth: 1, borderBottomColor: '#eef1f5' },
  personRole: { width: 128, fontSize: 13, fontWeight: '700', color: '#5b6a7a',
                textTransform: 'uppercase', letterSpacing: 0.4 },
  personWho: { flex: 1, gap: 1 },
  personName: { fontSize: 17, fontWeight: '700', color: '#16202b' },
  personMissing: { color: '#a35f00' },
  personEmp: { fontSize: 13, color: '#5b6a7a' },
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
              borderRadius: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  fix: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52,
         paddingVertical: 8 },
  fixRule: { borderTopWidth: 1, borderTopColor: '#f0deb0' },
  fixPressed: { backgroundColor: '#fdf0cf' },
  fixText: { flex: 1, fontSize: 15, color: '#16202b' },
  fixGo: { fontSize: 26, color: '#8a5a00', fontWeight: '700', lineHeight: 28 },
  primaryTodo: { backgroundColor: '#1e5f8a' },
  saving: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  stoppingTitle: { fontSize: 15, fontWeight: '800', color: '#16202b', marginBottom: 4 },
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
