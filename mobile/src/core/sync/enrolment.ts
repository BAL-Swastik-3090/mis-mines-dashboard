/**
 * How this device gets permission to exist, and what it keeps afterwards.
 *
 * ── NOBODY TYPES ANYTHING SECRET ─────────────────────────────────────────────
 * The previous version of this file asked whoever set the tablet up to type a
 * server address and a 43-character token. That is not a product. It needs an
 * administrator standing next to every device that ever joins, and the token
 * reaches them by whatever means is to hand, which is WhatsApp.
 *
 * Now the device asks and the office decides:
 *
 *   1. on first run the app makes itself an `install_id` and a `claim_secret`
 *      and keeps both for the life of the install;
 *   2. it registers -- saying what hardware it is and who is asking -- and is
 *      told to wait;
 *   3. somebody in the office sees those facts and approves it;
 *   4. the app, which has been checking, collects its own credential.
 *
 * The person holding the device types their name and, if they want, where it
 * will be used. Nothing else.
 *
 * ── THE TWO SECRETS, AND WHY THEY ARE DIFFERENT THINGS ───────────────────────
 * `claim_secret` proves "I am the installation that asked", and is all that a
 * device waiting for approval holds. It can collect a credential and do
 * nothing else. `token` is the credential, and arrives only after a person
 * approved it. Keeping them apart is what makes step 4 safe: knowing a device
 * code is not enough to collect somebody else's approval.
 *
 * ── THE SERVER ADDRESS IS BUILT IN ───────────────────────────────────────────
 * It comes from the build (`EXPO_PUBLIC_HOTO_API`), because every device in a
 * mine talks to the same server and typing a URL on a phone keyboard in a pit
 * is a transcription error waiting to happen. An override exists for the one
 * case that needs it -- a development server on somebody's laptop, whose
 * address moves -- and is deliberately out of the main path.
 */

import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const TOKEN_ENTRY = 'hoto.device.token';
const BASE_ENTRY = 'hoto.device.base_url';
const LABEL_ENTRY = 'hoto.device.label';
const CODE_ENTRY = 'hoto.device.code';
const INSTALL_ENTRY = 'hoto.install.id';
const SECRET_ENTRY = 'hoto.install.secret';
const TRACK_ENTRY = 'hoto.device.track';
const INTERVAL_ENTRY = 'hoto.device.interval';

/** The address this build was made for. */
const BUILT_IN_BASE = (process.env.EXPO_PUBLIC_HOTO_API ?? '').replace(/\/+$/, '');

export interface Enrolment {
  baseUrl: string;
  deviceCode: string;
  label: string;
  profile: 'PERSONAL' | 'COMPANY';
  mayInheritIdentity: boolean;
}

/** Where a device stands in the process of being allowed in. */
export type JoinState =
  | { state: 'unregistered' }
  // The pairing code the office types to allow it (16 Nov): shown on this
  // device only, never on the dashboard.
  | { state: 'waiting'; deviceCode: string; message: string; pairingCode?: string }
  | { state: 'refused'; deviceCode: string; message: string }
  | { state: 'ready'; deviceCode: string; label: string };

const get = async (k: string): Promise<string | null> => {
  try { return await SecureStore.getItemAsync(k); } catch { return null; }
};
const put = async (k: string, v: string): Promise<void> => {
  await SecureStore.setItemAsync(k, v, {
    // The device is shared and in use all shift. Requiring authentication to
    // read these would mean the app could not sync at all at the face.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

export const storedToken = () => get(TOKEN_ENTRY);
export const storedLabel = () => get(LABEL_ENTRY);
export const storedCode = () => get(CODE_ENTRY);

/** The override if one was set, otherwise what this build was made for. */
export async function storedBaseUrl(): Promise<string | null> {
  const override = await get(BASE_ENTRY);
  return (override ?? BUILT_IN_BASE) || null;
}

export async function setBaseUrlOverride(url: string | null): Promise<void> {
  if (url === null) {
    try { await SecureStore.deleteItemAsync(BASE_ENTRY); } catch { /* gone */ }
    return;
  }
  await put(BASE_ENTRY, url.trim().replace(/\/+$/, ''));
}

/**
 * This installation's id, made once and kept.
 *
 * It is NOT a hardware id. Android stopped handing those out, for good
 * reasons, and a reinstall producing a new identity is the honest answer
 * anyway: the app cannot prove it is the same software that was approved.
 */
export async function installId(): Promise<string> {
  const have = await get(INSTALL_ENTRY);
  if (have) return have;
  const made = Crypto.randomUUID();
  await put(INSTALL_ENTRY, made);
  return made;
}

async function claimSecret(): Promise<string> {
  const have = await get(SECRET_ENTRY);
  if (have) return have;
  // 32 bytes as hex: comfortably past the server's 32-character minimum.
  const bytes = await Crypto.getRandomBytesAsync(32);
  const made = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  await put(SECRET_ENTRY, made);
  return made;
}

/** What this device is, in the words an approver will recognise. */
export function deviceFacts() {
  const cfg = Constants.expoConfig as any;
  return {
    platform: Platform.OS,
    os_version: String(Device.osVersion ?? Platform.Version ?? ''),
    manufacturer: Device.manufacturer ?? undefined,
    model: Device.modelName ?? Device.designName ?? undefined,
    app_version: cfg?.version ?? undefined,
    build_number:
      String(cfg?.android?.versionCode ?? cfg?.ios?.buildNumber ?? '') || undefined,
  };
}

/** A human description of this device, for the screen that asks to join. */
export function describeDevice(): string {
  const f = deviceFacts();
  const make = [f.manufacturer, f.model].filter(Boolean).join(' ');
  const os = f.os_version
    ? `${f.platform === 'ios' ? 'iOS' : 'Android'} ${f.os_version}` : '';
  return [make || 'this device', os].filter(Boolean).join(' · ');
}

async function post(path: string, body: unknown): Promise<
  { ok: true; body: any } | { ok: false; problem: string; status?: number }
> {
  const base = await storedBaseUrl();
  if (!base) {
    return { ok: false,
             problem: 'This app was built without a server address. Tell IT.' };
  }
  let answer: Response;
  try {
    answer = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Kept apart from every other failure: "cannot reach the server" and "the
    // server said no" need completely different things doing about them.
    return { ok: false,
             problem: `Cannot reach ${base}. Check this device is on the mine network.` };
  }
  const parsed = await answer.json().catch(() => null);
  if (!answer.ok) {
    const detail = parsed?.detail;
    const problems: string[] = detail?.problems ?? [];
    return { ok: false, status: answer.status,
             problem: problems.join(' ') || detail?.message ||
                      `The server answered ${answer.status}.` };
  }
  return { ok: true, body: parsed ?? {} };
}

/**
 * Ask to be let in. Safe to call again: the server keeps one row per install,
 * so an impatient device does not fill the approval queue with copies.
 */
export async function requestAccess(
  who: string, note?: string,
  // Whose the device is (16 Nov): the office has to be able to tell, now that
  // people put the app on their own phones. The number is optional -- a name
  // is enough -- and only tells two people of the same name apart.
  owner: { emp?: string; ownDevice?: boolean } = {},
): Promise<{ ok: true; deviceCode: string; message: string; pairingCode?: string }
         | { ok: false; problem: string }> {
  const r = await post('/api/hoto/device/register', {
    install_id: await installId(),
    claim_secret: await claimSecret(),
    requested_by_name: who.trim(),
    requested_by_emp: (owner.emp ?? '').trim() || undefined,
    own_device: owner.ownDevice === true,
    requested_note: (note ?? '').trim() || undefined,
    ...deviceFacts(),
  });
  if (!r.ok) return { ok: false, problem: r.problem };
  const code = String(r.body.device_code ?? '');
  if (code) await put(CODE_ENTRY, code);
  return { ok: true, deviceCode: code, message: String(r.body.message ?? ''),
           ...(r.body.pairing_code ? { pairingCode: String(r.body.pairing_code) } : {}) };
}

/**
 * Have we been allowed yet? Collects the credential if so.
 *
 * Called on a timer by the waiting screen, and once at startup, so a device
 * approved overnight is already working when somebody picks it up.
 */
export async function checkAccess(): Promise<JoinState & { problem?: string }> {
  const r = await post('/api/hoto/device/claim', {
    install_id: await installId(),
    claim_secret: await claimSecret(),
  });
  if (!r.ok) {
    const code = (await storedCode()) ?? '';
    // A device that cannot reach the server has NOT been refused, and must
    // not say so: the two look identical here and mean opposite things.
    return code
      ? { state: 'waiting', deviceCode: code, message: r.problem, problem: r.problem }
      : { state: 'unregistered', problem: r.problem };
  }

  const b = r.body;
  const code = String(b.device_code ?? '');
  const message = String(b.message ?? '');

  if (b.status === 'UNKNOWN') return { state: 'unregistered' };
  if (b.status === 'REJECTED' || b.status === 'REVOKED') {
    return { state: 'refused', deviceCode: code, message };
  }

  if (code) await put(CODE_ENTRY, code);
  if (typeof b.track_location === 'boolean') {
    await put(TRACK_ENTRY, b.track_location ? '1' : '0');
  }
  if (typeof b.location_interval_s === 'number') {
    await put(INTERVAL_ENTRY, String(b.location_interval_s));
  }

  if (b.status === 'ACTIVE' && b.token) {
    await put(TOKEN_ENTRY, String(b.token));
    await put(LABEL_ENTRY, String(b.label ?? code));
    return { state: 'ready', deviceCode: code, label: String(b.label ?? code) };
  }

  if (b.status === 'ACTIVE' && (await storedToken())) {
    // Approved earlier and the credential is already here: nothing to collect.
    return { state: 'ready', deviceCode: code,
             label: (await storedLabel()) ?? code };
  }

  return { state: 'waiting', deviceCode: code, message,
           ...(b.pairing_code ? { pairingCode: String(b.pairing_code) } : {}) };
}

/** Where this device stands, without asking the server. */
export async function joinState(): Promise<JoinState> {
  const token = await storedToken();
  if (token) {
    const code = (await storedCode()) ?? '';
    return { state: 'ready', deviceCode: code, label: (await storedLabel()) ?? code };
  }
  const code = await storedCode();
  if (code) {
    return { state: 'waiting', deviceCode: code,
             message: `Waiting to be allowed. Ask the office to approve ${code}.` };
  }
  return { state: 'unregistered' };
}

/** What the office has told this device to do about its position. */
export async function trackingSettings(): Promise<{ track: boolean; intervalS: number }> {
  const t = await get(TRACK_ENTRY);
  const i = await get(INTERVAL_ENTRY);
  return {
    // Default OFF, not on. When the device cannot tell what it was told, the
    // safer direction on a question about following people around is to stop.
    track: t === '1',
    intervalS: Math.max(30, Math.min(7200, Number(i) || 300)),
  };
}

export async function rememberTracking(track: boolean, intervalS: number): Promise<void> {
  await put(TRACK_ENTRY, track ? '1' : '0');
  await put(INTERVAL_ENTRY, String(Math.round(intervalS)));
}

/**
 * Forget the credential, keeping this installation's identity.
 *
 * Used when the server moves: the device collects again against the SAME row
 * in the office rather than appearing as a second device waiting for approval.
 *
 * DOES NOT touch captured records. A device being set up again still holds
 * handovers somebody signed, and throwing those away because a credential
 * changed would be the worst thing this app could do.
 */
export async function forget(): Promise<void> {
  for (const k of [TOKEN_ENTRY, LABEL_ENTRY]) {
    try { await SecureStore.deleteItemAsync(k); } catch { /* already gone */ }
  }
}

/**
 * Forget everything, including who this installation is.
 *
 * The device registers again as a NEW one and needs approving again. Kept
 * apart from `forget` because the two look the same from the outside and are
 * not: this one makes work for somebody in an office.
 */
export async function forgetEverything(): Promise<void> {
  for (const k of [TOKEN_ENTRY, LABEL_ENTRY, CODE_ENTRY, BASE_ENTRY,
                   INSTALL_ENTRY, SECRET_ENTRY, TRACK_ENTRY, INTERVAL_ENTRY]) {
    try { await SecureStore.deleteItemAsync(k); } catch { /* already gone */ }
  }
}
