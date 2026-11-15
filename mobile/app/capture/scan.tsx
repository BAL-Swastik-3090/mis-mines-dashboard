/**
 * Scanning the sticker on the cab.
 *
 * ── WHY SCANNING IS THE INTENDED WAY TO PICK A MACHINE ───────────────────────
 * A fleet containing MAN-50, MAN-51, MAN-52, MAN-53 and MAN-55 is a fleet
 * where typing eventually picks the wrong one, and a handover filed against
 * the wrong machine is worse than no handover at all: the machine that was
 * actually checked has no record, and the one that was not looks checked.
 *
 * ── A CODE THIS TABLET DOES NOT KNOW IS NOT AN ERROR IN THE STICKER ──────────
 * It usually means the tablet has not synced since the machine was added. The
 * screen says that rather than "invalid code", because the two call for
 * completely different things from the operator.
 *
 * ── NOT VERIFIED ON HARDWARE ─────────────────────────────────────────────────
 * Needs a camera and a printed sticker. First proved in the phase 12 field
 * trial; unproven until then.
 */

import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import * as masters from '@/core/capture/masters';
import { useT } from '@/i18n';

export default function Scan() {
  const router = useRouter();
  const { t } = useT();
  const store = useCapture((s) => s.store);
  const begin = useCapture((s) => s.begin);

  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One scan at a time: a barcode in frame fires continuously, and without
  // this the first scan starts a draft while the next four try to as well.
  const locked = useRef(false);

  if (!permission) return <View style={styles.screen}><ActivityIndicator /></View>;

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <Text style={styles.title}>{t('The camera is not allowed')}</Text>
        <Text style={styles.note}>{t('Find the machine by its number instead.')}</Text>
        <Pressable style={styles.primary} onPress={() => void requestPermission()}>
          <Text style={styles.primaryText}>{t('Allow the camera')}</Text>
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t('Back to the list')}</Text>
        </Pressable>
      </View>
    );
  }

  const onScan = async (code: string) => {
    if (locked.current || !store) return;
    locked.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const asset = await masters.assetByQr(store, code);
      if (!asset) {
        setProblem(t('This tablet does not know the code “{code}”. It is probably a machine added since the last sync — find it by number, or sync the tablet within signal.', { code }));
        return;
      }
      const ok = await begin(asset, 'START_HANDOVER', Crypto.randomUUID());
      if (!ok) {
        setProblem(t('{fleet} is a {type}, and this tablet holds no checklist for one. Sync it, or use paper.',
                     { fleet: asset.fleet_code, type: asset.asset_type_name }));
        return;
      }
      router.replace('/capture/operator');
    } finally {
      setBusy(false);
      // Released only after the operator has had a chance to read the problem.
      setTimeout(() => { locked.current = false; }, 1500);
    }
  };

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39'] }}
        onBarcodeScanned={({ data }) => void onScan(data)}
      />
      <View style={styles.overlay}>
        <Text style={styles.hint}>{t('Point at the sticker on the cab')}</Text>
        {busy && <ActivityIndicator color="#fff" />}
        {problem && (
          <View style={styles.problem}>
            <Text style={styles.problemText}>{problem}</Text>
          </View>
        )}
        <Pressable testID="scan-back" style={styles.secondary} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>{t('Find it by number instead')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  centre: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12,
            backgroundColor: '#f3f6f9' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 12 },
  hint: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  problem: { backgroundColor: '#fff8e6', borderRadius: 8, padding: 14 },
  problemText: { fontSize: 15, color: '#16202b' },
  secondary: { minHeight: 64, borderRadius: 10, backgroundColor: '#fff',
               alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#16202b', fontSize: 17, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '700', color: '#16202b', textAlign: 'center' },
  note: { fontSize: 15, color: '#5b6a7a', textAlign: 'center' },
  primary: { minHeight: 64, borderRadius: 10, backgroundColor: '#16202b', paddingHorizontal: 24,
             alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  link: { color: '#1e5f8a', fontSize: 16, fontWeight: '600', marginTop: 8 },
});
