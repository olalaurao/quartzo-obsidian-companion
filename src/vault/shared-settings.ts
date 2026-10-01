import { TFile, Vault } from 'obsidian';
import {
  SHARED_SETTINGS_PATH,
  normalizeSharedFolder,
  parseSharedSettings,
  type MarkerType,
  type ObjectIdentificationTransition,
  type QuartzoSharedSettings,
  type TypeSignature,
} from '../core/shared-settings';
import { ObjectParser } from '../core/objects';

export * from '../core/shared-settings';

export class SharedSettingsRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<QuartzoSharedSettings | null> {
    const file = this.vault.getAbstractFileByPath(SHARED_SETTINGS_PATH);
    if (!(file instanceof TFile)) return null;
    return parseSharedSettings(await this.vault.read(file));
  }

  async updateTypeSignature(objectType: string, patch: Partial<TypeSignature>): Promise<QuartzoSharedSettings> {
    return this.processSettings(current => {
      const frontmatter = { ...ObjectParser.parseMarkdown(current).frontmatter };
      const signatures = record(frontmatter.type_signatures);
      const existing = record(signatures[objectType]);
      const markerType = patch.markerType ?? existing.markerType;
      if (!isMarkerType(markerType)) throw new Error(`Invalid marker type for ${objectType}.`);
      const markerValue = String(patch.markerValue ?? existing.markerValue ?? '').trim();
      if (!markerValue) throw new Error(`Marker is required for ${objectType}.`);
      signatures[objectType] = {
        ...existing,
        objectType: String(patch.objectType ?? existing.objectType ?? objectType),
        markerType,
        markerValue: markerType === 'folder' ? normalizeSharedFolder(markerValue) : markerValue,
        ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
        ...(patch.iconName !== undefined ? { iconName: patch.iconName } : {}),
        ...(patch.colorHex !== undefined ? { colorHex: patch.colorHex } : {}),
      };
      frontmatter.type_signatures = signatures;
      ensurePriority(frontmatter, objectType);
      return ObjectParser.serializeMarkdown(frontmatter, ObjectParser.parseMarkdown(current).body);
    });
  }

  async moveTypePriority(objectType: string, direction: -1 | 1): Promise<QuartzoSharedSettings> {
    return this.processSettings(current => {
      const parsed = ObjectParser.parseMarkdown(current);
      const frontmatter = { ...parsed.frontmatter };
      const signatures = record(frontmatter.type_signatures);
      const currentPriority = Array.isArray(frontmatter.type_priority)
        ? frontmatter.type_priority.map(value => String(value))
        : Object.keys(signatures);
      for (const key of Object.keys(signatures)) {
        if (!currentPriority.includes(key)) currentPriority.push(key);
      }
      const index = currentPriority.indexOf(objectType);
      if (index < 0) throw new Error(`Unknown object type in Object Identification: ${objectType}`);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= currentPriority.length) return current;
      const next = [...currentPriority];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      frontmatter.type_priority = next;
      return ObjectParser.serializeMarkdown(frontmatter, parsed.body);
    });
  }

  /**
   * Revision-aware compare-before-write (§92).
   * Increments the Object Identification revision monotonically.
   * Fails if the current persisted revision does not match `expectedRevision`,
   * preventing stale overwrites.
   */
  async incrementRevision(expectedRevision: number): Promise<QuartzoSharedSettings> {
    return this.processSettings(current => {
      const parsed = ObjectParser.parseMarkdown(current);
      const frontmatter = { ...parsed.frontmatter };
      const oi = record(frontmatter.object_identification);
      const currentRevision = Number.isInteger(Number(oi.revision)) ? Number(oi.revision) : 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(
          `Object Identification revision conflict: expected ${expectedRevision}, found ${currentRevision}. Refresh preview before applying.`,
        );
      }
      frontmatter.object_identification = {
        ...oi,
        revision: currentRevision + 1,
      };
      return ObjectParser.serializeMarkdown(frontmatter, parsed.body);
    });
  }

  /**
   * Persists a transition state (§10) using compare-before-write.
   * Does not persist `planning` phase remotely — only applies, awaiting_transport, committing.
   * Pass `null` to clear the transition after commit.
   */
  async updateTransition(
    expectedRevision: number,
    transition: ObjectIdentificationTransition | null,
  ): Promise<QuartzoSharedSettings> {
    if (transition?.phase === 'planning') {
      // §10: planning phase is not persisted remotely
      const current = await this.load();
      if (!current) throw new Error('Shared Quartzo settings are missing.');
      return current;
    }
    return this.processSettings(current => {
      const parsed = ObjectParser.parseMarkdown(current);
      const frontmatter = { ...parsed.frontmatter };
      const oi = record(frontmatter.object_identification);
      const currentRevision = Number.isInteger(Number(oi.revision)) ? Number(oi.revision) : 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(
          `Object Identification revision conflict: expected ${expectedRevision}, found ${currentRevision}.`,
        );
      }
      if (transition === null) {
        // Commit: clear transition, advance to targetRevision
        const rawTransition = record(oi.transition);
        const targetRevision = Number(rawTransition.target_revision) || currentRevision + 1;
        frontmatter.object_identification = {
          ...oi,
          revision: targetRevision,
          transition: null,
        };
      } else {
        // Persist active transition
        frontmatter.object_identification = {
          ...oi,
          transition: serializeTransition(transition),
        };
      }
      return ObjectParser.serializeMarkdown(frontmatter, parsed.body);
    });
  }

  private async processSettings(update: (current: string) => string): Promise<QuartzoSharedSettings> {
    const file = this.vault.getAbstractFileByPath(SHARED_SETTINGS_PATH);
    if (!(file instanceof TFile)) {
      throw new Error('Shared Quartzo settings are missing. Create app/quartzo_shared_settings.md from Quartzo before editing Object Identification in Companion.');
    }

    let parsed: QuartzoSharedSettings | null = null;
    await this.vault.process(file, current => {
      const next = update(current);
      parsed = parseSharedSettings(next);
      if (!parsed) throw new Error('Updated shared settings did not validate.');
      return next;
    });
    if (!parsed) throw new Error('Shared settings update failed.');
    return parsed;
  }
}

function serializeTransition(transition: ObjectIdentificationTransition): Record<string, unknown> {
  return {
    operation_id: transition.operationId,
    object_type: transition.objectType,
    base_revision: transition.baseRevision,
    target_revision: transition.targetRevision,
    old_signature: transition.oldSignature,
    new_signature: transition.newSignature,
    phase: transition.phase,
    ...(transition.initiatedBy !== undefined ? { initiated_by: transition.initiatedBy } : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function isMarkerType(value: unknown): value is MarkerType {
  return value === 'folder' || value === 'tag' || value === 'property';
}

function ensurePriority(frontmatter: Record<string, unknown>, objectType: string): void {
  const priority = Array.isArray(frontmatter.type_priority)
    ? frontmatter.type_priority.map(value => String(value))
    : Object.keys(record(frontmatter.type_signatures));
  if (!priority.includes(objectType)) priority.push(objectType);
  frontmatter.type_priority = priority;
}


