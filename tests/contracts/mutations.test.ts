import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ObjectParser } from '../../src/core/objects/parser';

interface PriorityVector {
  id: string;
  type: string;
  modelType: string;
  unknownField: string;
}

describe('Object Mutation Contract Vectors', () => {
  const priorityVectorsPath = path.join(__dirname, '../../contracts/quartzo/object_fixtures/priority_vectors.json');
  const priorityVectors: PriorityVector[] = JSON.parse(fs.readFileSync(priorityVectorsPath, 'utf8'));

  for (const vector of priorityVectors) {
    it(`should handle title mutation with unknown field preservation for ${vector.type}: ${vector.id}`, () => {
      const originalMarkdown = `---
id: test-${vector.type}
type: ${vector.modelType}
title: Original Title
${vector.unknownField}: original_value
---
Original body`;

      // Parse original
      const originalResult = ObjectParser.parse(originalMarkdown);
      expect(originalResult.unknownFields).toContain(vector.unknownField);
      expect((originalResult.object as Record<string, unknown>)[vector.unknownField]).toBe('original_value');

      // Perform title mutation
      const mutatedObject = { ...originalResult.object, title: 'Mutated Title' };

      // Serialize mutated object with unknown field preserved
      const unknownFieldsMap: Record<string, unknown> = {};
      for (const field of originalResult.unknownFields) {
        unknownFieldsMap[field] = (originalResult.object as Record<string, unknown>)[field];
      }
      const mutatedMarkdown = ObjectParser.serialize(mutatedObject, unknownFieldsMap);

      // Reparse mutated markdown
      const reparsedResult = ObjectParser.parse(mutatedMarkdown);

      // Verify mutation won
      expect(reparsedResult.object.title).toBe('Mutated Title');

      // Verify unknown field survived
      expect(reparsedResult.unknownFields).toContain(vector.unknownField);
      expect((reparsedResult.object as Record<string, unknown>)[vector.unknownField]).toBe('original_value');
    });
  }
});
