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
import {
  View, Text, Pressable, SectionList, StyleSheet, LayoutAnimation,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { ItemControl, ANSWER_LABEL } from '@/ui/ItemControl';
import { useReducedMotion } from '@/ui/motion';
import { FlowProgress } from '@/ui/FlowProgress';
import { evaluateOne, evaluateSession } from '@/core/evaluation';
import type { ChecklistItem, RawResponse } from '@/core/evaluation';
import { leftToAsk } from '@/core/stepping';
import { useT } from '@/i18n';

export default function Checklist() {
  const router = useRouter();
  const { t, tn } = useT();
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
  // Answered-OK checks the operator has opened again to change.
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const reduce = useReducedMotion();
  /** Cards folding and unfolding ease rather than jump. */
  const animate = () => {
    if (!reduce) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const sections = useMemo(
    () => (template?.sections ?? []).map((s) => ({ title: s.name, data: s.items })),
    [template],
  );

  if (!asset || !template) {
    return (
      <View style={styles.screen}>
        <Text style={styles.empty}>
          {t('No walk-round is in progress. Go back and start one.')}
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
      <FlowProgress at="checks" />
      <View style={styles.bar}>
        <Text style={styles.barCode}>{asset.fleet_code}</Text>
        <Text style={styles.barCount}>
          {t('{n} of {total} answered', { n: done, total })}
          {findings > 0 ? ` · ${tn(findings, '{n} finding', '{n} findings')}` : ''}
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
            {done === 0 ? tn(total, 'Start the checks — {n} check', 'Start the checks — {n} checks')
                        : t('Go on with the checks — {n} left', { n: left })}
          </Text>
          <Text style={styles.bulkNote}>
            {t('One at a time. A clean answer moves straight to the next.')}
          </Text>
        </Pressable>
        </View>
      )}

      {/* Records filled in one tap before this changed say so. */}
      {bulkAnswered && (
        <Text style={styles.bulkFlag}>
          {t('The routine checks on this handover were marked OK together. The office sees this on the record.')}
        </Text>
      )}

      {/* What every check demands, said once rather than on every card. */}
      <Text style={styles.legend}>
        {t('Every check needs an answer. Any fault needs a note saying what is wrong; the tags on a check say when it also needs a photo.')}
      </Text>

      {verdict?.isBlocked && (
        <View style={styles.blocked} testID="blocked-banner">
          <Text style={styles.blockedTitle}>{t('This machine does not change hands')}</Text>
          <Text style={styles.blockedWhy}>{verdict.blockedReason}</Text>
          <Text style={styles.blockedNote}>
            {t('Finish the walk-round and confirm anyway — the record of what was found is what gets it repaired. Tell your supervisor now.')}
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
        // ── HIERARCHY (E7) ───────────────────────────────────────────────
        // A pass and a fault were the same size card. Now a check answered
        // cleanly folds to one line with its answer, and what is left -- the
        // faults and the unanswered -- keeps the room. Each section says how
        // far it has got, so the operator knows where the work is without
        // reading every card.
        renderSectionHeader={({ section }) => {
          const n = section.data.length;
          const got = section.data.filter((i) => answered(answers.get(i.itemId))).length;
          const bad = section.data.filter((i) => isFault(i, answers.get(i.itemId))).length;
          return (
            <View style={styles.sectionHead}>
              <Text style={styles.section}>{section.title}</Text>
              <Text style={[styles.sectionCount, got === n && styles.sectionDone,
                            bad > 0 && styles.sectionBad]}>
                {got === n ? '✓ ' : ''}{t('{n} of {total}', { n: got, total: n })}
                {bad > 0 ? ` · ${tn(bad, '{n} fault', '{n} faults')}` : ''}
              </Text>
            </View>
          );
        }}
        renderItem={({ item }) => {
          const raw = answers.get(item.itemId);
          if (foldable(item, raw) && !opened.has(item.itemId)) {
            return (
              <Pressable testID={`passed-${item.itemId}`}
                         style={({ pressed }) => [styles.passed, pressed && styles.passedPressed]}
                         onPress={() => {
                           animate();
                           setOpened(new Set(opened).add(item.itemId));
                         }}>
                <Text style={styles.passedTick}>✓</Text>
                <Text style={styles.passedLabel} numberOfLines={2}>{item.label}</Text>
                <Text style={styles.passedAnswer}>{t(answerText(item, raw))}</Text>
              </Pressable>
            );
          }
          return (
            <ItemControl
              markUnanswered
              item={item}
              value={raw}
              photoCount={raw?.photoCount ?? 0}
              onChange={(next) => {
                // A clean answer folds the card away; one reopened to change
                // folds again once it has its new answer.
                if (foldable(item, next)) {
                  animate();
                  if (opened.has(item.itemId)) {
                    const o = new Set(opened); o.delete(item.itemId); setOpened(o);
                  }
                }
                void setAnswer(item, next);
              }}
              onAddPhoto={() => router.push({ pathname: '/capture/photo',
                                              params: { itemId: String(item.itemId) } })}
            />
          );
        }}
      />

      <View style={styles.footer}
            onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>
        <Pressable testID="to-readings" style={styles.primary}
                   onPress={() => router.push('/capture/readings')}>
          <Text style={styles.primaryText}>
            {done < total ? t('Readings ({n} unanswered)', { n: total - done }) : t('Readings')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const answered = (r: RawResponse | undefined): boolean =>
  r != null && (r.answer != null || r.numericValue != null);

/** Answered, not a fault, and owing nothing: the kind of check that can fold away. */
function isClean(item: ChecklistItem, r: RawResponse | undefined): boolean {
  if (!answered(r)) return false;
  const ev = evaluateOne(item, { ...r!, photoCount: r!.photoCount ?? 0 });
  return !ev.isAdverse && ev.problems.length === 0;
}

/**
 * Whether a check folds to one line once answered. Never a reading: it is
 * typed digit by digit, and "10" out of range then "100" in range would fold
 * the card away under the operator's finger before they typed "100.5".
 */
function foldable(item: ChecklistItem, r: RawResponse | undefined): boolean {
  return item.responseType !== 'NUMERIC' && isClean(item, r);
}

function isFault(item: ChecklistItem, r: RawResponse | undefined): boolean {
  return answered(r) && evaluateOne(item, { ...r!, photoCount: r!.photoCount ?? 0 }).isAdverse;
}

function answerText(item: ChecklistItem, r: RawResponse | undefined): string {
  if (r?.numericValue != null) return `${r.numericValue}${item.unit ? ` ${item.unit}` : ''}`;
  return r?.answer ? ANSWER_LABEL[r.answer] : '';
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
                 marginTop: 14, marginBottom: 8, gap: 8 },
  sectionCount: { fontSize: 13, fontWeight: '700', color: '#5b6a7a',
                  fontVariant: ['tabular-nums'] },
  sectionDone: { color: '#1e8449' },
  sectionBad: { color: '#c0392b' },
  passed: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52,
            paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8,
            backgroundColor: '#f6fbf8', borderRadius: 10, borderWidth: 1, borderColor: '#cfe8d8' },
  passedPressed: { backgroundColor: '#e8f5ed' },
  passedTick: { fontSize: 16, fontWeight: '800', color: '#1e8449' },
  passedLabel: { flex: 1, fontSize: 15, color: '#3c4a58' },
  passedAnswer: { fontSize: 15, fontWeight: '800', color: '#1e8449' },
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

  section: { flex: 1, fontSize: 13, fontWeight: '800', color: '#3c4a58', letterSpacing: 0.6,
             textTransform: 'uppercase' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16,
            alignItems: 'center',
            backgroundColor: '#f3f6f9', borderTopWidth: 1, borderTopColor: '#d8dee6' },
  primary: { minHeight: 64, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center',
             width: '100%', maxWidth: 788 },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 40, padding: 20 },
});
