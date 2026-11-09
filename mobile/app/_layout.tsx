/**
 * The app shell. Opens the database before anything can render.
 *
 * ── NOTHING RENDERS UNTIL THE DATABASE IS OPEN ───────────────────────────────
 * Not a loading spinner over a usable screen — nothing. Every screen in this
 * app reads from SQLite, and a screen that renders before the database is
 * ready shows an empty machine list, which an operator at the face reads as
 * "my machine is not here" rather than "wait a moment".
 */

import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { adapt, openDb } from '@/core/db/open';
import { useCapture } from '@/ui/useCapture';

export default function RootLayout() {
  const attach = useCapture((s) => s.attach);
  const [state, setState] = useState<'opening' | 'ready' | 'failed'>('opening');
  const [why, setWhy] = useState<string>('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const db = await openDb();
        if (!alive) return;
        attach(adapt(db));
        setState('ready');
      } catch (e) {
        if (!alive) return;
        setWhy(e instanceof Error ? e.message : String(e));
        setState('failed');
      }
    })();
    return () => { alive = false; };
  }, [attach]);

  if (state === 'opening') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" />
        <Text style={styles.note}>Opening the device database…</Text>
      </View>
    );
  }

  if (state === 'failed') {
    return (
      <View style={styles.centre}>
        <Text style={styles.failTitle}>This tablet cannot open its records</Text>
        {/* Said plainly, because the recovery is not something the operator can
            do: it needs IT, and anything unsynced is already gone. Pretending
            otherwise wastes a shift. */}
        <Text style={styles.note}>
          Nothing can be captured until this is fixed. Report it to IT and use
          paper for this shift.
        </Text>
        <Text style={styles.detail}>{why}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerStyle: { backgroundColor: '#16202b' },
                              headerTintColor: '#fff',
                              headerTitleStyle: { fontSize: 18 } }}>
        <Stack.Screen name="index" options={{ title: 'Handover' }} />
        <Stack.Screen name="capture/machine" options={{ title: 'Which machine' }} />
        <Stack.Screen name="capture/operator" options={{ title: 'Who is taking it' }} />
        <Stack.Screen name="capture/checklist" options={{ title: 'Walk-round' }} />
        <Stack.Screen name="capture/readings" options={{ title: 'Readings' }} />
        <Stack.Screen name="capture/confirm" options={{ title: 'Confirm' }} />
        <Stack.Screen name="capture/scan" options={{ title: 'Scan the cab' }} />
        <Stack.Screen name="capture/photo" options={{ title: 'Photo', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28,
            backgroundColor: '#f3f6f9', gap: 12 },
  note: { fontSize: 16, color: '#5b6a7a', textAlign: 'center' },
  failTitle: { fontSize: 20, fontWeight: '700', color: '#c0392b', textAlign: 'center' },
  detail: { fontSize: 12, color: '#8a97a5', textAlign: 'center', marginTop: 10 },
});
