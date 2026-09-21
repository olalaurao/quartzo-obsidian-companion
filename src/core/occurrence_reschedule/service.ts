import { OccurrenceActionPolicy } from '../occurrence_actions';
import type {
  OccurrenceReschedulePlan,
  OccurrenceRescheduleTarget,
} from './types';

function localDate(value: Date): string {
  return [
    value.getFullYear().toString().padStart(4, '0'),
    (value.getMonth() + 1).toString().padStart(2, '0'),
    value.getDate().toString().padStart(2, '0'),
  ].join('-');
}

function localClock(value: Date): string {
  return `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}`;
}

export function localPlanningIso(value: Date): string {
  return `${localDate(value)}T${localClock(value)}:${value.getSeconds().toString().padStart(2, '0')}.${value.getMilliseconds().toString().padStart(3, '0')}`;
}

export function planOccurrenceReschedule(
  target: OccurrenceRescheduleTarget,
  newStart: Date,
  newEnd: Date,
  now = new Date(),
): OccurrenceReschedulePlan {
  if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime())) {
    throw new Error('Choose a valid start and end time.');
  }
  const durationMinutes = Math.floor((newEnd.getTime() - newStart.getTime()) / 60_000);
  if (durationMinutes < 1 || durationMinutes > 10_080) {
    throw new Error('Reschedule duration must be between 1 minute and 7 days.');
  }

  const capabilities = OccurrenceActionPolicy.resolve({
    sourceType: target.sourceType,
    outcome: target.outcome,
    completable: target.isCompletable,
    playable: target.isPlayable,
    editable: target.editable,
    reminderId: target.reminderId,
    restrictionMetadata: target.restrictionMetadata,
  });
  if (!capabilities.canReplan) {
    throw new Error('This occurrence cannot be rescheduled safely.');
  }

  if (target.sourceType === 'task' && !target.seriesId) {
    return {
      storage: 'source_task',
      patch: {
        set: {
          start_date: `${localDate(newStart)}T00:00:00.000`,
          scheduled_time: localClock(newStart),
          duration: durationMinutes,
        },
      },
    };
  }

  return {
    storage: 'shared_planning_override',
    override: {
      occurrenceId: target.occurrenceId,
      sourceId: target.sourceId,
      scope: 'single',
      startAtOverride: localPlanningIso(newStart),
      endAtOverride: localPlanningIso(newEnd),
      updatedAt: localPlanningIso(now),
    },
  };
}
