/**
 * Setting up a tablet. Done once, by whoever hands it to the section.
 *
 * ── THE SCREEN NOBODY AT THE FACE SHOULD EVER SEE ────────────────────────────
 * If an operator is looking at this, something has gone wrong — the tablet has
 * been wiped, or its credential revoked. So it says what to do about that
 * rather than reading like a login, which would invite somebody to guess.
 */

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { enrol, type Enrolment } from '@/core/sync/enrolment';

export default function Enrol() {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(
    process.env.EXPO_PUBLIC_HOTO_API ?? 'https://mines.balasorealloys.in');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Enrolment | null>(null);

  const go = async () => {
    setBusy(true); setProblem(null);
    const r = await enrol(baseUrl, token);
    setBusy(false);
    if (r.ok) setDone(r.enrolment); else setProblem(r.problem);
  };

  if (done) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <Text style={styles.title}>This tablet is set up</Text>
        <Text style={styles.big}>{done.label}</Text>
        <Text style={styles.note}>
          {done.deviceCode} · {done.profile === 'COMPANY' ? 'shared tablet' : 'personal device'}
        </Text>
        {done.profile === 'COMPANY' && (
          <Text style={styles.note}>
            Every handover will ask who is taking the machine. Nobody stays
            signed in.
          </Text>
        )}
        <Pressable testID="enrolled-done" style={styles.primary}
                   onPress={() => router.replace('/')}>
          <Text style={styles.primaryText}>Start</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Set up this tablet</Text>
      <Text style={styles.note}>
        Done once, by whoever issues the tablet. An operator never needs this
        screen — if you are seeing it at the face, tell your supervisor the
        tablet needs setting up again.
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Server address</Text>
        <TextInput
          testID="base-url"
          style={styles.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Device token</Text>
        <Text style={styles.hint}>
          Issued from the dashboard, under HOTO → Devices. It is shown once.
        </Text>
        <TextInput
          testID="device-token"
          style={[styles.input, styles.multiline]}
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          placeholder="Paste or type the token"
        />
      </View>

      {problem && (
        <View style={styles.problem} testID="enrol-problem">
          <Text style={styles.problemText}>{problem}</Text>
        </View>
      )}

      <Pressable
        testID="enrol"
        disabled={busy || !token.trim()}
        style={[styles.primary, (busy || !token.trim()) && styles.primaryOff]}
        onPress={() => void go()}
      >
        {busy ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryText}>Check and save</Text>}
      </Pressable>

      <Text style={styles.footnote}>
        The token is checked against the server before it is kept, so a wrong
        one is found now rather than at the end of a shift.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  centre: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  title: { fontSize: 22, fontWeight: '800', color: '#16202b' },
  big: { fontSize: 26, fontWeight: '800', color: '#1e8449', textAlign: 'center' },
  note: { fontSize: 15, color: '#5b6a7a', textAlign: 'center' },
  field: { gap: 6 },
  label: { fontSize: 16, fontWeight: '700', color: '#16202b' },
  hint: { fontSize: 13, color: '#5b6a7a' },
  input: { minHeight: 58, borderWidth: 1.5, borderColor: '#aeb8c4', borderRadius: 8,
           paddingHorizontal: 14, fontSize: 16, backgroundColor: '#fff', color: '#16202b' },
  multiline: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top', fontSize: 15 },
  problem: { backgroundColor: '#fff6f5', borderColor: '#c0392b', borderWidth: 1.5,
             borderRadius: 8, padding: 14 },
  problemText: { fontSize: 15, color: '#c0392b', fontWeight: '600' },
  primary: { minHeight: 68, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  footnote: { fontSize: 13, color: '#5b6a7a', textAlign: 'center' },
});
