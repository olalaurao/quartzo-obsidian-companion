import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ObjectParser } from '../../src/core/objects';
import {
  canMutateFocusRuntime,
  completeFocusPhase,
  createIdleFocusRuntimeState,
  findChecklistPomodoroEvidence,
  focusChecklistLinkId,
  focusRemainingSeconds,
  focusRuntimeToFrontmatter,
  focusStopwatchElapsedSeconds,
  isChecklistPomodoroEvidence,
  parseFocusPresetSnapshot,
  parseFocusRuntimeFrontmatter,
  resolveFocusRuntimeControl,
  finishFocusRuntime,
  pauseFocusRuntime,
  startFocusRuntime,
  type FocusRuntimeClientKind,
  type FocusPhase,
} from '../../src/core/focus-runtime';

type Vector = Record<string, unknown> & { id: string; case: string };

describe('Focus runtime V1 contract vectors', () => {
  const vectorsPath = path.join(
    process.cwd(),
    'contracts',
    'quartzo',
    'focus_runtime',
    'vectors.json',
  );
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8')) as Vector[];

  for (const vector of vectors) {
    it(`passes vector ${vector.id}`, () => {
      switch (vector.case) {
        case 'control_capability': {
          const capability = resolveFocusRuntimeControl({
            clientKind: String(vector.client_kind) as FocusRuntimeClientKind,
            currentSessionId: vector.current_session_id == null
              ? undefined
              : String(vector.current_session_id),
            persistedControllerId: vector.persisted_controller_id == null
              ? undefined
              : String(vector.persisted_controller_id),
            localControllerId: String(vector.local_controller_id),
          });
          expect(capability).toBe(vector.expected_capability);
          expect(canMutateFocusRuntime(capability)).toBe(vector.expected_can_mutate);
          return;
        }
        case 'timer_remaining':
          expect(focusRemainingSeconds({
            isRunning: vector.is_running === true,
            totalSeconds: Number(vector.total_seconds),
            now: new Date(String(vector.now)),
            phaseEndsAt: vector.phase_ends_at == null
              ? undefined
              : String(vector.phase_ends_at),
            pausedRemainingSeconds: vector.paused_remaining_seconds == null
              ? undefined
              : Number(vector.paused_remaining_seconds),
          })).toBe(vector.expected_seconds);
          return;
        case 'stopwatch_elapsed':
          expect(focusStopwatchElapsedSeconds({
            isRunning: vector.is_running === true,
            elapsedBeforeCurrentRun: Number(vector.elapsed_before_current_run),
            now: new Date(String(vector.now)),
            stopwatchStartedAt: vector.stopwatch_started_at == null
              ? undefined
              : String(vector.stopwatch_started_at),
          })).toBe(vector.expected_seconds);
          return;
        case 'phase_transition': {
          const preset = parseFocusPresetSnapshot(vector.preset);
          const transition = completeFocusPhase({
            phase: String(vector.phase) as FocusPhase,
            completedWorkIntervals: Number(vector.completed_work_intervals),
            preset,
          });
          const expected = vector.expected as Record<string, unknown>;
          expect(transition.nextPhase).toBe(expected.next_phase);
          expect(transition.nextDurationMinutes).toBe(expected.next_duration_minutes);
          expect(transition.completedWorkIntervals)
            .toBe(expected.completed_work_intervals);
          return;
        }
        case 'checklist_link_identity':
          expect(focusChecklistLinkId(
            String(vector.parent_object_id),
            String(vector.step_id),
          )).toBe(vector.expected_linked_item_slug);
          return;
        case 'checklist_evidence': {
          const session = vector.session as Record<string, unknown>;
          expect(isChecklistPomodoroEvidence({
            parentObjectId: String(vector.parent_object_id),
            stepId: String(vector.step_id),
            evaluationDate: String(vector.evaluation_date),
            session,
          })).toBe(vector.expected_completed);
          const result = findChecklistPomodoroEvidence({
            parentObjectId: String(vector.parent_object_id),
            stepId: String(vector.step_id),
            evaluationDate: String(vector.evaluation_date),
            objects: [{
              type: 'daily_note',
              frontmatter: { pomodoro_sessions: [session] },
            }],
          });
          expect(result.completed).toBe(vector.expected_completed);
          return;
        }
        default:
          throw new Error(`Unhandled Focus runtime vector case: ${vector.case}`);
      }
    });
  }

  it('current-state codec preserves unknown fields and clears idle controller claim', () => {
    const state = parseFocusRuntimeFrontmatter({
      type: 'pomodoro_state',
      isRunning: true,
      runtimeMode: 'pomodoro',
      currentType: 'work',
      currentSessionId: 'pomo-1',
      focusControllerId: 'desktop-a',
      phaseEndsAt: '2026-09-21T10:20:00.000',
      preset_snapshot: {
        preset_id: 'focus',
        name: '25/5',
        work_minutes: 25,
        short_break_minutes: 5,
        long_break_minutes: 15,
        long_break_every: 4,
      },
      future_key: 'preserve-me',
    });
    expect(state?.focusControllerId).toBe('desktop-a');
    const idle = {
      ...(state ?? createIdleFocusRuntimeState()),
      isRunning: false,
      currentSessionId: undefined,
      focusControllerId: undefined,
    };
    const encoded = focusRuntimeToFrontmatter(idle, {
      future_key: 'preserve-me',
    });
    expect(encoded.future_key).toBe('preserve-me');
    expect(encoded.focusControllerId).toBeNull();
  });
});

describe('Focus runtime lifecycle compatibility', () => {
  it('indexes Quartzo type: daily notes by date without inventing a second parser', () => {
    const parsed = ObjectParser.parse(`---
type: daily
date: 2026-09-21
pomodoro_sessions:
  - id: pomo-1
    linked_item: checklist:routine-morning:deep-work
    state: completed
    occurred_at: 2026-09-21T08:30:00.000
---
`);
    expect(parsed.object.type).toBe('daily_note');
    expect(parsed.object.id).toBe('2026-09-21');
    expect((parsed.object as Record<string, unknown>).pomodoro_sessions)
      .toBeDefined();
  });

  it('starts, pauses and finishes an owned checklist Focus session as completed evidence', () => {
    const idle = createIdleFocusRuntimeState({
      presetId: 'focus',
      name: '25/5',
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
    });
    const started = startFocusRuntime(idle, {
      localControllerId: 'desktop-a',
      sessionId: 'pomo-checklist',
      now: new Date('2026-09-21T08:00:00.000'),
      currentItemId: 'checklist:routine-morning:deep-work',
      currentItemTitle: 'Deep work',
    });
    expect(started.focusControllerId).toBe('desktop-a');
    expect(started.isRunning).toBe(true);

    const paused = pauseFocusRuntime(
      started,
      'desktop-a',
      new Date('2026-09-21T08:10:00.000'),
    );
    expect(paused.isRunning).toBe(false);
    expect(paused.pausedRemainingSeconds).toBe(900);

    const resumed = startFocusRuntime(paused, {
      localControllerId: 'desktop-a',
      sessionId: 'pomo-checklist',
      now: new Date('2026-09-21T08:12:00.000'),
    });
    const finished = finishFocusRuntime(resumed, {
      localControllerId: 'desktop-a',
      now: new Date('2026-09-21T08:17:00.000'),
      disposition: 'finish',
    });
    expect(finished.evidence?.id).toBe('pomo-checklist');
    expect(finished.evidence?.linked_item)
      .toBe('checklist:routine-morning:deep-work');
    expect(finished.evidence?.state).toBe('completed');
    expect(finished.evidence?.worked).toBe(15);
    expect(finished.state.currentSessionId).toBeUndefined();
    expect(finished.state.focusControllerId).toBeUndefined();
  });

  it('partial Focus evidence never counts as checklist completion', () => {
    const idle = createIdleFocusRuntimeState();
    const started = startFocusRuntime(idle, {
      localControllerId: 'desktop-a',
      sessionId: 'pomo-partial',
      now: new Date('2026-09-21T08:00:00.000'),
      currentItemId: 'checklist:routine-morning:deep-work',
    });
    const result = finishFocusRuntime(started, {
      localControllerId: 'desktop-a',
      now: new Date('2026-09-21T08:05:00.000'),
      disposition: 'savePartial',
    });
    expect(result.evidence?.state).toBe('partial');
    expect(isChecklistPomodoroEvidence({
      parentObjectId: 'routine-morning',
      stepId: 'deep-work',
      evaluationDate: '2026-09-21T09:00:00.000',
      session: result.evidence as unknown as Record<string, unknown>,
    })).toBe(false);
  });

  it('rejects mutation of a foreign active runtime', () => {
    const foreign = {
      ...createIdleFocusRuntimeState(),
      currentSessionId: 'foreign-session',
      focusControllerId: 'desktop-b',
      isRunning: true,
      phaseStartedAt: '2026-09-21T08:00:00.000',
      phaseEndsAt: '2026-09-21T08:25:00.000',
      phaseDurationSeconds: 1500,
    };
    expect(() => pauseFocusRuntime(
      foreign,
      'desktop-a',
      new Date('2026-09-21T08:05:00.000'),
    )).toThrow(/another device/i);
  });
});

