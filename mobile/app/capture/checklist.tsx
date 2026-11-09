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

import { useMemo } from 'react';
import { View, Text, Pressable, SectionList, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { ItemControl } from '@/ui/ItemControl';
import { evaluateSession } from '@/core/evaluation';
import type { ChecklistItem } from '@/core/evaluation';

export default function Checklist() {
  const router = useRouter();
  const asset = useCapture((s) => s.asset);
  const template = useCapture((s) => s.template);
  const answers = useCapture((s) => s.answers);
  const setAnswer = useCapture((s) => s.setAnswer);

  const verdict = useMemo(() => {
    if (!template) return null;
    return evaluateSession({
      items: template.items, answers, sessionType: 'START_HANDOVER',
    });
  }, [template, answers]);

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
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.section}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <ItemControl
            item={item}
            value={answers.get(item.itemId)}
            photoCount={answers.get(item.itemId)?.photoCount ?? 0}
            onChange={(raw) => void setAnswer(item, raw)}
            onAddPhoto={() => router.push({ pathname: '/capture/photo',
                                            params: { itemId: String(item.itemId) } })}
          />
        )}
      />

      <View style={styles.footer}>
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
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  bar: { backgroundColor: '#16202b', paddingHorizontal: 16, paddingVertical: 12 },
  barCode: { color: '#fff', fontSize: 18, fontWeight: '700' },
  barCount: { color: '#aeb8c4', fontSize: 13 },

  blocked: { backgroundColor: '#c0392b', padding: 14, gap: 3 },
  blockedTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  blockedWhy: { color: '#fff', fontSize: 15 },
  blockedNote: { color: '#ffd9d4', fontSize: 13, marginTop: 4 },

  section: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.6,
             marginTop: 10, marginBottom: 8 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16,
            backgroundColor: '#f3f6f9', borderTopWidth: 1, borderTopColor: '#d8dee6' },
  primary: { minHeight: 64, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 40, padding: 20 },
});
