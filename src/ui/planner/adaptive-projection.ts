import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import { defaultDailyPlanningState, type DailyPlanningState, type DayCapacityMode } from '../../core/adaptive_planning';
import { localIsoDate } from '../../core/local-date';
import { OccurrenceActionPolicy } from '../../core/occurrence_actions';

export type AdaptiveTemporalState =
  | 'active'
  | 'upcoming'
  | 'fellBehind'
  | 'completed'
  | 'skipped';

export interface AdaptivePlannerItem {
  item: NormalizedItem;
  temporalState: AdaptiveTemporalState;
}

export interface AdaptivePlannerProjection {
  now: AdaptivePlannerItem[];
  next: AdaptivePlannerItem[];
  later: AdaptivePlannerItem[];
  fellBehind: AdaptivePlannerItem[];
  essentials: AdaptivePlannerItem[];
  capacityMode: DayCapacityMode;
  capacity: null;
  essentialOccurrenceIds: string[];
  parkedOccurrenceIds: string[];
  numericCapacityShared: false;
}

const NEXT_COUNT = 3;

function clockMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function policyInput(item: NormalizedItem) {
  const start = clockMinutes(item.start);
  const end = clockMinutes(item.end);
  return {
    sourceType: item.sourceType,
    outcome: item.outcome,
    completable: item.isCompletable,
    playable: item.isPlayable,
    reminderId: item.reminderId,
    temporalKind: item.isTimed ? 'interval' as const : 'instant' as const,
    durationMinutes: start != null && end != null && end > start ? end - start : undefined,
    restrictionMetadata: item.restrictionMetadata,
    completed: item.isCompleted,
  };
}

function temporalState(item: NormalizedItem, selectedDate: string, now: Date): AdaptiveTemporalState {
  if (item.outcome === 'done') return 'completed';
  if (item.outcome === 'skipped') return 'skipped';

  const today = localIsoDate(now);
  if (selectedDate > today) return 'upcoming';
  if (selectedDate < today) return OccurrenceActionPolicy.isRecoveryEligible(policyInput(item)) ? 'fellBehind' : 'upcoming';

  if (!item.isTimed || item.isAllDay) return 'upcoming';
  const start = clockMinutes(item.start);
  if (start == null) return 'upcoming';
  const end = clockMinutes(item.end);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start <= current && end != null && current < end) return 'active';
  if (start > current) return 'upcoming';
  if (OccurrenceActionPolicy.isRecoveryEligible(policyInput(item))) return 'fellBehind';
  return 'upcoming';
}

function fixedRank(item: NormalizedItem): boolean {
  if (item.origin === 'externalEvent') return true;
  return item.restrictionMetadata?.rigidity === 'fixed';
}

function deadlineRank(item: NormalizedItem): boolean {
  return item.restrictionMetadata?.has_real_deadline === true ||
    item.restrictionMetadata?.rigidity === 'deadline';
}

function startRank(item: NormalizedItem): number {
  return clockMinutes(item.start) ?? Number.MAX_SAFE_INTEGER;
}

function nextScore(entry: AdaptivePlannerItem): number {
  let score = 0;
  if (fixedRank(entry.item)) score += 100;
  if (deadlineRank(entry.item)) score += 50;
  return score;
}

/**
 * Read-only Adaptive Day projection over the same canonical Daily Schedule used
 * by Timeline/Home/Day Dial. It ports the upstream Now/Next/Later/Fell Behind
 * ordering that can be proven from Companion inputs.
 *
 * DailyPlanningState is the sole source for Essentials/Parked/Capacity mode.
 * Numeric capacity is not shared in V1, so it remains unavailable/null.
 */
export function projectAdaptivePlanner(
  schedule: NormalizedSchedule,
  selectedDate: string,
  now: Date,
  planningState: DailyPlanningState = defaultDailyPlanningState(selectedDate),
): AdaptivePlannerProjection {
  const parkedIds = new Set(planningState.parkedOccurrenceIds);
  const resolved: AdaptivePlannerItem[] = [];
  for (const item of schedule.items) {
    const capabilities = OccurrenceActionPolicy.resolve(policyInput(item));
    if (capabilities.isEvidence) continue;
    const occurrenceId = item.actionOccurrenceId ?? item.occurrenceId ?? item.id;
    if (parkedIds.has(occurrenceId)) continue;
    resolved.push({ item, temporalState: temporalState(item, selectedDate, now) });
  }

  const active = resolved.filter(entry => entry.temporalState === 'active');
  const upcoming = resolved
    .filter(entry => entry.temporalState === 'upcoming')
    .sort((a, b) => startRank(a.item) - startRank(b.item) || a.item.id.localeCompare(b.item.id));
  const fellBehind = resolved
    .filter(entry => entry.temporalState === 'fellBehind')
    .filter(entry => OccurrenceActionPolicy.isRecoveryEligible(policyInput(entry.item)))
    .sort((a, b) => startRank(a.item) - startRank(b.item) || a.item.id.localeCompare(b.item.id));

  let nowItems: AdaptivePlannerItem[] = [];
  const running = active.find(entry => OccurrenceActionPolicy.resolve(policyInput(entry.item)).canStart);
  if (running) nowItems = [running];
  else if (active.length > 0) nowItems = [active[0]];
  else {
    const fixed = upcoming.find(entry => fixedRank(entry.item));
    if (fixed) nowItems = [fixed];
    else {
      const actionable = upcoming.find(entry => {
        const capabilities = OccurrenceActionPolicy.resolve(policyInput(entry.item));
        return capabilities.canReportDone || capabilities.canStart;
      });
      if (actionable) nowItems = [actionable];
      else if (upcoming.length > 0) nowItems = [upcoming[0]];
    }
  }

  const nowIds = new Set(nowItems.map(entry => entry.item.id));
  const nextCandidates = upcoming.filter(entry => !nowIds.has(entry.item.id));
  const next = [...nextCandidates]
    .sort((a, b) => nextScore(b) - nextScore(a) ||
      startRank(a.item) - startRank(b.item) ||
      a.item.id.localeCompare(b.item.id))
    .slice(0, NEXT_COUNT);
  const nextIds = new Set(next.map(entry => entry.item.id));
  const later = nextCandidates.filter(entry => !nextIds.has(entry.item.id));
  const visible = [...nowItems, ...next, ...later, ...fellBehind];
  const visibleByOccurrenceId = new Map(visible.map(entry => [
    entry.item.actionOccurrenceId ?? entry.item.occurrenceId ?? entry.item.id,
    entry,
  ]));

  return {
    now: nowItems,
    next,
    later,
    fellBehind,
    essentials: planningState.essentialOccurrenceIds
      .map(id => visibleByOccurrenceId.get(id))
      .filter((entry): entry is AdaptivePlannerItem => entry != null),
    capacityMode: planningState.capacityMode,
    capacity: null,
    essentialOccurrenceIds: planningState.essentialOccurrenceIds,
    parkedOccurrenceIds: planningState.parkedOccurrenceIds,
    numericCapacityShared: false,
  };
}
