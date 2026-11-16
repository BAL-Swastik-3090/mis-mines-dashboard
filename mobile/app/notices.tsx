/**
 * Updates from the office: the operators, machines and checklists it has
 * added, changed or taken away since this tablet last looked.
 *
 * Opened from the bell in the header, the menu, the home screen's banner, or
 * the Android notification. Opening it marks everything read and clears the
 * notifications; what was new keeps its highlight until the screen is left,
 * so somebody can still see which lines were the new ones.
 *
 * "Check now" asks the office straight away rather than waiting for the next
 * refresh -- for the supervisor standing there after a phone call saying "I've
 * just added him".
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { useCapture } from '@/ui/useCapture';
import { useSync } from '@/ui/useSync';
import { useNotices } from '@/ui/useNotices';
import { clearPosted } from '@/ui/announce';
import { headline, icon, meaning } from '@/ui/noticeText';
import { clearAll, list, markAllRead, type Notice } from '@/core/notices';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN',
  { hour: '2-digit', minute: '2-digit', hour12: false });
const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN',
  { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function Notices() {
  const { t } = useT();
  const store = useCapture((s) => s.store);
  const run = useSync((s) => s.run);
  const running = useSync((s) => s.running);
  const lastSyncAt = useSync((s) => s.status?.lastSyncAt ?? null);
  const refreshSync = useSync((s) => s.refresh);
  const refreshCount = useNotices((s) => s.refresh);

  const [items, setItems] = useState<Notice[] | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (keepFresh: boolean) => {
    if (!store) return;
    const rows = await list(store);
    if (!keepFresh) setFresh(new Set(rows.filter((r) => !r.read_at).map((r) => r.notice_id)));
    else setFresh((f) => new Set([...f, ...rows.filter((r) => !r.read_at).map((r) => r.notice_id)]));
    setItems(rows);
    await markAllRead(store);
    await refreshCount();
    await clearPosted();
  }, [store, refreshCount]);

  useFocusEffect(useCallback(() => {
    setNote(null);
    void refreshSync();
    void load(false);
  }, [load, refreshSync]));

  const checkNow = async () => {
    setNote(null);
    const r = await run({ force: true, refreshMasters: true });
    await load(true);
    if (!r || !r.mastersRefreshed) setNote(t('Could not reach the office. It keeps trying by itself.'));
    else if (r.changes.length === 0) setNote(t('Nothing new from the office.'));
    else setNote(null);
  };

  const clear = () => {
    Alert.alert(t('Clear this list?'),
      t("Only this tablet's list is cleared. Nothing changes at the office."), [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Clear'), style: 'destructive', onPress: async () => {
          if (!store) return;
          await clearAll(store);
          await load(false);
        } },
      ]);
  };

  // Grouped by day, newest first.
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const groups: { label: string; rows: Notice[] }[] = [];
  for (const n of items ?? []) {
    const d = new Date(n.created_at);
    const label = dayKey(d) === dayKey(today) ? t('Today')
      : dayKey(d) === dayKey(yesterday) ? t('Yesterday')
      : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push(n);
    else groups.push({ label, rows: [n] });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.check}>
        <MaterialCommunityIcons name="cloud-sync-outline" size={26} color="#1e5f8a" />
        <View style={{ flex: 1 }}>
          <Text style={styles.checkTitle}>
            {lastSyncAt ? t('Last checked with the office {when}', { when: stamp(lastSyncAt) })
                        : t('Not checked with the office yet')}
          </Text>
          <Text style={styles.hint}>
            {t('The tablet checks by itself every few minutes while it has signal.')}
          </Text>
        </View>
        <Pressable testID="notices-check" disabled={running} onPress={() => { void checkNow(); }}
                   style={({ pressed }) => [styles.checkButton, (pressed || running) && styles.pressed]}>
          {running ? <ActivityIndicator color="#fff" />
                   : <Text style={styles.checkButtonText}>{t('Check now')}</Text>}
        </Pressable>
      </View>
      {note ? <Text style={styles.note} testID="notices-note">{note}</Text> : null}

      {items && items.length === 0 && (
        <View style={styles.empty} testID="notices-empty">
          <MaterialCommunityIcons name="bell-check-outline" size={48} color="#9aa7b5" />
          <Text style={styles.emptyTitle}>{t('Nothing new from the office')}</Text>
          <Text style={styles.emptyText}>
            {t('When the office adds or removes an operator or a machine, or changes a checklist, it is listed here and the tablet shows a notification.')}
          </Text>
        </View>
      )}

      {groups.map((g) => (
        <View key={g.label} style={styles.group}>
          <Text style={styles.day}>{g.label}</Text>
          <View style={styles.card}>
            {g.rows.map((n, i) => {
              const ic = icon(n.kind);
              const isNew = fresh.has(n.notice_id);
              return (
                <View key={n.notice_id} testID={`notice-${n.notice_id}`}
                      style={[styles.row, i > 0 && styles.rowRule, isNew && styles.rowNew]}>
                  <View style={[styles.iconWrap, { backgroundColor: `${ic.colour}18` }]}>
                    <MaterialCommunityIcons name={ic.name} size={24} color={ic.colour} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.headline}>{headline(n, t)}</Text>
                    <Text style={styles.hint}>{meaning(n.kind, t)}</Text>
                  </View>
                  <View style={styles.when}>
                    {isNew && <Text style={styles.newTag}>{t('New')}</Text>}
                    <Text style={styles.time}>{time(n.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {items && items.length > 0 && (
        <Pressable testID="notices-clear" onPress={clear}
                   style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="delete-sweep-outline" size={22} color="#a33a2a" />
          <Text style={styles.clearText}>{t('Clear this list')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 14, paddingBottom: 40, width: '100%', maxWidth: 820, alignSelf: 'center' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
           borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#d8dee6' },
  checkTitle: { fontSize: 15, fontWeight: '700', color: '#16202b' },
  checkButton: { minHeight: 52, minWidth: 120, borderRadius: 12, backgroundColor: '#1e5f8a',
                 alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  checkButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  note: { fontSize: 14, color: '#16202b', backgroundColor: '#eaf2f8', borderRadius: 10, padding: 12 },
  pressed: { opacity: 0.75 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#3c4a58' },
  emptyText: { fontSize: 15, color: '#5b6a7a', textAlign: 'center', lineHeight: 21, maxWidth: 520 },
  group: { gap: 8 },
  day: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.6,
         textTransform: 'uppercase', marginLeft: 4 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#d8dee6',
          overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 72 },
  rowRule: { borderTopWidth: 1, borderTopColor: '#eef1f5' },
  rowNew: { backgroundColor: '#f0f6fb' },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headline: { fontSize: 16, fontWeight: '700', color: '#16202b' },
  hint: { fontSize: 13, color: '#5b6a7a', lineHeight: 18 },
  when: { alignItems: 'flex-end', gap: 4 },
  newTag: { fontSize: 11, fontWeight: '800', color: '#fff', backgroundColor: '#d8201a',
            borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  time: { fontSize: 13, color: '#5b6a7a', fontVariant: ['tabular-nums'] },
  clear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
           minHeight: 52, borderRadius: 12, borderWidth: 1.5, borderColor: '#e3b5ae', marginTop: 6 },
  clearText: { fontSize: 15, fontWeight: '700', color: '#a33a2a' },
});
