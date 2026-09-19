import { ObjectParser } from '../objects';
import type { OccurrenceActionTarget } from './types';
import { companionOccurrenceDomainMode } from './companion-support';

function occurrenceDate(target: OccurrenceActionTarget, fallback: Date): string {
  const match = target.occurrenceId.match(/@(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (match) return match[1];
  return [
    fallback.getFullYear().toString().padStart(4, '0'),
    (fallback.getMonth() + 1).toString().padStart(2, '0'),
    fallback.getDate().toString().padStart(2, '0'),
  ].join('-');
}

function localIso(value: Date): string {
  const year = value.getFullYear().toString().padStart(4, '0');
  const month = (value.getMonth() + 1).toString().padStart(2, '0');
  const day = value.getDate().toString().padStart(2, '0');
  const hour = value.getHours().toString().padStart(2, '0');
  const minute = value.getMinutes().toString().padStart(2, '0');
  const second = value.getSeconds().toString().padStart(2, '0');
  const milli = value.getMilliseconds().toString().padStart(3, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milli}`;
}

function encodeHabitEvent(
  actionId: string,
  completedAt: Date,
  recordedAt: Date,
  slotIndex: number | undefined,
): string {
  return [
    encodeURIComponent(actionId),
    localIso(completedAt),
    localIso(recordedAt),
    'planner',
    slotIndex == null ? '' : String(slotIndex),
    encodeURIComponent(actionId),
  ].join('|');
}

interface HabitHistoryLine {
  index: number;
  date: string;
  completions: number;
  goal: number;
  suffix: string;
}

function findHabitHistoryLine(lines: string[], date: string): HabitHistoryLine | null {
  const pattern = /^- \[(?:x|~| )\] (\d{4}-\d{2}-\d{2}) \((\d+)\/(\d+)\)(.*)$/;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(pattern);
    if (match?.[1] !== date) continue;
    return {
      index,
      date,
      completions: Number(match[2]),
      goal: Number(match[3]),
      suffix: match[4] ?? '',
    };
  }
  return null;
}

function suffixToken(suffix: string, key: string): string | undefined {
  const match = suffix.match(new RegExp(`(?:^|\\s)${key}:([^\\s]+)`));
  return match?.[1];
}

function preservedHabitSuffix(suffix: string): string {
  return suffix
    .replace(/\s+completed_at:[^\s]+/g, '')
    .replace(/\s+events:[^\s]+/g, '')
    .replace(/\s+skipped:true/g, '')
    .trim();
}

function mutateHabitCompletion(
  body: string,
  frontmatter: Record<string, unknown>,
  target: OccurrenceActionTarget,
  completedAt: Date,
  recordedAt: Date,
  actionId: string,
): string {
  const date = occurrenceDate(target, completedAt);
  const dailyGoal = Number.isInteger(frontmatter.daily_goal) && Number(frontmatter.daily_goal) > 0
    ? Number(frontmatter.daily_goal)
    : 1;
  const lines = body.split('\n');
  const existing = findHabitHistoryLine(lines, date);
  const encodedEvent = encodeHabitEvent(actionId, completedAt, recordedAt, target.slotIndex);

  if (existing) {
    const existingEvents = suffixToken(existing.suffix, 'events')?.split(',').filter(Boolean) ?? [];
    if (existingEvents.some(event => decodeURIComponent(event.split('|')[0] ?? '') === actionId)) {
      return body;
    }
    const events = [...existingEvents, encodedEvent];
    const completions = target.slotIndex == null
      ? Math.max(existing.completions + 1, events.length)
      : Math.max(existing.completions + 1, 1);
    const skipped = /(?:^|\s)skipped:true(?:\s|$)/.test(existing.suffix);
    const preserved = preservedHabitSuffix(existing.suffix);
    const suffix = [
      preserved,
      `completed_at:${localIso(completedAt)}`,
      `events:${events.join(',')}`,
      ...(skipped ? ['skipped:true'] : []),
    ].filter(Boolean).join(' ');
    const successful = completions >= dailyGoal && !skipped;
    lines[existing.index] = `- [${skipped ? '~' : successful ? 'x' : ' '}] ${date} (${completions}/${dailyGoal}) ${suffix}`.trimEnd();
    return lines.join('\n');
  }

  const historyHeading = lines.findIndex(line => line.trim() === '## History');
  const newLine = `- [${dailyGoal <= 1 ? 'x' : ' '}] ${date} (1/${dailyGoal}) completed_at:${localIso(completedAt)} events:${encodedEvent}`;
  if (historyHeading >= 0) {
    lines.splice(historyHeading + 1, 0, newLine);
    return lines.join('\n');
  }
  const prefix = body.trimEnd();
  return `${prefix}${prefix ? '\n\n' : ''}## History\n${newLine}`;
}

function mutateHabitClear(
  body: string,
  frontmatter: Record<string, unknown>,
  target: OccurrenceActionTarget,
): string {
  const dueAt = new Date(target.dueAt);
  const date = occurrenceDate(target, Number.isNaN(dueAt.getTime()) ? new Date() : dueAt);
  const lines = body.split('\n');
  const existing = findHabitHistoryLine(lines, date);
  if (!existing) return body;

  const dailyGoal = Number.isInteger(frontmatter.daily_goal) && Number(frontmatter.daily_goal) > 0
    ? Number(frontmatter.daily_goal)
    : Math.max(1, existing.goal);
  const nextCompletions = target.slotIndex == null
    ? 0
    : Math.max(0, existing.completions - 1);
  const events = suffixToken(existing.suffix, 'events');
  const preserved = preservedHabitSuffix(existing.suffix);
  const suffix = [
    preserved,
    ...(events ? [`events:${events}`] : []),
  ].filter(Boolean).join(' ');
  lines[existing.index] = `- [ ] ${date} (${nextCompletions}/${dailyGoal})${suffix ? ` ${suffix}` : ''}`;
  return lines.join('\n');
}

function sourceId(frontmatter: Record<string, unknown>): string {
  return String(frontmatter.id ?? '').trim();
}

export function completeOccurrenceDomainMarkdown(
  markdown: string,
  target: OccurrenceActionTarget,
  completedAt: Date,
  recordedAt: Date,
  actionId: string,
): string {
  const mode = companionOccurrenceDomainMode(target.sourceType);
  if (mode === 'response_only') return markdown;
  if (mode === 'unsupported') {
    throw new Error(`Companion does not yet support the required domain mutation for ${target.sourceType}.`);
  }

  const parsed = ObjectParser.parseMarkdown(markdown);
  if (sourceId(parsed.frontmatter) !== target.sourceId) {
    throw new Error('Occurrence source identity changed before mutation.');
  }
  const frontmatter = { ...parsed.frontmatter };
  let body = parsed.body;

  switch (target.sourceType) {
    case 'task':
      if (frontmatter.scheduler == null) {
        frontmatter.stage = 'finalized';
        if (frontmatter.reflection == null) {
          frontmatter.reflection = 'Completed from occurrence action.';
        }
      }
      break;
    case 'habit':
      body = mutateHabitCompletion(body, frontmatter, target, completedAt, recordedAt, actionId);
      break;
    case 'reminder':
      if (frontmatter.scheduler == null) frontmatter.is_completed = true;
      break;
    case 'event':
      if (frontmatter.scheduler == null) frontmatter.state = 'completed';
      break;
    case 'person':
    case 'personContact':
    case 'person_contact':
      frontmatter.last_contact_date = localIso(completedAt);
      break;
    case 'goal':
    case 'goalStart':
    case 'goal_start':
    case 'goalDeadline':
    case 'goal_deadline':
      if (target.occurrenceId.startsWith('goalDeadline:') || target.sourceType.includes('Deadline')) {
        frontmatter.state = 'completed';
      }
      break;
  }

  return ObjectParser.serializeMarkdown(frontmatter, body);
}

export function clearOccurrenceDomainMarkdown(
  markdown: string,
  target: OccurrenceActionTarget,
): string {
  const mode = companionOccurrenceDomainMode(target.sourceType);
  if (mode === 'response_only') return markdown;
  if (mode === 'unsupported') {
    throw new Error(`Companion does not yet support the required domain mutation for ${target.sourceType}.`);
  }

  const parsed = ObjectParser.parseMarkdown(markdown);
  if (sourceId(parsed.frontmatter) !== target.sourceId) {
    throw new Error('Occurrence source identity changed before mutation.');
  }
  const frontmatter = { ...parsed.frontmatter };
  let body = parsed.body;

  switch (target.sourceType) {
    case 'task':
      if (frontmatter.scheduler == null) {
        frontmatter.stage = 'todo';
        delete frontmatter.completion_ref;
      }
      break;
    case 'habit':
      body = mutateHabitClear(body, frontmatter, target);
      break;
    case 'reminder':
      if (frontmatter.scheduler == null) frontmatter.is_completed = false;
      break;
    case 'event':
      if (frontmatter.scheduler == null) frontmatter.state = 'scheduled';
      break;
    case 'goal':
    case 'goalStart':
    case 'goal_start':
    case 'goalDeadline':
    case 'goal_deadline':
      if (target.occurrenceId.startsWith('goalDeadline:') || target.sourceType.includes('Deadline')) {
        frontmatter.state = 'active';
      }
      break;
    case 'person':
    case 'personContact':
    case 'person_contact':
      // Upstream has no Person clear adapter. The shared response is cleared,
      // but contact history is not guessed backwards.
      break;
  }

  return ObjectParser.serializeMarkdown(frontmatter, body);
}
