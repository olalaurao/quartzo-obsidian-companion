import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SyncEngine } from '../../src/core/sync';

interface SyncVector {
  id: string;
  baseHash?: string | null;
  localHash?: string | null;
  remoteHash?: string | null;
  localExists?: boolean;
  remoteExists?: boolean;
  duplicateRemoteIdentity?: boolean;
  postWriteExpectedHash?: string;
  path?: string;
  contentEncoding?: string;
  expected: string;
}

describe('Sync Protocol Contract Vectors', () => {
  const vectorsPath = path.join(__dirname, '../../contracts/quartzo/sync/vectors.json');
  const vectors: SyncVector[] = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

  for (const vector of vectors) {
    it(`should pass vector ${vector.id}`, () => {
      const result = SyncEngine.reconcile(vector);
      
      expect(result.action).toBe(vector.expected);
      
      // Verify additional result properties based on expected action
      if (vector.expected === 'conflict') {
        expect(result.conflict).toBe(true);
      }
      if (vector.expected === 'adoption_required') {
        expect(result.adoptionRequired).toBe(true);
      }
      if (vector.expected === 'fail_closed') {
        expect(result.failClosed).toBe(true);
      }
    });
  }
});
