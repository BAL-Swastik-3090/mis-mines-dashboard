/**
 * Help inside the app (gap G11), and the language switch (gap G12).
 *
 * A "?" on every screen's header opens a panel from the side: what this screen
 * is for and what to do on it, then the five steps of a handover, so somebody
 * holding the tablet for the first time is never more than one tap from being
 * told. The language chip beside it switches the whole app in one tap; the
 * panel lists the languages too, each written in itself. The buttons are in
 * AppHeader; the panels, with the menu, are drawn once by GuideHost.
 *
 * Written as plain sentences, translated like every other screen.
 */

import { useEffect, useRef } from 'react';
import {
  Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { usePathname } from 'expo-router';
import { LANGS, useLang, useT } from '@/i18n';
import { useReducedMotion } from './motion';
import { usePanel } from './panels';
import { AppMenu } from './AppMenu';

interface Page { title: string; points: string[] }

/** What each screen is for, keyed by its route. */
export const GUIDE: Record<string, Page> = {
  '/': { title: 'Home', points: [
    'The box at the top says whether everything on this tablet has reached the office.',
    'Unfinished handovers are listed with how far they got. Tap one to carry on, or Discard to throw it away.',
    'Start a handover begins a new one.',
    'Done on this tablet shows which machines were handed over, and who filled each one in.',
    'The menu at the top right opens every part of the app: home, the history, sending, the guide, language and settings.',
  ] },
  '/capture/machine': { title: 'Which machine', points: [
    'Choose the kind: taking over, handing over, or a mid-shift check.',
    'Scan the sticker on the cab. It is the surest way to pick the right machine.',
    'If the sticker cannot be read, search by number or registration, and check the registration on the machine.',
  ] },
  '/capture/operator': { title: 'Who is in this handover', points: [
    'Find the operator by employee number or name. When two people share a name, check the number.',
    'Take the operator\'s photo at the machine. If the camera is not working, say so.',
    'Say who handed the machine over, or that nobody did because it was parked.',
    'If someone else is holding the tablet, such as a supervisor, choose them under Filled in by. The tablet remembers them for the next handover in this shift.',
  ] },
  '/capture/checklist': { title: 'Walk-round', points: [
    'Every check needs an answer.',
    'Start the checks takes you through them one at a time. It is the quickest way.',
    'A check marked STOPS THE MACHINE holds the machine if it fails.',
    'A fault needs a note saying what is wrong. The tags on a check say when it also needs a photo.',
    'Checks answered OK fold away. Tap one to change it.',
  ] },
  '/capture/step': { title: 'One check at a time', points: [
    'Tap the answer. A clean answer moves to the next check by itself.',
    'A fault waits: write what is wrong, add a photo if asked, then press Next.',
    'For a reading, type the number and press Next.',
    'Skip for now leaves a check for later. It comes back round.',
  ] },
  '/capture/readings': { title: 'Readings', points: [
    'The hour meter is required. If it reads lower than last time, check it. If it is right, say why in the remarks.',
    'Fuel is optional, as a percentage from 0 to 100.',
    'Anything else is read by the supervisor. Faults belong in the checks, not here.',
  ] },
  '/capture/confirm': { title: 'Confirm', points: [
    'Check the machine and the three people.',
    'Anything still missing is listed. Tap a line to go straight to it.',
    'When nothing is left, confirm. It is saved on this tablet and sent to the office by itself.',
    'To throw this handover away instead, use Discard at the bottom.',
  ] },
  '/history': { title: 'Done on this tablet', points: [
    'Every handover confirmed on this tablet: today, yesterday or the last 7 days.',
    'Tap a name under Filled in by to see only that person\'s handovers.',
    'Each one says whether it has reached the office.',
  ] },
  '/settings': { title: 'Settings', points: [
    'Choose the language for this tablet.',
    'See who is chosen by itself under Filled in by, and forget them when the tablet changes hands.',
    "This tablet's name, the office server and the app version, for IT.",
  ] },
  '/sync': { title: 'Still on this tablet', points: [
    'What is still on this tablet, and what the office said about it.',
    'Sync now sends straight away. Otherwise it sends by itself.',
  ] },
};

const STEPS = [
  'Machine: scan the sticker on the cab, or find it by number.',
  'People: who is taking or handing over, the other side, and who is filling it in.',
  'Checks: answer every check. A fault needs a note, and sometimes a photo.',
  'Readings: the hour meter, and fuel if you know it.',
  'Confirm: read it through and confirm. It is saved on the tablet and sent by itself.',
];

/** The menu, the guide and the language list, drawn once beside the stack. */
export function GuideHost() {
  const panel = usePanel((s) => s.panel);
  const setPanel = usePanel((s) => s.open);
  return (
    <>
      <AppMenu visible={panel === 'menu'} onClose={() => setPanel(null)} />
      <GuidePanel visible={panel === 'guide'} onClose={() => setPanel(null)} />
      <LanguageMenu visible={panel === 'lang'} onClose={() => setPanel(null)} />
    </>
  );
}

export function LanguageList({ onPicked }: { onPicked?: () => void }) {
  const { lang } = useT();
  const setLang = useLang((s) => s.setLang);
  return (
    <View style={styles.langs}>
      {LANGS.map((l) => (
        <Pressable key={l.code} testID={`lang-${l.code}`}
                   style={[styles.lang, lang === l.code && styles.langOn]}
                   onPress={() => { void setLang(l.code); onPicked?.(); }}>
          <Text style={[styles.langText, lang === l.code && styles.langTextOn]}>{l.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function LanguageMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.menu} onPress={() => { /* keep taps inside */ }}>
          <Text style={styles.menuTitle}>{t('Language')}</Text>
          <LanguageList onPicked={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The side panel. Slides in from the right; still under reduced motion. */
export function GuidePanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const path = usePathname();
  const page: Page = GUIDE[path] ?? GUIDE['/']!;
  const reduce = useReducedMotion();
  const x = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!visible) return;
    if (reduce) { x.setValue(0); return; }
    x.setValue(1);
    Animated.timing(x, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic),
                         useNativeDriver: true }).start();
  }, [visible, reduce, x]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.drawerWrap}>
        <Pressable style={styles.drawerShade} onPress={onClose} />
        <Animated.View style={[styles.drawer, {
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 480] }) }],
        }]}>
          <View style={styles.drawerHead}>
            <Text style={styles.drawerTitle}>{t('Guide')}</Text>
            <Pressable testID="guide-close" hitSlop={10} onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.drawerBody}>
            <Text style={styles.section}>{t('Language')}</Text>
            <LanguageList />

            <Text style={styles.section}>{t('This screen')}</Text>
            <Text style={styles.pageTitle}>{t(page.title)}</Text>
            {page.points.map((p) => (
              <View key={p} style={styles.point}>
                <Text style={styles.dot}>•</Text>
                <Text style={styles.pointText}>{t(p)}</Text>
              </View>
            ))}

            <Text style={styles.section}>{t('A handover in five steps')}</Text>
            {STEPS.map((s, i) => (
              <View key={s} style={styles.point}>
                <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
                <Text style={styles.pointText}>{t(s)}</Text>
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 4 },
  chip: { minWidth: 44, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#5d7186',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  chipText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  help: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e5f8a',
          alignItems: 'center', justifyContent: 'center' },
  helpText: { color: '#fff', fontSize: 20, fontWeight: '900' },

  backdrop: { flex: 1, backgroundColor: 'rgba(10,20,30,0.4)', justifyContent: 'flex-start',
              alignItems: 'flex-end', paddingTop: 70, paddingRight: 12 },
  menu: { width: 280, backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 10 },
  menuTitle: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.6 },

  langs: { gap: 8 },
  lang: { minHeight: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#c4d3e0',
          paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#fff' },
  langOn: { backgroundColor: '#16202b', borderColor: '#16202b' },
  langText: { fontSize: 18, fontWeight: '700', color: '#16202b' },
  langTextOn: { color: '#fff' },

  drawerWrap: { flex: 1, flexDirection: 'row' },
  drawerShade: { flex: 1, backgroundColor: 'rgba(10,20,30,0.4)' },
  drawer: { width: '86%', maxWidth: 480, backgroundColor: '#f7f9fb',
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, elevation: 12 },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: '#16202b', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 16 },
  drawerTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
           backgroundColor: '#2c3a48' },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  drawerBody: { padding: 18, gap: 10, paddingBottom: 40 },
  section: { fontSize: 12, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.8, marginTop: 10,
             textTransform: 'uppercase' },
  pageTitle: { fontSize: 19, fontWeight: '800', color: '#16202b' },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { fontSize: 18, color: '#1e5f8a', lineHeight: 24 },
  pointText: { flex: 1, fontSize: 16, lineHeight: 23, color: '#16202b' },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#1e5f8a', alignItems: 'center',
         justifyContent: 'center', marginTop: 1 },
  numText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
