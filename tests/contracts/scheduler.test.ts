import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SchedulerEngine, SchedulerDefinition, SchedulerContext } from '../../src/core/scheduler';

interface Vector {
  id: string;
  repeatType: string;
  input: {
    scheduler: SchedulerDefinition;
    after: string;
    date: string;
    context?: SchedulerContext;
  };
  expected: {
    next: string | null;
    shouldFire: boolean;
  };
}

describe('Scheduler Contract Vectors', () => {
  const vectorsPath = path.join(__dirname, '../../contracts/quartzo/scheduler/vectors.json');
  const vectors: Vector[] = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

  for (const vector of vectors) {
    it(`should pass vector ${vector.id} (${vector.repeatType})`, () => {
      const result = SchedulerEngine.evaluate(
        vector.input.scheduler,
        vector.input.after,
        vector.input.date,
        vector.input.context
      );
      
      expect(result.next).toBe(vector.expected.next);
      expect(result.shouldFire).toBe(vector.expected.shouldFire);
    });
  }
});
