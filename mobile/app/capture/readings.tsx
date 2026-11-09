/**
 * The meter, the fuel, and anything the operator wants to say.
 *
 * ── THE METER IS QUERIED AT THE MACHINE OR NOT AT ALL ────────────────────────
 * It is the only honest boundary between two operators' work, and a reading
 * that went backwards is either a typo or something worse. Both are answerable
 * while standing in front of the hour meter, and neither is answerable by
 * somebody in an office next week — so the check fires here, with the previous
 * reading shown next to it.
 */

import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';

export default function Readings() {
  const router = useRouter();
  const asset = useCapture((s) => s.asset);
  const row = useCapture((s) => s.row);
  const setReadings = useCapture((s) => s.setReadings);

  const [meter, setMeter] = useState(
    row?.meter_reading != null ? String(row.meter_reading) : '');
  const [fuel, setFuel] = useState(row?.fuel_level != null ? String(row.fuel_level) : '');
  const [remarks, setRemarks] = useState(row?.remarks ?? '');

  if (!asset) {
    return <View style={styles.screen}><Text style={styles.empty}>No machine picked.</Text></View>;
  }

  const n = meter.trim() === '' ? null : Number(meter);
  const valid = n != null && Number.isFinite(n);
  const last = asset.last_meter_reading;
  const wentBackwards = valid && last != null && n < last;

  const save = async () => {
    await setReadings({
      ...(valid ? { meterReading: n } : {}),
      ...(fuel.trim() !== '' && Number.isFinite(Number(fuel)) ? { fuelLevel: Number(fuel) } : {}),
      ...(remarks.trim() !== '' ? { remarks: remarks.trim() } : {}),
    });
    router.push('/capture/confirm');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.field}>
        <Text style={styles.label}>Hour meter / odometer</Text>
        {last != null && (
          <Text style={styles.hint}>
            Last recorded: {last} {asset.meter_uom ?? ''}
            {asset.last_meter_at
              ? ` on ${new Date(asset.last_meter_at).toLocaleDateString('en-IN')}`
              : ''}
          </Text>
        )}
        <View style={styles.inputRow}>
          <TextInput
            testID="meter"
            style={[styles.input, wentBackwards && styles.inputBad]}
            value={meter}
            onChangeText={setMeter}
            keyboardType="decimal-pad"
            placeholder="—"
            accessibilityLabel="meter reading"
          />
          <Text style={styles.unit}>{asset.meter_uom ?? ''}</Text>
        </View>
        {wentBackwards && (
          <Text style={styles.bad} testID="meter-backwards">
            That is lower than the last recorded reading. Check it against the
            meter before going on — if it is right, say why in the remarks.
          </Text>
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Fuel level (%)</Text>
        <TextInput
          testID="fuel"
          style={styles.input}
          value={fuel}
          onChangeText={setFuel}
          keyboardType="number-pad"
          placeholder="—"
          accessibilityLabel="fuel level"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Anything else</Text>
        <Text style={styles.hint}>
          Read by the supervisor and kept with the record. Not a defect — use
          the checklist for those.
        </Text>
        <TextInput
          testID="remarks"
          style={[styles.input, styles.multiline]}
          value={remarks}
          onChangeText={setRemarks}
          multiline
          accessibilityLabel="remarks"
        />
      </View>

      <Pressable
        testID="to-confirm"
        disabled={!valid}
        style={[styles.primary, !valid && styles.primaryOff]}
        onPress={() => void save()}
      >
        <Text style={styles.primaryText}>
          {valid ? 'Review and confirm' : 'Enter the meter reading'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 18, paddingBottom: 40 },
  field: { gap: 6 },
  label: { fontSize: 16, fontWeight: '700', color: '#16202b' },
  hint: { fontSize: 13, color: '#5b6a7a' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { minHeight: 60, flex: 1, borderWidth: 1.5, borderColor: '#aeb8c4', borderRadius: 8,
           paddingHorizontal: 14, fontSize: 22, backgroundColor: '#fff', color: '#16202b' },
  inputBad: { borderColor: '#c0392b', borderWidth: 2 },
  multiline: { minHeight: 90, fontSize: 16, paddingTop: 12, textAlignVertical: 'top' },
  unit: { fontSize: 17, color: '#5b6a7a', minWidth: 60 },
  bad: { fontSize: 14, color: '#c0392b', fontWeight: '600' },

  primary: { minHeight: 68, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 40 },
});
