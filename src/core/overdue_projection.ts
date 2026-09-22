import { parseLocalIsoDate, localIsoDate } from './local-date';
import type { IndexedObject } from '../vault/index/types';

export type OverdueSeverity = 'none' | 'light' | 'moderate' | 'severe';
export type OverdueDeadlineMode = 'calendarDay' | 'instant';

export interface OverdueProjectionCandidate {
  sourceId: string;
  sourceType: string;
  deadline: string | null;
  deadlineMode: OverdueDeadlineMode;
  completed: boolean;
  archived: boolean;
}

export interface OverdueProjectionDecision {
  candidate: OverdueProjectionCandidate;
  daysLate: number;
  severity: OverdueSeverity;
}

export interface OverdueObjectProjection {
  object: IndexedObject;
  decision: OverdueProjectionDecision;
}

function dateOnly(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function parseCalendarDay(value: string | null): Date | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  try {
    return parseLocalIsoDate(date);
  } catch {
    return null;
  }
}

function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (match) {
    const day = parseLocalIsoDate(match[1]);
    return new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      Number(match[2]),
      Number(match[3]),
      Number(match[4] ?? '0'),
    );
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function overdueSeverityForDaysLate(daysLate: number): OverdueSeverity {
  if (daysLate <= 0) return 'none';
  if (daysLate <= 2) return 'light';
  if (daysLate <= 6) return 'moderate';
  return 'severe';
}

export function evaluateOverdueCandidate(
  candidate: OverdueProjectionCandidate,
  now: Date,
): OverdueProjectionDecision | null {
  if (candidate.archived || candidate.completed || candidate.deadline == null) return null;
  const today = dateOnly(now);
  const deadlineDay = parseCalendarDay(candidate.deadline);
  if (!deadlineDay) return null;

  const instant = candidate.deadlineMode === 'instant'
    ? parseInstant(candidate.deadline)
    : null;
  const isOverdue = candidate.deadlineMode === 'calendarDay'
    ? deadlineDay < today
    : instant != null && instant < now;
  if (!isOverdue) return null;

  const daysLate = Math.floor((today.getTime() - deadlineDay.getTime()) / 86_400_000);
  return {
    candidate,
    daysLate,
    severity: overdueSeverityForDaysLate(daysLate),
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function dateField(frontmatter: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(frontmatter[key]);
    if (value) return value;
  }
  return null;
}

function completed(type: string, frontmatter: Record<string, unknown>): boolean {
  if (frontmatter.completed === true || frontmatter.is_completed === true) return true;
  const stage = text(frontmatter.stage)?.toLowerCase();
  const state = text(frontmatter.state)?.toLowerCase();
  const status = text(frontmatter.status)?.toLowerCase();
  if (type === 'task') return stage === 'done' || stage === 'completed' || stage === 'finalized';
  if (type === 'goal') return state === 'completed' || state === 'cancelled';
  if (type === 'project') return state === 'completed' || state === 'archived' || status === 'completed' || status === 'archived';
  if (type === 'idea') return status === 'converted' || status === 'dropped';
  if (type === 'resource') return status === 'completed' || status === 'dropped';
  if (type === 'routine') return state === 'completed' || state === 'done';
  return false;
}

function reminderDeadline(frontmatter: Record<string, unknown>): string | null {
  const full = dateField(frontmatter, ['deadline', 'due_at', 'due']);
  if (full?.includes('T')) return full;
  const date = dateField(frontmatter, ['scheduled_date', 'date']);
  const time = text(frontmatter.time);
  if (!date || !time) return null;
  return `${date.slice(0, 10)}T${time}:00`;
}

export function candidateForOverdueObject(object: IndexedObject): OverdueProjectionCandidate | null {
  const sourceType = object.type;
  const frontmatter = object.frontmatter;
  const archived = frontmatter.archived === true || frontmatter.deleted === true || frontmatter._deleted === true;
  const base = {
    sourceId: object.id,
    sourceType,
    completed: completed(sourceType, frontmatter),
    archived,
  };

  if (sourceType === 'reminder') {
    return { ...base, deadline: reminderDeadline(frontmatter), deadlineMode: 'instant' };
  }
  if (sourceType === 'task') {
    return { ...base, deadline: dateField(frontmatter, ['deadline', 'due_date', 'due']), deadlineMode: 'calendarDay' };
  }
  if (sourceType === 'goal') {
    return { ...base, deadline: dateField(frontmatter, ['deadline', 'target_date']), deadlineMode: 'calendarDay' };
  }
  if (sourceType === 'project') {
    return { ...base, deadline: dateField(frontmatter, ['end_date', 'deadline']), deadlineMode: 'calendarDay' };
  }
  if (sourceType === 'idea') {
    return { ...base, deadline: dateField(frontmatter, ['target_date', 'deadline']), deadlineMode: 'calendarDay' };
  }
  if (sourceType === 'resource') {
    return { ...base, deadline: dateField(frontmatter, ['read_date', 'deadline']), deadlineMode: 'calendarDay' };
  }
  if (sourceType === 'routine') {
    return { ...base, deadline: dateField(frontmatter, ['end_date', 'deadline']), deadlineMode: 'calendarDay' };
  }
  return null;
}

export function projectOverdueObjects(
  objects: Iterable<IndexedObject>,
  now: Date,
): OverdueObjectProjection[] {
  const projected: OverdueObjectProjection[] = [];
  for (const object of objects) {
    const candidate = candidateForOverdueObject(object);
    if (!candidate) continue;
    const decision = evaluateOverdueCandidate(candidate, now);
    if (!decision) continue;
    projected.push({ object, decision });
  }
  return projected.sort((left, right) => {
    const severityOrder: Record<OverdueSeverity, number> = { none: 0, light: 1, moderate: 2, severe: 3 };
    return severityOrder[right.decision.severity] - severityOrder[left.decision.severity] ||
      right.decision.daysLate - left.decision.daysLate ||
      localIsoDate(parseCalendarDay(left.decision.candidate.deadline) ?? now)
        .localeCompare(localIsoDate(parseCalendarDay(right.decision.candidate.deadline) ?? now)) ||
      left.object.id.localeCompare(right.object.id);
  });
}
