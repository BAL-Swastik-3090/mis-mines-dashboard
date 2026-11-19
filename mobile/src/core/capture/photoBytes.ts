/**
 * Turning a photo file's base64 into the bytes the server will hash.
 *
 * ── THE BUG THIS EXISTS TO STOP HAPPENING AGAIN ──────────────────────────────
 * The camera screen used to do this:
 *
 *     const base64 = await FileSystem.readAsStringAsync(uri, { Base64 });
 *     const sha256 = await Crypto.digestStringAsync(SHA256, base64);
 *
 * which hashes the base64 TEXT. The server hashes the bytes it receives
 * (`hashlib.sha256(content)`), so the two could never agree, and every photo
 * a device ever uploaded was refused with "the photo did not arrive intact".
 * Worse, that refusal is retryable by design -- the device is meant to keep a
 * corrupted upload and try again -- so each photo retried for ever, on every
 * sync, and the queue could never drain.
 *
 * It survived because the contract test uploads its own bytes and hashes them
 * correctly, so the server side was proven and the device side was never
 * exercised until a camera was pointed at a brake pedal. Found on a tablet,
 * 12 Nov 2026.
 *
 * Both sides now hash the same thing: the bytes of the file as stored.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * base64 -> bytes, without depending on `atob`.
 *
 * React Native's global `atob` exists on current engines but is not something
 * to rely on across runtimes for the one step that decides whether evidence
 * reaches the office.
 */
export function bytesFromBase64(b64: string): Uint8Array {
  // `clean` already has the padding stripped, so the length alone gives the
  // byte count: 4 characters -> 3 bytes, 3 -> 2, 2 -> 1. Subtracting the
  // padding again on top of that loses the last byte of every padded file,
  // which a JPEG almost always is. Caught by the 'TWE=' case below.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18)
            | (B64.indexOf(clean[i + 1]!) << 12)
            | ((clean[i + 2] ? B64.indexOf(clean[i + 2]!) : 0) << 6)
            | (clean[i + 3] ? B64.indexOf(clean[i + 3]!) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

export const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
