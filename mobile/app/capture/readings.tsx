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
import { fuelProblem } from '@/core/capture/session';
import { FlowProgress } from '@/ui/FlowProgress';
import { useT } from '@/i18n';

export default function Readings() {
  const router = useRouter();
  const { t } = useT();
  const asset = useCapture((s) => s.asset);
  const row = useCapture((s) => s.row);
  const setReadings = useCapture((s) => s.setReadings);

  const [meter, setMeter] = useState(
    row?.meter_reading != null ? String(row.meter_reading) : '');
  const [fuel, setFuel] = useState(row?.fuel_level != null ? String(row.fuel_level) : '');
  const [remarks, setRemarks] = useState(row?.remarks ?? '');

  if (!asset) {
    return <View style={styles.screen}><Text style={styles.empty}>{t('No machine picked.')}</Text></View>;
  }

  const n = meter.trim() === '' ? null : Number(meter);
  const valid = n != null && Number.isFinite(n);
  const last = asset.last_meter_reading;
  const wentBackwards = valid && last != null && n < last;

  const fuelN = fuel.trim() === '' ? null : Number(fuel);
  const fuelBad = fuel.trim() !== '' && (fuelN == null || fuelProblem(fuelN) != null);
  const explained = remarks.trim() !== '';

  // The button names the first thing still missing, top to bottom (B1).
  const missing = !valid ? t('Enter the meter reading')
    : fuelBad ? t('Fuel must be 0 to 100')
    : wentBackwards && !explained ? t('Say why the meter is lower')
    : null;

  const save = async () => {
    await setReadings({
      ...(valid ? { meterReading: n } : {}),
      ...(fuelN != null && !fuelBad ? { fuelLevel: fuelN } : {}),
      ...(remarks.trim() !== '' ? { remarks: remarks.trim() } : {}),
    });
    router.push('/capture/confirm');
  };

  return (
    <View style={styles.screen}>
    <FlowProgress at="readings" />
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled">
      <View style={styles.field}>
        <FieldHead label={t('Hour meter / odometer')} required done={valid} />
        {last != null && (
          <Text style={styles.hint}>
            {asset.last_meter_at
              ? t('Last recorded: {value} on {date}', {
                  value: `${last} ${asset.meter_uom ?? ''}`.trim(),
                  date: new Date(asset.last_meter_at).toLocaleDateString('en-IN') })
              : t('Last recorded: {value}', { value: `${last} ${asset.meter_uom ?? ''}`.trim() })}
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
            {t('That is lower than the last recorded reading. Check it against the meter. If it is right — the meter was replaced or reset — say so in the remarks below and it will be accepted.')}
          </Text>
        )}
      </View>

      <View style={styles.field}>
        <FieldHead label={t('Fuel level (%)')} />
        <TextInput
          testID="fuel"
          style={[styles.input, fuelBad && styles.inputBad]}
          value={fuel}
          onChangeText={setFuel}
          keyboardType="number-pad"
          placeholder="—"
          accessibilityLabel="fuel level"
        />
        {fuelBad && (
          <Text style={styles.bad} testID="fuel-bad">
            {t('A percentage, from 0 (empty) to 100 (full).')}
          </Text>
        )}
      </View>

      <View style={styles.field}>
        {/* Optional, except when it is the explanation for a lower meter. */}
        <FieldHead label={t('Anything else')} required={wentBackwards} done={explained} />
        <Text style={styles.hint}>
          {t(wentBackwards
            ? 'Say why the meter reads lower than last time.'
            : 'Read by the supervisor and kept with the record. Not a defect — use the checklist for those.')}
        </Text>
        <TextInput
          testID="remarks"
          style={[styles.input, styles.multiline, wentBackwards && !explained && styles.inputOwed]}
          value={remarks}
          onChangeText={setRemarks}
          multiline
          accessibilityLabel="remarks"
        />
      </View>

      <Pressable
        testID="to-confirm"
        disabled={missing != null}
        style={({ pressed }) => [styles.primary, missing != null && styles.primaryOff,
                                 pressed && missing == null && styles.pressed]}
        onPress={() => void save()}
      >
        <Text style={styles.primaryText}>{missing ?? t('Review and confirm')}</Text>
      </Pressable>
    </ScrollView>
    </View>
  );
}

/** A field's label, with whether it is compulsory said beside it (B1). */
function FieldHead({ label, required, done }: { label: string; required?: boolean; done?: boolean }) {
  const { t } = useT();
  return (
    <View style={styles.head}>
      <Text style={styles.label}>{label}</Text>
      {required
        ? (done ? <Text style={styles.tick}>✓</Text>
                : <View style={styles.required}><Text style={styles.requiredText}>{t('Required')}</Text></View>)
        : <Text style={styles.optional}>{t('Optional')}</Text>}
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

  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 12, paddingBottom: 40,
             width: '100%', maxWidth: 820, alignSelf: 'center' },
  // Each reading is its own card (E6): label, hint, input and any warning
  // read as one thing, instead of a column of evenly spaced loose parts.
  field: { gap: 8, backgroundColor: '#fff', borderRadius: 12, padding: 14,
           borderWidth: 1, borderColor: '#d8dee6' },
  label: { fontSize: 16, fontWeight: '700', color: '#16202b' },
  hint: { fontSize: 13, color: '#5b6a7a' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { minHeight: 60, flex: 1, borderWidth: 1.5, borderColor: '#aeb8c4', borderRadius: 8,
           paddingHorizontal: 14, fontSize: 22, backgroundColor: '#fff', color: '#16202b' },
  inputBad: { borderColor: '#c0392b', borderWidth: 2 },
  inputOwed: { borderColor: '#d9a441', borderWidth: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  required: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
              backgroundColor: '#fff4dc', borderWidth: 1, borderColor: '#e0bf6a' },
  requiredText: { fontSize: 12, fontWeight: '800', color: '#8a5a00', letterSpacing: 0.4 },
  optional: { fontSize: 12, fontWeight: '700', color: '#8a97a5', letterSpacing: 0.4 },
  tick: { fontSize: 18, fontWeight: '800', color: '#1e8449' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  multiline: { minHeight: 90, fontSize: 16, paddingTop: 12, textAlignVertical: 'top' },
  unit: { fontSize: 17, color: '#5b6a7a', minWidth: 60 },
  bad: { fontSize: 14, color: '#c0392b', fontWeight: '600' },

  primary: { minHeight: 68, borderRadius: 10, backgroundColor: '#16202b',
             alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#5b6a7a', fontSize: 15, marginTop: 40 },
});
