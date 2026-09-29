import { describe, expect, it } from 'vitest';
import { DailyScheduleEngine } from '../../src/core/daily_schedule';
import { ObjectParser } from '../../src/core/objects';
import { projectDayDial } from '../../src/ui/day-dial/projection';

function parsedObject(markdown: string, path: string): Record<string, unknown> {
  const parsed = ObjectParser.parse(markdown);
  return {
    ...(parsed.object as unknown as Record<string, unknown>),
    id: parsed.object.id,
    type: parsed.object.type,
    body: parsed.object.body,
    __path: path,
  };
}

describe('Day Dial persisted Markdown parity', () => {
  it('accepts legacy camelCase Time Block types from persisted Markdown', () => {
    const block = parsedObject(`---
id: morning
type: timeBlock
organizer_type: timeBlock
title: Manha
time_ranges:
  - start_hour: 7
    start_minute: 0
    end_hour: 11
    end_minute: 59
---
`, 'app/manha.md');

    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-06',
      objects: [block],
    });
    const projection = projectDayDial(schedule.items, { index: null });

    expect(block.type).toBe('time_block');
    expect(schedule.items).toHaveLength(1);
    expect(schedule.items[0]).toMatchObject({
      id: 'time_block:morning:range-0@2026-09-06',
      sourceType: 'time_block',
      start: '07:00',
      end: '11:59',
      isTimed: true,
    });
    expect(projection.invalidTimed).toEqual([]);
  });

  it('projects Habit slot reminders as timed items instead of invalid clockless dial entries', () => {
    const habit = parsedObject(`---
id: ritalina
type: habit
title: Ritalina
archived: false
slots:
  - completed: false
    reminders:
      - id: primary
        time_of_day: 09:08
        type: popup
  - completed: false
    reminders:
      - id: primary
        time_of_day: "12:47"
        type: popup
---
`, 'habits/ritalina.md');

    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-06',
      objects: [habit],
    });
    const projection = projectDayDial(schedule.items, { index: null });

    expect(schedule.items.map(item => ({
      id: item.id,
      start: item.start,
      isTimed: item.isTimed,
    }))).toEqual([
      {
        id: 'legacyTime:habit:ritalina:slot:0:reminder:slot_time:2026-09-06T09:08:00.000',
        start: '09:08',
        isTimed: true,
      },
      {
        id: 'legacyTime:habit:ritalina:slot:1:reminder:slot_time:2026-09-06T12:47:00.000',
        start: '12:47',
        isTimed: true,
      },
    ]);
    expect(projection.invalidTimed).toEqual([]);
  });

  it('falls back to an all-day Habit when slots have no canonical clock', () => {
    const habit = parsedObject(`---
id: water-plants
type: habit
title: Water plants
archived: false
slots:
  - completed: false
---
`, 'habits/water-plants.md');

    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-06',
      objects: [habit],
    });
    const projection = projectDayDial(schedule.items, { index: null });

    expect(schedule.items).toHaveLength(1);
    expect(schedule.items[0]).toMatchObject({
      id: 'habit:water-plants',
      isTimed: false,
    });
    expect(projection.invalidTimed).toEqual([]);
  });

  it('projects current time_ranges Markdown into canonical Time Block arcs', () => {
    const block = parsedObject(`---
id: deep-work
type: time_block
organizer_type: timeBlock
title: Deep work
time_ranges:
  - id: morning
    start_hour: 9
    start_minute: 0
    end_hour: 10
    end_minute: 0
  - id: afternoon
    start_hour: 13
    start_minute: 30
    end_hour: 14
    end_minute: 15
---
`, 'organizers/time_blocks/deep-work.md');

    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-06',
      objects: [block],
    });
    const projection = projectDayDial(schedule.items, { index: null });

    expect(schedule.items.map(item => item.id)).toEqual([
      'time_block:deep-work:morning@2026-09-06',
      'time_block:deep-work:afternoon@2026-09-06',
    ]);
    expect(projection.timed.map(item => [
      item.item.id,
      item.visual,
      item.startMinute,
      item.endMinute,
    ])).toEqual([
      ['time_block:deep-work:morning@2026-09-06', 'arc', 540, 600],
      ['time_block:deep-work:afternoon@2026-09-06', 'arc', 810, 855],
    ]);
    expect(projection.invalidTimed).toEqual([]);
  });

  it('clips overnight Time Block ranges to the selected civil day without changing occurrence identity', () => {
    const block = parsedObject(`---
id: sleep
type: time_block
organizer_type: timeBlock
title: Sleep
time_ranges:
  - id: overnight
    start_hour: 22
    start_minute: 0
    end_hour: 7
    end_minute: 0
---
`, 'organizers/time_blocks/sleep.md');

    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-07',
      objects: [block],
    });

    expect(schedule.items.map(item => ({
      id: item.id,
      start: item.start,
      end: item.end,
    }))).toEqual([
      {
        id: 'time_block:sleep:overnight@2026-09-06',
        start: '00:00',
        end: '07:00',
      },
      {
        id: 'time_block:sleep:overnight@2026-09-07',
        start: '22:00',
        end: '24:00',
      },
    ]);
  });

  it('projects persisted Event timing and daily scheduler through the canonical Daily Schedule', () => {
    const event = parsedObject(`---
id: standup
type: event
title: Standup
date: 2026-09-06
time_of_day: "10:00"
end_time: "10:30"
duration: 30
multi_day: false
scheduler:
  start_date: 2026-09-06T00:00:00.000
  rules:
    - repeat_type: number_of_days
      interval: 1
---
`, 'events/standup.md');

    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-07',
      objects: [event],
    });
    const projection = projectDayDial(schedule.items, { index: null });

    expect(schedule.items).toHaveLength(1);
    expect(schedule.items[0]).toMatchObject({
      id: 'event:standup',
      date: '2026-09-07',
      start: '10:00',
      end: '10:30',
      isTimed: true,
    });
    expect(projection.timed[0]).toMatchObject({
      visual: 'arc',
      startMinute: 600,
      endMinute: 630,
    });
  });
});
