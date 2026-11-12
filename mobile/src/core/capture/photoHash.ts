/**
 * The hash of a photo file, computed the way the server computes it.
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

import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { bytesFromBase64, hex } from './photoBytes';

/** The sha256 of the file's BYTES, lower-case hex — what the server will compute. */
export async function hashPhotoFile(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = bytesFromBase64(base64);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return hex(digest);
}
