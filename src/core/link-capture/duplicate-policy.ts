import { normalizeLinkCaptureUrl } from './policy';

export interface RecipeIdentity {
  id?: string;
  type?: string;
  note_subtype?: string;
  source_url?: string;
  archived?: boolean;
}

export interface SocialPostIdentity {
  id?: string;
  type?: string;
  url?: string;
  archived?: boolean;
}

export function findRecipeDuplicates(candidateUrl: string | undefined, existing: readonly RecipeIdentity[]): string[] {
  const normalized = normalizeLinkCaptureUrl(candidateUrl);
  if (!normalized) return [];
  return existing
    .filter(item => item.archived !== true && item.type === 'note' && item.note_subtype === 'recipe')
    .filter(item => normalizeLinkCaptureUrl(item.source_url) === normalized)
    .map(item => item.id ?? '')
    .filter(Boolean);
}

export function findSocialPostDuplicates(candidateUrl: string | undefined, existing: readonly SocialPostIdentity[]): string[] {
  const normalized = normalizeLinkCaptureUrl(candidateUrl);
  if (!normalized) return [];
  return existing
    .filter(item => item.archived !== true && item.type === 'social_post')
    .filter(item => normalizeLinkCaptureUrl(item.url) === normalized)
    .map(item => item.id ?? '')
    .filter(Boolean);
}
