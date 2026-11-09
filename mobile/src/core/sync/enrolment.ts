/**
 * The tablet's own credential.
 *
 * ── WHY THIS IS NOT A LOGIN ──────────────────────────────────────────────────
 * It is entered once, by whoever sets the tablet up, and then never again. It
 * names the TABLET. Nobody signs in to this app and nobody signs out of it:
 * the operator is identified per capture, inside the handover, and that is a
 * separate thing entirely (see capture/session.ts).
 *
 * ── AND WHY IT IS CHECKED AGAINST THE SERVER BEFORE IT IS KEPT ───────────────
 * A token that is wrong by one character looks identical to one that is right
 * until something is sent. Enrolling without checking would mean discovering it
 * at the end of a shift, with a tablet full of handovers that cannot be filed —
 * so `hello` is called first and the token is only stored if the server
 * recognises it.
 */

import * as SecureStore from 'expo-secure-store';

const TOKEN_ENTRY = 'hoto.device.token';
const BASE_ENTRY = 'hoto.device.base_url';
const LABEL_ENTRY = 'hoto.device.label';

export interface Enrolment {
  baseUrl: string;
  deviceCode: string;
  label: string;
  profile: 'PERSONAL' | 'COMPANY';
  mayInheritIdentity: boolean;
}

export async function storedToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_ENTRY);
  } catch {
    // A keystore that will not open is not something an operator can fix, and
    // treating it as "not enrolled" at least shows the enrolment screen rather
    // than a blank one.
    return null;
  }
}

export async function storedBaseUrl(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(BASE_ENTRY); } catch { return null; }
}

export async function storedLabel(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(LABEL_ENTRY); } catch { return null; }
}

export async function isEnrolled(): Promise<boolean> {
  return (await storedToken()) != null && (await storedBaseUrl()) != null;
}

/**
 * Check a token against the server and keep it only if it works.
 *
 * Returns what the server said the tablet is, so the enrolment screen can show
 * the label and the person setting it up can confirm it is the right tablet
 * before walking away.
 */
export async function enrol(baseUrl: string, token: string): Promise<
  { ok: true; enrolment: Enrolment } | { ok: false; problem: string }
> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const tok = token.trim();
  if (!base) return { ok: false, problem: 'The server address is missing.' };
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, problem: 'The server address must start with https://' };
  }
  if (!tok) return { ok: false, problem: 'The device token is missing.' };

  let answer: Response;
  try {
    answer = await fetch(`${base}/api/hoto/device/hello`, {
      method: 'POST',
      headers: { 'X-HOTO-Device': tok },
    });
  } catch {
    // Distinguished from a bad token on purpose: "cannot reach the server" and
    // "the server does not know this tablet" need different things doing.
    return { ok: false,
             problem: `Cannot reach ${base}. Check the tablet is on the network and the address is right.` };
  }

  if (answer.status === 401 || answer.status === 403) {
    const text = await answer.text().catch(() => '');
    return { ok: false,
             problem: /revoked|suspended/i.test(text)
               ? 'This tablet has been stopped by whoever administers HOTO.'
               : 'The server does not recognise this token. Check it, or ask for a new one.' };
  }
  if (!answer.ok) {
    return { ok: false, problem: `The server answered ${answer.status}. Try again shortly.` };
  }

  const body = await answer.json().catch(() => null);
  if (!body?.device_code) {
    return { ok: false, problem: 'The server answered, but not with a device. Check the address.' };
  }

  try {
    await SecureStore.setItemAsync(TOKEN_ENTRY, tok, {
      // The tablet is shared and in use all shift; requiring authentication to
      // read the token would mean the app could not sync at all at the face.
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await SecureStore.setItemAsync(BASE_ENTRY, base);
    await SecureStore.setItemAsync(LABEL_ENTRY, String(body.label ?? body.device_code));
  } catch (e) {
    return { ok: false,
             problem: `The token is valid but this tablet could not store it: ${
               e instanceof Error ? e.message : String(e)}` };
  }

  return {
    ok: true,
    enrolment: {
      baseUrl: base,
      deviceCode: String(body.device_code),
      label: String(body.label ?? body.device_code),
      profile: body.profile === 'PERSONAL' ? 'PERSONAL' : 'COMPANY',
      mayInheritIdentity: Boolean(body.may_inherit_identity),
    },
  };
}

/**
 * Forget the credential.
 *
 * DOES NOT touch captured records. A tablet being re-enrolled still holds
 * handovers somebody signed, and throwing those away because the credential
 * changed would be the worst thing this app could do.
 */
export async function forget(): Promise<void> {
  for (const k of [TOKEN_ENTRY, BASE_ENTRY, LABEL_ENTRY]) {
    try { await SecureStore.deleteItemAsync(k); } catch { /* already gone */ }
  }
}
