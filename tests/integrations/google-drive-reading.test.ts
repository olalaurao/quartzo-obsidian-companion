import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { strict as assert } from 'assert';
import { GoogleDriveAdapter } from '../../src/integrations/google/drive/adapter';
import { SyncEngine } from '../../src/core/sync';
import { decodeDriveMultipart } from '../fixtures/drive-multipart';
interface FixtureMetadata {
    id: string;
    name: string;
    mimeType: string;
    parents: string[];
    trashed: boolean;
    properties?: Record<string, string>;
}
interface FixtureRequest {
    fileId?: string;
    alt?: string;
    q?: string;
    addParents?: string;
    requestBody?: {
        name?: string;
        parents?: string[];
        title?: string;
        labels?: {
            trashed?: boolean;
        };
    };
    media?: {
        body: Uint8Array;
    };
}
interface FixtureOptions {
    headers: Record<string, string>;
    maxContentLength?: number;
    body?: Uint8Array;
}
const hash = (bytes: Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex');
const original = Buffer.from('opaque synthetic reading bytes\n'), digest = hash(original);
const canonical = `sessions/reading_activity_v1/${'a'.repeat(64)}/${'b'.repeat(64)}/2026/10/${digest}.jsonl`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fixture(kind: 'reading' | 'ordinary' | 'ordinary_hash' = 'reading', seed: Buffer = original) {
    const adapter = new GoogleDriveAdapter('synthetic-only');
    const segments = canonical.split('/'), folders = new Map<string, FixtureMetadata>();
    let parent = 'root';
    for (let index = 0; index < segments.length - 1; index++) {
        const id = `folder-${index}`;
        folders.set(id, { id, name: segments[index], mimeType: 'application/vnd.google-apps.folder', parents: [parent], trashed: false });
        parent = id;
    }
    folders.set('notes', { id: 'notes', name: 'notes', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], trashed: false });
    const fixtureDigest = hash(seed);
    let bytes = Buffer.from(seed), exists = true, etag = 'e1', title = kind === 'ordinary' ? 'ordinary.md' : `${fixtureDigest}.jsonl`, parents = [kind === 'reading' ? parent : 'notes'];
    const calls: Array<{
        operation: string;
        if_match?: string;
    }> = [];
    let hook: ((id: string) => Promise<void>) | null = null;
    let duplicate = false, partial = false, mediaReads = 0;
    let declaredSize: string | null = null;
    const mediaBounds: Array<number | undefined> = [];
    const version = () => ({ id: 'file', etag, title, mimeType: 'application/octet-stream', fileSize: declaredSize ?? bytes.byteLength.toString(), parents: parents.map(id => ({ id })), labels: { trashed: false }, properties: [] });
    const metadata = () => ({ id: 'file', name: title, mimeType: 'application/octet-stream', parents, trashed: false, properties: { Quartzo_hash: hash(bytes) } });
    const v2 = { files: {
            get: async () => { if (!exists)
                throw { response: { status: 404 } }; return { data: clone(version()) }; },
            update: async (params: FixtureRequest, options: FixtureOptions) => {
                calls.push({ operation: 'update', if_match: options.headers['If-Match'] });
                if (options.headers['If-Match'] !== etag)
                    throw { response: { status: 412 } };
                if (options.body)
                    bytes = decodeDriveMultipart(options).bytes;
                if (params.requestBody?.title)
                    title = params.requestBody.title;
                if (params.addParents)
                    parents = [params.addParents];
                etag = `e${Number(etag.slice(1)) + 1}`;
                await hook?.('mutation_reply');
                return { data: { ...clone(version()), labels: { trashed: params.requestBody?.labels?.trashed === true } } };
            },
            delete: async (params: FixtureRequest, options: FixtureOptions) => { calls.push({ operation: 'delete', if_match: options.headers['If-Match'] }); if (options.headers['If-Match'] !== etag)
                throw { response: { status: 412 } }; exists = false; return { data: {} }; },
        } };
    const v3 = { files: {
            get: async (params: FixtureRequest, options?: FixtureOptions) => {
                await hook?.(params.fileId!);
                if (params.alt === 'media') {
                    mediaReads++;
                    mediaBounds.push(options?.maxContentLength);
                    return { data: Buffer.from(bytes) };
                }
                if (params.fileId === 'file')
                    return { data: clone(metadata()) };
                const folder = folders.get(params.fileId!);
                if (!folder)
                    throw { response: { status: 404 } };
                return { data: clone(folder) };
            },
            list: async (params: FixtureRequest) => {
                await hook?.('list');
                const parentMatch = /'([^']+)' in parents/.exec(params.q || ''), nameMatch = /name = '([^']+)'/.exec(params.q || '');
                const wantedParent = parentMatch?.[1], wantedName = nameMatch?.[1];
                const values = [...folders.values()].filter(item => item.parents[0] === wantedParent && item.name === wantedName);
                if (exists && parents[0] === wantedParent && title === wantedName)
                    values.push(metadata());
                if (duplicate && values.some(value => value.id === 'file')) values.push({...metadata(), id: 'duplicate'});
                return { data: { files: clone(values), nextPageToken: partial ? 'more' : undefined } };
            },
            create: async (_params: FixtureRequest, options: FixtureOptions) => { const media = decodeDriveMultipart(options); calls.push({ operation: 'create' }); assert.equal(media.metadata.name, `${digest}.jsonl`); assert.equal(media.metadata.parents[0], parent); bytes = media.bytes; exists = true; parents = [parent]; title = `${digest}.jsonl`; return { data: metadata() }; },
            delete: async () => { calls.push({ operation: 'unconditional_delete' }); exists = false; return { data: {} }; },
        } };
    Object.assign(adapter, { folderId: 'root', getDriveClient: () => v3, getConditionalClient: () => v2, withRetry: async (operation: () => Promise<unknown>) => operation() });
    return { adapter, calls, parent, bytes: () => bytes, empty: () => { exists = false; }, hook: (fn: ((id: string) => Promise<void>) | null) => { hook = fn; }, mutate: () => { etag = 'e2'; bytes = Buffer.from('concurrent remote bytes'); },
        duplicate: () => { duplicate = true; }, partial: () => { partial = true; },
        replace: (value: Uint8Array) => { etag = `e${Number(etag.slice(1)) + 1}`; bytes = Buffer.from(value); },
        declaredSize: (value: string) => { declaredSize = value; }, mediaReads: () => mediaReads, mediaBounds };
}
describe('Reading Drive file identity and immutable publication', () => {
    for (const operation of ['update', 'trash', 'delete', 'rename', 'rename_into', 'ordinary_hash_update', 'ordinary_update', 'upload_wrong', 'upload_alias', 'upload_original', 'retarget_update', 'concurrent_version', 'upload_caller_mutation', 'upload_retarget', 'reading_bound_download', 'foreign_bound_download', 'download_retarget', 'rename_retarget'] as const) {
        it(operation, async () => {
            const ordinary = ['rename_into', 'ordinary_update', 'concurrent_version', 'rename_retarget'].includes(operation);
            const f = fixture(ordinary ? 'ordinary' : ['ordinary_hash_update', 'foreign_bound_download'].includes(operation) ? 'ordinary_hash' : 'reading');
            let outcome = 'accepted';
            try {
                if (!operation.startsWith('upload'))
                    await f.adapter.downloadFile('file');
                if (operation === 'retarget_update')
                    f.hook(async (id) => { if (id === 'folder-5')
                        f.adapter.setAccessToken('other-synthetic-account'); });
                if (operation === 'concurrent_version')
                    f.hook(async (id) => { if (id === 'file') {
                        f.hook(null);
                        f.mutate();
                        await f.adapter.downloadFile('file');
                    } });
                if (operation === 'download_retarget')
                    f.hook(async (id) => { if (id === 'file') {
                        f.hook(null);
                        f.adapter.setAccessToken('other-synthetic-account');
                    } });
                if (operation === 'rename_retarget')
                    f.hook(async (id) => { if (id === 'mutation_reply') {
                        f.hook(null);
                        f.adapter.setAccessToken('other-synthetic-account');
                    } });
                if (['update', 'ordinary_update', 'ordinary_hash_update', 'retarget_update', 'concurrent_version'].includes(operation))
                    await f.adapter.updateFile('file', Buffer.from('changed'), hash('changed'));
                if (operation === 'trash')
                    await f.adapter.trashFile('file');
                if (operation === 'delete')
                    await f.adapter.deleteFile('file');
                if (operation === 'rename' || operation === 'rename_retarget')
                    await f.adapter.renameFile('file', 'renamed.md', 'notes');
                if (operation === 'rename_into')
                    await f.adapter.renameFile('file', `${digest}.jsonl`, f.parent);
                if (operation === 'upload_wrong') {
                    f.empty();
                    await f.adapter.uploadFile({ folderId: 'root', name: canonical, content: Buffer.from('wrong'), quartzoHash: hash('wrong') });
                }
                if (operation === 'upload_alias') {
                    f.empty();
                    await f.adapter.uploadFile({ folderId: 'root', parentId: f.parent, name: `${digest}.jsonl`, content: original, quartzoHash: digest });
                }
                if (operation === 'upload_original') {
                    f.empty();
                    await f.adapter.uploadFile({ folderId: 'root', name: canonical, content: original, quartzoHash: digest });
                }
                if (operation === 'upload_caller_mutation') {
                    f.empty();
                    const input = new Uint8Array(original);
                    f.hook(async (id) => { if (id === 'list') {
                        f.hook(null);
                        input.fill(120);
                    } });
                    await f.adapter.uploadFile({ folderId: 'root', name: canonical, content: input, quartzoHash: digest });
                }
                if (operation === 'upload_retarget') {
                    f.empty();
                    f.hook(async (id) => { if (id === 'list') {
                        f.hook(null);
                        f.adapter.setAccessToken('other-synthetic-account');
                    } });
                    await f.adapter.uploadFile({ folderId: 'root', name: canonical, content: original, quartzoHash: digest });
                }
                if (operation === 'reading_bound_download' || operation === 'foreign_bound_download')
                    await f.adapter.downloadFile('file', canonical);
                if (operation === 'download_retarget')
                    await f.adapter.downloadFile('file');
            }
            catch {
                outcome = 'rejected';
            }
            const allowed = ['ordinary_update', 'ordinary_hash_update', 'upload_original', 'upload_caller_mutation', 'reading_bound_download'].includes(operation);
            expect(outcome).toBe(allowed ? 'accepted' : 'rejected');
            if (operation === 'concurrent_version' || operation === 'rename_retarget') {
                expect(f.calls).toEqual([{ operation: 'update', if_match: 'e1' }]);
                if (operation === 'concurrent_version') expect(f.bytes().toString()).toBe('concurrent remote bytes');
            }
            else if (!allowed)
                expect(f.calls).toEqual([]);
            if (operation === 'upload_caller_mutation')
                expect(hash(f.bytes())).toBe(digest);
        });
    }
});

describe('explicit original-byte Reading repair', () => {
    const requestFor = (f: ReturnType<typeof fixture>) => ({fileId: 'file', relativePath: canonical,
        expectedRemoteHash: hash(f.bytes()), content: new Uint8Array(original)});

    it('repairs reviewed bytes with the observed ETag and verifies the result', async () => {
        const f = fixture(); f.mutate();
        const result = await f.adapter.repairReadingFile(requestFor(f));
        expect(result.id).toBe('file'); expect(result.quartzoHash).toBe(digest);
        expect(f.calls).toEqual([{operation: 'update', if_match: 'e2'}]);
        expect(f.bytes()).toEqual(original);
        expect(f.mediaReads()).toBe(2);
        expect(f.mediaBounds).toEqual([SyncEngine.readingShardMaxBytes, SyncEngine.readingShardMaxBytes]);
    });
    it('accepts the exact pinned byte limit', async () => {
        const payload = Buffer.alloc(SyncEngine.readingShardMaxBytes, 120);
        const f = fixture('reading', payload); f.mutate();
        const result = await f.adapter.repairReadingFile({fileId: 'file', relativePath: canonical.replace(digest, hash(payload)),
            expectedRemoteHash: hash(f.bytes()), content: payload});
        expect(result.quartzoHash).toBe(hash(payload)); expect(f.bytes()).toEqual(payload);
    });
    it('does not rewrite a repair whose previous reply was lost', async () => {
        const f = fixture(); f.mutate(); const request = requestFor(f);
        f.hook(async id => { if (id === 'mutation_reply') throw {response: {status: 503}}; });
        await expect(f.adapter.repairReadingFile(request)).rejects.toMatchObject({response: {status: 503}});
        expect(f.bytes()).toEqual(original);
        f.hook(null);
        expect((await f.adapter.repairReadingFile(request)).quartzoHash).toBe(digest);
        expect(f.calls).toHaveLength(1);
    });
    it('binds its own version even when a concurrent download replaces the cache', async () => {
        const f = fixture(); f.mutate(); const request = requestFor(f);
        f.hook(async id => { if (id === 'list') {
            f.hook(null); f.replace(Buffer.from('newer unreviewed bytes'));
            await f.adapter.downloadFile('file', canonical);
        } });
        await expect(f.adapter.repairReadingFile(request)).rejects.toMatchObject({response: {status: 412}});
        expect(f.calls).toEqual([{operation: 'update', if_match: 'e2'}]);
        expect(f.bytes().toString()).toBe('newer unreviewed bytes');
    });
    it('captures all caller fields and bytes before its first await', async () => {
        const f = fixture(); f.mutate(); const request = requestFor(f);
        f.hook(async id => { if (id === 'folder-5') {
            f.hook(null); request.fileId = 'other'; request.relativePath = 'notes/other.md';
            request.expectedRemoteHash = '0'.repeat(64); request.content.fill(120);
        } });
        expect((await f.adapter.repairReadingFile(request)).quartzoHash).toBe(digest);
        expect(f.bytes()).toEqual(original);
    });
    for (const scenario of ['wrong_digest', 'stale_review', 'duplicate', 'partial', 'oversize_remote', 'oversize_input', 'foreign_id', 'retarget', 'late_retarget', 'late_corruption', 'late_duplicate'] as const) {
        it(`preserves evidence on ${scenario}`, async () => {
            const f = fixture(scenario === 'foreign_id' ? 'ordinary_hash' : 'reading'); f.mutate();
            const request = requestFor(f); const before = Buffer.from(f.bytes());
            if (scenario === 'wrong_digest') request.content = new Uint8Array(Buffer.from('different original'));
            if (scenario === 'stale_review') request.expectedRemoteHash = '0'.repeat(64);
            if (scenario === 'duplicate') f.duplicate();
            if (scenario === 'partial') f.partial();
            if (scenario === 'oversize_remote') f.declaredSize((SyncEngine.readingShardMaxBytes + 1).toString());
            if (scenario === 'oversize_input') {
                request.content = new Uint8Array(SyncEngine.readingShardMaxBytes + 1);
                request.relativePath = canonical.replace(digest, hash(request.content));
            }
            if (scenario === 'retarget') f.hook(async id => { if (id === 'list') { f.hook(null); f.adapter.setAccessToken('other-synthetic-account'); } });
            if (['late_retarget','late_corruption','late_duplicate'].includes(scenario)) f.hook(async id => {
                if (id === 'mutation_reply') {
                    f.hook(null);
                    if (scenario === 'late_retarget') f.adapter.setAccessToken('other-synthetic-account');
                    if (scenario === 'late_corruption') f.replace(Buffer.from('changed after write'));
                    if (scenario === 'late_duplicate') f.duplicate();
                }
            });
            await expect(f.adapter.repairReadingFile(request)).rejects.toBeDefined();
            if (!scenario.startsWith('late_')) {
                expect(f.calls).toEqual([]); expect(f.bytes()).toEqual(before);
            } else expect(f.calls).toHaveLength(1);
            if (['wrong_digest','oversize_remote','oversize_input','foreign_id'].includes(scenario)) expect(f.mediaReads()).toBe(0);
        });
    }
});
