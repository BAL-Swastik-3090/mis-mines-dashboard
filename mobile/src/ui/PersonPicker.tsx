/**
 * Finding one person on the tablet, by employee number or by name.
 *
 * Used three times on the identify screen -- the operator, the other side of
 * the handover, and whoever is holding the tablet -- so the rules for finding
 * somebody are the same wherever a name goes on the record.
 *
 * ── TWO PEOPLE WITH ONE NAME ─────────────────────────────────────────────────
 * A mine of 269 operators has repeated names, and a handover filed against the
 * wrong person is worse than none: it says somebody checked a machine who never
 * saw it, and it is their name on the record. When the search cannot tell two
 * people apart the picker says so and makes the employee number the thing to
 * read.
 *
 * ── CHANGING YOUR MIND ACTUALLY CHANGES IT ───────────────────────────────────
 * The screen this replaces had a "Not him — change" link that cleared the
 * search box and nothing else: the chosen operator stayed chosen, the search
 * never came back, and the only way to correct a wrong pick was to abandon the
 * handover. Here "Change" reopens the search and "Keep" puts it back.
 *
 * Results are a plain list capped at a handful, not a FlatList: this sits in a
 * scrolling screen, and a virtualised list inside one is a warning on every
 * render and a broken scroll on some Android builds.
 */

import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useCapture } from './useCapture';
import * as masters from '@/core/capture/masters';
import type { CachedOperator } from '@/core/capture/masters';
import type { IdentificationMethod } from '@/core/enums';
import { useT } from '@/i18n';

const SHOWN = 8;

interface Props {
  testID: string;
  chosen: CachedOperator | null;
  onPick: (op: CachedOperator, how: IdentificationMethod) => void | Promise<void>;
  /** Somebody who may not be picked here -- the operator, on the other two. */
  exclude?: number | null;
  /** Why they are excluded, said when they are searched for. */
  excludedBecause?: string;
  placeholder?: string;
}

export function PersonPicker({
  testID, chosen, onPick, exclude, excludedBecause, placeholder,
}: Props) {
  const { t } = useT();
  const store = useCapture((s) => s.store);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<CachedOperator[]>([]);
  const [hidden, setHidden] = useState<CachedOperator | null>(null);
  const [editing, setEditing] = useState(false);

  const look = useCallback(async (q: string) => {
    if (!store || q.trim().length < 2) { setFound([]); setHidden(null); return; }
    // By employee number first, because that is exact. Then by name, which is
    // the only way to reach the operators with no number on record.
    const exact = await masters.operatorByEmpId(store, q);
    const byName = await masters.operatorsByName(store, q);
    const merged = exact ? [exact, ...byName.filter((o) => o.operator_id !== exact.operator_id)]
                         : byName;
    setHidden(merged.find((o) => o.operator_id === exclude) ?? null);
    setFound(merged.filter((o) => o.operator_id !== exclude));
  }, [store, exclude]);

  const sameName = useMemo(() => {
    const seen = new Map<string, number>();
    for (const o of found) {
      const k = o.name.trim().toUpperCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [found]);
  const clashes = found.filter((o) => sameName.has(o.name.trim().toUpperCase()));

  const pick = async (op: CachedOperator) => {
    const how: IdentificationMethod =
      op.emp_id && op.emp_id === search.trim() ? 'EMPNO' : 'BADGE';
    await onPick(op, how);
    setEditing(false);
    setSearch('');
    setFound([]);
    setHidden(null);
  };

  if (chosen && !editing) {
    return (
      <View style={styles.chosen} testID={`${testID}-chosen`}>
        <View style={styles.chosenText}>
          <Text style={styles.chosenName}>{chosen.name}</Text>
          <Text style={styles.chosenEmp}>
            {chosen.emp_id ?? t('no employee number on record')}
          </Text>
        </View>
        <Pressable testID={`${testID}-change`} hitSlop={12}
                   onPress={() => setEditing(true)} style={styles.changeBtn}>
          <Text style={styles.change}>{t('Change')}</Text>
        </Pressable>
      </View>
    );
  }

  const short = search.trim().length >= 2;
  return (
    <View style={styles.wrap}>
      <TextInput
        testID={`${testID}-search`}
        style={styles.search}
        value={search}
        onChangeText={(t) => { setSearch(t); void look(t); }}
        placeholder={placeholder ?? t('Employee number or name')}
        placeholderTextColor="#8a97a5"
        autoCorrect={false}
        autoFocus={editing}
      />

      {clashes.length > 0 && (
        <View style={styles.clash} testID={`${testID}-clash`}>
          <Text style={styles.clashText}>
            {t('{n} people here are called {name}. Check the employee number before you pick one.',
               { n: clashes.length, name: clashes[0]!.name })}
          </Text>
        </View>
      )}

      {found.slice(0, SHOWN).map((o) => (
        <Pressable key={o.operator_id} testID={`${testID}-${o.operator_id}`}
                   style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                   onPress={() => void pick(o)}>
          <Text style={styles.name}>{o.name}</Text>
          <Text style={[styles.emp,
                        sameName.has(o.name.trim().toUpperCase()) && styles.empLoud]}>
            {o.emp_id ?? t('no employee number')}
          </Text>
        </Pressable>
      ))}

      {found.length > SHOWN && (
        <Text style={styles.more}>
          {t('{n} more — type more of the name or the employee number.', { n: found.length - SHOWN })}
        </Text>
      )}
      {short && found.length === 0 && !hidden && (
        <Text style={styles.none}>{t('Nobody on this tablet matches.')}</Text>
      )}
      {hidden && excludedBecause && (
        <Text style={styles.none}>{hidden.name}: {t(excludedBecause)}</Text>
      )}

      {editing && chosen && (
        <Pressable testID={`${testID}-keep`} hitSlop={12}
                   onPress={() => { setEditing(false); setSearch(''); setFound([]); }}>
          <Text style={styles.keep}>{t('Keep {name}', { name: chosen.name })}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  search: { minHeight: 56, borderWidth: 1.5, borderColor: '#aeb8c4', borderRadius: 10,
            paddingHorizontal: 14, fontSize: 18, backgroundColor: '#fff', color: '#16202b' },

  row: { backgroundColor: '#f7f9fb', borderRadius: 10, paddingHorizontal: 14,
         minHeight: 56, borderWidth: 1, borderColor: '#d8dee6', flexDirection: 'row',
         alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowPressed: { backgroundColor: '#e6eef5', borderColor: '#1e5f8a' },
  name: { fontSize: 17, fontWeight: '600', color: '#16202b', flexShrink: 1 },
  emp: { fontSize: 15, color: '#5b6a7a', fontVariant: ['tabular-nums'] },
  empLoud: { color: '#16202b', fontWeight: '800' },

  clash: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1,
           borderRadius: 8, padding: 12 },
  clashText: { fontSize: 14, color: '#16202b', fontWeight: '600' },

  more: { fontSize: 13, color: '#5b6a7a', paddingHorizontal: 4 },
  none: { fontSize: 14, color: '#5b6a7a', paddingHorizontal: 4 },

  chosen: { flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: '#f2f9f5', borderRadius: 10, borderWidth: 1.5,
            borderColor: '#1e8449', paddingHorizontal: 14, paddingVertical: 12 },
  chosenText: { flex: 1, gap: 2 },
  chosenName: { fontSize: 19, fontWeight: '700', color: '#16202b' },
  chosenEmp: { fontSize: 14, color: '#5b6a7a', fontVariant: ['tabular-nums'] },
  changeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
               borderWidth: 1, borderColor: '#c4d3e0', backgroundColor: '#fff' },
  change: { fontSize: 15, color: '#1e5f8a', fontWeight: '700' },
  keep: { fontSize: 15, color: '#1e5f8a', fontWeight: '600', paddingHorizontal: 4,
          paddingVertical: 4 },
});
