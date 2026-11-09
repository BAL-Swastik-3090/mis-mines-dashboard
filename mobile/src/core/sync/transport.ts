/**
 * The real transport: HTTP, as a tablet at a mine gate experiences it.
 *
 * ── WHY EVERY HTTP ANSWER RESOLVES AND ONLY A NETWORK FAILURE REJECTS ────────
 * The engine's whole decision tree turns on that distinction. A 422 is the
 * server having read the record and declined it; a dropped connection is the
 * server never having seen it. Collapsing both into a thrown error would make
 * the engine retry a refusal forever and give up on a timeout.
 *
 * ── WHY THE PATHS ARE /api/hoto/device/* ─────────────────────────────────────
 * A tablet is not a person. The person-facing /api/hoto endpoints sit behind
 * the dashboard's session middleware, which refuses a request with no cookie
 * before any handler runs -- and a session cookie is the wrong credential for a
 * shared tablet three times over: it idles out in twenty minutes, the platform
 * permits one per employee so two tablets evict each other, and it would mean
 * typing a dashboard password into a tablet in a pit. The device prefix carries
 * only what a device does, and the token names a tablet rather than a person.
 *
 * ── WHY THE PHOTO GOES THROUGH expo-file-system AND NOT fetch ────────────────
 * `uploadAsync` streams the file from disk. Reading a 300 kB JPEG into a
 * JavaScript string to hand to fetch works, until a tablet with a long queue
 * does it forty times and the app is killed for memory — on the device that
 * has been offline longest and has the most to send.
 */

import * as FileSystem from 'expo-file-system';
import type { Transport } from './engine';

export interface TransportConfig {
  /** e.g. https://mines.balasorealloys.in — no trailing slash. */
  baseUrl: string;
  /** Milliseconds. Short: a tablet's window of signal is seconds long, and a
   *  60-second timeout spends the whole window on one failing request. */
  timeoutMs?: number;
  /** The device token, read from secure storage. Async for that reason. */
  deviceToken: () => Promise<string | null>;
}

/** The one header that identifies the tablet. */
export const DEVICE_HEADER = 'X-HOTO-Device';

const DEFAULT_TIMEOUT = 20_000;

export function httpTransport(cfg: TransportConfig): Transport {
  const timeout = cfg.timeoutMs ?? DEFAULT_TIMEOUT;

  const call = async (path: string, init: RequestInit): Promise<{ status: number; body: any }> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const token = await cfg.deviceToken();
      const headers: Record<string, string> = {
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { [DEVICE_HEADER]: token } : {}),
      };
      const r = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers, signal: ac.signal });
      const text = await r.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 400) }; }
      return { status: r.status, body };
    } finally {
      clearTimeout(timer);
    }
    // NOTE: a thrown fetch error (including the abort) propagates, which is
    // exactly what the engine reads as "no connection".
  };

  return {
    postSession: (payload) => call('/api/hoto/device/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

    getBundle: () => call('/api/hoto/device/sync', { method: 'GET' }),

    postPhoto: async ({ photoUuid, clientUuid, itemId, localPath, sha256, capturedAt }) => {
      const token = await cfg.deviceToken();
      const r = await FileSystem.uploadAsync(
        `${cfg.baseUrl}/api/hoto/device/photos`, localPath, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'image/jpeg',
        headers: token ? { [DEVICE_HEADER]: token } : {},
        parameters: {
          photo_uuid: photoUuid,
          client_uuid: clientUuid,
          sha256,
          captured_at: capturedAt,
          ...(itemId != null ? { item_id: String(itemId) } : {}),
        },
      });
      let body: any = null;
      try { body = r.body ? JSON.parse(r.body) : null; } catch { body = { raw: r.body?.slice(0, 400) }; }
      return { status: r.status, body };
    },
  };
}
