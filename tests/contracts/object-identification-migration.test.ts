import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildObjectIdentificationMigrationPlan,
  planObjectIdentificationCandidate,
} from '../../src/core/object-identification-migration';
import type { TypeSignature } from '../../src/core/shared-settings';

const vectors = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'contracts', 'quartzo', 'object_identification_migration', 'vectors.json'),
    'utf8',
  ),
) as {
  cases: Array<{
    name: string;
    objectType: string;
    oldSignature: TypeSignature;
    newSignature: TypeSignature;
    candidate: { path: string; frontmatter: Record<string, unknown>; body: string };
    expected: {
      eligible: boolean;
      path: string;
      frontmatter: Record<string, unknown>;
      body: string;
      removeOldMarker: boolean;
      applyNewMarker: boolean;
      move: boolean;
    };
  }>;
  preflightCases: Array<{
    name: string;
    objectType: string;
    oldSignature: TypeSignature;
    newSignature: TypeSignature;
    existingPaths: string[];
    candidates: Array<{ path: string; frontmatter: Record<string, unknown>; body: string }>;
    expectedBlockers: string[];
  }>;
};

describe('Object Identification migration vectors', () => {
  for (const vector of vectors.cases) {
    it(vector.name, () => {
      const action = planObjectIdentificationCandidate(
        vector.oldSignature,
        vector.newSignature,
        { ...vector.candidate, originalMarkdown: 'fixture' },
      );
      if (!vector.expected.eligible) {
        expect(action).toBeNull();
        return;
      }
      expect(action).not.toBeNull();
      expect(action!.destinationPath).toBe(vector.expected.path);
      expect(action!.frontmatter).toEqual(vector.expected.frontmatter);
      expect(action!.body).toBe(vector.expected.body);
      expect(action!.removeOldMarker).toBe(vector.expected.removeOldMarker);
      expect(action!.applyNewMarker).toBe(vector.expected.applyNewMarker);
      expect(action!.moves).toBe(vector.expected.move);
    });
  }

  for (const vector of vectors.preflightCases) {
    it(vector.name, () => {
      const plan = buildObjectIdentificationMigrationPlan({
        objectType: vector.objectType,
        oldSignature: vector.oldSignature,
        newSignature: vector.newSignature,
        candidates: vector.candidates.map(candidate => ({ ...candidate, originalMarkdown: 'fixture' })),
        existingPaths: vector.existingPaths,
      });
      expect(plan.blockers.map(blocker => blocker.code)).toEqual(
        expect.arrayContaining(vector.expectedBlockers),
      );
    });
  }
});
