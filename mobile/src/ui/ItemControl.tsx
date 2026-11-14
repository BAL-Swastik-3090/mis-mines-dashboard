/**
 * One checklist item, answered with a gloved hand on a tablet in sunlight.
 *
 * ── WHY THE BUTTONS ARE THIS BIG ─────────────────────────────────────────────
 * 56pt minimum, well past the 44pt guideline. The operator is wearing gloves,
 * standing next to a running machine, often in direct sun, and a mis-tap here
 * does not produce a typo — it produces a brake check that says OK.
 *
 * ── WHY NOT OK OPENS ITS CONSEQUENCES IMMEDIATELY ────────────────────────────
 * The remark box and the camera appear the moment an adverse answer is given,
 * not on a later screen. "Brakes not OK" with no remark is an argument;
 * "brakes not OK, pedal goes to the floor, and here is the photo" is a defect
 * the workshop can act on. Asking for it later means asking for it after the
 * operator has stopped looking at the brakes.
 *
 * ── WHY A CRITICAL ITEM IS MARKED BEFORE IT IS ANSWERED ──────────────────────
 * So that answering it NOT OK is not a surprise. The operator should know,
 * while he is looking at the machine, that this is the question that stops it.
 */

import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import type { ChecklistItem, RawResponse } from '@/core/evaluation';
import { evaluateOne, rangeLabel } from '@/core/evaluation';
import { answersFor, isAdverse, type Answer } from '@/core/enums';
import { plural } from '@/core/words';

const ANSWER_LABEL: Record<Answer, string> = {
  OK: 'OK', CAUTION: 'Caution', NOT_OK: 'Not OK', NA: 'N/A',
  YES: 'Yes', NO: 'No',
  LOW: 'Low', NORMAL: 'Normal', HIGH: 'High',
};

export interface ItemControlProps {
  item: ChecklistItem;
  value: RawResponse | undefined;
  photoCount: number;
  onChange: (raw: RawResponse) => void;
  onAddPhoto: () => void;
  /** Give an unanswered check an edge of its own, so what is left stands out (B1). */
  markUnanswered?: boolean;
  /** One check on its own screen: bigger type and buttons. */
  large?: boolean;
}

/**
 * What this check demands, said BEFORE it is answered (issue B5).
 *
 * "Photo required if not OK" was enforced and never shown until it blocked
 * the operator -- after they had walked away from the thing to photograph.
 * And a yes/no check says nothing on its face about which answer is the
 * fault: "Abnormal sound -- Yes" is one, "Grease points done -- Yes" is not.
 */
export function itemRules(item: ChecklistItem): string[] {
  const out: string[] = [];
  let fault: string | null = null;
  switch (item.responseType) {
    case 'OK_CAUTION_NOTOK': fault = 'Caution or Not OK'; break;
    case 'NUMERIC': fault = rangeLabel(item) ? 'out of range' : null; break;
    case 'YES_NO':
      if (item.adverseAnswer) {
        fault = ANSWER_LABEL[item.adverseAnswer];
        out.push(`${fault} is a fault`);
      }
      break;
    case 'LEVEL': fault = null; break;
  }
  if (item.requiresPhotoIfNotOk && fault) out.push(`Photo if ${fault}`);
  return out;
}

export function ItemControl({
  item, value, photoCount, onChange, onAddPhoto, markUnanswered, large,
}: ItemControlProps) {
  const [reading, setReading] = useState(
    value?.numericValue != null ? String(value.numericValue) : '',
  );

  const current: RawResponse = value ?? { itemId: item.itemId };
  const ev = evaluateOne(item, { ...current, photoCount });
  const answered = current.answer != null || current.numericValue != null;
  const adverse = answered && ev.isAdverse;

  const put = (patch: Partial<RawResponse>) =>
    onChange({ ...current, itemId: item.itemId, ...patch });

  /**
   * Changing a finding back to a clean answer asks first.
   *
   * ── WHY THIS IS NOT FUSSY ──────────────────────────────────────────────
   * An adverse answer carries a remark somebody typed and often a photograph
   * somebody took, and it may be the reason the machine is held. One stray
   * tap on OK cleared all of it silently: the finding, the banner, the
   * defect it would have raised. The record then showed a clean machine, and
   * nothing anywhere said a fault had been entered and removed. Done by
   * accident during testing on a tablet, 12 Nov 2026 -- which is exactly how
   * it would happen in a cab with gloves on.
   *
   * Only in this direction. Marking something NOT OK is never questioned.
   */
  const [confirmClear, setConfirmClear] = useState<Answer | null>(null);

  const choose = (a: Answer) => {
    const losingAFinding =
      adverse && !isAdverse(a) && a !== item.adverseAnswer
      && ((current.remark ?? '').trim() !== '' || (photoCount ?? 0) > 0);
    if (losingAFinding) { setConfirmClear(a); return; }
    put({ answer: a, numericValue: null });
  };

  // A problem the screen is already stating is noise, not help. "Add a photo"
  // is the label on the button sitting right above it, and printing it twice
  // reads as two separate things to do.
  const photoButtonShown = adverse && item.requiresPhotoIfNotOk;
  const unsaid = ev.problems.filter(
    (p) => !(photoButtonShown && p === 'Add a photo'));
  const rules = itemRules(item);

  const clearPrompt = confirmClear ? (
    <View style={styles.confirmBox} testID={`confirm-clear-${item.itemId}`}>
      <Text style={styles.confirmText}>
        This removes the finding{(current.remark ?? '').trim() ? ', what you wrote about it' : ''}
        {(photoCount ?? 0) > 0 ? ` and ${plural(photoCount, 'photo')}` : ''}. The workshop
        will not be told about it.
      </Text>
      <View style={styles.confirmRow}>
        <Pressable
          testID={`confirm-clear-yes-${item.itemId}`}
          style={[styles.confirmBtn, styles.confirmBtnBad]}
          onPress={() => {
            // The remark and photos are kept on the row: an answer that is no
            // longer adverse does not use them, but deleting what somebody
            // wrote because of a tap is the same mistake again.
            put({ answer: confirmClear, numericValue: null });
            setConfirmClear(null);
          }}
        >
          <Text style={styles.confirmBtnText}>Yes, remove it</Text>
        </Pressable>
        <Pressable
          testID={`confirm-clear-no-${item.itemId}`}
          style={[styles.confirmBtn, styles.confirmBtnKeep]}
          onPress={() => setConfirmClear(null)}
        >
          <Text style={styles.confirmBtnText}>Keep the finding</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  return (
    <View style={[styles.card, large && styles.cardLarge,
                  markUnanswered && !answered && styles.cardOpen,
                  adverse && styles.cardAdverse]}
          testID={`item-${item.itemId}`}>
      <View style={styles.header}>
        <Text style={[styles.label, large && styles.labelLarge]}>{item.label}</Text>
        {item.isCritical ? (
          <Text style={styles.critical} accessibilityLabel="critical item">STOPS THE MACHINE</Text>
        ) : answered && !adverse && unsaid.length === 0 ? (
          <Text style={styles.done} accessibilityLabel="answered">✓</Text>
        ) : null}
      </View>

      {rules.length > 0 && (
        <View style={styles.rules} testID={`rules-${item.itemId}`}>
          {rules.map((r) => (
            <View key={r} style={styles.rule}><Text style={styles.ruleText}>{r}</Text></View>
          ))}
        </View>
      )}

      {item.responseType === 'NUMERIC' ? (
        <View>
          <View style={styles.readingRow}>
            <TextInput
              testID={`reading-${item.itemId}`}
              style={styles.reading}
              value={reading}
              onChangeText={(t) => {
                setReading(t);
                const n = t.trim() === '' ? null : Number(t);
                put({ numericValue: Number.isFinite(n as number) ? (n as number) : null });
              }}
              keyboardType="decimal-pad"
              placeholder="—"
              accessibilityLabel={`${item.label} reading`}
            />
            {item.unit ? <Text style={styles.unit}>{item.unit}</Text> : null}
          </View>
          {rangeLabel(item) ? (
            <Text style={[styles.range, ev.inRange === false && styles.rangeBad]}>
              {ev.inRange === false ? 'Outside ' : 'Should be '}{rangeLabel(item)}
            </Text>
          ) : (
            // Said out loud: an unbounded gauge is recorded, not judged, and an
            // operator should not be left wondering whether his reading passed.
            <Text style={styles.range}>Recorded, no limit set</Text>
          )}
        </View>
      ) : (
        <View style={styles.answers}>
          {answersFor(item.responseType).map((a) => {
            const picked = current.answer === a;
            // A critical item cannot be waved away, so N/A is not offered on
            // one — rather than offered and then refused at the end.
            if (a === 'NA' && item.isCritical) return null;
            return (
              <Pressable
                key={a}
                testID={`answer-${item.itemId}-${a}`}
                accessibilityRole="button"
                accessibilityState={{ selected: picked }}
                style={[styles.answer, large && styles.answerLarge, picked && styles.answerPicked,
                        picked && a === 'NOT_OK' && styles.answerNotOk,
                        picked && a === 'CAUTION' && styles.answerCaution]}
                onPress={() => choose(a)}
              >
                <Text style={[styles.answerText, picked && styles.answerTextPicked]}>
                  {ANSWER_LABEL[a]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Asked BEFORE the answer changes, so the finding is still there to
          keep. Outside the adverse block: by the time it renders the answer
          has not changed yet, and inside it would vanish on the very tap it
          exists to question. */}
      {clearPrompt}

      {/* The consequences, the moment the answer is given. */}
      {adverse && (
          <View style={styles.consequences}>
          <TextInput
            testID={`remark-${item.itemId}`}
            style={styles.remark}
            value={current.remark ?? ''}
            onChangeText={(t) => put({ remark: t })}
            placeholder="What is wrong? The workshop reads this."
            multiline
            accessibilityLabel={`${item.label} — what is wrong`}
          />
          {item.requiresPhotoIfNotOk && (
            <Pressable
              testID={`photo-${item.itemId}`}
              accessibilityRole="button"
              style={[styles.photo, photoCount > 0 && styles.photoDone]}
              onPress={onAddPhoto}
            >
              <Text style={styles.photoText}>
                {photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'Add a photo'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Why this item is not finished. Shown here rather than saved up for the
          confirm screen, where it would be a list of twenty things to go back
          and find. */}
      {answered && unsaid.length > 0 && (
        <View testID={`problems-${item.itemId}`}>
          {unsaid.map((p) => (
            <Text key={p} style={styles.problem}>{p}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  confirmBox: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1.5,
                borderRadius: 8, padding: 12, gap: 10 },
  confirmText: { fontSize: 14, color: '#16202b' },
  confirmRow: { flexDirection: 'row', gap: 8 },
  confirmBtn: { flex: 1, minHeight: 52, borderRadius: 8,
                alignItems: 'center', justifyContent: 'center' },
  confirmBtnBad: { backgroundColor: '#c0392b' },
  confirmBtnKeep: { backgroundColor: '#1e5f8a' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10,
          borderWidth: 1, borderColor: '#d8dee6' },
  cardLarge: { padding: 20, borderRadius: 14, marginBottom: 0 },
  // Not answered yet: an edge of its own, so the eye finds what is left
  // rather than reading every card to see which has no selection.
  cardOpen: { borderLeftWidth: 5, borderLeftColor: '#d9a441' },
  labelLarge: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  done: { fontSize: 18, fontWeight: '800', color: '#1e8449' },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2, marginBottom: 10 },
  rule: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
          backgroundColor: '#eef3f8', borderWidth: 1, borderColor: '#d3dde8' },
  ruleText: { fontSize: 12, fontWeight: '700', color: '#3c4a58' },
  answerLarge: { minHeight: 72, minWidth: 120, flexGrow: 1, borderRadius: 12 },
  cardAdverse: { borderColor: '#c0392b', borderWidth: 2, backgroundColor: '#fff6f5' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
            marginBottom: 10, gap: 8 },
  label: { fontSize: 17, fontWeight: '600', flexShrink: 1, color: '#16202b' },
  critical: { fontSize: 10, fontWeight: '800', color: '#c0392b', letterSpacing: 0.5 },

  answers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  answer: { minHeight: 56, minWidth: 92, paddingHorizontal: 16, borderRadius: 8,
            borderWidth: 1.5, borderColor: '#aeb8c4', alignItems: 'center',
            justifyContent: 'center', backgroundColor: '#fff' },
  answerPicked: { backgroundColor: '#16202b', borderColor: '#16202b' },
  answerNotOk: { backgroundColor: '#c0392b', borderColor: '#c0392b' },
  answerCaution: { backgroundColor: '#d98300', borderColor: '#d98300' },
  answerText: { fontSize: 17, fontWeight: '600', color: '#16202b' },
  answerTextPicked: { color: '#fff' },

  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reading: { minHeight: 56, flex: 1, borderWidth: 1.5, borderColor: '#aeb8c4',
             borderRadius: 8, paddingHorizontal: 14, fontSize: 22, color: '#16202b' },
  unit: { fontSize: 17, color: '#5b6a7a', minWidth: 48 },
  range: { marginTop: 6, fontSize: 13, color: '#5b6a7a' },
  rangeBad: { color: '#c0392b', fontWeight: '700' },

  consequences: { marginTop: 10, gap: 8 },
  remark: { minHeight: 64, borderWidth: 1.5, borderColor: '#c0392b', borderRadius: 8,
            padding: 12, fontSize: 16, backgroundColor: '#fff', textAlignVertical: 'top' },
  photo: { minHeight: 56, borderRadius: 8, borderWidth: 1.5, borderColor: '#c0392b',
           alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  photoDone: { borderColor: '#1e8449', backgroundColor: '#eefaf1' },
  photoText: { fontSize: 16, fontWeight: '600', color: '#16202b' },

  problem: { marginTop: 6, fontSize: 13, color: '#c0392b', fontWeight: '600' },
});
