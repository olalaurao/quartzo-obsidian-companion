import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { drive } from '@googleapis/drive';
import { OAuth2Client } from 'google-auth-library';
import { GoogleDriveAdapter } from '../../src/integrations/google/drive/adapter';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const payload = Buffer.from([0, 255, 128, 13, 10, 34, 123, 195, 169, 0, 254]);

// Keep the real Google SDK, OAuth request pipeline and Gaxios serialization.
// Only the last HTTP transport is replaced; no network or real credential exists.
function fixture() {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: 'synthetic-no-network' });
  let stored = Buffer.from('before');
  let exists = false;
  let claimedHash = hash(stored);
  let dropMedia = false;
  let loseCreateReply = false;
  let etag = 'e1';
  const mutations: Array<{ body: Buffer; contentType: string; ifMatch: string | null; url: string }> = [];
  const metadata = () => ({ id: 'file', name: 'ordinary.bin', mimeType: 'application/octet-stream',
    parents: ['root'], properties: { Quartzo_hash: claimedHash } });
  const version = () => ({ id: 'file', title: 'ordinary.bin', etag, fileSize: String(stored.length),
    mimeType: 'application/octet-stream', parents: [{ id: 'root' }],
    properties: [{ key: 'future', value: 'preserved', visibility: 'PUBLIC' }] });
  auth.transporter.defaults.fetchImplementation = async (input, config) => {
    const url = new URL(String(input));
    let data: unknown;
    if (config?.method === 'POST' || config?.method === 'PUT') {
      const body = Buffer.from(config.body as Uint8Array);
      const headers = new Headers(config.headers);
      const contentType = headers.get('content-type')!;
      mutations.push({ body, contentType, ifMatch: headers.get('if-match'), url: url.pathname });
      if (config.method === 'PUT' && headers.get('if-match') !== etag) {
        return Response.json({ error: { message: 'stale precondition' } }, { status: 412 });
      }
      const boundary = /boundary=([^;]+)/.exec(contentType)![1];
      const metadataEnd = body.indexOf(Buffer.from(`\r\n--${boundary}\r\n`));
      const json = JSON.parse(body.subarray(body.indexOf('\r\n\r\n') + 4, metadataEnd).toString('utf8'));
      claimedHash = json.properties?.Quartzo_hash ?? json.properties?.find?.((p: { key: string }) => p.key === 'Quartzo_hash')?.value;
      const mediaHeader = Buffer.from('Content-Type: application/octet-stream\r\n\r\n');
      // Header names are case-insensitive; inspect bytes rather than decoding the media.
      const headerAt = body.toString('latin1').toLowerCase().indexOf(mediaHeader.toString().toLowerCase());
      const start = headerAt + mediaHeader.length;
      const end = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
      stored = dropMedia ? Buffer.alloc(0) : Buffer.from(body.subarray(start, end));
      exists = true;
      if (config.method === 'POST' && loseCreateReply) {
        loseCreateReply = false;
        return Response.json({ error: { message: 'synthetic lost create response' } }, { status: 503 });
      }
      data = url.pathname.includes('/v2/') ? version() : metadata();
    } else if (url.searchParams.get('alt') === 'media') {
      return new Response(stored);
    } else if (url.pathname.endsWith('/files')) {
      data = { files: exists ? [metadata()] : [] };
    } else {
      data = url.pathname.includes('/v2/') ? version() : metadata();
    }
    return Response.json(data);
  };
  const adapter = new GoogleDriveAdapter('synthetic-no-network');
  Object.assign(adapter, {
    folderId: 'root', drive: drive({ version: 'v3', auth }),
    getConditionalClient: () => drive({ version: 'v2', auth }),
  });
  return { adapter, mutations, bytes: () => stored, dropMedia: () => { dropMedia = true; },
    loseCreateReply: () => { loseCreateReply = true; }, changeVersion: () => { etag = 'e2'; } };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe.each(['node', 'obsidian-renderer'])('real SDK binary media: %s', runtime => {
  it('publishes exact non-UTF8 bytes with metadata in a single multipart request', async () => {
    if (runtime === 'obsidian-renderer') vi.stubGlobal('window', {});
    const f = fixture();
    await f.adapter.uploadFile({ folderId: 'root', name: 'ordinary.bin', content: payload, quartzoHash: hash(payload) });
    expect(f.bytes()).toEqual(payload);
    expect(f.mutations).toHaveLength(1);
    expect(f.mutations[0].url).toBe('/upload/drive/v3/files');
    expect(f.mutations[0].body.toString('latin1')).toContain(hash(payload));
  });

  it('preserves exact bytes, public metadata and If-Match on a conditional update', async () => {
    if (runtime === 'obsidian-renderer') vi.stubGlobal('window', {});
    const f = fixture();
    await f.adapter.downloadFile('file');
    await f.adapter.updateFile('file', payload, hash(payload));
    expect(f.bytes()).toEqual(payload);
    expect(f.mutations).toHaveLength(1);
    expect(f.mutations[0].ifMatch).toBe('e1');
    expect(f.mutations[0].url).toBe('/upload/drive/v2/files/file');
    expect(f.mutations[0].body.toString('latin1')).toContain('preserved');
  });

  it('rejects acknowledged empty upload bytes even when metadata claims the expected SHA-256', async () => {
    if (runtime === 'obsidian-renderer') vi.stubGlobal('window', {});
    const f = fixture(); f.dropMedia();
    await expect(f.adapter.uploadFile({ folderId: 'root', name: 'ordinary.bin', content: payload,
      quartzoHash: hash(payload) })).rejects.toThrow('divergent content');
    expect(f.mutations).toHaveLength(1);
    expect(f.bytes()).toHaveLength(0);
  });

  it('rejects an acknowledged conditional update whose independent readback is empty', async () => {
    if (runtime === 'obsidian-renderer') vi.stubGlobal('window', {});
    const f = fixture();
    await f.adapter.downloadFile('file'); f.dropMedia();
    await expect(f.adapter.updateFile('file', payload, hash(payload))).rejects.toThrow('not independently verified');
    expect(f.mutations).toHaveLength(1);
  });

  it('preserves a legitimate empty file without treating its zero length as failure', async () => {
    if (runtime === 'obsidian-renderer') vi.stubGlobal('window', {});
    const f = fixture(), empty = Buffer.alloc(0);
    const result = await f.adapter.uploadFile({ folderId: 'root', name: 'ordinary.bin', content: empty, quartzoHash: hash(empty) });
    expect(result.quartzoHash).toBe(hash(empty));
    expect(f.bytes()).toEqual(empty);
    expect(f.mutations).toHaveLength(1);
  });

  it('recovers a lost create reply through independent bytes without a second upload', async () => {
    if (runtime === 'obsidian-renderer') vi.stubGlobal('window', {});
    const f = fixture(); f.loseCreateReply();
    const result = await f.adapter.uploadFile({ folderId: 'root', name: 'ordinary.bin', content: payload, quartzoHash: hash(payload) });
    expect(result.quartzoHash).toBe(hash(payload));
    expect(f.bytes()).toEqual(payload);
    expect(f.mutations).toHaveLength(1);
  });

  it('keeps a stale If-Match failure closed at the real SDK HTTP boundary', async () => {
    if (runtime === 'obsidian-renderer') vi.stubGlobal('window', {});
    const f = fixture();
    await f.adapter.downloadFile('file'); f.changeVersion();
    await expect(f.adapter.updateFile('file', payload, hash(payload))).rejects.toMatchObject({ status: 412 });
    expect(f.bytes()).toEqual(Buffer.from('before'));
    expect(f.mutations).toHaveLength(1);
    expect(f.mutations[0].ifMatch).toBe('e1');
  });
});
