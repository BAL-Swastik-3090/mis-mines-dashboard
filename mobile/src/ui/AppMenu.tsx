/**
 * The menu: every part of the app from one place, on every screen.
 *
 * Asked for on 16 Nov: a three-bar menu beside the language and the guide,
 * with home, starting a handover, the history, sending, language and settings.
 * The top of it says which tablet this is and whether everything has reached
 * the office -- the two things somebody picking up a strange tablet wants to
 * know first. Counts beside an entry are read when the menu opens, from the
 * tablet's own records, so they are right with no signal.
 *
 * Leaving a handover half done from here loses nothing: it stays under
 * Unfinished on the home screen, and the menu says so while one is open.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router, usePathname } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGS, useT } from '@/i18n';
import { useCapture } from './useCapture';
import { useReducedMotion } from './motion';
import { usePanel } from './panels';
import { useNotices } from './useNotices';
import { LOGO, LOGO_RATIO } from './brand';
import * as session from '@/core/capture/session';
import { draftSummaries } from '@/core/capture/drafts';
import { doneOnTablet } from '@/core/capture/history';
import { storedCode, storedLabel } from '@/core/sync/enrolment';

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

interface Counts { unfinished: number; today: number; waiting: number; refused: number }

export function AppMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, tn, lang } = useT();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const store = useCapture((s) => s.store);
  const resetCapture = useCapture((s) => s.discard);
  const openPanel = usePanel((s) => s.open);
  const unread = useNotices((s) => s.unread);
  const reduce = useReducedMotion();
  const x = useRef(new Animated.Value(1)).current;

  const [counts, setCounts] = useState<Counts | null>(null);
  const [tablet, setTablet] = useState<{ label: string | null; code: string | null }>(
    { label: null, code: null });

  useEffect(() => {
    if (!visible) return;
    if (reduce) x.setValue(0);
    else {
      x.setValue(1);
      Animated.timing(x, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic),
                           useNativeDriver: true }).start();
    }
    void (async () => {
      setTablet({ label: await storedLabel(), code: await storedCode() });
      if (!store) return;
      const [drafts, today, out] = await Promise.all([
        draftSummaries(store), doneOnTablet(store, 'today'), session.outboxDepth(store)]);
      setCounts({ unfinished: drafts.length, today: today.length,
                  waiting: out.queued + out.sending, refused: out.rejected + out.conflict });
    })();
  }, [visible, reduce, x, store]);

  // A handover exists once a machine is picked; on the machine screen before
  // that there is nothing to keep, and saying there is would be untrue.
  const draft = useCapture((s) => s.uuid);
  const inHandover = path.startsWith('/capture') && draft != null;
  const home = () => { if (router.canDismiss()) router.dismissAll(); };
  const go = (to: () => void) => { onClose(); setTimeout(to, 60); };

  const state = !counts ? null
    : counts.refused > 0
      ? { tone: 'bad' as const, text: tn(counts.refused, '{n} handover refused by the office',
                                          '{n} handovers refused by the office') }
      : counts.waiting > 0
        ? { tone: 'wait' as const, text: t('{n} waiting to send', { n: counts.waiting }) }
        : { tone: 'ok' as const, text: t('Everything on this tablet has reached the office') };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.shade} onPress={onClose} accessibilityLabel={t('Close')} />
        <Animated.View style={[styles.drawer, {
          paddingBottom: insets.bottom,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 460] }) }],
        }]}>
          {/* ── which tablet, and is everything sent ─────────────────────── */}
          <View style={[styles.top, { paddingTop: insets.top + 18 }]}>
            <View style={styles.topRow}>
              <View style={styles.mark}>
                <Image source={LOGO} style={styles.logo} resizeMode="contain"
                       accessibilityLabel="Balasore Alloys Limited" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.app}>Kaliapani HOTO</Text>
                <Text style={styles.device} numberOfLines={1}>
                  {tablet.label ?? t('This tablet')}{tablet.code ? ` · ${tablet.code}` : ''}
                </Text>
              </View>
              <Pressable testID="menu-close" hitSlop={10} onPress={onClose} style={styles.close}
                         accessibilityLabel={t('Close')}>
                <MaterialCommunityIcons name="close" size={22} color="#fff" />
              </Pressable>
            </View>
            {state && (
              <View style={[styles.state, styles[state.tone]]}>
                <View style={[styles.dot, styles[`${state.tone}Dot`]]} />
                <Text style={styles.stateText}>{state.text}</Text>
              </View>
            )}
          </View>

          <ScrollView contentContainerStyle={styles.list}>
            {inHandover && (
              <Text style={styles.note}>
                {t('The handover you are on stays under Unfinished on the home screen.')}
              </Text>
            )}
            <Item testID="menu-home" icon="home-outline" label={t('Home')} current={path === '/'}
                  sub={counts?.unfinished ? t('{n} unfinished', { n: counts.unfinished }) : undefined}
                  onPress={() => go(home)} />
            <Item testID="menu-start" icon="plus-circle-outline" label={t('Start a handover')} strong
                  sub={t('Taking over, handing over or a mid-shift check')}
                  onPress={() => go(() => { resetCapture(); home(); router.push('/capture/machine'); })} />
            <Item testID="menu-history" icon="history" label={t('Done on this tablet')}
                  current={path === '/history'}
                  sub={counts ? t('{n} today', { n: counts.today }) : undefined}
                  onPress={() => go(() => router.push('/history'))} />
            <Item testID="menu-sync" icon="cloud-upload-outline" label={t('Sending to the office')}
                  current={path === '/sync'}
                  badge={counts && counts.waiting + counts.refused > 0
                    ? counts.waiting + counts.refused : undefined}
                  sub={counts && counts.waiting + counts.refused === 0 ? t('All sent') : undefined}
                  onPress={() => go(() => router.push('/sync'))} />
            <Item testID="menu-notices" icon="bell-outline" label={t('Updates from the office')}
                  current={path === '/notices'}
                  badge={unread > 0 ? unread : undefined}
                  sub={unread === 0 ? t('New operators, machines and checklists') : undefined}
                  onPress={() => go(() => router.push('/notices'))} />

            <View style={styles.rule} />

            <Item testID="menu-guide" icon="help-circle-outline" label={t('Guide')}
                  onPress={() => openPanel('guide')} />
            <Item testID="menu-lang" icon="translate" label={t('Language')}
                  sub={LANGS.find((l) => l.code === lang)?.name}
                  onPress={() => openPanel('lang')} />
            <Item testID="menu-settings" icon="cog-outline" label={t('Settings')}
                  current={path === '/settings'}
                  onPress={() => go(() => router.push('/settings'))} />
          </ScrollView>

          <Text style={styles.version}>
            {t('Version {v}', { v: Constants.expoConfig?.version ?? '—' })}
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Item({ testID, icon, label, sub, badge, current, strong, onPress }: {
  testID: string; icon: Icon; label: string; sub?: string | undefined;
  badge?: number | undefined; current?: boolean; strong?: boolean; onPress: () => void;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress}
               style={({ pressed }) => [styles.item, current && styles.itemOn,
                                        strong && styles.itemStrong, pressed && styles.itemPressed]}>
      <MaterialCommunityIcons name={icon} size={26}
                              color={strong ? '#fff' : current ? '#1e5f8a' : '#3c4a58'} />
      <View style={styles.itemText}>
        <Text style={[styles.label, strong && styles.labelStrong]}>{label}</Text>
        {sub ? <Text style={[styles.sub, strong && styles.subStrong]}>{sub}</Text> : null}
      </View>
      {badge != null ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={24} color={strong ? '#cfe0ec' : '#9aa7b5'} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row' },
  shade: { flex: 1, backgroundColor: 'rgba(10,20,30,0.45)' },
  drawer: { width: '86%', maxWidth: 440, backgroundColor: '#f7f9fb',
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, elevation: 14 },

  top: { backgroundColor: '#16202b', paddingHorizontal: 18, paddingBottom: 16, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { height: 52, borderRadius: 11, backgroundColor: '#fff', paddingHorizontal: 10,
          alignItems: 'center', justifyContent: 'center' },
  logo: { height: 32, width: 32 * LOGO_RATIO },
  app: { color: '#fff', fontSize: 20, fontWeight: '800' },
  device: { color: '#aeb8c4', fontSize: 14, marginTop: 1 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2c3a48',
           alignItems: 'center', justifyContent: 'center' },
  state: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10,
           paddingHorizontal: 12, paddingVertical: 10 },
  ok: { backgroundColor: '#1d3b2c' }, wait: { backgroundColor: '#3d3320' }, bad: { backgroundColor: '#45231f' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  okDot: { backgroundColor: '#3fb67a' }, waitDot: { backgroundColor: '#f2b632' }, badDot: { backgroundColor: '#e8604f' },
  stateText: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },

  list: { padding: 12, gap: 6 },
  note: { fontSize: 13, color: '#8a5a00', backgroundColor: '#fff8e6', borderRadius: 8, padding: 10,
          borderWidth: 1, borderColor: '#e0bf6a', marginBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, borderRadius: 12,
          paddingHorizontal: 14, paddingVertical: 8 },
  itemOn: { backgroundColor: '#e6eef5' },
  itemStrong: { backgroundColor: '#16202b', marginVertical: 4 },
  itemPressed: { opacity: 0.8 },
  itemText: { flex: 1, gap: 1 },
  label: { fontSize: 17, fontWeight: '700', color: '#16202b' },
  labelStrong: { color: '#fff' },
  sub: { fontSize: 13, color: '#5b6a7a' },
  subStrong: { color: '#cfe0ec' },
  badge: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: '#f2b632',
           alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  badgeText: { fontSize: 14, fontWeight: '800', color: '#16202b' },
  rule: { height: 1, backgroundColor: '#dde4eb', marginVertical: 8, marginHorizontal: 8 },
  version: { fontSize: 12, color: '#8a97a5', textAlign: 'center', paddingVertical: 12 },
});
