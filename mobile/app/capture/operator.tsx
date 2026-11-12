/**
 * Who is taking the machine.
 *
 * ── IDENTIFICATION IS NOT A LOGIN ────────────────────────────────────────────
 * Nobody signs in to this app. The tablet is shared, it is used by whoever is
 * at the machine, and the question being answered is "who is attesting to this
 * handover", once, for this handover only. Nothing is remembered afterwards:
 * a device that recalled the last operator would put the previous shift's name
 * on this one, which is the quiet failure that makes a whole register
 * worthless.
 *
 * ── AND IT IS NEVER REFUSED ──────────────────────────────────────────────────
 * Not signed off on this machine type? Recorded, shown, and raised for a
 * supervisor. The mine has not decided whether competency may be overridden
 * (scope §9, question 3), and until it does, refusing would mean a machine
 * going out with no record at all rather than a machine going out with an
 * awkward one.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import * as masters from '@/core/capture/masters';
import type { CachedOperator } from '@/core/capture/masters';
import type { IdentificationMethod } from '@/core/enums';

export default function Identify() {
  const router = useRouter();
  const store = useCapture((s) => s.store);
  const asset = useCapture((s) => s.asset);
  const chosen = useCapture((s) => s.operator);
  const advisories = useCapture((s) => s.advisories);
  const identify = useCapture((s) => s.identify);

  const [search, setSearch] = useState('');
  const [found, setFound] = useState<CachedOperator[]>([]);

  // Names that appear more than once in what the search returned.
  const duplicated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const o of found) {
      const k = o.name.trim().toUpperCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [found]);
  const isDuplicated = (n: string) => duplicated.has(n.trim().toUpperCase());
  const sameName = useMemo(
    () => found.filter((o) => isDuplicated(o.name)), [found, duplicated]);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [photoSkipped, setPhotoSkipped] = useState(false);

  // Re-read on focus, because the camera screen is pushed on top of this one
  // and returns to it: the photo exists only after it comes back.
  const uuid = useCapture((s) => s.uuid);
  useFocusEffect(useCallback(() => {
    void (async () => {
      if (!store || !uuid) { setHasPhoto(false); return; }
      const r = await store.getFirstAsync<{ n: number }>(
        `SELECT count(*) AS n FROM photo
          WHERE session_uuid = ? AND kind = 'OPERATOR'`, [uuid]);
      setHasPhoto((r?.n ?? 0) > 0);
    })();
  }, [store, uuid]));

  const look = useCallback(async (q: string) => {
    if (!store || q.trim().length < 2) { setFound([]); return; }
    // By employee number first, because that is exact. Then by name, which is
    // the only way to reach the 32 operators with no number on record.
    const exact = await masters.operatorByEmpId(store, q);
    const byName = await masters.operatorsByName(store, q);
    const merged = exact ? [exact, ...byName.filter((o) => o.operator_id !== exact.operator_id)]
                         : byName;
    setFound(merged);
  }, [store]);

  const pick = async (op: CachedOperator) => {
    const how: IdentificationMethod = op.emp_id && op.emp_id === search.trim() ? 'EMPNO' : 'BADGE';
    await identify(op, how);
  };

  if (!asset) {
    return (
      <View style={styles.screen}>
        <Text style={styles.empty}>No machine has been picked. Go back and pick one.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.machine}>
        <Text style={styles.machineCode}>{asset.fleet_code}</Text>
        <Text style={styles.machineType}>{asset.asset_type_name}</Text>
      </View>

      {chosen ? (
        <View style={styles.picked}>
          <Text style={styles.pickedName}>{chosen.name}</Text>
          <Text style={styles.pickedEmp}>
            {chosen.emp_id ?? 'no employee number on record'}
          </Text>
          <Pressable testID="change-operator" onPress={() => { setSearch(''); setFound([]); }}>
            <Text style={styles.change}>Not him — change</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            testID="operator-search"
            style={styles.search}
            value={search}
            onChangeText={(t) => { setSearch(t); void look(t); }}
            placeholder="Employee number or name"
            autoCorrect={false}
          />
          {/* ── two men with the same name ───────────────────────────────
              A mine of 269 operators has repeated names, and a handover filed
              against the wrong man is worse than none: it says somebody
              checked a machine who never saw it, and it is his name on the
              record. So when the search cannot tell them apart, the screen
              says so and makes the employee number the thing to read. */}
          {sameName.length > 0 && (
            <View style={styles.clash} testID="name-clash">
              <Text style={styles.clashText}>
                {sameName.length} people here are called {sameName[0]!.name}.
                Check the employee number before you pick one.
              </Text>
            </View>
          )}

          <FlatList
            data={found}
            keyExtractor={(o) => String(o.operator_id)}
            ListEmptyComponent={
              search.trim().length >= 2
                ? <Text style={styles.empty}>Nobody on this tablet matches.</Text>
                : null
            }
            renderItem={({ item: o }) => (
              <Pressable testID={`operator-${o.operator_id}`} style={styles.row}
                         onPress={() => void pick(o)}>
                <Text style={styles.name}>{o.name}</Text>
                <Text style={[styles.emp,
                              isDuplicated(o.name) && styles.empLoud]}>
                  {o.emp_id ?? 'no employee number on record'}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      {/* Shown, never blocking. */}
      {advisories.length > 0 && (
        <View style={styles.advisories} testID="advisories">
          {advisories.map((a) => (
            <View key={a.kind}
                  style={[styles.advisory,
                          (a.kind === 'MACHINE_HELD' || a.kind === 'COMPETENCY')
                            && styles.advisorySerious]}>
              <Text style={styles.advisoryText}>{a.message}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── the operator's photo ─────────────────────────────────────────
          Taken before the walk-round, not after, because it is a record of
          WHO took the machine on and the point of it is that the person was
          standing there. A photo offered at the end can be taken by anybody,
          anywhere, once the machine has already moved. */}
      {chosen && (
        <View style={styles.photoBox}>
          {hasPhoto ? (
            <Text style={styles.photoDone}>✓ Operator photographed</Text>
          ) : (
            <>
              <Text style={styles.photoAsk}>
                Take a photo of {chosen.name.split(' ')[0]} before starting.
                It is kept with the handover.
              </Text>
              <Pressable
                testID="operator-photo"
                style={styles.photoBtn}
                onPress={() => router.push('/capture/photo?kind=operator')}
              >
                <Text style={styles.photoBtnText}>Take the photo</Text>
              </Pressable>
              {/* A broken camera must not stop a shift. Recorded, not hidden:
                  the handover goes without a photo and says so. */}
              {!photoSkipped ? (
                <Pressable testID="skip-photo" onPress={() => setPhotoSkipped(true)}>
                  <Text style={styles.photoSkip}>The camera is not working</Text>
                </Pressable>
              ) : (
                <Text style={styles.photoSkipped}>
                  Going on without a photo. The office will see that none was taken.
                </Text>
              )}
            </>
          )}
        </View>
      )}

      <Pressable
        testID="to-checklist"
        disabled={!chosen || !(hasPhoto || photoSkipped)}
        style={[styles.primary,
                (!chosen || !(hasPhoto || photoSkipped)) && styles.primaryOff]}
        onPress={() => router.push('/capture/checklist')}
      >
        <Text style={styles.primaryText}>
          {!chosen ? 'Identify the operator first'
                   : !(hasPhoto || photoSkipped) ? 'Photograph the operator first'
                   : 'Start the walk-round'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /* ── READABLE ON A TABLET ─────────────────────────────────────────────
     This is a phone layout, and on a 1600px tablet in a dock every row
     stretched the full width: a checklist item's label sat at the far left
     and its three buttons at the far right, with a hand's width of nothing
     between them. An operator in a cab reads across that gap for every one
     of twenty-four checks.

     One column, capped and centred. Nothing changes on a phone, where the
     screen is narrower than the cap. See app/capture/checklist.tsx for the
     same cap applied to a list. */

  screen: { flex: 1, backgroundColor: '#f3f6f9', padding: 16, gap: 12,
            width: '100%', maxWidth: 820, alignSelf: 'center' },

  clash: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1,
           borderRadius: 8, padding: 12 },
  clashText: { fontSize: 14, color: '#16202b', fontWeight: '600' },
  empLoud: { color: '#16202b', fontWeight: '800' },

  photoBox: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 10,
              borderWidth: 1, borderColor: '#d8dee6' },
  photoAsk: { fontSize: 15, color: '#16202b' },
  photoDone: { fontSize: 16, fontWeight: '700', color: '#1e8a4f' },
  photoBtn: { minHeight: 56, borderRadius: 8, backgroundColor: '#1e5f8a',
              alignItems: 'center', justifyContent: 'center' },
  photoBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  photoSkip: { fontSize: 13, color: '#8a97a5', textAlign: 'center' },
  photoSkipped: { fontSize: 13, color: '#d98300', fontWeight: '600' },
  machine: { backgroundColor: '#16202b', borderRadius: 10, padding: 14 },
  machineCode: { color: '#fff', fontSize: 20, fontWeight: '700' },
  machineType: { color: '#aeb8c4', fontSize: 13 },

  search: { minHeight: 56, borderWidth: 1.5, borderColor: '#aeb8c4', borderRadius: 8,
            paddingHorizontal: 14, fontSize: 18, backgroundColor: '#fff', color: '#16202b' },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
         minHeight: 64, borderWidth: 1, borderColor: '#d8dee6', flexDirection: 'row',
         alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 17, fontWeight: '600', color: '#16202b', flexShrink: 1 },
  emp: { fontSize: 15, color: '#5b6a7a' },

  picked: { backgroundColor: '#fff', borderRadius: 10, padding: 16, borderWidth: 1.5,
            borderColor: '#1e8449', gap: 2 },
  pickedName: { fontSize: 20, fontWeight: '700', color: '#16202b' },
  pickedEmp: { fontSize: 14, color: '#5b6a7a' },
  change: { fontSize: 14, color: '#1e5f8a', fontWeight: '600', marginTop: 8 },

  advisories: { gap: 8 },
  advisory: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1,
              borderRadius: 8, padding: 12 },
  advisorySerious: { backgroundColor: '#fff6f5', borderColor: '#c0392b' },
  advisoryText: { fontSize: 14, color: '#16202b' },

  primary: { minHeight: 68, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center' },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 20 },
});
