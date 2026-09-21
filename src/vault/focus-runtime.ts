import { TFile, Vault } from 'obsidian';
import { ObjectParser } from '../core/objects';
import {
  advanceFocusPhase,
  createIdleFocusRuntimeState,
  finishFocusRuntime,
  focusPhaseIsDue,
  focusRuntimeToFrontmatter,
  parseFocusRuntimeFrontmatter,
  pauseFocusRuntime,
  startFocusRuntime,
  type FocusPhase,
  type FocusPresetSnapshot,
  type FocusRuntimeMode,
  type FocusRuntimeState,
  type FocusSessionDisposition,
  type FocusSessionEvidence,
} from '../core/focus-runtime';

export const FOCUS_RUNTIME_PATH = 'sessions/current.md';

export class FocusRuntimeRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<FocusRuntimeState> {
    const file = this.vault.getAbstractFileByPath(FOCUS_RUNTIME_PATH);
    if (file == null) return createIdleFocusRuntimeState();
    if (!(file instanceof TFile)) {
      throw new Error('Focus runtime path is not a file.');
    }
    const parsed = ObjectParser.parseMarkdown(await this.vault.read(file));
    const state = parseFocusRuntimeFrontmatter(parsed.frontmatter);
    if (!state) {
      throw new Error('sessions/current.md is not a canonical pomodoro_state.');
    }
    return state;
  }

  async mutate(
    transform: (current: FocusRuntimeState) => FocusRuntimeState,
  ): Promise<FocusRuntimeState> {
    const file = this.vault.getAbstractFileByPath(FOCUS_RUNTIME_PATH);
    if (file == null) {
      await this.ensureFolder('sessions');
      const next = transform(createIdleFocusRuntimeState());
      await this.vault.create(
        FOCUS_RUNTIME_PATH,
        ObjectParser.serializeMarkdown(
          focusRuntimeToFrontmatter(next),
          '# Pomodoro Current State',
        ),
      );
      return next;
    }
    if (!(file instanceof TFile)) {
      throw new Error('Focus runtime path is not a file.');
    }

    let output: FocusRuntimeState | null = null;
    await this.vault.process(file, current => {
      const parsed = ObjectParser.parseMarkdown(current);
      const state = parseFocusRuntimeFrontmatter(parsed.frontmatter);
      if (!state) {
        throw new Error('sessions/current.md is not a canonical pomodoro_state.');
      }
      const next = transform(state);
      output = next;
      return ObjectParser.serializeMarkdown(
        focusRuntimeToFrontmatter(next, parsed.frontmatter),
        parsed.body || '# Pomodoro Current State',
      );
    });
    if (!output) throw new Error('Focus runtime mutation produced no state.');
    return output;
  }

  async start(input: {
    localControllerId: string;
    sessionId: string;
    now: Date;
    mode?: FocusRuntimeMode;
    phase?: FocusPhase;
    preset?: FocusPresetSnapshot;
    currentItemId?: string;
    currentItemTitle?: string;
    linkedObjectRef?: Record<string, unknown>;
  }): Promise<FocusRuntimeState> {
    return this.mutate(current => startFocusRuntime(current, input));
  }

  async pause(
    localControllerId: string,
    now: Date,
  ): Promise<FocusRuntimeState> {
    return this.mutate(current =>
      pauseFocusRuntime(current, localControllerId, now)
    );
  }

  async advancePhase(input: {
    localControllerId: string;
    now: Date;
    skipped?: boolean;
  }): Promise<FocusRuntimeState> {
    return this.mutate(current => advanceFocusPhase(current, input));
  }

  async advancePhaseIfDue(
    localControllerId: string,
    now: Date,
  ): Promise<FocusRuntimeState> {
    return this.mutate(current => {
      if (!focusPhaseIsDue(current, now)) return current;
      return advanceFocusPhase(current, { localControllerId, now });
    });
  }

  async finish(input: {
    localControllerId: string;
    now: Date;
    disposition: FocusSessionDisposition;
  }): Promise<{ state: FocusRuntimeState; evidencePath?: string }> {
    const before = await this.load();
    const result = finishFocusRuntime(before, input);
    const evidencePath = result.evidence
      ? await this.saveSessionEvidence(result.evidence)
      : undefined;
    const state = await this.mutate(current => {
      if (
        current.currentSessionId !== before.currentSessionId
        || current.focusControllerId !== before.focusControllerId
      ) {
        throw new Error(
          'Focus runtime changed before finalization; refusing to overwrite it.',
        );
      }
      return finishFocusRuntime(current, input).state;
    });
    return { state, ...(evidencePath ? { evidencePath } : {}) };
  }

  private async saveSessionEvidence(
    evidence: FocusSessionEvidence,
  ): Promise<string> {
    const dateKey = evidence.occurred_at.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      throw new Error('Focus session evidence has an invalid occurrence date.');
    }
    const dailyPath = `daily/${dateKey}.md`;
    const file = this.vault.getAbstractFileByPath(dailyPath);
    if (file == null) {
      await this.ensureFolder('daily');
      await this.vault.create(
        dailyPath,
        ObjectParser.serializeMarkdown({
          type: 'daily',
          date: dateKey,
          pomodoro_sessions: [evidence],
        }, ''),
      );
      return dailyPath;
    }
    if (!(file instanceof TFile)) {
      throw new Error(`Daily note path is not a file: ${dailyPath}`);
    }
    await this.vault.process(file, current => {
      const parsed = ObjectParser.parseMarkdown(current);
      const raw = Array.isArray(parsed.frontmatter.pomodoro_sessions)
        ? parsed.frontmatter.pomodoro_sessions
        : [];
      const sessions = raw.filter(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
        return String((item as Record<string, unknown>).id ?? '') !== evidence.id;
      });
      return ObjectParser.serializeMarkdown({
        ...parsed.frontmatter,
        pomodoro_sessions: [...sessions, evidence],
      }, parsed.body);
    });
    return dailyPath;
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!this.vault.getAbstractFileByPath(folder)) {
      await this.vault.createFolder(folder);
    }
  }
}
