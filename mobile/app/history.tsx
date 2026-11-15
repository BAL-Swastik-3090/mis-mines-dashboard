/**
 * Done on this tablet: which machines were handed over, by whom, and whether
 * each has reached the office.
 *
 * Asked for by the people doing the handovers: a supervisor taking the HOTO
 * for a section could not see, on the tablet in their hand, which vehicles
 * they had already done. Tap your own name and the list is yours. Read from
 * the tablet's own records, so it works with no signal. Logic and tests in
 * core/capture/history.ts.
 */

import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCapture } from '@/ui/useCapture';
import { useSync } from '@/ui/useSync';
import {
  doneOnTablet, filledInBy, people, summary, whereItIs, type DoneRow, type Period,
} from '@/core/capture/history';
import { useT } from '@/i18n';
import { FadeIn } from '@/ui/motion';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 days' },
];

const TYPE_LABEL: Record<DoneRow['session_type'], string> = {
  START_HANDOVER: 'Taking over', END_HANDOVER: 'Handing over', MID_SHIFT: 'Mid-shift',
};

const when = (iso: string, withDay: boolean) => new Date(iso).toLocaleString('en-IN', {
  ...(withDay ? { day: '2-digit', month: 'short' } : {}),
  hour: '2-digit', minute: '2-digit', hour12: false,
});

export default function History() {
  const { t, tn } = useT();
  const store = useCapture((s) => s.store);
  const lastReport = useSync((s) => s.lastReport);
  const [period, setPeriod] = useState<Period>('today');
  const [who, setWho] = useState<string | null>(null);
  const [rows, setRows] = useState<DoneRow[]>([]);

  const load = useCallback(async () => {
    if (!store) return;
    setRows(await doneOnTablet(store, period));
  }, [store, period]);
  // Re-read on focus and after every send, so "waiting" turns to "at the
  // office" in front of whoever is looking.
  useFocusEffect(useCallback(() => { void load(); }, [load, lastReport]));

  const everyone = useMemo(() => people(rows), [rows]);
  const shown = useMemo(
    () => (who ? rows.filter((r) => filledInBy(r) === who) : rows), [rows, who]);
  const s = summary(shown);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* ── which days ─────────────────────────────────────────────────────── */}
      <View style={styles.segment}>
        {PERIODS.map((p) => (
          <Pressable key={p.key} testID={`period-${p.key}`}
                     style={[styles.seg, period === p.key && styles.segOn]}
                     onPress={() => { setPeriod(p.key); setWho(null); }}>
            <Text style={[styles.segText, period === p.key && styles.segTextOn]}>{t(p.label)}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── whose ──────────────────────────────────────────────────────────
          The person who held the tablet. A supervisor taps their own name
          to see exactly which vehicles they did. */}
      {everyone.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.label}>{t('Filled in by').toUpperCase()}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chips}>
            <Pressable testID="who-everyone"
                       style={[styles.chip, who === null && styles.chipOn]}
                       onPress={() => setWho(null)}>
              <Text style={[styles.chipText, who === null && styles.chipTextOn]}>
                {t('Everyone')} · {rows.length}
              </Text>
            </Pressable>
            {everyone.map((p) => (
              <Pressable key={p.name} testID={`who-${p.name}`}
                         style={[styles.chip, who === p.name && styles.chipOn]}
                         onPress={() => setWho(who === p.name ? null : p.name)}>
                <Text style={[styles.chipText, who === p.name && styles.chipTextOn]}>
                  {p.name} · {p.n}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── the totals ─────────────────────────────────────────────────────── */}
      {shown.length > 0 && (
        <View style={styles.totals} testID="history-summary">
          <Total n={s.machines} label={t(s.machines === 1 ? 'machine' : 'machines')} />
          <Total n={s.handovers} label={t(s.handovers === 1 ? 'handover' : 'handovers')} />
          <Total n={s.atOffice} label={t('at the office')} tone="good" />
          {s.waiting > 0 && <Total n={s.waiting} label={t('waiting to send')} tone="warn" />}
          {s.refused > 0 && <Total n={s.refused} label={t('refused')} tone="bad" />}
          {s.held > 0 && <Total n={s.held} label={t(s.held === 1 ? 'machine held' : 'machines held')} tone="bad" />}
        </View>
      )}

      {/* ── the handovers ──────────────────────────────────────────────────── */}
      {shown.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {t(period === 'today' ? 'Nothing confirmed on this tablet today'
              : period === 'yesterday' ? 'Nothing confirmed on this tablet yesterday'
              : 'Nothing confirmed on this tablet in the last 7 days')}
          </Text>
          <Text style={styles.emptyNote}>
            {t('Handovers done on other tablets are on the office dashboard.')}
          </Text>
        </View>
      ) : shown.map((r, i) => {
        const where = whereItIs(r);
        return (
          <FadeIn key={r.client_uuid} delay={Math.min(i, 8) * 35}>
            <View style={[styles.card, r.status === 'BLOCKED' && styles.cardHeld]}
                  testID={`done-${r.client_uuid}`}>
              <View style={styles.top}>
                <View style={styles.machine}>
                  <Text style={styles.code}>
                    {r.fleet_code ?? t('Machine {id}', { id: r.asset_id })}
                    {r.registration_no ? <Text style={styles.reg}>  {r.registration_no}</Text> : null}
                  </Text>
                  <Text style={styles.time}>{when(r.captured_at, period !== 'today')}</Text>
                </View>
                <View style={styles.type}><Text style={styles.typeText}>{t(TYPE_LABEL[r.session_type])}</Text></View>
              </View>

              <View style={styles.rows}>
                <Line label={t('Operator')} value={r.operator_name ?? t('Not identified')} />
                {r.session_type !== 'MID_SHIFT' && (
                  <Line label={t(r.session_type === 'START_HANDOVER' ? 'Handed over by' : 'Handed to')}
                        value={r.counterpart_name ?? t(r.counterpart_absent ? 'Nobody — parked' : 'Not recorded')} />
                )}
                <Line label={t('Filled in by')} value={filledInBy(r)} />
              </View>

              {r.status === 'BLOCKED' && (
                <Text style={styles.held}>
                  {t('Machine held')} — {r.blocked_reason ?? t('a check that stops it failed')}
                </Text>
              )}

              <View style={styles.bottom}>
                <Text style={[styles.where, where === 'office' ? styles.whereOk
                              : where === 'refused' ? styles.whereBad : styles.whereWait]}>
                  {where === 'office' ? `✓ ${t('At the office')}${r.server_session_ref ? ` · ${r.server_session_ref}` : ''}`
                    : where === 'refused' ? `✕ ${t('Refused by the office — show a supervisor')}`
                    : r.sync_state === 'synced' ? `⏳ ${t('Photographs still sending ({n})', { n: r.photos_waiting })}`
                    : `⏳ ${t('Waiting to send')}`}
                </Text>
                <Text style={[styles.found, r.findings > 0 && styles.foundSome]}>
                  {r.findings > 0 ? tn(r.findings, '{n} fault', '{n} faults') : t('Nothing found')}
                </Text>
              </View>
            </View>
          </FadeIn>
        );
      })}
    </ScrollView>
  );
}

function Total({ n, label, tone }: { n: number; label: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <View style={styles.total}>
      <Text style={[styles.totalN, tone === 'good' && styles.good, tone === 'warn' && styles.warn,
                    tone === 'bad' && styles.bad]}>{n}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f6f9' },
  content: { padding: 16, gap: 12, paddingBottom: 40, width: '100%', maxWidth: 820,
             alignSelf: 'center' },

  segment: { flexDirection: 'row', backgroundColor: '#e3e9f0', borderRadius: 12, padding: 4, gap: 4 },
  seg: { flex: 1, minHeight: 48, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#fff', shadowColor: '#0b1a2a', shadowOpacity: 0.12, shadowRadius: 4,
           shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 15, fontWeight: '700', color: '#5b6a7a' },
  segTextOn: { color: '#16202b' },

  block: { gap: 6 },
  label: { fontSize: 12, fontWeight: '800', color: '#5b6a7a', letterSpacing: 0.8 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5,
          borderColor: '#c4d3e0', backgroundColor: '#fff', justifyContent: 'center' },
  chipOn: { backgroundColor: '#16202b', borderColor: '#16202b' },
  chipText: { fontSize: 15, fontWeight: '700', color: '#3c4a58' },
  chipTextOn: { color: '#fff' },

  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  total: { flexGrow: 1, minWidth: 120, backgroundColor: '#fff', borderRadius: 12, padding: 12,
           borderWidth: 1, borderColor: '#d8dee6' },
  totalN: { fontSize: 26, fontWeight: '800', color: '#16202b', fontVariant: ['tabular-nums'] },
  totalLabel: { fontSize: 13, fontWeight: '600', color: '#5b6a7a' },
  good: { color: '#1e8449' }, warn: { color: '#b86e00' }, bad: { color: '#c0392b' },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 10, borderWidth: 1,
          borderColor: '#d8dee6' },
  cardHeld: { borderColor: '#e6a59d', backgroundColor: '#fff8f7' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  machine: { flex: 1, gap: 2 },
  code: { fontSize: 20, fontWeight: '800', color: '#16202b' },
  reg: { fontSize: 14, fontWeight: '700', color: '#5b6a7a', letterSpacing: 0.4 },
  time: { fontSize: 14, color: '#5b6a7a', fontVariant: ['tabular-nums'] },
  type: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#eef3f8',
          borderWidth: 1, borderColor: '#d3dde8' },
  typeText: { fontSize: 12, fontWeight: '800', color: '#3c4a58' },

  rows: { gap: 4 },
  line: { flexDirection: 'row', gap: 10 },
  lineLabel: { width: 130, fontSize: 13, fontWeight: '700', color: '#5b6a7a' },
  lineValue: { flex: 1, fontSize: 15, color: '#16202b' },

  held: { fontSize: 14, fontWeight: '700', color: '#c0392b' },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            borderTopWidth: 1, borderTopColor: '#eef1f5', paddingTop: 10 },
  where: { flex: 1, fontSize: 14, fontWeight: '700' },
  whereOk: { color: '#1e8449' }, whereWait: { color: '#b86e00' }, whereBad: { color: '#c0392b' },
  found: { fontSize: 14, color: '#5b6a7a', fontWeight: '600' },
  foundSome: { color: '#c0392b', fontWeight: '800' },

  empty: { backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 4, borderWidth: 1,
           borderColor: '#d8dee6', alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#16202b', textAlign: 'center' },
  emptyNote: { fontSize: 14, color: '#5b6a7a', textAlign: 'center' },
});
