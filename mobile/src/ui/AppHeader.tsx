/**
 * The bar at the top of every screen, drawn by the app itself.
 *
 * ── WHY NOT ANDROID'S OWN TITLE BAR ──────────────────────────────────────────
 * The language and guide buttons used to sit in the native header. On the
 * tablet they answered a perfectly still tap and nothing else: a real finger
 * moves a pixel or two while it is down, the native bar took that as the start
 * of a drag and cancelled the press. So for anybody actually using the tablet,
 * EN and ? did nothing (16 Nov; reproduced with a press that slides 3 px).
 * Buttons in a bar the app draws are ordinary buttons, and press like every
 * other button on the screen.
 *
 * Left: back, or the app's mark on the home screen. Then the screen's name.
 * Right: language, the guide, and the menu -- each a 48 dp target, for gloves.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGS, useT } from '@/i18n';
import { usePanel } from './panels';

export function AppHeader({ navigation, options, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        {back ? (
          <HeaderButton testID="header-back" label={t('Back')} onPress={() => navigation.goBack()}>
            <MaterialCommunityIcons name="arrow-left" size={28} color="#fff" />
          </HeaderButton>
        ) : (
          <View style={styles.mark} accessibilityLabel="Kaliapani HOTO">
            <MaterialCommunityIcons name="hard-hat" size={24} color="#16202b" />
          </View>
        )}
        <Text style={styles.title} numberOfLines={1}>{options.title}</Text>
        <HeaderActions />
      </View>
    </View>
  );
}

/** Language, guide, menu. */
export function HeaderActions() {
  const { t, lang } = useT();
  const open = usePanel((s) => s.open);
  const short = LANGS.find((l) => l.code === lang)?.short ?? 'EN';
  return (
    <View style={styles.actions}>
      <HeaderButton testID="lang-open" label={t('Language')} onPress={() => open('lang')}>
        <View style={styles.chip}><Text style={styles.chipText}>{short}</Text></View>
      </HeaderButton>
      <HeaderButton testID="guide-open" label={t('Guide')} onPress={() => open('guide')}>
        <View style={styles.help}>
          <MaterialCommunityIcons name="help" size={22} color="#fff" />
        </View>
      </HeaderButton>
      <HeaderButton testID="menu-open" label={t('Menu')} onPress={() => open('menu')}>
        <MaterialCommunityIcons name="menu" size={32} color="#fff" />
      </HeaderButton>
    </View>
  );
}

function HeaderButton({ testID, label, onPress, children }: {
  testID: string; label: string; onPress: () => void; children: ReactNode;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
               hitSlop={6} onPress={onPress}
               style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#16202b' },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6 },
  title: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '700', marginLeft: 4 },
  mark: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#f2b632', marginLeft: 8,
          marginRight: 4, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  button: { minWidth: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 4 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
  chip: { minWidth: 44, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#5d7186',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  chipText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  help: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e5f8a',
          alignItems: 'center', justifyContent: 'center' },
});
