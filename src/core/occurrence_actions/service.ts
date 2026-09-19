import type {
  CanonicalOccurrenceAction,
  CanonicalOccurrenceActionResult,
  OccurrenceActionTarget,
  OccurrenceDomainClear,
  OccurrenceDomainCompletion,
  OccurrenceResponseState,
  OccurrenceResponseStore,
} from './types';

export interface OccurrenceActionServiceOptions {
  store: OccurrenceResponseStore;
  completeDomainOccurrence?: OccurrenceDomainCompletion;
  clearDomainOccurrence?: OccurrenceDomainClear;
}

function cloneResponse(response: OccurrenceResponseState): OccurrenceResponseState {
  return {
    ...response,
    processedActionIds: [...response.processedActionIds],
    unknownFields: response.unknownFields ? { ...response.unknownFields } : undefined,
  };
}

function initialResponse(target: OccurrenceActionTarget): OccurrenceResponseState {
  return {
    occurrenceId: target.occurrenceId,
    sourceId: target.sourceId,
    reminderId: target.reminderId,
    slotIndex: target.slotIndex,
    dueAt: target.dueAt,
    ignoredCount: 0,
    processedActionIds: [],
  };
}

export class OccurrenceActionService {
  private mutationChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: OccurrenceActionServiceOptions) {}

  async completeNow(
    target: OccurrenceActionTarget,
    actionId: string,
    now: Date,
  ): Promise<CanonicalOccurrenceActionResult> {
    return this.completeAt(target, actionId, now, now, 'done');
  }

  async completeAt(
    target: OccurrenceActionTarget,
    actionId: string,
    completedAt: Date,
    recordedAt: Date,
    action: CanonicalOccurrenceAction = 'already_did',
  ): Promise<CanonicalOccurrenceActionResult> {
    if (completedAt.getTime() > recordedAt.getTime()) {
      throw new Error('Already did cannot record a future completion.');
    }
    return this.mutate(
      target,
      actionId,
      action,
      response => ({
        ...response,
        completedAt: completedAt.toISOString(),
        recordedAt: recordedAt.toISOString(),
        skippedAt: undefined,
        snoozedUntil: undefined,
        dismissedAt: undefined,
      }),
      async () => {
        await this.options.completeDomainOccurrence?.(
          target,
          completedAt,
          recordedAt,
          actionId,
        );
      },
    );
  }

  async skip(
    target: OccurrenceActionTarget,
    actionId: string,
    skippedAt: Date,
  ): Promise<CanonicalOccurrenceActionResult> {
    return this.mutate(target, actionId, 'skip', response => ({
      ...response,
      skippedAt: skippedAt.toISOString(),
      completedAt: undefined,
      recordedAt: undefined,
      snoozedUntil: undefined,
      dismissedAt: undefined,
    }));
  }

  async clearOutcome(
    target: OccurrenceActionTarget,
    actionId: string,
  ): Promise<CanonicalOccurrenceActionResult> {
    return this.mutate(
      target,
      actionId,
      'clear',
      response => ({
        ...response,
        completedAt: undefined,
        skippedAt: undefined,
        recordedAt: undefined,
      }),
      async () => {
        await this.options.clearDomainOccurrence?.(target);
      },
    );
  }

  async snooze(
    target: OccurrenceActionTarget,
    actionId: string,
    now: Date,
    durationMs: number,
  ): Promise<CanonicalOccurrenceActionResult> {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('Snooze must be positive.');
    }
    return this.snoozeUntil(
      target,
      actionId,
      new Date(now.getTime() + durationMs),
    );
  }

  async snoozeUntil(
    target: OccurrenceActionTarget,
    actionId: string,
    snoozedUntil: Date,
  ): Promise<CanonicalOccurrenceActionResult> {
    return this.mutate(target, actionId, 'snooze', response => ({
      ...response,
      snoozedUntil: snoozedUntil.toISOString(),
      dismissedAt: undefined,
    }));
  }

  async dismissDelivery(
    target: OccurrenceActionTarget,
    actionId: string,
    dismissedAt: Date,
  ): Promise<CanonicalOccurrenceActionResult> {
    return this.mutate(target, actionId, 'dismiss', response => ({
      ...response,
      dismissedAt: dismissedAt.toISOString(),
      ignoredCount: response.ignoredCount + 1,
    }));
  }

  private mutate(
    target: OccurrenceActionTarget,
    actionId: string,
    action: CanonicalOccurrenceAction,
    apply: (response: OccurrenceResponseState) => OccurrenceResponseState,
    afterSave?: () => Promise<void>,
  ): Promise<CanonicalOccurrenceActionResult> {
    const run = this.mutationChain.then(
      () => this.applyMutation(target, actionId, action, apply, afterSave),
      () => this.applyMutation(target, actionId, action, apply, afterSave),
    );
    this.mutationChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async applyMutation(
    target: OccurrenceActionTarget,
    actionId: string,
    action: CanonicalOccurrenceAction,
    apply: (response: OccurrenceResponseState) => OccurrenceResponseState,
    afterSave?: () => Promise<void>,
  ): Promise<CanonicalOccurrenceActionResult> {
    const normalizedActionId = actionId.trim();
    if (!normalizedActionId) throw new Error('actionId is required.');

    const previousResponses = await this.options.store.loadResponses();
    const existing = cloneResponse(
      previousResponses[target.occurrenceId] ?? initialResponse(target),
    );

    if (existing.processedActionIds.includes(normalizedActionId)) {
      return {
        action,
        occurrenceId: target.occurrenceId,
        applied: false,
        idempotentReplay: true,
        responseState: existing,
      };
    }

    const nextResponse = apply(existing);
    nextResponse.sourceId = target.sourceId;
    nextResponse.reminderId = target.reminderId;
    nextResponse.slotIndex = target.slotIndex;
    nextResponse.dueAt = target.dueAt;
    nextResponse.processedActionIds = [
      ...new Set([...existing.processedActionIds, normalizedActionId]),
    ];

    const nextResponses = {
      ...previousResponses,
      [target.occurrenceId]: nextResponse,
    };

    await this.options.store.replaceResponses(nextResponses);
    try {
      await afterSave?.();
    } catch (error) {
      await this.options.store.replaceResponses(previousResponses);
      throw error;
    }

    return {
      action,
      occurrenceId: target.occurrenceId,
      applied: true,
      idempotentReplay: false,
      responseState: nextResponse,
    };
  }
}
