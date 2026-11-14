/**
 * The walk-round.
 *
 * ── THE PROGRESS COUNTER IS HONEST ABOUT WHAT IS LEFT ────────────────────────
 * It counts answered against total, and says how many findings so far. Not a
 * percentage bar: an operator who has answered 23 of 24 wants to know which one
 * is missing, and a bar at 96% does not tell him.
 *
 * ── A BLOCKED MACHINE IS ANNOUNCED AS SOON AS IT IS BLOCKED ──────────────────
 * Not at the end. The moment a critical item is answered adversely, the banner
 * says the machine does not change hands — while the operator is still next to
 * it and can tell the supervisor before anybody has moved it. Telling him on
 * the confirm screen is telling him after the decision he needed it for.
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, SectionList, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { ItemControl } from '@/ui/ItemControl';
import { evaluateSession } from '@/core/evaluation';
import type { ChecklistItem } from '@/core/evaluation';
import { leftToAsk } from '@/core/stepping';
import { plural } from '@/core/words';

export default function Checklist() {
  const router = useRouter();
  const asset = useCapture((s) => s.asset);
  const template = useCapture((s) => s.template);
  const answers = useCapture((s) => s.answers);
  const setAnswer = useCapture((s) => s.setAnswer);
  const bulkAnswered = useCapture((s) => s.bulkAnswered);

  const verdict = useMemo(() => {
    if (!template) return null;
    return evaluateSession({
      items: template.items, answers, sessionType: 'START_HANDOVER',
    });
  }, [template, answers]);

  const [footerHeight, setFooterHeight] = useState(110);

  const sections = useMemo(
    () => (template?.sections ?? []).map((s) => ({ title: s.name, data: s.items })),
    [template],
  );

  if (!asset || !template) {
    return (
      <View style={styles.screen}>
        <Text style={styles.empty}>
          No walk-round is in progress. Go back and start one.
        </Text>
      </View>
    );
  }

  const left = leftToAsk(template.items, answers);

  const total = template.items.length;
  const done = verdict ? total - verdict.unanswered.length : 0;
  const findings = verdict?.adverseCount ?? 0;

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Text style={styles.barCode}>{asset.fleet_code}</Text>
        <Text style={styles.barCount}>
          {done} of {total} answered
          {findings > 0 ? ` · ${findings} finding${findings === 1 ? '' : 's'}` : ''}
        </Text>
      </View>

      {/* ── ONE CHECK AT A TIME ───────────────────────────────────────────
          This was "Mark the routine checks OK": one tap that filled twenty
          answers nobody gave. Now it walks through what is left, each check
          on its own screen -- a clean answer moves on by itself, so it costs
          a tap per check, and every answer on the record is one somebody
          gave to a question they were shown (issue B3). */}
      {left > 0 && (
        <View style={styles.bulkWrap}>
        <Pressable
          testID="one-by-one"
          style={({ pressed }) => [styles.bulk, pressed && styles.pressed]}
          onPress={() => router.push('/capture/step')}
        >
          <Text style={styles.bulkText}>
            {done === 0 ? `Start the checks — ${plural(total, 'check')}`
                        : `Go on with the checks — ${left} left`}
          </Text>
          <Text style={styles.bulkNote}>
            One at a time. A clean answer moves straight to the next.
          </Text>
        </Pressable>
        </View>
      )}

      {/* Records filled in one tap before this changed say so. */}
      {bulkAnswered && (
        <Text style={styles.bulkFlag}>
          The routine checks on this handover were marked OK together. The office sees this on the record.
        </Text>
      )}

      {/* What every check demands, said once rather than on every card. */}
      <Text style={styles.legend}>
        Every check needs an answer. Any fault needs a note saying what is wrong;
        the tags on a check say when it also needs a photo.
      </Text>

      {verdict?.isBlocked && (
        <View style={styles.blocked} testID="blocked-banner">
          <Text style={styles.blockedTitle}>This machine does not change hands</Text>
          <Text style={styles.blockedWhy}>{verdict.blockedReason}</Text>
          <Text style={styles.blockedNote}>
            Finish the walk-round and confirm anyway — the record of what was
            found is what gets it repaired. Tell your supervisor now.
          </Text>
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(i: ChecklistItem) => String(i.itemId)}
        // MEASURED, not guessed. The footer is absolutely positioned, so the
        // list has to leave room for it by hand -- and the fixed 110 it used
        // to leave was not enough on a tablet, where the gesture bar makes
        // the footer taller. The last check on the list sat UNDER the button,
        // so tapping it pressed Readings instead. Found on a Lenovo tablet,
        // 12 Nov 2026, by answering the last item and landing on the next
        // screen.
        contentContainerStyle={{ padding: 16, paddingBottom: footerHeight + 24,
                                 width: '100%', maxWidth: 820, alignSelf: 'center' }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.section}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <ItemControl
            markUnanswered
            item={item}
            value={answers.get(item.itemId)}
            photoCount={answers.get(item.itemId)?.photoCount ?? 0}
            onChange={(raw) => void setAnswer(item, raw)}
            onAddPhoto={() => router.push({ pathname: '/capture/photo',
                                            params: { itemId: String(item.itemId) } })}
          />
        )}
      />

      <View style={styles.footer}
            onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>
        <Pressable testID="to-readings" style={styles.primary}
                   onPress={() => router.push('/capture/readings')}>
          <Text style={styles.primaryText}>
            {done < total ? `Readings (${total - done} unanswered)` : 'Readings'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Width from the wrapper, margins from its padding: a width of 100% plus a
  // margin is wider than a phone.
  bulkWrap: { width: '100%', maxWidth: 820, alignSelf: 'center',
              paddingHorizontal: 16, paddingTop: 12 },
  bulk: { backgroundColor: '#1e5f8a', borderRadius: 12, padding: 16, gap: 3 },
  bulkText: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  bulkNote: { color: '#cfe0ec', fontSize: 12, textAlign: 'center' },
  bulkDone: { backgroundColor: '#eaf6ee', borderColor: '#1e8a4f', borderWidth: 1,
              borderRadius: 8, padding: 10 },
  bulkDoneText: { fontSize: 14, color: '#16202b' },
  bulkFlag: { fontSize: 12, color: '#8a97a5', textAlign: 'center' },
  legend: { fontSize: 13, color: '#5b6a7a', paddingHorizontal: 16, paddingTop: 10,
            width: '100%', maxWidth: 820, alignSelf: 'center' },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  bar: { width: '100%', maxWidth: 820, alignSelf: 'center', backgroundColor: '#16202b', paddingHorizontal: 16, paddingVertical: 12 },
  barCode: { color: '#fff', fontSize: 18, fontWeight: '700' },
  barCount: { color: '#aeb8c4', fontSize: 13 },

  blocked: { backgroundColor: '#c0392b', padding: 14, gap: 3 },
  blockedTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  blockedWhy: { color: '#fff', fontSize: 15 },
  blockedNote: { color: '#ffd9d4', fontSize: 13, marginTop: 4 },

  section: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.6,
             marginTop: 10, marginBottom: 8 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16,
            alignItems: 'center',
            backgroundColor: '#f3f6f9', borderTopWidth: 1, borderTopColor: '#d8dee6' },
  primary: { minHeight: 64, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center',
             width: '100%', maxWidth: 788 },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 40, padding: 20 },
});
