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
});
