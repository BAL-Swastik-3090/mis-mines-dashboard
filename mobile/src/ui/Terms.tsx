/**
 * The terms of use: shown before the app is first used (and after a new
 * version), and readable any time from Settings.
 *
 * The person setting the tablet up reads the summary in their own language --
 * the chips at the top switch it, and the choice carries into the app -- and
 * the full terms in English, which governs. "I agree" stays off until the box
 * is ticked, so agreeing is a decision rather than a reflex. Saying no is
 * allowed and explained: the app simply cannot be used until somebody agrees.
 */

import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGS, useLang, useT } from '@/i18n';
import { SUMMARY, TERMS, TERMS_DATE, TERMS_VERSION } from '@/legal/terms';
import { useTerms } from '@/legal/acceptance';
import { BRAND_BLUE, BRAND_RED, LOGO, LOGO_RATIO } from './brand';

export function TermsScreen({ mode }: { mode: 'accept' | 'read' }) {
  const { t, lang } = useT();
  const setLang = useLang((s) => s.setLang);
  const accepted = useTerms((s) => s.accepted);
  const accept = useTerms((s) => s.accept);
  const insets = useSafeAreaInsets();
  const [ticked, setTicked] = useState(false);
  const [declined, setDeclined] = useState(false);
  const gate = mode === 'accept';

  return (
    <View style={[styles.screen, gate && { paddingTop: insets.top }]}>
      {gate && (
        <View style={styles.band}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain"
                 accessibilityLabel="Balasore Alloys Limited" />
          <View style={styles.langs}>
            {LANGS.map((l) => (
              <Pressable key={l.code} testID={`terms-lang-${l.code}`} onPress={() => void setLang(l.code)}
                         style={[styles.lang, lang === l.code && styles.langOn]}>
                <Text style={[styles.langText, lang === l.code && styles.langTextOn]}>{l.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} testID="terms-scroll">
        <Text style={styles.title}>{t('Terms of use')}</Text>
        <Text style={styles.meta}>
          {t('HOTO app · Kaliapani Chromite Mines · version {v}, {date}',
             { v: TERMS_VERSION, date: TERMS_DATE })}
        </Text>
        {!gate && accepted && (
          <View style={styles.acceptedBox}>
            <MaterialCommunityIcons name="check-decagram" size={20} color="#1e8449" />
            <Text style={styles.acceptedText}>
              {t('Accepted on this tablet on {date}, version {v}.',
                 { date: new Date(accepted.at).toLocaleDateString('en-IN',
                   { day: '2-digit', month: 'short', year: 'numeric' }), v: accepted.version })}
            </Text>
          </View>
        )}

        {/* ── in short, in the reader's language ─────────────────────────── */}
        <View style={styles.summary}>
          {/* A bar of its own: Android draws a coloured left border on a
              rounded box in the box's other colour. */}
          <View style={styles.accent} />
          <Text style={styles.summaryTitle}>{t('In short')}</Text>
          {SUMMARY.map((s) => (
            <View key={s} style={styles.point}>
              <Text style={styles.dot}>•</Text>
              <Text style={styles.pointText}>{t(s)}</Text>
            </View>
          ))}
        </View>

        {/* ── the terms themselves, in English ───────────────────────────── */}
        <Text style={styles.fullTitle}>{t('The full terms')}</Text>
        {lang !== 'en' && (
          <Text style={styles.governs}>{t('The full terms are in English, and the English text governs.')}</Text>
        )}
        {TERMS.map((sec) => (
          <View key={sec.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{sec.title}</Text>
            {sec.body.map((p) => <Text key={p} style={styles.para}>{p}</Text>)}
          </View>
        ))}
        <Text style={styles.copyright}>
          © 2026 Balasore Alloys Limited. {t('For authorised internal use only.')}
        </Text>
      </ScrollView>

      {gate && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
          {declined ? (
            <View style={styles.declined} testID="terms-declined">
              <Text style={styles.declinedText}>
                {t('The app cannot be used until the terms are accepted. If you have a question about them, ask IT at Kaliapani Chromite Mines.')}
              </Text>
              <Pressable onPress={() => setDeclined(false)} hitSlop={8}>
                <Text style={styles.back}>{t('Read the terms again')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable testID="terms-tick" accessibilityRole="checkbox"
                         accessibilityState={{ checked: ticked }}
                         onPress={() => setTicked(!ticked)} style={styles.tickRow}>
                <View style={[styles.box, ticked && styles.boxOn]}>
                  {ticked && <MaterialCommunityIcons name="check" size={22} color="#fff" />}
                </View>
                <Text style={styles.tickText}>
                  {t('I have read the terms of use and agree to them, and the people who use this tablet will be told of them.')}
                </Text>
              </Pressable>
              <View style={styles.buttons}>
                <Pressable testID="terms-decline" onPress={() => setDeclined(true)}
                           style={({ pressed }) => [styles.btn, styles.no, pressed && styles.pressed]}>
                  <Text style={styles.noText}>{t('I do not agree')}</Text>
                </Pressable>
                <Pressable testID="terms-accept" disabled={!ticked} onPress={() => void accept()}
                           style={({ pressed }) => [styles.btn, styles.yes, !ticked && styles.yesOff,
                                                    pressed && ticked && styles.pressed]}>
                  <Text style={styles.yesText}>{t('I agree — continue')}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  band: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#dde4eb',
          paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', flexWrap: 'wrap',
          alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  logo: { height: 52, width: 52 * LOGO_RATIO },
  langs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  lang: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5,
          borderColor: '#c4d3e0', justifyContent: 'center', backgroundColor: '#fff' },
  langOn: { backgroundColor: '#16202b', borderColor: '#16202b' },
  langText: { fontSize: 16, fontWeight: '700', color: '#16202b' },
  langTextOn: { color: '#fff' },

  content: { padding: 20, gap: 12, paddingBottom: 32, width: '100%', maxWidth: 820, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: '#16202b' },
  meta: { fontSize: 14, color: '#5b6a7a', marginTop: -6 },
  acceptedBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f2f9f5',
                 borderRadius: 10, borderWidth: 1, borderColor: '#9fd3b4', padding: 12 },
  acceptedText: { flex: 1, fontSize: 14, color: '#16202b', fontWeight: '600' },

  summary: { backgroundColor: '#fff', borderRadius: 14, padding: 18, paddingLeft: 24, gap: 10,
             borderWidth: 1, borderColor: '#d8dee6', overflow: 'hidden' },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: BRAND_RED },
  summaryTitle: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.8,
                  textTransform: 'uppercase' },
  point: { flexDirection: 'row', gap: 10 },
  dot: { fontSize: 18, lineHeight: 24, color: BRAND_BLUE },
  pointText: { flex: 1, fontSize: 17, lineHeight: 25, color: '#16202b' },

  fullTitle: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.8,
               textTransform: 'uppercase', marginTop: 10 },
  governs: { fontSize: 14, color: '#8a5a00' },
  section: { gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#16202b', marginTop: 4 },
  para: { fontSize: 15, lineHeight: 22, color: '#2c3a48' },
  copyright: { fontSize: 12, color: '#8a97a5', marginTop: 16, textAlign: 'center' },

  footer: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#dde4eb',
            paddingHorizontal: 20, paddingTop: 14, gap: 12 },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 14, width: '100%', maxWidth: 820,
             alignSelf: 'center' },
  box: { width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: '#5b6a7a',
         alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#1e8449', borderColor: '#1e8449' },
  tickText: { flex: 1, fontSize: 15, lineHeight: 21, color: '#16202b', fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: 820, alignSelf: 'center' },
  btn: { minHeight: 60, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
         paddingHorizontal: 16 },
  no: { flex: 1, borderWidth: 1.5, borderColor: '#aeb8c4', backgroundColor: '#fff' },
  noText: { fontSize: 16, fontWeight: '700', color: '#3c4a58' },
  yes: { flex: 2, backgroundColor: '#1e8449' },
  yesOff: { backgroundColor: '#aeb8c4' },
  yesText: { fontSize: 17, fontWeight: '800', color: '#fff' },
  pressed: { opacity: 0.85 },
  declined: { gap: 10, width: '100%', maxWidth: 820, alignSelf: 'center' },
  declinedText: { fontSize: 15, lineHeight: 22, color: '#a33a2a', fontWeight: '600' },
  back: { fontSize: 16, fontWeight: '700', color: '#1e5f8a' },
});
