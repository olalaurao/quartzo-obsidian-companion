import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateOverdueCandidate,
  projectOverdueObjects,
  type OverdueProjectionCandidate,
} from '../../src/core/overdue_projection';
import type { IndexedObject } from '../../src/vault/index/types';

interface Vector {
  id: string;
  input: {
    now: string;
    candidate: OverdueProjectionCandidate;
  };
  expected: {
    is_overdue: boolean;
    days_late?: number;
    severity?: string;
  };
}

function object(id: string, type: string, frontmatter: Record<string, unknown>): IndexedObject {
  return { id, type, path: `${type}/${id}.md`, frontmatter: { id, type, ...frontmatter }, body: '' };
}

function candidate(raw: Record<string, unknown>): OverdueProjectionCandidate {
  return {
    sourceId: String(raw.source_id),
    sourceType: String(raw.source_type),
    deadline: raw.deadline == null ? null : String(raw.deadline),
    deadlineMode: raw.deadline_mode === 'instant' ? 'instant' : 'calendarDay',
    completed: raw.completed === true,
    archived: raw.archived === true,
  };
}

describe('Overdue projection contract', () => {
  const vectorsPath = path.join(__dirname, '../../contracts/quartzo/overdue_projection/vectors.json');
  const vectors: Vector[] = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

  for (const vector of vectors) {
    it(`passes vector ${vector.id}`, () => {
      const decision = evaluateOverdueCandidate(
        candidate(vector.input.candidate as unknown as Record<string, unknown>),
        new Date(vector.input.now),
      );
      expect(decision != null).toBe(vector.expected.is_overdue);
      if (decision) {
        expect(decision.daysLate).toBe(vector.expected.days_late);
        expect(decision.severity).toBe(vector.expected.severity);
      }
    });
  }

  it('projects only real deadlines and keeps planned slots out of Overdue', () => {
    const projected = projectOverdueObjects([
      object('planned', 'task', { start_date: '2026-09-05', scheduled_time: '09:00' }),
      object('deadline', 'task', { deadline: '2026-09-05', title: 'Real deadline' }),
      object('done', 'task', { deadline: '2026-09-05', stage: 'done' }),
      object('reminder', 'reminder', { scheduled_date: '2026-09-06', time: '09:30' }),
    ], new Date(2026, 8, 6, 10, 0));

    expect(projected.map(item => item.object.id)).toEqual(['deadline', 'reminder']);
    expect(projected.map(item => item.decision.candidate.deadlineMode)).toEqual(['calendarDay', 'instant']);
  });
});
