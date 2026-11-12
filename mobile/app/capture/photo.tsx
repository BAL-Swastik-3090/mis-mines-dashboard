/**
 * The camera, for evidence against one checklist item.
 *
 * ── THE PHOTO IS DOWNSIZED BEFORE IT IS STORED ───────────────────────────────
 * A 12-megapixel JPEG is four megabytes, and a tablet with forty of them and
 * no signal for two days has a photo queue it will never clear over a mine's
 * 2G. 1600px on the long edge at 70% is legible enough to see a cracked hose
 * and small enough to actually arrive, which is the only thing that matters.
 *
 * ── AND HASHED, BECAUSE UPLOADS GET INTERRUPTED ──────────────────────────────
 * The sha256 goes in with the row so that a re-upload after a half-finished
 * transfer is recognised rather than stored twice. That is phase 11's problem
 * to use, but the hash has to be taken here, when the file is written.
 *
 * ── NOT VERIFIED ON HARDWARE ─────────────────────────────────────────────────
 * Everything else in this phase is covered by tests. This screen is not: it
 * needs a camera, and the field trial in phase 12 is the first time it will
 * have one. Treated as unproven until then.
 */

import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { hashPhotoFile } from '@/core/capture/photoHash';

const LONG_EDGE = 1600;
const QUALITY = 0.7;

export default function Photo() {
  const router = useRouter();
  const { itemId, kind } = useLocalSearchParams<{ itemId?: string; kind?: string }>();
  const isOperator = kind === 'operator';
  const store = useCapture((s) => s.store);
  const uuid = useCapture((s) => s.uuid);
  const answers = useCapture((s) => s.answers);
  const setAnswer = useCapture((s) => s.setAnswer);
  const template = useCapture((s) => s.template);

  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = template?.items.find((i) => String(i.itemId) === itemId);
  // An operator photo belongs to the handover, not to a check, so it has no
  // item and must not be gated on finding one.
  const ready = isOperator ? Boolean(uuid && store) : Boolean(uuid && store && item);

  if (!permission) return <View style={styles.screen}><ActivityIndicator /></View>;

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <Text style={styles.title}>The camera is not allowed</Text>
        <Text style={styles.note}>
          {isOperator
            ? 'A photo of the operator is required before a handover can start.'
            : 'A photo is required for this check. Without the camera it cannot be completed on the tablet.'}
        </Text>
        <Pressable style={styles.primary} onPress={() => void requestPermission()}>
          <Text style={styles.primaryText}>Allow the camera</Text>
        </Pressable>
      </View>
    );
  }

  const take = async () => {
    if (!camera.current || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 1, skipProcessing: true });
      if (!shot?.uri) throw new Error('the camera returned nothing');

      const small = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: shot.width >= shot.height ? { width: LONG_EDGE } : { height: LONG_EDGE } }],
        { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );

      const info = await FileSystem.getInfoAsync(small.uri, { size: true });
      const bytes = info.exists && 'size' in info ? info.size : 0;

      // The BYTES, not the base64 text. See core/capture/photoHash.ts for what
      // hashing the wrong thing here cost.
      const sha256 = await hashPhotoFile(small.uri);

      // WHERE IT WAS TAKEN. The server has had columns for this since
      // migration 109 and this app never once filled them, so every photo
      // filed so far says nothing about where it was. For a picture of a
      // machine in a pit that is most of what makes it evidence.
      //
      // Best effort, and never a reason to lose the photo: a fix can take
      // several seconds under a tipper body, and a photo without coordinates
      // is worth far more than no photo at all.
      let lat: number | null = null;
      let lon: number | null = null;
      let acc: number | null = null;
      try {
        const fix = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((r) => setTimeout(() => r(null), 6000)),
        ]);
        if (fix) {
          lat = fix.coords.latitude;
          lon = fix.coords.longitude;
          acc = fix.coords.accuracy ?? null;
        }
      } catch { /* no fix; the photo still stands */ }

      const photoUuid = Crypto.randomUUID();
      await store!.runAsync(
        `INSERT INTO photo (photo_uuid, session_uuid, item_id, local_path, bytes,
                            sha256, sync_state, captured_at, kind, lat, lon, accuracy_m)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
        [photoUuid, uuid, isOperator ? null : item!.itemId, small.uri, bytes, sha256,
         new Date().toISOString(), isOperator ? 'OPERATOR' : 'ITEM', lat, lon, acc],
      );

      if (!isOperator && item) {
        // Re-evaluate the item now that it has evidence, so the checklist stops
        // asking for a photo the moment one exists.
        const raw = answers.get(item.itemId) ?? { itemId: item.itemId };
        await setAnswer(item, { ...raw, photoCount: (raw.photoCount ?? 0) + 1 });
      }

      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill}
                  facing={isOperator ? 'front' : 'back'} />
      <View style={styles.overlay}>
        <Text style={styles.what}>
          {isOperator ? 'Photo of the operator' : (item?.label ?? 'Evidence')}
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable testID="shutter" style={styles.shutter} disabled={saving}
                   onPress={() => void take()}>
          {saving ? <ActivityIndicator color="#16202b" />
                  : <Text style={styles.shutterText}>Take the photo</Text>}
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
  what: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  error: { color: '#ffd9d4', fontSize: 14, textAlign: 'center' },
  shutter: { minHeight: 72, borderRadius: 10, backgroundColor: '#fff',
             alignItems: 'center', justifyContent: 'center' },
  shutterText: { color: '#16202b', fontSize: 18, fontWeight: '800' },
  title: { fontSize: 20, fontWeight: '700', color: '#16202b', textAlign: 'center' },
  note: { fontSize: 15, color: '#5b6a7a', textAlign: 'center' },
  primary: { minHeight: 64, borderRadius: 10, backgroundColor: '#16202b', paddingHorizontal: 24,
             alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
