/**
 * Asking to be let in — the first screen on a device nobody has approved yet.
 *
 * ── WHAT A PERSON HAS TO DO HERE ─────────────────────────────────────────────
 * Type their name. That is the whole thing. No server address, no token, no
 * device code to invent: the address is built into the app, the credential is
 * collected by the app itself once somebody approves it, and the code is
 * allocated by the server.
 *
 * ── WAITING IS A STATE, NOT AN ERROR ─────────────────────────────────────────
 * Between asking and being approved there is a person in an office who may be
 * at lunch. So the waiting screen shows the device code in the largest type on
 * the screen -- it is what they will be read out over a phone -- says exactly
 * where to go and look, and keeps checking by itself. It never tells somebody
 * to try again later and then does nothing.
 *
 * ── "CANNOT REACH THE SERVER" IS NOT "YOU WERE REFUSED" ──────────────────────
 * They look identical from here and mean opposite things, so they are never
 * merged into one message. One needs a network; the other needs a conversation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  checkAccess, describeDevice, joinState, requestAccess, setBaseUrlOverride,
  storedBaseUrl, trackingSettings, type JoinState,
} from '@/core/sync/enrolment';
import { applyTrackingSettings } from '@/core/location/tracker';

/** How often a waiting device asks. Often enough to feel immediate to somebody
 *  standing next to the approver; rare enough to be nothing on a battery. */
const CHECK_EVERY_MS = 10_000;

export default function Join({ onJoined }: { onJoined?: () => void } = {}) {
  const router = useRouter();

  const [join, setJoin] = useState<JoinState | null>(null);
  const [who, setWho] = useState('');
  const [emp, setEmp] = useState('');
  // Null until answered: whose the device is is asked, never assumed.
  const [ownDevice, setOwnDevice] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [approved, setApproved] = useState<{ code: string; label: string } | null>(null);
  const [permProblem, setPermProblem] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [serverDraft, setServerDraft] = useState('');

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    void (async () => {
      setJoin(await joinState());
      const s = await storedBaseUrl();
      setServer(s);
      setServerDraft(s ?? '');
    })();
  }, []);

  const check = useCallback(async (manual = false) => {
    if (manual) setChecking(true);
    const r = await checkAccess();
    if (!alive.current) return;
    setChecking(false);
    if (r.problem && manual) setProblem(r.problem);
    if (!r.problem) setProblem(null);
    // A check that could not reach the office has no code in it; keep the one
    // already on screen rather than make it vanish while somebody reads it out.
    setJoin((prev) => (r.state === 'waiting' && !r.pairingCode && prev?.state === 'waiting'
                       && prev.pairingCode ? { ...r, pairingCode: prev.pairingCode } : r));
    if (r.state === 'ready') setApproved({ code: r.deviceCode, label: r.label });
  }, []);

  // Keep asking while waiting. Stops the moment it is no longer waiting, so an
  // approved or refused device is not still polling in somebody's pocket.
  useEffect(() => {
    if (join?.state !== 'waiting') return;
    void check();
    const t = setInterval(() => { void check(); }, CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, [join?.state, check]);

  const ask = async () => {
    setBusy(true);
    setProblem(null);
    const r = await requestAccess(who, note, { emp, ownDevice: ownDevice === true });
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) { setProblem(r.problem); return; }
    setJoin({ state: 'waiting', deviceCode: r.deviceCode, message: r.message,
              ...(r.pairingCode ? { pairingCode: r.pairingCode } : {}) });
  };

  const saveServer = async () => {
    const v = serverDraft.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) {
      setProblem('A server address starts with http:// or https://');
      return;
    }
    await setBaseUrlOverride(v || null);
    const s = await storedBaseUrl();
    setServer(s);
    setShowAdvanced(false);
    setProblem(null);
    void check(true);
  };

  if (!join) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  /* ── approved, and asking for what it needs ──────────────────────────── */
  if (approved) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.waitBox}>
          <Text style={styles.readyTick}>✓</Text>
          <Text style={styles.waitTitle}>This device is allowed</Text>
          <Text style={styles.code}>{approved.code}</Text>
          <Text style={styles.waitHow}>{approved.label}</Text>
        </View>

        {/* ASKED HERE, ON A BUTTON, AND NOT AT STARTUP.
            Android shows its permission dialog reliably only in response to
            somebody touching the screen. Asking silently while the app boots
            is how a device ends up never prompting at all and never
            reporting its position, with nothing on screen to say so --
            reported from the field on 10 Nov 2026. The person who just set
            this device up is holding it right now, which is the one moment
            they can answer. */}
        <Text style={styles.note}>
          The office has asked this device to report where it is. Android will
          ask twice: allow it, and then choose
          {' '}<Text style={styles.strong}>Allow all the time</Text> so it keeps
          working while the app is closed.
        </Text>

        {permProblem && (
          <View style={styles.warn}><Text style={styles.warnText}>{permProblem}</Text></View>
        )}

        <Pressable
          testID="finish"
          disabled={finishing}
          style={[styles.primary, finishing && styles.primaryOff]}
          onPress={async () => {
            setFinishing(true);
            const { track } = await trackingSettings();
            if (track) {
              const r = await applyTrackingSettings();
              if (!alive.current) return;
              if (!r.ok) {
                // Not a dead end. The device still captures handovers, which
                // is the job; position reporting is the extra. The home
                // screen keeps offering it.
                setPermProblem(r.message + ' You can still record handovers, '
                             + 'and the home screen will ask again.');
                setFinishing(false);
                return;
              }
            }
            if (!alive.current) return;
            setFinishing(false);
            if (onJoined) onJoined(); else router.replace('/');
          }}
        >
          {finishing ? <ActivityIndicator color="#fff" />
                     : <Text style={styles.primaryText}>Start using this device</Text>}
        </Pressable>

        {permProblem && (
          <Pressable testID="skip-perms"
                     onPress={() => { if (onJoined) onJoined(); else router.replace('/'); }}>
            <Text style={styles.advancedLink}>Carry on without reporting position</Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }

  /* ── refused ─────────────────────────────────────────────────────────── */
  if (join.state === 'refused') {
    return (
      <View style={[styles.screen, styles.centre]}>
        <Text style={styles.refusedTitle}>This device was not allowed</Text>
        <Text style={styles.refusedWhy}>{join.message}</Text>
        <Text style={styles.note}>
          {join.deviceCode} · Asking again will not change this. Speak to
          whoever administers HOTO.
        </Text>
      </View>
    );
  }

  /* ── waiting ─────────────────────────────────────────────────────────── */
  if (join.state === 'waiting') {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.waitBox}>
          <ActivityIndicator size="large" color="#1e5f8a" />
          <Text style={styles.waitTitle}>Waiting to be allowed</Text>
          {/* The largest thing on the screen, because it is what somebody will
              read out over a phone to the office. */}
          <Text style={styles.code}>{join.deviceCode}</Text>
          <Text style={styles.waitHow}>
            Ask the office to open the HOTO dashboard, go to{' '}
            <Text style={styles.strong}>Devices</Text>, and allow{' '}
            <Text style={styles.strong}>{join.deviceCode}</Text>.
          </Text>
          {/* THE PAIRING CODE. The office types it to allow this device, which
              proves they are allowing this one and not somebody else's
              request. It is shown here and nowhere else -- read it out to
              them if they are not standing beside you. */}
          {join.pairingCode ? (
            <View style={styles.pairBox} testID="pairing-code">
              <Text style={styles.pairLabel}>Pairing code</Text>
              <Text style={styles.pair}>
                {join.pairingCode.slice(0, 3)} {join.pairingCode.slice(3)}
              </Text>
              <Text style={styles.pairNote}>
                The office will ask for this code to allow the device. Give it
                only to the person allowing it.
              </Text>
            </View>
          ) : null}
          <Text style={styles.note}>
            This device checks by itself and will start as soon as it is
            allowed. Nothing needs to be typed in here.
          </Text>
        </View>

        {problem && (
          <View style={styles.warn}>
            <Text style={styles.warnText}>{problem}</Text>
          </View>
        )}

        <Pressable testID="check-now" style={styles.primary}
                   disabled={checking} onPress={() => void check(true)}>
          {checking ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.primaryText}>Check now</Text>}
        </Pressable>

        <Advanced show={showAdvanced} server={server} draft={serverDraft}
                  onDraft={setServerDraft} onToggle={setShowAdvanced}
                  onSave={() => void saveServer()} />
      </ScrollView>
    );
  }

  /* ── not registered yet ──────────────────────────────────────────────── */
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Set up this device</Text>
      <Text style={styles.note}>
        This device needs to be allowed before it can record handovers. Say who
        you are and the office will approve it.
      </Text>

      <View style={styles.hardware}>
        <Text style={styles.hardwareLabel}>This device</Text>
        <Text style={styles.hardwareValue}>{describeDevice()}</Text>
        <Text style={styles.hardwareNote}>
          The office sees this, so they can tell which device they are allowing.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          testID="who"
          style={styles.input}
          value={who}
          onChangeText={setWho}
          placeholder="e.g. Akash Jena"
          autoCapitalize="words"
          autoCorrect={false}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Employee number (optional)</Text>
        <TextInput
          testID="emp"
          style={styles.input}
          value={emp}
          onChangeText={setEmp}
          placeholder="Only if two people share your name"
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>

      {/* WHOSE IT IS. The office's device list shows it, so a phone can be
          matched to its owner -- the question once people use their own. */}
      <View style={styles.field}>
        <Text style={styles.label}>Whose device is this?</Text>
        <View style={styles.kinds}>
          {([[true, 'My own phone'], [false, 'A company tablet']] as const).map(([own, text]) => (
            <Pressable key={text} testID={own ? 'own-phone' : 'company-tablet'}
                       onPress={() => setOwnDevice(own)}
                       style={[styles.kind, ownDevice === own && styles.kindOn]}>
              <Text style={[styles.kindText, ownDevice === own && styles.kindTextOn]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Where it will be used (optional)</Text>
        <TextInput
          testID="note"
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Kaliapani, night shift tipper"
        />
      </View>

      {problem && (
        <View style={styles.warn}><Text style={styles.warnText}>{problem}</Text></View>
      )}

      <Pressable
        testID="ask"
        disabled={busy || !who.trim() || ownDevice === null}
        style={[styles.primary, (busy || !who.trim() || ownDevice === null) && styles.primaryOff]}
        onPress={() => void ask()}
      >
        {busy ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryText}>
                  {!who.trim() ? 'Enter your name first'
                    : ownDevice === null ? 'Say whose device this is'
                    : 'Ask for access'}
                </Text>}
      </Pressable>

      <Advanced show={showAdvanced} server={server} draft={serverDraft}
                onDraft={setServerDraft} onToggle={setShowAdvanced}
                onSave={() => void saveServer()} />
    </ScrollView>
  );
}

/**
 * The server address, kept off the main path.
 *
 * Needed for exactly one thing: a development server running on somebody's
 * laptop, whose address changes when the laptop gets a new lease. On a real
 * build nobody should ever open this, which is why it is a line of small text
 * rather than a field.
 */
function Advanced({ show, server, draft, onDraft, onToggle, onSave }: {
  show: boolean; server: string | null; draft: string;
  onDraft: (v: string) => void; onToggle: (v: boolean) => void; onSave: () => void;
}) {
  if (!show) {
    return (
      <Pressable testID="advanced" onPress={() => onToggle(true)}>
        <Text style={styles.advancedLink}>
          Sends to {server ?? 'nowhere — this app was built without a server'}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.advancedBox}>
      <Text style={styles.label}>Server address</Text>
      <TextInput
        testID="server"
        style={styles.input}
        value={draft}
        onChangeText={onDraft}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.1.10:8990"
      />
      <Text style={styles.note}>
        Only change this if IT told you to. Leave it empty to go back to the
        address this app was built with.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable style={[styles.primary, { flex: 1 }]} onPress={onSave}>
          <Text style={styles.primaryText}>Use this server</Text>
        </Pressable>
        <Pressable style={[styles.primary, { flex: 1, backgroundColor: '#5b6a7a' }]}
                   onPress={() => onToggle(false)}>
          <Text style={styles.primaryText}>Cancel</Text>
        </Pressable>
      </View>
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
  content: { padding: 20, gap: 16, paddingBottom: 48,
             width: '100%', maxWidth: 820, alignSelf: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },

  title: { fontSize: 24, fontWeight: '700', color: '#16202b' },
  note: { fontSize: 14, color: '#5b6a7a', lineHeight: 20 },
  strong: { fontWeight: '800', color: '#16202b' },

  hardware: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 3,
              borderWidth: 1, borderColor: '#d8dee6' },
  hardwareLabel: { fontSize: 11, fontWeight: '800', color: '#5b6a7a',
                   letterSpacing: 0.5 },
  hardwareValue: { fontSize: 17, fontWeight: '700', color: '#16202b' },
  hardwareNote: { fontSize: 12, color: '#8a97a5' },

  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: '#16202b' },
  kinds: { flexDirection: 'row', gap: 10 },
  kind: { flex: 1, minHeight: 52, borderRadius: 10, borderWidth: 1.5, borderColor: '#aeb8c4',
          alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', paddingHorizontal: 8 },
  kindOn: { backgroundColor: '#16202b', borderColor: '#16202b' },
  kindText: { fontSize: 16, fontWeight: '700', color: '#16202b', textAlign: 'center' },
  kindTextOn: { color: '#fff' },
  input: { minHeight: 56, borderWidth: 1.5, borderColor: '#aeb8c4', borderRadius: 8,
           paddingHorizontal: 14, fontSize: 17, backgroundColor: '#fff',
           color: '#16202b' },

  primary: { minHeight: 64, borderRadius: 10, backgroundColor: '#1e5f8a',
             alignItems: 'center', justifyContent: 'center' },
  primaryOff: { backgroundColor: '#aeb8c4' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  waitBox: { backgroundColor: '#fff', borderRadius: 12, padding: 22, gap: 10,
             alignItems: 'center', borderWidth: 1, borderColor: '#d8dee6' },
  waitTitle: { fontSize: 20, fontWeight: '700', color: '#16202b' },
  pairBox: { alignSelf: 'stretch', alignItems: 'center', gap: 4, marginTop: 8, padding: 16,
             borderRadius: 12, backgroundColor: '#f2f6fa', borderWidth: 1.5, borderColor: '#1e5f8a' },
  pairLabel: { fontSize: 13, fontWeight: '800', color: '#1e5f8a', letterSpacing: 1,
               textTransform: 'uppercase' },
  pair: { fontSize: 44, fontWeight: '800', color: '#16202b', letterSpacing: 6,
          fontVariant: ['tabular-nums'] },
  pairNote: { fontSize: 14, color: '#5b6a7a', textAlign: 'center' },
  code: { fontSize: 40, fontWeight: '800', color: '#1e5f8a', letterSpacing: 2 },
  waitHow: { fontSize: 16, color: '#16202b', textAlign: 'center', lineHeight: 23 },

  warn: { backgroundColor: '#fff8e6', borderColor: '#e0bf6a', borderWidth: 1,
          borderRadius: 8, padding: 12 },
  warnText: { fontSize: 14, color: '#16202b' },

  refusedTitle: { fontSize: 22, fontWeight: '700', color: '#c0392b',
                  textAlign: 'center' },
  refusedWhy: { fontSize: 17, color: '#16202b', textAlign: 'center',
                lineHeight: 24 },

  readyTick: { fontSize: 44, color: '#1e8a4f', fontWeight: '800' },
  advancedLink: { fontSize: 12, color: '#8a97a5', textAlign: 'center',
                  marginTop: 8 },
  advancedBox: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 10,
                 borderWidth: 1, borderColor: '#d8dee6' },
});
