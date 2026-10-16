import { describe, expect, it } from 'vitest';
import { GoogleDriveAdapter } from '../../src/integrations/google/drive/adapter';

function fixture() {
  const adapter = new GoogleDriveAdapter('test-only');
  let etag = 'e1';
  let bytes = Buffer.from('base');
  const writes: Array<{ headers: Record<string, string>; properties: unknown }> = [];
  const v2 = { files: {
    get: async () => ({ data: { id: 'file', etag, title: 'file.md', properties: [{ key: 'future', value: 'preserved', visibility: 'PUBLIC' }] } }),
    update: async (params: { requestBody: { properties: unknown } }, options: { headers: Record<string, string> }) => {
      writes.push({ headers: options.headers, properties: params.requestBody.properties });
      if (options.headers['If-Match'] !== etag) throw { response: { status: 412 } };
      return { data: { id: 'file', title: 'file.md', properties: params.requestBody.properties } };
    },
  } };
  const v3 = { files: { get: async () => ({ data: bytes }) } };
  Object.assign(adapter, { getConditionalClient: () => v2, getDriveClient: () => v3 });
  adapter.assertInsideSelectedVault = async () => {};
  return { adapter, writes, mutate: () => { etag = 'e2'; bytes = Buffer.from('other client'); }, read: () => bytes };
}

describe('conditional Drive mutation boundary', () => {
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
