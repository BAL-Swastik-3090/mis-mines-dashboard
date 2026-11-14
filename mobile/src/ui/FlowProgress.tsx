/**
 * Where you are in a handover, and how much is left.
 *
 * Machine → People → Checks → Readings → Confirm, with nothing on screen saying
 * which of those you were on or how many remained (issue E4). An operator
 * interrupted mid-walk-round -- a radio call, a machine needed now -- came back
 * to a screen with no bearings. This strip sits at the top of every capture
 * screen and says it at a glance: done, here, still to come.
 *
 * The bar under it fills to the current stage and eases there, so moving on
 * reads as progress rather than as a page swap.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from './motion';

export const STAGES = [
  { key: 'machine', label: 'Machine' },
  { key: 'people', label: 'People' },
  { key: 'checks', label: 'Checks' },
  { key: 'readings', label: 'Readings' },
  { key: 'confirm', label: 'Confirm' },
] as const;
export type Stage = (typeof STAGES)[number]['key'];

export function FlowProgress({ at }: { at: Stage }) {
  const here = STAGES.findIndex((s) => s.key === at);
  const reduce = useReducedMotion();
  const fill = useRef(new Animated.Value(Math.max(0, here - 1) / (STAGES.length - 1))).current;
  useEffect(() => {
    const to = here / (STAGES.length - 1);
    if (reduce) { fill.setValue(to); return; }
    Animated.timing(fill, { toValue: to, duration: 420, easing: Easing.out(Easing.cubic),
                            useNativeDriver: false }).start();
  }, [here, reduce, fill]);

  return (
    <View style={styles.bar} accessibilityRole="progressbar"
          accessibilityLabel={`Step ${here + 1} of ${STAGES.length}: ${STAGES[here]?.label}`}>
      <View style={styles.row}>
        {/* Behind the dots, from the centre of the first to the centre of the
            last: each column is 1/N wide, so its centre is 1/2N in. */}
        <View style={styles.track}>
          <Animated.View style={[styles.fill, {
            width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }]} />
        </View>
        {STAGES.map((s, i) => {
          const done = i < here;
          const now = i === here;
          return (
            <View key={s.key} style={styles.stage}>
              <View style={[styles.dot, done && styles.dotDone, now && styles.dotNow]}>
                <Text style={[styles.dotText, (done || now) && styles.dotTextOn]}>
                  {done ? '✓' : i + 1}
                </Text>
              </View>
              <Text numberOfLines={1}
                    style={[styles.label, now && styles.labelNow, done && styles.labelDone]}>
                {s.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const DOT = 24;

const styles = StyleSheet.create({
  // Full width, so the strip meets both edges of a tablet; the stages
  // themselves are capped like every other column in the app.
  bar: { alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
         backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e1e7ee' },
  track: { position: 'absolute', left: `${50 / STAGES.length}%`, right: `${50 / STAGES.length}%`,
           top: DOT / 2 - 1.5, height: 3,
           backgroundColor: '#e1e7ee', borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: '#1e8449' },
  row: { flexDirection: 'row', width: '100%', maxWidth: 788, alignSelf: 'center' },
  stage: { flex: 1, alignItems: 'center', gap: 4 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: '#fff',
         borderWidth: 2, borderColor: '#cfd8e2', alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: '#1e8449', borderColor: '#1e8449' },
  dotNow: { backgroundColor: '#16202b', borderColor: '#16202b' },
  dotText: { fontSize: 11, fontWeight: '800', color: '#8a97a5' },
  dotTextOn: { color: '#fff' },
  label: { fontSize: 12, fontWeight: '600', color: '#8a97a5' },
  labelNow: { color: '#16202b', fontWeight: '800' },
  labelDone: { color: '#3c4a58' },
});
