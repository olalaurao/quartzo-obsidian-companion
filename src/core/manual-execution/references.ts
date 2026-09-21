import type { ManualExecutionStep } from './types';

export interface ManualExecutionObject {
  id: string;
  type: string;
  title: string;
  frontmatter: Record<string, unknown>;
}

export interface ManualExecutionReferenceResolution {
  byStepId: Map<string, ManualExecutionObject>;
}

const ACCENTS: Record<string, string> = {
  'à':'a','á':'a','â':'a','ã':'a','ä':'a','è':'e','é':'e','ê':'e','ë':'e',
  'ì':'i','í':'i','î':'i','ï':'i','ò':'o','ó':'o','ô':'o','õ':'o','ö':'o',
  'ù':'u','ú':'u','û':'u','ü':'u','ç':'c','ñ':'n',
};

export function canonicalObjectSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .split('')
    .map(character => ACCENTS[character] ?? character)
    .join('')
    .replace(/ /g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function trackerHasField(object: ManualExecutionObject, fieldId: string): boolean {
  const sections = object.frontmatter.sections;
  if (!Array.isArray(sections)) return false;
  return sections.some(section => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false;
    const raw = section as Record<string, unknown>;
    const fields = raw.input_fields ?? raw.fields;
    if (!Array.isArray(fields)) return false;
    return fields.some(field => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) return false;
      const data = field as Record<string, unknown>;
      return String(data.id ?? data.slug ?? '').trim() === fieldId;
    });
  });
}

export function resolveManualExecutionReferences(
  steps: readonly ManualExecutionStep[],
  objects: Iterable<ManualExecutionObject>,
): ManualExecutionReferenceResolution {
  const candidates = [...objects];
  const byStepId = new Map<string, ManualExecutionObject>();

  for (const step of steps) {
    if (!['habit', 'task', 'tracker_entry'].includes(step.kind)) continue;
    const slug = step.linkedObjectSlug?.trim();
    if (!slug) throw new Error(`Checklist step ${step.id} has no linked object.`);
    const expectedType = step.kind === 'tracker_entry' ? 'tracker_definition' : step.kind;
    const linked = candidates.find(object =>
      object.type === expectedType && canonicalObjectSlug(object.title) === slug
    );
    if (!linked) {
      throw new Error(`Linked ${expectedType} “${slug}” is not available.`);
    }
    if (step.kind === 'tracker_entry') {
      const fieldId = step.trackerFieldId?.trim();
      if (!fieldId || !trackerHasField(linked, fieldId)) {
        throw new Error(`Linked Tracker field “${fieldId ?? ''}” is not available.`);
      }
    }
    byStepId.set(step.id, linked);
  }

  return { byStepId };
}
