import { describe, expect, it } from 'vitest';
import {
  parseOccurrenceResponses,
  replaceOccurrenceResponsesInMarkdown,
} from '../../src/core/occurrence_actions';

describe('shared occurrence state codec', () => {
  it('roundtrips canonical responses while preserving unknown top-level and response fields', () => {
    const original = `---
schema_version: 1
type: shared_occurrence_state
future_top: keep-me
occurrence_responses:
  "task:1@2026-09-19":
    occurrence_id: "task:1@2026-09-19"
    source_id: task-1
    completed_at: "2026-09-19T10:00:00.000Z"
    ignored_count: 2
    processed_action_ids: [a1]
    future_response:
      keep: true
---
# Shared Occurrence State V1
Do not erase this body.
`;

    const parsed = parseOccurrenceResponses(original);
    expect(parsed['task:1@2026-09-19']).toMatchObject({
      occurrenceId: 'task:1@2026-09-19',
      sourceId: 'task-1',
      ignoredCount: 2,
      processedActionIds: ['a1'],
    });
    expect(parsed['task:1@2026-09-19'].unknownFields).toEqual({
      future_response: { keep: true },
    });

    const updated = replaceOccurrenceResponsesInMarkdown(
      original,
      parsed,
      new Date('2026-09-19T12:00:00.000Z'),
    );
    expect(updated).toContain('future_top: keep-me');
    expect(updated).toContain('future_response:');
    expect(updated).toContain('Do not erase this body.');
    expect(parseOccurrenceResponses(updated)['task:1@2026-09-19'].completedAt)
      .toBe('2026-09-19T10:00:00.000Z');
  });

  it('fails closed when the map key and persisted occurrence identity disagree', () => {
    const invalid = `---
type: shared_occurrence_state
occurrence_responses:
  wrong-key:
    occurrence_id: right-key
---
# Shared Occurrence State V1
`;
    expect(() => parseOccurrenceResponses(invalid)).toThrow('key mismatch');
  });
});
