import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
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
