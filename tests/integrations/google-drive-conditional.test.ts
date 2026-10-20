import { describe, expect, it, vi } from 'vitest';
import { GoogleDriveAdapter } from '../../src/integrations/google/drive/adapter';
import { decodeDriveMultipart } from '../fixtures/drive-multipart';

function fixture() {
  const adapter = new GoogleDriveAdapter('test-only');
  let etag = 'e1';
  let bytes = Buffer.from('base');
  const writes: Array<{ headers: Record<string, string>; properties: unknown }> = [];
  const v2 = { files: {
    get: async () => ({ data: { id: 'file', etag, title: 'file.md', properties: [{ key: 'future', value: 'preserved', visibility: 'PUBLIC' }] } }),
    update: async (_params: unknown, options: { headers: Record<string, string>; body: Uint8Array }) => {
      const media = decodeDriveMultipart(options);
      writes.push({ headers: options.headers, properties: media.metadata.properties });
      if (options.headers['If-Match'] !== etag) throw { response: { status: 412 } };
      bytes = media.bytes;
      return { data: { id: 'file', title: 'file.md', properties: media.metadata.properties } };
    },
  } };
  const v3 = { files: { get: async () => ({ data: bytes }) } };
  Object.assign(adapter, { getConditionalClient: () => v2, getDriveClient: () => v3 });
  adapter.assertInsideSelectedVault = async () => {};
  return { adapter, writes, mutate: () => { etag = 'e2'; bytes = Buffer.from('other client'); }, read: () => bytes };
}

describe('conditional Drive mutation boundary', () => {
  it.each(['first-page', 'later-page'])('refreshes the actual folder lookup client after an expired token on %s', async expiry => {
    const adapter = new GoogleDriveAdapter('synthetic-expired');
    let generation = 'expired';
    const calls: Array<{ generation: string; parent: string; page: string | null }> = [];
    const refresh = vi.fn(async () => { generation = 'refreshed'; return 'synthetic-refreshed'; });
    adapter.setTokenRefreshCallback(refresh);
    Object.assign(adapter, { getDriveClient: () => {
      const captured = generation;
      return { files: { list: async (params: { q: string; pageToken?: string }) => {
        const parent = params.q.includes("'root' in parents") ? 'root' : 'diagnostics';
        calls.push({ generation: captured, parent, page: params.pageToken || null });
        if (captured === 'expired' && (expiry === 'first-page' || params.pageToken === 'second')) {
          throw { response: { status: 401 }, message: 'synthetic expired credential' };
        }
        if (parent === 'root') return { data: params.pageToken ? { files: [] } : {
          nextPageToken: expiry === 'later-page' ? 'second' : undefined,
          files: [{ id: 'diagnostics', name: '_diagnostics', mimeType: 'application/vnd.google-apps.folder' }],
        } };
        return { data: { files: [{ id: 'preconditions', name: 'preconditions', mimeType: 'application/vnd.google-apps.folder' }] } };
      } } };
    } });
    await expect(adapter.ensureParentFolder('root', '_diagnostics/preconditions/probe.bin')).resolves.toBe('preconditions');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls.filter(call => call.generation === 'refreshed')).toEqual([
      { generation: 'refreshed', parent: 'root', page: expiry === 'later-page' ? 'second' : null },
      { generation: 'refreshed', parent: 'diagnostics', page: null },
    ]);
    if (expiry === 'later-page') expect(calls.filter(call => call.parent === 'root' && call.page === null)).toHaveLength(1);
  });

  it('stops folder lookup after one unsuccessful credential refresh without creating a folder', async () => {
    const adapter = new GoogleDriveAdapter('synthetic-expired');
    const failure = { response: { status: 401 }, message: 'synthetic expired credential' };
    const list = vi.fn(async () => { throw failure; });
    const create = vi.fn();
    const refresh = vi.fn(async () => 'synthetic-still-rejected');
    adapter.setTokenRefreshCallback(refresh);
    Object.assign(adapter, { getDriveClient: () => ({ files: { list, create } }) });
    await expect(adapter.ensureParentFolder('root', '_diagnostics/preconditions/probe.bin')).rejects.toBe(failure);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it('paginates inventory without traversing backups or diagnostics', async () => {
    const adapter = new GoogleDriveAdapter('test-only');
    const calls: Array<{ q: string; pageToken?: string }> = [];
    Object.assign(adapter, { getDriveClient: () => ({ files: { list: async (params: { q: string; pageToken?: string }) => {
      calls.push(params);
      if (params.pageToken) return { data: { files: [{ id:'note', name:'note.md', mimeType:'text/plain', md5Checksum:'checksum' }] } };
      return { data: { nextPageToken:'page-2', files: ['_backups','_diagnostics','.obsidian'].map(name => ({id:name,name,mimeType:'application/vnd.google-apps.folder'})) } };
    } } }) });
    const files = await adapter.listAllFiles('root');
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.q.includes("'root'"))).toBe(true);
    expect(files.map(file => file.relativePath)).toEqual(['note.md']);
    expect(files[0].md5Checksum).toBe('checksum');
  });
  it('rejects a write when another client changes the verified version', async () => {
    const f = fixture(); await f.adapter.downloadFile('file'); f.mutate();
    await expect(f.adapter.updateFile('file', Buffer.from('local edit'), 'local-hash')).rejects.toMatchObject({ response: { status: 412 } });
    expect(f.writes[0].headers['If-Match']).toBe('e1');
    expect(f.read().toString()).toBe('other client');
  });
  it('preserves unrelated public metadata when replacing content', async () => {
    const f = fixture(); await f.adapter.downloadFile('file');
    await f.adapter.updateFile('file', Buffer.from('local edit'), 'local-hash');
    expect(f.writes[0].properties).toContainEqual({ key: 'future', value: 'preserved', visibility: 'PUBLIC' });
  });
  it('refuses an update without a verified remote snapshot', async () => {
    const f = fixture();
    await expect(f.adapter.updateFile('file', Buffer.from('local edit'), 'local-hash')).rejects.toThrow('verified');
    expect(f.writes).toHaveLength(0);
  });
  it('rejects media that changed version while downloading', async () => {
    const f = fixture();
    Object.assign(f.adapter, { getDriveClient: () => ({ files: { get: async () => {
      f.mutate(); return { data: Buffer.from('untrustworthy snapshot') };
    } } }) });
    await expect(f.adapter.downloadFile('file')).rejects.toThrow('changed during download');
    expect(f.writes).toHaveLength(0);
  });
});
