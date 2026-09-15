import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { OccurrenceActionsEngine } from '../../src/core/occurrence_actions';

interface Vector {
  id: string;
  action: string;
  expected: string;
  target?: string;
  duplicateActionId?: boolean;
}

describe('Occurrence Actions Contract Vectors', () => {
  const vectorsPath = path.join(__dirname, '../../contracts/quartzo/occurrence_actions/vectors.json');
  const vectors: Vector[] = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

  for (const vector of vectors) {
    it(`should pass vector ${vector.id}`, () => {
      const input = {
        action: vector.action,
        occurrenceId: 'test-occurrence',
        date: '2026-09-06',
        target: vector.target as 'habit_slot' | 'reminder' | undefined,
        duplicateActionId: vector.duplicateActionId,
        existingProcessedActions: vector.duplicateActionId ? ['done:test-occurrence'] : []
      };

      const result = vector.target 
        ? OccurrenceActionsEngine.processWithTarget(input)
        : OccurrenceActionsEngine.process(input);

      expect(result.outcome).toBe(vector.expected);
    });
  }
});
