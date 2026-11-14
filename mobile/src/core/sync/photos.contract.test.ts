/**
 * Does a photo actually reach the server, and does a corrupt one get refused?
 *
 * The engine tests prove the device's decisions. This proves the other half:
 * that the upload endpoint accepts what the device would send, that a retry is
 * one photo rather than two, and that bytes which did not survive the journey
 * are refused rather than filed as evidence.
 *
 * It builds the multipart body with fetch rather than expo-file-system, since
 * there is no expo runtime in node — so what it proves is the CONTRACT (fields,
 * hashing, idempotency, refusals), not the streaming upload itself. The
 * streaming path is first exercised on hardware in phase 12, and is marked
 * unproven in transport.ts until then.
 *
 *   HOTO_API=http://127.0.0.1:8990 HOTO_COOKIE=<cookie> npx jest photos.contract
 */

import { createHash, randomUUID } from 'node:crypto';

const API = process.env.HOTO_API;
const COOKIE = process.env.HOTO_COOKIE;
const live = Boolean(API && COOKIE);
const describeLive = live ? describe : describe.skip;

if (!live) {
  // eslint-disable-next-line no-console
  console.warn('\n  photos.contract.test.ts SKIPPED — set HOTO_API and HOTO_COOKIE.\n');
}

const auth = () => ({ Cookie: `mines_session=${COOKIE}` });

async function json(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: { raw: text.slice(0, 400) } }; }
}

/** A tiny but genuinely valid JPEG, so the server is not accepting rubbish. */
function jpeg(): Buffer {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64');
}

async function upload(fields: Record<string, string>, bytes: Buffer,
                      filename = 'evidence.jpg') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), filename);
  const r = await fetch(`${API}/api/hoto/photos`, {
    method: 'POST', headers: auth(), body: form,
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: { raw: text.slice(0, 400) } }; }
}

describeLive('a photo reaching the server', () => {
  let clientUuid: string;
  let sessionId: number;
  const filed: number[] = [];

  beforeAll(async () => {
    // A real handover to attach evidence to, filed the way a device files one.
    const sync = await json('GET', '/api/hoto/sync');
    expect(sync.status).toBe(200);
    const templates = sync.body.templates as any[];
    const assets = sync.body.assets as any[];
    const types = templates.map((t) => t.asset_type_id);
    const asset = assets.find((a) => types.includes(a.asset_type_id));
    const template = templates.find((t) => t.asset_type_id === asset.asset_type_id);
    const allItems = template.sections.flatMap((s: any) => s.items);

    clientUuid = randomUUID();
    const responses = allItems.map((i: any) => {
      if (i.response_type === 'NUMERIC') {
        const lo = i.min_value ?? 0, hi = i.max_value ?? 100;
        return { item_id: i.item_id, numeric_value: (lo + hi) / 2 };
      }
      if (i.response_type === 'LEVEL') return { item_id: i.item_id, answer: 'NORMAL' };
      // The answer that is NOT the finding for this item. 'YES' to "Abnormal
      // sound" is a fault, and this fixture is meant to be a clean walk-round.
      if (i.response_type === 'YES_NO') {
        return { item_id: i.item_id, answer: (i.adverse_answer ?? 'YES') === 'YES' ? 'NO' : 'YES' };
      }
      return { item_id: i.item_id, answer: 'OK' };
    });

    const posted = await json('POST', '/api/hoto/sessions', {
      client_uuid: clientUuid,
      asset_id: asset.asset_id,
      session_type: 'START_HANDOVER',
      captured_at: new Date().toISOString(),
      production_day: new Date().toISOString().slice(0, 10),
      template_id: template.template_id,
      template_version: template.version,
      meter_reading: (asset.last_meter_reading ?? 0) + 2,
      responses,
      status: 'SUBMITTED',
      captured_offline: true,
      remarks: 'contract test',
    });
    if (![200, 201].includes(posted.status)) {
      throw new Error(`fixture handover refused: ${posted.status} ${JSON.stringify(posted.body)}`);
    }
    sessionId = posted.body.session_id;
    filed.push(sessionId);
  }, 90_000);

  it('is stored, and comes back as its own bytes', async () => {
    const bytes = jpeg();
    const sha = createHash('sha256').update(bytes).digest('hex');
    const photoUuid = randomUUID();

    const r = await upload({
      photo_uuid: photoUuid, client_uuid: clientUuid, sha256: sha,
      captured_at: new Date().toISOString(),
    }, bytes);

    if (![200, 201].includes(r.status)) {
      throw new Error(`the server refused the photo: ${r.status} ${JSON.stringify(r.body)}`);
    }
    expect(r.body).toMatchObject({ created: true, sha256: sha, size_bytes: bytes.length });

    // And it reads back as the same image, not a re-encoded one.
    const got = await fetch(`${API}/api/hoto/photos/${r.body.photo_id}`, { headers: auth() });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toContain('image/jpeg');
    const back = Buffer.from(await got.arrayBuffer());
    expect(createHash('sha256').update(back).digest('hex')).toBe(sha);
  }, 60_000);

  it('a retry is one photo, not two', async () => {
    const bytes = jpeg();
    const sha = createHash('sha256').update(bytes).digest('hex');
    const photoUuid = randomUUID();
    const fields = { photo_uuid: photoUuid, client_uuid: clientUuid, sha256: sha,
                     captured_at: new Date().toISOString() };

    const first = await upload(fields, bytes);
    expect([200, 201]).toContain(first.status);
    const again = await upload(fields, bytes);
    expect([200, 201]).toContain(again.status);
    // The device's retry after a dropped connection must not file a second copy.
    expect(again.body.created).toBe(false);
    expect(again.body.photo_id).toBe(first.body.photo_id);
  }, 60_000);

  it('refuses bytes that did not survive the journey', async () => {
    const bytes = jpeg();
    const wrong = createHash('sha256').update(Buffer.concat([bytes, Buffer.from('x')]))
      .digest('hex');

    const r = await upload({
      photo_uuid: randomUUID(), client_uuid: clientUuid, sha256: wrong,
      captured_at: new Date().toISOString(),
    }, bytes);

    // A truncated JPEG is not evidence. Refused with 409 so the device keeps it
    // queued and sends it again, rather than the register holding something
    // that is not the photograph anybody took.
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/did not arrive intact/);
  }, 60_000);

  it('tells a device to send the handover first, rather than losing the photo', async () => {
    const bytes = jpeg();
    const r = await upload({
      photo_uuid: randomUUID(), client_uuid: randomUUID(),      // no such session
      sha256: createHash('sha256').update(bytes).digest('hex'),
      captured_at: new Date().toISOString(),
    }, bytes);

    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/no handover has been filed/);
  }, 60_000);

  it('refuses something that is not an image at all', async () => {
    const bytes = Buffer.from('this is not a photograph');
    const r = await fetch(`${API}/api/hoto/photos`, {
      method: 'POST', headers: auth(), body: (() => {
        const f = new FormData();
        f.append('photo_uuid', randomUUID());
        f.append('client_uuid', clientUuid);
        f.append('file', new Blob([bytes], { type: 'text/plain' }), 'notes.txt');
        return f;
      })(),
    });
    expect(r.status).toBe(422);
    expect(await r.text()).toMatch(/not an image type/);
  }, 60_000);

  it('the register can say what has arrived and what has not', async () => {
    const r = await json('GET', `/api/hoto/register/${sessionId}/photos`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
    // Metadata only — the listing must never carry the bytes.
    expect(JSON.stringify(r.body)).not.toMatch(/"content"/);
    expect(r.body.photos[0]).toMatchObject({ content_type: 'image/jpeg' });
  }, 60_000);

  it('the pending-evidence report finds checks whose photos never came', async () => {
    const r = await json('GET', '/api/hoto/evidence/pending?days=30');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.pending)).toBe(true);
    // Seeded handovers attested to photos that were never uploaded, so this
    // report has something real to find. If it were empty the report would be
    // passing for the wrong reason.
    expect(r.body.count).toBeGreaterThan(0);
    expect(r.body.pending[0]).toHaveProperty('photos_attested');
    expect(r.body.pending[0]).toHaveProperty('photos_arrived');
  }, 60_000);
});
