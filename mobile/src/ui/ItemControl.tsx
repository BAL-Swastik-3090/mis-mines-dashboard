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
import { answersFor, type Answer } from '@/core/enums';

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
}

export function ItemControl({ item, value, photoCount, onChange, onAddPhoto }: ItemControlProps) {
  const [reading, setReading] = useState(
    value?.numericValue != null ? String(value.numericValue) : '',
  );

  const current: RawResponse = value ?? { itemId: item.itemId };
  const ev = evaluateOne(item, { ...current, photoCount });
  const answered = current.answer != null || current.numericValue != null;
  const adverse = answered && ev.isAdverse;

  const put = (patch: Partial<RawResponse>) =>
    onChange({ ...current, itemId: item.itemId, ...patch });

  // A problem the screen is already stating is noise, not help. "Add a photo"
  // is the label on the button sitting right above it, and printing it twice
  // reads as two separate things to do.
  const photoButtonShown = adverse && item.requiresPhotoIfNotOk;
  const unsaid = ev.problems.filter(
    (p) => !(photoButtonShown && p === 'Add a photo'));

  return (
    <View style={[styles.card, adverse && styles.cardAdverse]} testID={`item-${item.itemId}`}>
      <View style={styles.header}>
        <Text style={styles.label}>{item.label}</Text>
        {item.isCritical && (
          <Text style={styles.critical} accessibilityLabel="critical item">STOPS THE MACHINE</Text>
        )}
      </View>

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
                style={[styles.answer, picked && styles.answerPicked,
                        picked && a === 'NOT_OK' && styles.answerNotOk,
                        picked && a === 'CAUTION' && styles.answerCaution]}
                onPress={() => put({ answer: a, numericValue: null })}
              >
                <Text style={[styles.answerText, picked && styles.answerTextPicked]}>
                  {ANSWER_LABEL[a]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

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
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10,
          borderWidth: 1, borderColor: '#d8dee6' },
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
