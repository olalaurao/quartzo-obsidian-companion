import { describe, expect, it } from 'vitest';
import { parseDailyPlanningStates } from '../../src/core/adaptive_planning';
import { parseOccurrenceTimeOverrides, upsertOccurrenceTimeOverrideInMarkdown } from '../../src/core/occurrence_reschedule';

describe('DailyPlanningState shard parsing', () => {
  it('loads exact essentials, parked IDs and capacity mode from the shared planning shard', () => {
    const states = parseDailyPlanningStates(`---
type: shared_planning_state
schema_version: 1
daily_planning_states:
  2026-09-06:
    capacity_mode: low
    minimum_plan_active: true
    essential_occurrence_ids:
      - task:essential@2026-09-06
    parked_occurrence_ids:
      - task:parked@2026-09-06
    leave_space_reserve_minutes: 30
    updated_at: 2026-09-06T07:00:00.000
---
# Shared Planning State V1`);

    expect(states['2026-09-06']).toMatchObject({
      capacityMode: 'low',
      minimumPlanActive: true,
      essentialOccurrenceIds: ['task:essential@2026-09-06'],
      parkedOccurrenceIds: ['task:parked@2026-09-06'],
      leaveSpaceReserveMinutes: 30,
    });
  });

  it('loads legacy missing optional sets as closed defaults', () => {
    const states = parseDailyPlanningStates(`---
type: shared_planning_state
daily_planning_states:
  2026-09-06:
    updated_at: 2026-09-06T07:00:00.000
---
# Shared Planning State V1`);

    expect(states['2026-09-06']).toMatchObject({
      capacityMode: 'auto',
      essentialOccurrenceIds: [],
      parkedOccurrenceIds: [],
      acknowledgedFellBehindIds: [],
      minimumPlanDeferredIds: [],
      leaveSpaceReserveMinutes: 0,
    });
  });

  it('keeps time overrides and DailyPlanningState in the same preserved shard', () => {
    const updated = upsertOccurrenceTimeOverrideInMarkdown(`---
type: shared_planning_state
schema_version: 1
daily_planning_states:
  2026-09-06:
    capacity_mode: high
    essential_occurrence_ids:
      - task:essential@2026-09-06
    updated_at: 2026-09-06T07:00:00.000
---
# Shared Planning State V1`, {
      occurrenceId: 'task:recurring@2026-09-06',
      sourceId: 'recurring',
      scope: 'single',
      startAtOverride: '2026-09-06T13:00:00.000',
      endAtOverride: '2026-09-06T14:00:00.000',
      updatedAt: '2026-09-06T12:00:00.000',
    });

    expect(parseOccurrenceTimeOverrides(updated)['task:recurring@2026-09-06']).toBeDefined();
    expect(parseDailyPlanningStates(updated)['2026-09-06']?.capacityMode).toBe('high');
    expect(parseDailyPlanningStates(updated)['2026-09-06']?.essentialOccurrenceIds).toEqual(['task:essential@2026-09-06']);
  });
});
