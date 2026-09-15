import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ObjectParser } from '../../src/core/objects/parser';

interface Fixture {
  id: string;
  type: string;
  path: string;
  markdown: string;
  expected: Record<string, unknown>;
}

describe('Object Roundtrip Contract Vectors', () => {
  const fixturesPath = path.join(__dirname, '../../contracts/quartzo/object_fixtures/fixtures.json');
  const fixtures: Fixture[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  for (const fixture of fixtures) {
    if (fixture.type === 'daily_note') {
      it(`should parse daily_note as raw/read-only: ${fixture.id}`, () => {
        const result = ObjectParser.parse(fixture.markdown);
        expect(result.object.type).toBe('daily_note');
        expect(result.object.id).toBe(fixture.expected.id);
        expect(result.object.title).toBe(fixture.expected.title);
        expect(result.object.body).toBe(fixture.expected.body);
      });
      continue;
    }

    it(`should roundtrip ${fixture.type}: ${fixture.id}`, () => {
      const result = ObjectParser.roundtrip(fixture.markdown);
      
      // Parse the result to verify it's valid
      const parsed = ObjectParser.parse(result);
      
      // Verify basic fields
      expect(parsed.object.id).toBe(fixture.expected.id);
      expect(parsed.object.type).toBe(fixture.expected.type);
      expect(parsed.object.title).toBe(fixture.expected.title);
      
      // Verify expected fields match
      for (const [key, expectedValue] of Object.entries(fixture.expected)) {
        const actualValue = (parsed.object as Record<string, unknown>)[key];
        expect(actualValue).toEqual(expectedValue);
      }
    });
  }
});

describe('Unknown Field Preservation', () => {
  const priorityVectorsPath = path.join(__dirname, '../../contracts/quartzo/object_fixtures/priority_vectors.json');
  const priorityVectors = JSON.parse(fs.readFileSync(priorityVectorsPath, 'utf8'));

  for (const vector of priorityVectors) {
    it(`should preserve unknown field for ${vector.type}: ${vector.id}`, () => {
      const markdown = `---
id: test-${vector.type}
type: ${vector.modelType}
title: Test
${vector.unknownField}: some_value
---
Body`;
      
      const result = ObjectParser.parse(markdown);
      expect(result.unknownFields).toContain(vector.unknownField);
      expect((result.object as Record<string, unknown>)[vector.unknownField]).toBe('some_value');
      
      // Verify roundtrip preserves unknown field
      const serialized = ObjectParser.serialize(result.object, { [vector.unknownField]: 'some_value' });
      const reparsed = ObjectParser.parse(serialized);
      expect((reparsed.object as Record<string, unknown>)[vector.unknownField]).toBe('some_value');
    });
  }
});
