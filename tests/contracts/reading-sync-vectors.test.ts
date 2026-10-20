// Execute the pinned upstream matrix through the existing sync owner.
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SyncEngine } from '../../src/core/sync';
import type { SyncVector } from '../../src/core/sync/types';
interface ReadingSyncFixture {
    path_vectors: Array<{
        id: string;
        path: string;
        canonical: boolean;
    }>;
    sync_lifecycle_vectors: Array<SyncVector & {
        relative_path: string;
    }>;
}
describe('Pinned Reading immutable sync vectors', () => {
    const fixture: ReadingSyncFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../contracts/quartzo/reading_activity/vectors.json'), 'utf8'));
    it('executes the complete unique upstream matrix', () => {
        expect(fixture.path_vectors).toHaveLength(14);
        expect(fixture.sync_lifecycle_vectors).toHaveLength(15);
        expect(new Set(fixture.path_vectors.map(vector => vector.id)).size).toBe(14);
        expect(new Set(fixture.sync_lifecycle_vectors.map(vector => vector.id)).size).toBe(15);
    });
    for (const vector of fixture.path_vectors) {
        it(`path: ${vector.id}`, () => {
            expect(SyncEngine.immutableReadingHash(vector.path) !== null).toBe(vector.canonical);
        });
    }
    for (const vector of fixture.sync_lifecycle_vectors) {
        it(`lifecycle: ${vector.id}`, () => {
            // Runtime vectors use the vault-relative path as id. Legacy SyncVector.path
            // is file-scope fixture input and must not bypass reconciliation here.
            const result = SyncEngine.reconcile({ ...vector, id: vector.relative_path });
            expect(result.action).toBe(vector.expected);
        });
    }
});
