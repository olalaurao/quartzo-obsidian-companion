import { describe, expect, it } from 'vitest';
import {
  OccurrenceActionService,
  type OccurrenceActionTarget,
  type OccurrenceResponseState,
  type OccurrenceResponseStore,
} from '../../src/core/occurrence_actions';

class MemoryStore implements OccurrenceResponseStore {
  responses: Record<string, OccurrenceResponseState> = {};
  async loadResponses() {
    return Object.fromEntries(
      Object.entries(this.responses).map(([key, value]) => [
        key,
        { ...value, processedActionIds: [...value.processedActionIds] },
      ]),
    );
  }
  async replaceResponses(responses: Record<string, OccurrenceResponseState>) {
    this.responses = await new MemoryStoreSnapshot(responses).loadResponses();
  }
}

class MemoryStoreSnapshot extends MemoryStore {
  constructor(responses: Record<string, OccurrenceResponseState>) {
    super();
    this.responses = responses;
  }
}

const target: OccurrenceActionTarget = {
  occurrenceId: 'habit:water@2026-09-19',
  sourceId: 'habit-water',
  sourceType: 'habit',
  reminderId: 'primary',
  slotIndex: 1,
  dueAt: '2026-09-19T09:00:00.000Z',
};

describe('OccurrenceActionService', () => {
  it('persists Done and treats an identical actionId replay as an idempotent no-op', async () => {
    const store = new MemoryStore();
    const service = new OccurrenceActionService({ store });
    const now = new Date('2026-09-19T10:00:00.000Z');

    const first = await service.completeNow(target, 'work-pc:done-1', now);
    const replay = await service.completeNow(target, 'work-pc:done-1', new Date('2026-09-19T10:01:00.000Z'));

    expect(first.applied).toBe(true);
    expect(first.responseState.completedAt).toBe(now.toISOString());
    expect(first.responseState.sourceId).toBe(target.sourceId);
    expect(first.responseState.reminderId).toBe(target.reminderId);
    expect(first.responseState.slotIndex).toBe(1);
    expect(replay.applied).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(store.responses[target.occurrenceId].processedActionIds).toEqual(['work-pc:done-1']);
  });

  it('keeps Done and Skip mutually exclusive and Clear removes only the outcome', async () => {
    const store = new MemoryStore();
    const service = new OccurrenceActionService({ store });

    await service.completeNow(target, 'done', new Date('2026-09-19T10:00:00.000Z'));
    await service.snoozeUntil(target, 'snooze', new Date('2026-09-19T11:00:00.000Z'));
    await service.skip(target, 'skip', new Date('2026-09-19T10:05:00.000Z'));

    let response = store.responses[target.occurrenceId];
    expect(response.completedAt).toBeUndefined();
    expect(response.recordedAt).toBeUndefined();
    expect(response.skippedAt).toBe('2026-09-19T10:05:00.000Z');
    expect(response.snoozedUntil).toBeUndefined();

    await service.snoozeUntil(target, 'snooze-2', new Date('2026-09-19T12:00:00.000Z'));
    await service.clearOutcome(target, 'clear');
    response = store.responses[target.occurrenceId];
    expect(response.completedAt).toBeUndefined();
    expect(response.skippedAt).toBeUndefined();
    expect(response.recordedAt).toBeUndefined();
    expect(response.snoozedUntil).toBe('2026-09-19T12:00:00.000Z');
  });

  it('rolls back shared occurrence state if the canonical domain completion callback fails', async () => {
    const store = new MemoryStore();
    const service = new OccurrenceActionService({
      store,
      completeDomainOccurrence: async () => {
        throw new Error('domain write failed');
      },
    });

    await expect(
      service.completeNow(target, 'done-fails', new Date('2026-09-19T10:00:00.000Z')),
    ).rejects.toThrow('domain write failed');
    expect(store.responses).toEqual({});
  });

  it('rejects Already did timestamps in the future', async () => {
    const service = new OccurrenceActionService({ store: new MemoryStore() });
    await expect(
      service.completeAt(
        target,
        'future',
        new Date('2026-09-20T00:00:00.000Z'),
        new Date('2026-09-19T00:00:00.000Z'),
      ),
    ).rejects.toThrow('future completion');
  });
});
