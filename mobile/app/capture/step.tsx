/**
 * The walk-round, one check at a time.
 *
 * ── WHAT "ALL OK" BECAME ─────────────────────────────────────────────────────
 * It used to fill every routine check with one tap, which made a record saying
 * twenty things were looked at when one button was pressed. The mine asked for
 * the opposite (issue B3): press it and be asked each check in turn. So every
 * answer on the record is one somebody gave to a question they were shown.
 *
 * It is still quick. A clean answer moves on by itself -- one tap per check,
 * no scrolling, no hunting for what is left. A fault waits: what is wrong, and
 * a photo where the check asks for one, while the operator is still looking at
 * it. A reading waits for "Next", because jumping away after the first digit
 * typed would be a trap.
 *
 * The order and the rules are in core/stepping.ts, with tests.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Animated, AccessibilityInfo,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { ItemControl } from '@/ui/ItemControl';
import { evaluateSession, type RawResponse } from '@/core/evaluation';
import { isSettled, leftToAsk, movesOnByItself, nextToAsk, startAt } from '@/core/stepping';
import { useT } from '@/i18n';

/** Long enough to see the answer land, short enough not to wait for it. */
const MOVE_ON_MS = 320;

export default function Step() {
  const router = useRouter();
  const { t, tn } = useT();
  const params = useLocalSearchParams<{ item?: string; from?: string }>();
  const fromConfirm = params.from === 'confirm';

  const asset = useCapture((s) => s.asset);
  const template = useCapture((s) => s.template);
  const answers = useCapture((s) => s.answers);
  const setAnswer = useCapture((s) => s.setAnswer);

  const items = template?.items ?? [];
  const sectionOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const sec of template?.sections ?? []) for (const i of sec.items) m.set(i.itemId, sec.name);
    return m;
  }, [template]);

  const [index, setIndex] = useState(() =>
    startAt(items, answers, params.item ? Number(params.item) : null));
  const [finished, setFinished] = useState(false);

  // ── the move to the next check ──────────────────────────────────────────
  const slide = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);
  useEffect(() => {
    if (reduceMotion) { slide.setValue(1); return; }
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [index, finished, reduceMotion, slide]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelMove = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => cancelMove, []);

  const goOn = useCallback((from: number, now: Map<number, RawResponse>) => {
    const next = nextToAsk(items, now, from);
    if (next == null) setFinished(true);
    else setIndex(next);
  }, [items]);

  const verdict = useMemo(() => (template
    ? evaluateSession({ items: template.items, answers, sessionType: 'START_HANDOVER' })
    : null), [template, answers]);

  if (!asset || !template || items.length === 0) {
    return (
      <View style={styles.screen}>
        <Text style={styles.empty}>{t('No walk-round is in progress. Go back and start one.')}</Text>
      </View>
    );
  }

  const fade = {
    opacity: slide,
    transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }],
  };

  // ── every check has an answer ───────────────────────────────────────────
  if (finished) {
    const owed = verdict?.responses.filter((r) => r.problems.length > 0) ?? [];
    const findings = verdict?.adverseCount ?? 0;
    return (
      <View style={styles.screen}>
        <Animated.View style={[styles.doneWrap, fade]}>
          <View style={styles.doneCard}>
            <View style={[styles.doneMark, verdict?.isBlocked && styles.doneMarkHeld]}>
              <Text style={styles.doneMarkText}>{verdict?.isBlocked ? '!' : '✓'}</Text>
            </View>
            <Text style={styles.doneTitle}>
              {owed.length > 0 ? t('Every check is answered') : t('All {n} checks done', { n: items.length })}
            </Text>
            <Text style={styles.doneNote}>
              {findings === 0 ? t('Nothing found.')
                : tn(findings, '{n} finding recorded.', '{n} findings recorded.')}
            </Text>
            {verdict?.isBlocked && (
              <Text style={styles.doneHeld}>
                {t('This machine does not change hands')}: {verdict.blockedReason}
              </Text>
            )}
            {owed.length > 0 && (
              <Text style={styles.doneOwed}>
                {tn(owed.length, '{n} check still needs a note or a photo — go back to it.',
                    '{n} checks still need a note or a photo — go back to them.')}
              </Text>
            )}
          </View>

          <Pressable testID="step-continue"
                     style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                     onPress={() => {
                       if (fromConfirm) router.back();
                       else router.replace('/capture/readings');
                     }}>
            <Text style={styles.primaryText}>
              {fromConfirm ? t('Back to confirm') : t('Go to the readings')}
            </Text>
          </Pressable>
          {owed.length > 0 && (
            <Pressable testID="step-review" style={styles.secondary}
                       onPress={() => {
                         setFinished(false);
                         setIndex(items.findIndex((i) => i.itemId === owed[0]!.item.itemId));
                       }}>
              <Text style={styles.secondaryText}>{t('Go to {label}', { label: owed[0]!.item.label })}</Text>
            </Pressable>
          )}
        </Animated.View>
      </View>
    );
  }

  const item = items[Math.min(index, items.length - 1)]!;
  const raw = answers.get(item.itemId);
  const photos = raw?.photoCount ?? 0;
  const settled = isSettled(item, raw, photos);
  const left = leftToAsk(items, answers);
  const canSkip = nextToAsk(items, answers, index) != null;

  return (
    <View style={styles.screen}>
      {/* ── where you are ────────────────────────────────────────────────
          Which check of how many, and how many still have no answer, so the
          operator always knows how much of the walk-round is left (E4). */}
      <View style={styles.bar}>
        <View style={styles.barRow}>
          <Text style={styles.barCode}>{asset.fleet_code}</Text>
          <Text style={styles.barCount} testID="step-position">
            {t('Check {n} of {total}', { n: index + 1, total: items.length })}
          </Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${((items.length - left) / items.length) * 100}%` }]} />
        </View>
        <Text style={styles.barLeft}>
          {left === 0 ? t('Every check has an answer') : t('{n} still to answer', { n: left })}
          {sectionOf.get(item.itemId) ? ` · ${sectionOf.get(item.itemId)}` : ''}
        </Text>
      </View>

      {verdict?.isBlocked && (
        <View style={styles.blocked} testID="blocked-banner">
          <Text style={styles.blockedTitle}>{t('This machine does not change hands')}</Text>
          <Text style={styles.blockedWhy}>{verdict.blockedReason}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Animated.View style={fade}>
          <ItemControl
            key={item.itemId}
            large
            item={item}
            value={raw}
            photoCount={photos}
            onChange={(next) => {
              cancelMove();
              void setAnswer(item, next);
              if (movesOnByItself(item, next, photos)) {
                const now = new Map(answers).set(item.itemId, next);
                const at = index;
                timer.current = setTimeout(() => goOn(at, now), MOVE_ON_MS);
              }
            }}
            onAddPhoto={() => {
              cancelMove();
              router.push({ pathname: '/capture/photo', params: { itemId: String(item.itemId) } });
            }}
          />
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable testID="step-back" disabled={index === 0}
                   style={[styles.small, index === 0 && styles.smallOff]}
                   onPress={() => { cancelMove(); setIndex(index - 1); }}>
          <Text style={styles.smallText}>{t('Back')}</Text>
        </Pressable>
        <Pressable testID="step-skip" disabled={!canSkip || settled}
                   style={[styles.small, (!canSkip || settled) && styles.smallOff]}
                   onPress={() => { cancelMove(); goOn(index, answers); }}>
          <Text style={styles.smallText}>{t('Skip for now')}</Text>
        </Pressable>
        <Pressable testID="step-next" disabled={!settled}
                   style={({ pressed }) => [styles.next, !settled && styles.nextOff,
                                            pressed && settled && styles.pressed]}
                   onPress={() => { cancelMove(); goOn(index, answers); }}>
          <Text style={styles.nextText}>
            {t(!raw || (raw.answer == null && raw.numericValue == null) ? 'Answer to go on'
              : settled ? (left === 0 ? 'Finish' : 'Next')
              : 'Finish this check first')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 820, alignSelf: 'center' },

  bar: { backgroundColor: '#16202b', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
         gap: 8 },
  barRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
            width: '100%', maxWidth: 788, alignSelf: 'center' },
  barCode: { color: '#fff', fontSize: 18, fontWeight: '800' },
  barCount: { color: '#fff', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: '#2c3a48', overflow: 'hidden',
           width: '100%', maxWidth: 788, alignSelf: 'center' },
  fill: { height: 6, backgroundColor: '#3fb67a' },
  barLeft: { color: '#aeb8c4', fontSize: 13, width: '100%', maxWidth: 788, alignSelf: 'center' },

  blocked: { backgroundColor: '#c0392b', paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  blockedTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  blockedWhy: { color: '#fff', fontSize: 14 },

  footer: { flexDirection: 'row', gap: 10, padding: 16, backgroundColor: '#f3f6f9',
            borderTopWidth: 1, borderTopColor: '#d8dee6',
            width: '100%', maxWidth: 820, alignSelf: 'center' },
  small: { minHeight: 60, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5,
           borderColor: '#aeb8c4', alignItems: 'center', justifyContent: 'center',
           backgroundColor: '#fff' },
  smallOff: { opacity: 0.4 },
  smallText: { fontSize: 16, fontWeight: '700', color: '#3c4a58' },
  next: { flex: 1, minHeight: 60, borderRadius: 12, backgroundColor: '#16202b',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  nextOff: { backgroundColor: '#aeb8c4' },
  nextText: { color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },

  doneWrap: { flex: 1, padding: 16, gap: 14, justifyContent: 'center',
              width: '100%', maxWidth: 820, alignSelf: 'center' },
  doneCard: { backgroundColor: '#fff', borderRadius: 14, padding: 24, gap: 8,
              alignItems: 'center', borderWidth: 1, borderColor: '#d8dee6' },
  doneMark: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#1e8449',
              alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  doneMarkHeld: { backgroundColor: '#c0392b' },
  doneMarkText: { color: '#fff', fontSize: 28, fontWeight: '800', lineHeight: 34 },
  doneTitle: { fontSize: 24, fontWeight: '800', color: '#16202b', textAlign: 'center' },
  doneNote: { fontSize: 16, color: '#5b6a7a', textAlign: 'center' },
  doneHeld: { fontSize: 15, color: '#c0392b', fontWeight: '700', textAlign: 'center' },
  doneOwed: { fontSize: 15, color: '#8a5a00', fontWeight: '600', textAlign: 'center' },
  primary: { minHeight: 68, borderRadius: 12, backgroundColor: '#1e8449',
             alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  secondary: { minHeight: 56, borderRadius: 12, borderWidth: 1.5, borderColor: '#aeb8c4',
               alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  secondaryText: { fontSize: 16, fontWeight: '700', color: '#1e5f8a' },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 40, padding: 20 },
});
