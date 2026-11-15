/**
 * Settings: the few things about this tablet that somebody using it may want
 * to change or look up.
 *
 *   Language        -- the same choice as the chip in the header.
 *   Filled in by    -- who the tablet fills in by itself (gap G4), until when,
 *                      and a way to forget them when a supervisor hands the
 *                      tablet on before their 12 hours are up.
 *   This tablet     -- its name, the office server, the app version: what IT
 *                      asks for on the phone. Changing the server stays on the
 *                      sending screen, for IT, in English.
 */

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { useCapture } from '@/ui/useCapture';
import { LanguageList } from '@/ui/Guide';
import { forgetRecorder, rememberedUntil } from '@/core/capture/drafting';
import type { CachedOperator } from '@/core/capture/masters';
import { storedBaseUrl, storedCode, storedLabel } from '@/core/sync/enrolment';

export default function Settings() {
  const { t } = useT();
  const store = useCapture((s) => s.store);
  const [remembered, setRemembered] = useState<{ who: CachedOperator; until: Date } | null>(null);
  const [device, setDevice] = useState<{ label: string | null; code: string | null; server: string | null }>(
    { label: null, code: null, server: null });

  const load = useCallback(async () => {
    setDevice({ label: await storedLabel(), code: await storedCode(), server: await storedBaseUrl() });
    if (store) setRemembered(await rememberedUntil(store));
  }, [store]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const until = remembered?.until.toLocaleTimeString('en-IN',
    { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Section icon="translate" title={t('Language')}>
        <LanguageList />
      </Section>

      <Section icon="account-check-outline" title={t('Filled in by')}>
        {remembered ? (
          <>
            <View style={styles.who} testID="settings-remembered">
              <Text style={styles.whoName}>{remembered.who.name}</Text>
              <Text style={styles.whoEmp}>{remembered.who.emp_id ?? ''}</Text>
            </View>
            <Text style={styles.text}>
              {t('{name} is chosen by itself under Filled in by until {time}.',
                 { name: remembered.who.name, time: until })}
            </Text>
            <Pressable testID="settings-forget"
                       style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                       onPress={async () => {
                         if (!store) return;
                         await forgetRecorder(store);
                         await load();
                       }}>
              <Text style={styles.buttonText}>{t('Forget {name}', { name: remembered.who.name })}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.text} testID="settings-nobody">
            {t('Nobody is remembered. The next handover starts with the operator filling it in.')}
          </Text>
        )}
        <Text style={styles.hint}>
          {t('When a supervisor fills in a handover, the next one on this tablet starts with them for 12 hours. Forget them when the tablet changes hands.')}
        </Text>
      </Section>

      <Section icon="tablet" title={t('This tablet')}>
        <Row label={t('Name')} value={`${device.label ?? t('not set up')}${device.code ? ` · ${device.code}` : ''}`} />
        <Row label={t('Office server')} value={device.server ?? '—'} />
        <Row label={t('App version')} value={Constants.expoConfig?.version ?? '—'} last />
      </Section>

      <Section icon="wrench-outline" title={t('For IT')}>
        <Pressable testID="settings-sync"
                   style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                   onPress={() => router.push('/sync')}>
          <MaterialCommunityIcons name="cloud-upload-outline" size={24} color="#1e5f8a" />
          <Text style={styles.linkText}>{t('Sending, waiting and the server address')}</Text>
          <MaterialCommunityIcons name="chevron-right" size={24} color="#9aa7b5" />
        </Pressable>
      </Section>
    </ScrollView>
  );
}

function Section({ icon, title, children }: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <MaterialCommunityIcons name={icon} size={22} color="#1e5f8a" />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowRule]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 14, paddingBottom: 40, width: '100%', maxWidth: 820, alignSelf: 'center' },
  section: { backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 12,
             borderWidth: 1, borderColor: '#d8dee6' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#16202b' },
  text: { fontSize: 15, color: '#16202b', lineHeight: 21 },
  hint: { fontSize: 13, color: '#5b6a7a', lineHeight: 19 },
  who: { backgroundColor: '#f2f9f5', borderRadius: 10, borderWidth: 1.5, borderColor: '#1e8449',
         paddingHorizontal: 14, paddingVertical: 12 },
  whoName: { fontSize: 19, fontWeight: '700', color: '#16202b' },
  whoEmp: { fontSize: 14, color: '#5b6a7a' },
  button: { minHeight: 56, borderRadius: 12, borderWidth: 1.5, borderColor: '#e3b5ae',
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#a33a2a' },
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' },
  rowRule: { borderBottomWidth: 1, borderBottomColor: '#eef1f5' },
  rowLabel: { width: 140, fontSize: 14, fontWeight: '700', color: '#5b6a7a' },
  rowValue: { flex: 1, fontSize: 15, color: '#16202b' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  linkText: { flex: 1, fontSize: 16, fontWeight: '600', color: '#16202b' },
});
