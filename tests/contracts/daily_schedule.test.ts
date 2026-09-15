import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DailyScheduleEngine } from '../../src/core/daily_schedule';

interface Vector {
  id: string;
  kind: string;
  input: {
    date: string;
    today?: string;
    objects?: Array<Record<string, unknown>>;
    googleEvents?: Array<Record<string, unknown>>;
  };
  expectedNormalized: {
    kind: string;
    count: number;
    items: Array<Record<string, unknown>>;
  };
}

describe('Daily Schedule Contract Vectors', () => {
  const vectorsPath = path.join(__dirname, '../../contracts/quartzo/daily_schedule/vectors.json');
  const vectors: Vector[] = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

  for (const vector of vectors) {
    it(`should pass vector ${vector.id} (${vector.kind})`, () => {
      const result = DailyScheduleEngine.normalize(vector.input);
      
      expect(result.kind).toBe(vector.expectedNormalized.kind);
      expect(result.count).toBe(vector.expectedNormalized.count);
      
      // Check items match
      expect(result.items.length).toBe(vector.expectedNormalized.items.length);
      
      for (let i = 0; i < result.items.length; i++) {
        const actualItem = result.items[i];
        const expectedItem = vector.expectedNormalized.items[i];
        
        for (const [key, expectedValue] of Object.entries(expectedItem)) {
          const actualValue = (actualItem as unknown as Record<string, unknown>)[key];
          expect(actualValue).toEqual(expectedValue);
        }
      }
    });
  }
});
