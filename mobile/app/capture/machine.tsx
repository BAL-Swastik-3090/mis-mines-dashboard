/**
 * Which machine. The first question, and the one most often got wrong.
 *
 * ── THE QR CODE IS THE INTENDED PATH ─────────────────────────────────────────
 * A fleet with MAN-50, MAN-51, MAN-52, MAN-53, MAN-55 in it is a fleet where
 * typing the code picks the wrong machine eventually, and a handover filed
 * against the wrong machine is worse than none: the right machine looks
 * checked. Scanning is offered first and searching is the fallback.
 *
 * ── A MACHINE THAT IS HELD IS SHOWN, NOT HIDDEN ──────────────────────────────
 * The operator needs to know it is held before he starts walking round it, and
 * he may still have a legitimate reason to capture against it — an end-of-shift
 * handover on a machine that broke down mid-shift is exactly such a case.
 */

import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useCapture } from '@/ui/useCapture';
import * as masters from '@/core/capture/masters';
import type { CachedAsset } from '@/core/capture/masters';
import type { SessionType } from '@/core/enums';

const TYPES: { t: SessionType; label: string }[] = [
  { t: 'START_HANDOVER', label: 'Taking over' },
  { t: 'END_HANDOVER', label: 'Handing over' },
  { t: 'MID_SHIFT', label: 'Mid-shift check' },
];

export default function PickMachine() {
  const router = useRouter();
  const store = useCapture((s) => s.store);
  const begin = useCapture((s) => s.begin);
  const busy = useCapture((s) => s.busy);

  const [type, setType] = useState<SessionType>('START_HANDOVER');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<CachedAsset[]>([]);
  const [held, setHeld] = useState<number | null>(null);
  const [noChecklist, setNoChecklist] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    if (!store) return;
    setList(await masters.assets(store, q));
    // How many it holds AT ALL, so an empty result can tell the operator
    // which of the two very different things has happened.
    setHeld(await masters.assetCount(store));
  }, [store]);

  useFocusEffect(useCallback(() => { void load(search); }, [load, search]));

  const choose = async (a: CachedAsset) => {
    setNoChecklist(null);
    const ok = await begin(a, type, Crypto.randomUUID());
    if (!ok) {
      // Stopped here rather than three screens later with an empty checklist.
      setNoChecklist(
        `This tablet holds no checklist for a ${a.asset_type_name}. ` +
        `Sync it within signal, or record this handover on paper.`,
      );
      return;
    }
    router.push('/capture/operator');
  };

  return (
    <View style={styles.screen}>
      <View style={styles.types}>
        {TYPES.map((o) => (
          <Pressable
            key={o.t}
            testID={`type-${o.t}`}
            accessibilityRole="button"
            accessibilityState={{ selected: type === o.t }}
            style={[styles.type, type === o.t && styles.typePicked]}
            onPress={() => setType(o.t)}
          >
            <Text style={[styles.typeText, type === o.t && styles.typeTextPicked]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable testID="scan" style={styles.scan} onPress={() => router.push('/capture/scan')}>
        <Text style={styles.scanText}>Scan the sticker on the cab</Text>
      </Pressable>

      <TextInput
        testID="search"
        style={styles.search}
        value={search}
        onChangeText={(t) => { setSearch(t); void load(t); }}
        placeholder="…or find it by number"
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {noChecklist && (
        <View style={styles.warn}><Text style={styles.warnText}>{noChecklist}</Text></View>
      )}

      {busy ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}

      <FlatList
        data={list}
        keyExtractor={(a) => String(a.asset_id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          held === 0 ? (
            <View style={styles.warn}>
              <Text style={styles.warnText}>
                This tablet holds no machines yet. Bring it within signal and
                press Sync now on the home screen.
              </Text>
            </View>
          ) : (
            <Text style={styles.empty}>
              {search
                ? `None of the ${held} machines on this tablet match “${search}”.`
                : `${held} machines on this tablet.`}
            </Text>
          )
        }
        renderItem={({ item: a }) => (
          <Pressable
            testID={`asset-${a.asset_id}`}
            style={styles.row}
            onPress={() => void choose(a)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.code}>{a.fleet_code}</Text>
              <Text style={styles.type2}>{a.asset_type_name}</Text>
            </View>
            <View style={styles.flags}>
              {a.has_critical_defect === 1 && (
                <Text style={styles.held}>HELD</Text>
              )}
              {a.open_defect_count > 0 && (
                <Text style={styles.defects}>
                  {a.open_defect_count} open
                </Text>
              )}
              {a.last_meter_reading != null && (
                <Text style={styles.meter}>
                  {a.last_meter_reading} {a.meter_uom ?? ''}
                </Text>
              )}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9', padding: 16, gap: 12 },
  types: { flexDirection: 'row', gap: 8 },
  type: { flex: 1, minHeight: 56, borderRadius: 8, borderWidth: 1.5, borderColor: '#aeb8c4',
          alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  typePicked: { backgroundColor: '#16202b', borderColor: '#16202b' },
  typeText: { fontSize: 15, fontWeight: '600', color: '#16202b', textAlign: 'center' },
  typeTextPicked: { color: '#fff' },

  scan: { minHeight: 64, borderRadius: 10, backgroundColor: '#1e5f8a',
          alignItems: 'center', justifyContent: 'center' },
  scanText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  search: { minHeight: 56, borderWidth: 1.5, borderColor: '#aeb8c4', borderRadius: 8,
            paddingHorizontal: 14, fontSize: 18, backgroundColor: '#fff', color: '#16202b' },

  warn: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1,
          borderRadius: 8, padding: 12 },
  warnText: { fontSize: 14, color: '#16202b' },

  row: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
         minHeight: 68, flexDirection: 'row', alignItems: 'center',
         borderWidth: 1, borderColor: '#d8dee6' },
  code: { fontSize: 19, fontWeight: '700', color: '#16202b' },
  type2: { fontSize: 13, color: '#5b6a7a' },
  flags: { alignItems: 'flex-end', gap: 2 },
  held: { fontSize: 11, fontWeight: '800', color: '#fff', backgroundColor: '#c0392b',
          paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  defects: { fontSize: 12, color: '#d98300', fontWeight: '700' },
  meter: { fontSize: 12, color: '#8a97a5' },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 24 },
});
