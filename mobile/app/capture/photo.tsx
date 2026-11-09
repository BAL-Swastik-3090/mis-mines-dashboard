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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCapture } from '@/ui/useCapture';

const LONG_EDGE = 1600;
const QUALITY = 0.7;

export default function Photo() {
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
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

  if (!permission) return <View style={styles.screen}><ActivityIndicator /></View>;

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <Text style={styles.title}>The camera is not allowed</Text>
        <Text style={styles.note}>
          A photo is required for this check. Without the camera it cannot be
          completed on the tablet.
        </Text>
        <Pressable style={styles.primary} onPress={() => void requestPermission()}>
          <Text style={styles.primaryText}>Allow the camera</Text>
        </Pressable>
      </View>
    );
  }

  const take = async () => {
    if (!camera.current || !uuid || !store || !item) return;
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

      const base64 = await FileSystem.readAsStringAsync(small.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const sha256 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256, base64,
      );

      const photoUuid = Crypto.randomUUID();
      await store.runAsync(
        `INSERT INTO photo (photo_uuid, session_uuid, item_id, local_path, bytes,
                            sha256, sync_state, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
        [photoUuid, uuid, item.itemId, small.uri, bytes, sha256, new Date().toISOString()],
      );

      // Re-evaluate the item now that it has evidence, so the checklist stops
      // asking for a photo the moment one exists.
      const raw = answers.get(item.itemId) ?? { itemId: item.itemId };
      await setAnswer(item, { ...raw, photoCount: (raw.photoCount ?? 0) + 1 });

      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.overlay}>
        <Text style={styles.what}>{item?.label ?? 'Evidence'}</Text>
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
