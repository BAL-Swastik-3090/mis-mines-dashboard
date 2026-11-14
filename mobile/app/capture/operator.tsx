/**
 * Who is in this handover.
 *
 * ── THREE PEOPLE, NOT ONE ────────────────────────────────────────────────────
 * This screen asked for one name and the record put it everywhere: the person
 * coming on, the person going off, and whoever held the tablet were all the
 * same employee number. So a supervisor filling in a handover for an operator
 * who cannot read left no trace, and a takeover never said who it was taken
 * from. It now asks, in order:
 *
 *   1. the operator whose handover this is            required
 *   2. the other side -- or that nobody was there      required on a handover
 *   3. who is holding the tablet                       defaults to the operator
 *
 * The third costs nothing when it is the same person, which is most of the
 * time, and that is why it is a default rather than a question.
 *
 * ── IDENTIFICATION IS NOT A LOGIN ────────────────────────────────────────────
 * Nobody signs in to this app. The tablet is shared, it is used by whoever is
 * at the machine, and nothing is remembered afterwards: a device that recalled
 * the last operator would put the previous shift's name on this one, which is
 * the quiet failure that makes a whole register worthless.
 *
 * ── AND IT IS NEVER REFUSED ──────────────────────────────────────────────────
 * Not signed off on this machine type? Recorded, shown, and raised for a
 * supervisor. The mine has not decided whether competency may be overridden
 * (scope §9, question 3), and until it does, refusing would mean a machine
 * going out with no record at all rather than a machine going out with an
 * awkward one.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { PersonPicker } from '@/ui/PersonPicker';
import { FlowProgress } from '@/ui/FlowProgress';
import { counterpartQuestion } from '@/core/capture/session';
import type { SessionType } from '@/core/enums';

/** What the operator IS in this kind of session. */
function operatorRole(t: SessionType): string {
  switch (t) {
    case 'START_HANDOVER': return 'Taking over';
    case 'END_HANDOVER': return 'Handing over';
    case 'MID_SHIFT': return 'Operator';
  }
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

export default function Identify() {
  const router = useRouter();
  const store = useCapture((s) => s.store);
  const uuid = useCapture((s) => s.uuid);
  const asset = useCapture((s) => s.asset);
  const row = useCapture((s) => s.row);
  const chosen = useCapture((s) => s.operator);
  const counterpart = useCapture((s) => s.counterpart);
  const counterpartAbsent = useCapture((s) => s.counterpartAbsent);
  const recorder = useCapture((s) => s.recorder);
  const advisories = useCapture((s) => s.advisories);
  const identify = useCapture((s) => s.identify);
  const setCounterpart = useCapture((s) => s.setCounterpart);
  const setRecorder = useCapture((s) => s.setRecorder);

  const [hasPhoto, setHasPhoto] = useState(false);
  const [photoSkipped, setPhotoSkipped] = useState(false);
  const [someoneElse, setSomeoneElse] = useState(false);

  // Re-read on focus, because the camera screen is pushed on top of this one
  // and returns to it: the photo exists only after it comes back. And after
  // the operator is changed, because that removes the previous one's photo.
  const checkPhoto = useCallback(async () => {
    if (!store || !uuid) { setHasPhoto(false); return; }
    const r = await store.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM photo WHERE session_uuid = ? AND kind = 'OPERATOR'`, [uuid]);
    setHasPhoto((r?.n ?? 0) > 0);
  }, [store, uuid]);
  useFocusEffect(useCallback(() => { void checkPhoto(); }, [checkPhoto]));

  if (!asset || !row) {
    return (
      <View style={styles.screen}>
        <Text style={styles.empty}>No machine has been picked. Go back and pick one.</Text>
      </View>
    );
  }

  const type = row.session_type;
  const other = counterpartQuestion(type);
  const operatorDone = chosen != null;
  const photoDone = hasPhoto || photoSkipped;
  const otherDone = !other || counterpart != null || counterpartAbsent;

  // The button names the first thing still missing, in the order asked.
  const missing = !operatorDone ? 'Identify the operator first'
    : !photoDone ? `Photograph ${firstName(chosen.name)} first`
    : !otherDone ? (type === 'START_HANDOVER' ? 'Say who handed it over first'
                                              : 'Say who is taking it over first')
    : null;

  return (
    <View style={styles.scroll}>
    <FlowProgress at="people" />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}
                keyboardShouldPersistTaps="handled">
      <View style={styles.machine}>
        <Text style={styles.machineCode}>{asset.fleet_code}</Text>
        {/* Shown here too: this is the last screen before the walk-round,
            and the cheapest moment to notice the wrong machine. */}
        {asset.registration_no ? (
          <Text style={styles.machineReg}>{asset.registration_no}</Text>
        ) : null}
        <Text style={styles.machineType}>
          {asset.asset_type_name} · {operatorRole(type).toLowerCase()}
        </Text>
      </View>

      {/* ── 1 · the operator ─────────────────────────────────────────────── */}
      <Step n={1} title={operatorRole(type)} done={operatorDone && photoDone}
            hint={type === 'MID_SHIFT' ? 'Who is operating the machine'
                  : type === 'START_HANDOVER' ? 'Who is taking the machine on'
                  : 'Who is handing the machine off'}>
        <PersonPicker
          testID="operator"
          chosen={chosen}
          onPick={async (op, how) => {
            await identify(op, how);
            // One person cannot be both sides of a handover, nor be recorded
            // as filling in for themself. Picking somebody as the operator who
            // was already named below takes them out of that role.
            if (counterpart?.operator_id === op.operator_id) await setCounterpart(null, false);
            if (recorder?.operator_id === op.operator_id) await setRecorder(null);
            await checkPhoto();
          }}
        />

        {/* Shown, never blocking. */}
        {advisories.length > 0 && (
          <View style={styles.advisories} testID="advisories">
            {advisories.map((a) => (
              <View key={a.kind}
                    style={[styles.advisory,
                            (a.kind === 'MACHINE_HELD' || a.kind === 'COMPETENCY')
                              && styles.advisorySerious]}>
                <Text style={styles.advisoryText}>{a.message}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── the operator's photo ─────────────────────────────────────────
            Taken before the walk-round, not after, because it is a record of
            WHO was at the machine and the point of it is that the person was
            standing there. A photo offered at the end can be taken by
            anybody, anywhere, once the machine has already moved. */}
        {chosen && (
          <View style={styles.photoBox}>
            {hasPhoto ? (
              <Text style={styles.photoDone}>✓ {firstName(chosen.name)} photographed</Text>
            ) : (
              <>
                <View style={styles.photoHead}>
                  <Text style={styles.photoAsk}>
                    Photograph {firstName(chosen.name)} at the machine
                  </Text>
                  <Required done={photoSkipped} />
                </View>
                <Pressable testID="operator-photo"
                           style={({ pressed }) => [styles.photoBtn, pressed && styles.pressed]}
                           onPress={() => router.push('/capture/photo?kind=operator')}>
                  <Text style={styles.photoBtnText}>Take the photo</Text>
                </Pressable>
                {/* A broken camera must not stop a shift. Recorded, not
                    hidden: the handover goes without a photo and says so. */}
                {!photoSkipped ? (
                  <Pressable testID="skip-photo" hitSlop={8} onPress={() => setPhotoSkipped(true)}>
                    <Text style={styles.photoSkip}>The camera is not working</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.photoSkipped}>
                    Going on without a photo. The office will see that none was taken.
                  </Text>
                )}
              </>
            )}
          </View>
        )}
      </Step>

      {/* ── 2 · the other side ───────────────────────────────────────────── */}
      {other && (
        <Step n={2} title={other.label} done={otherDone}
              hint={type === 'START_HANDOVER'
                ? 'The operator going off shift, who handed you the machine'
                : 'The operator coming on shift, who takes the machine from you'}>
          {counterpartAbsent ? (
            <View style={styles.nobody} testID="counterpart-nobody">
              <Text style={styles.nobodyText}>{other.nobody}</Text>
              <Pressable testID="counterpart-nobody-change" hitSlop={12}
                         style={styles.changeBtn}
                         onPress={() => void setCounterpart(null, false)}>
                <Text style={styles.change}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <PersonPicker
                testID="counterpart"
                chosen={counterpart}
                exclude={chosen?.operator_id}
                excludedBecause={'is the operator. If nobody else was there, say "nobody" below.'}
                onPick={(op) => setCounterpart(op, false)}
              />
              {!counterpart && (
                <Pressable testID="counterpart-none"
                           style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                           onPress={() => void setCounterpart(null, true)}>
                  <Text style={styles.secondaryText}>{other.nobody}</Text>
                </Pressable>
              )}
            </>
          )}
        </Step>
      )}

      {/* ── 3 · who is holding the tablet ────────────────────────────────── */}
      <Step n={other ? 3 : 2} title="Filled in by" optional
            hint="Whoever is holding the tablet, if it is not the operator">
        {recorder ? (
          <>
            <PersonPicker testID="recorder" chosen={recorder}
                          exclude={chosen?.operator_id}
                          onPick={(op) => setRecorder(op)} />
            <Pressable testID="recorder-is-operator" hitSlop={8}
                       onPress={() => { void setRecorder(null); setSomeoneElse(false); }}>
              <Text style={styles.link}>
                {chosen ? `${firstName(chosen.name)} is filling it in after all`
                        : 'The operator is filling it in after all'}
              </Text>
            </Pressable>
          </>
        ) : someoneElse ? (
          <>
            <PersonPicker testID="recorder" chosen={null}
                          exclude={chosen?.operator_id}
                          excludedBecause="is the operator, which is already the default."
                          placeholder="Your employee number or name"
                          onPick={(op) => setRecorder(op)} />
            <Pressable testID="recorder-cancel" hitSlop={8} onPress={() => setSomeoneElse(false)}>
              <Text style={styles.link}>Cancel — the operator is filling it in</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.selfRow}>
            <Text style={styles.selfText}>
              {chosen ? `${firstName(chosen.name)} is filling this in` : 'The operator is filling this in'}
            </Text>
            <Pressable testID="recorder-someone-else" hitSlop={8}
                       style={styles.changeBtn} onPress={() => setSomeoneElse(true)}>
              <Text style={styles.change}>Someone else</Text>
            </Pressable>
          </View>
        )}
      </Step>

      <Pressable
        testID="to-checklist"
        disabled={missing != null}
        style={({ pressed }) => [styles.primary, missing != null && styles.primaryOff,
                                 pressed && missing == null && styles.pressed]}
        onPress={() => router.push('/capture/checklist')}
      >
        <Text style={styles.primaryText}>{missing ?? 'Start the walk-round'}</Text>
      </Pressable>
    </ScrollView>
    </View>
  );
}

/** One question on the screen, numbered because they are asked in order. */
function Step({ n, title, hint, done, optional, children }: {
  n: number; title: string; hint: string; done?: boolean; optional?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.step, !optional && !done && styles.stepOpen]} testID={`step-${n}`}>
      <View style={styles.stepHead}>
        <View style={[styles.stepNo, done && styles.stepNoDone]}>
          <Text style={[styles.stepNoText, done && styles.stepNoTextDone]}>
            {done ? '✓' : n}
          </Text>
        </View>
        <View style={styles.stepTitles}>
          <Text style={styles.stepTitle}>{title}</Text>
          <Text style={styles.stepHint}>{hint}</Text>
        </View>
        {optional ? <Text style={styles.optional}>Optional</Text> : <Required done={done} />}
      </View>
      {children}
    </View>
  );
}

/**
 * What is compulsory, said where it is asked rather than discovered at the end.
 * Before this, required-ness appeared only as a dim button at the bottom of
 * the last screen (issue B1).
 */
function Required({ done }: { done?: boolean }) {
  if (done) return null;
  return (
    <View style={styles.required}>
      <Text style={styles.requiredText}>Required</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  /* ── READABLE ON A TABLET ─────────────────────────────────────────────
     One column, capped and centred, so a label and its control are never a
     hand's width apart on a 1600px screen. Nothing changes on a phone. */
  scroll: { flex: 1, backgroundColor: '#f3f6f9' },
  screen: { padding: 16, gap: 14, width: '100%', maxWidth: 820, alignSelf: 'center',
            paddingBottom: 32 },

  machine: { backgroundColor: '#16202b', borderRadius: 12, padding: 16, gap: 2 },
  machineCode: { color: '#fff', fontSize: 22, fontWeight: '800' },
  machineReg: { fontSize: 14, fontWeight: '700', color: '#cfe0ec', letterSpacing: 0.4 },
  machineType: { color: '#aeb8c4', fontSize: 14 },

  step: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 12,
          borderWidth: 1, borderColor: '#d8dee6' },
  // An unanswered required question is the one thing on the screen with an
  // edge of its own, so the eye goes to what is left rather than what is done.
  stepOpen: { borderColor: '#d9a441', borderLeftWidth: 4 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNo: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e8edf2',
            alignItems: 'center', justifyContent: 'center' },
  stepNoDone: { backgroundColor: '#1e8449' },
  stepNoText: { fontSize: 15, fontWeight: '800', color: '#3c4a58' },
  stepNoTextDone: { color: '#fff' },
  stepTitles: { flex: 1, gap: 1 },
  stepTitle: { fontSize: 18, fontWeight: '800', color: '#16202b' },
  stepHint: { fontSize: 13, color: '#5b6a7a' },

  required: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
              backgroundColor: '#fff4dc', borderWidth: 1, borderColor: '#e0bf6a' },
  requiredText: { fontSize: 12, fontWeight: '800', color: '#8a5a00', letterSpacing: 0.4 },
  optional: { fontSize: 12, fontWeight: '700', color: '#8a97a5', letterSpacing: 0.4 },

  advisories: { gap: 8 },
  advisory: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1,
              borderRadius: 8, padding: 12 },
  advisorySerious: { backgroundColor: '#fff6f5', borderColor: '#c0392b' },
  advisoryText: { fontSize: 14, color: '#16202b' },

  photoBox: { backgroundColor: '#f7f9fb', borderRadius: 10, padding: 12, gap: 10,
              borderWidth: 1, borderColor: '#e1e7ee' },
  photoHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoAsk: { flex: 1, fontSize: 15, fontWeight: '600', color: '#16202b' },
  photoDone: { fontSize: 16, fontWeight: '700', color: '#1e8a4f' },
  photoBtn: { minHeight: 56, borderRadius: 10, backgroundColor: '#1e5f8a',
              alignItems: 'center', justifyContent: 'center' },
  photoBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  photoSkip: { fontSize: 13, color: '#5b6a7a', textAlign: 'center', paddingVertical: 4 },
  photoSkipped: { fontSize: 13, color: '#a35f00', fontWeight: '600' },

  nobody: { flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: '#f2f9f5', borderRadius: 10, borderWidth: 1.5,
            borderColor: '#1e8449', paddingHorizontal: 14, paddingVertical: 14 },
  nobodyText: { flex: 1, fontSize: 16, fontWeight: '700', color: '#16202b' },

  secondary: { minHeight: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#aeb8c4',
               borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
               paddingHorizontal: 12, backgroundColor: '#fff' },
  secondaryText: { fontSize: 15, fontWeight: '700', color: '#3c4a58' },

  selfRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selfText: { flex: 1, fontSize: 16, color: '#16202b' },
  changeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
               borderWidth: 1, borderColor: '#c4d3e0', backgroundColor: '#fff' },
  change: { fontSize: 15, color: '#1e5f8a', fontWeight: '700' },
  link: { fontSize: 15, color: '#1e5f8a', fontWeight: '600', paddingVertical: 4 },

  primary: { minHeight: 68, borderRadius: 12, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20,
             marginTop: 4 },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 20 },
});
