/**
 * Throwing away an unfinished handover (gap G1): a reason, and one more look.
 *
 * Deliberately two steps. An unfinished handover may hold twenty answers and
 * a photo of a fault; losing that to one stray tap is the failure the confirm
 * prompt on a finding exists to prevent, and this is the same kind of loss.
 * The reason is kept on the tablet with the record of what was discarded.
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { DISCARD_REASONS, type DiscardReason } from '@/core/capture/drafting';
import { useT } from '@/i18n';

const REASON_LABEL: Record<DiscardReason, string> = {
  WRONG_MACHINE: 'Wrong machine picked',
  BY_MISTAKE: 'Started by mistake',
  DUPLICATE: 'Already done for this machine',
  OTHER: 'Something else',
};

export function DiscardSheet({ visible, what, answered, onCancel, onDiscard }: {
  visible: boolean;
  /** "MAN-11 · Taking over" */
  what: string;
  answered: number;
  onCancel: () => void;
  onDiscard: (reason: DiscardReason) => void | Promise<void>;
}) {
  const { t, tn } = useT();
  const [reason, setReason] = useState<DiscardReason | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setReason(null); onCancel(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => { /* keep taps inside */ }}>
          <Text style={styles.title}>{t('Discard this unfinished handover?')}</Text>
          <Text style={styles.what}>{what}</Text>
          <Text style={styles.warn}>
            {answered > 0
              ? tn(answered,
                   'Its {n} answer and any photos are deleted from this tablet. This cannot be undone.',
                   'Its {n} answers and any photos are deleted from this tablet. This cannot be undone.')
              : t('It is deleted from this tablet. This cannot be undone.')}
          </Text>

          <Text style={styles.ask}>{t('Why?')}</Text>
          <View style={styles.reasons}>
            {DISCARD_REASONS.map((r) => (
              <Pressable key={r} testID={`discard-reason-${r}`}
                         style={[styles.reason, reason === r && styles.reasonOn]}
                         onPress={() => setReason(r)}>
                <Text style={[styles.reasonText, reason === r && styles.reasonTextOn]}>
                  {t(REASON_LABEL[r])}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.buttons}>
            <Pressable testID="discard-keep" style={[styles.btn, styles.keep]} onPress={close}>
              <Text style={styles.keepText}>{t('Keep it')}</Text>
            </Pressable>
            <Pressable testID="discard-confirm" disabled={!reason || busy}
                       style={[styles.btn, styles.go, (!reason || busy) && styles.off]}
                       onPress={async () => {
                         if (!reason) return;
                         setBusy(true);
                         try { await onDiscard(reason); } finally { setBusy(false); setReason(null); }
                       }}>
              <Text style={styles.goText}>{reason ? t('Discard') : t('Choose why first')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,20,30,0.45)', justifyContent: 'center',
              alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 640, backgroundColor: '#fff', borderRadius: 16,
           padding: 22, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#16202b' },
  what: { fontSize: 17, fontWeight: '700', color: '#3c4a58' },
  warn: { fontSize: 15, color: '#a33a2a', fontWeight: '600' },
  ask: { fontSize: 13, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.6, marginTop: 4 },
  reasons: { gap: 8 },
  reason: { minHeight: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#c4d3e0',
            paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#fff' },
  reasonOn: { borderColor: '#16202b', backgroundColor: '#16202b' },
  reasonText: { fontSize: 16, fontWeight: '600', color: '#16202b' },
  reasonTextOn: { color: '#fff' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, minHeight: 58, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
         paddingHorizontal: 10 },
  keep: { borderWidth: 1.5, borderColor: '#aeb8c4', backgroundColor: '#fff' },
  keepText: { fontSize: 17, fontWeight: '800', color: '#16202b' },
  go: { backgroundColor: '#c0392b' },
  off: { backgroundColor: '#d9a7a1' },
  goText: { fontSize: 17, fontWeight: '800', color: '#fff', textAlign: 'center' },
});
