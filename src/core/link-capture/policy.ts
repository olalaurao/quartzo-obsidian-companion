import { detectResourceMetadataSource, type ResourceMetadataSource } from '../resource-capture/policy';

export type LinkCaptureDestination = 'social_post' | 'recipe' | 'resource';
export type LinkCaptureConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface LinkCaptureSuggestion {
  destination: LinkCaptureDestination;
  confidence: LinkCaptureConfidence;
  reason: string;
  resourceMediaType?: string;
  socialPlatform?: string;
  socialMediaType?: 'video' | 'image' | 'carousel' | 'article' | 'newsletter' | 'other';
}

export interface LinkCaptureMetadata {
  sourceUrl?: string;
  resolvedUrl?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  authorName?: string;
  authorHandle?: string;
  publishedAt?: string;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function generic(confidence: LinkCaptureConfidence, reason: string): LinkCaptureSuggestion {
  return { destination: 'resource', confidence, reason, resourceMediaType: 'General' };
}

function social(
  socialPlatform: string,
  socialMediaType: NonNullable<LinkCaptureSuggestion['socialMediaType']>,
): LinkCaptureSuggestion {
  return { destination: 'social_post', confidence: 'high', reason: 'social_host', socialPlatform, socialMediaType };
}

function mediaTypeForResourceSource(source: ResourceMetadataSource): string {
  if (source === 'openLibrary' || source === 'googleBooks' || source === 'goodreads') return 'Book';
  if (source === 'imdb') return 'Movie';
  return 'General';
}

function socialSuggestion(uri: URL): LinkCaptureSuggestion | null {
  const host = uri.hostname.toLowerCase();
  if (hostMatches(host, 'instagram.com')) return social('instagram', uri.pathname.includes('/reel/') ? 'video' : 'image');
  if (hostMatches(host, 'tiktok.com')) return social('tiktok', 'video');
  if (hostMatches(host, 'youtube.com') || hostMatches(host, 'youtu.be')) return social('youtube', 'video');
  if (hostMatches(host, 'twitter.com') || hostMatches(host, 'x.com')) return social('twitter', 'other');
  if (hostMatches(host, 'reddit.com')) return social('reddit', 'other');
  if (hostMatches(host, 'linkedin.com')) return social('linkedin', 'article');
  if (hostMatches(host, 'pinterest.com')) return social('pinterest', 'image');
  if (hostMatches(host, 'substack.com')) return social('substack', 'newsletter');
  return null;
}

export function suggestLinkFromUrl(rawUrl: string): LinkCaptureSuggestion {
  let uri: URL;
  try {
    uri = new URL(rawUrl.trim());
  } catch {
    return generic('unknown', 'network_unavailable');
  }
  if (uri.protocol.toLowerCase() !== 'https:') return generic('unknown', 'network_unavailable');
  const socialHost = socialSuggestion(uri);
  if (socialHost) return socialHost;
  const source = detectResourceMetadataSource(uri.toString());
  if (source !== 'unknown') {
    return {
      destination: 'resource',
      confidence: 'high',
      reason: 'known_resource_provider',
      resourceMediaType: mediaTypeForResourceSource(source),
    };
  }
  return generic('low', 'generic_page');
}

export function suggestLinkFromHtml(html: string, pageUrl: string): LinkCaptureSuggestion {
  const urlSuggestion = suggestLinkFromUrl(pageUrl);
  if (urlSuggestion.reason === 'social_host' || urlSuggestion.reason === 'known_resource_provider' || urlSuggestion.confidence === 'unknown') {
    return urlSuggestion;
  }
  for (const node of extractJsonLdNodes(html)) {
    const suggestion = structuredSuggestion(node);
    if (suggestion) return suggestion;
  }
  const ogType = metaContent(html, 'property', 'og:type')?.toLowerCase();
  if (ogType?.includes('article')) return { destination: 'resource', confidence: 'medium', reason: 'open_graph_article', resourceMediaType: 'Article' };
  if (ogType?.includes('video')) return { destination: 'resource', confidence: 'medium', reason: 'open_graph_video', resourceMediaType: 'Video' };
  return generic('low', 'generic_page');
}

export function applyUserLinkSelection(
  suggested: LinkCaptureSuggestion,
  selected: Pick<LinkCaptureSuggestion, 'destination' | 'resourceMediaType' | 'socialPlatform' | 'socialMediaType'>,
): LinkCaptureSuggestion {
  return {
    destination: selected.destination,
    confidence: 'unknown',
    reason: 'manual_override',
    resourceMediaType: selected.destination === 'resource' ? (selected.resourceMediaType ?? suggested.resourceMediaType ?? 'General') : undefined,
    socialPlatform: selected.destination === 'social_post' ? selected.socialPlatform : undefined,
    socialMediaType: selected.destination === 'social_post' ? (selected.socialMediaType ?? 'other') : undefined,
  };
}

export function mergePristineMetadata<T extends Record<string, string | undefined>>(
  current: T,
  incoming: Partial<T>,
  dirtyFields: ReadonlySet<string>,
): T {
  const merged = { ...current };
  for (const [key, raw] of Object.entries(incoming) as Array<[keyof T & string, string | undefined]>) {
    if (dirtyFields.has(key)) continue;
    const next = raw?.trim();
    if (!next) continue;
    const existing = merged[key]?.trim() ?? '';
    if (!existing) merged[key] = next as T[keyof T & string];
  }
  return merged;
}

export function normalizeLinkCaptureUrl(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  let uri: URL;
  try {
    uri = new URL(text);
  } catch {
    return undefined;
  }
  uri.protocol = uri.protocol.toLowerCase();
  uri.hostname = uri.hostname.toLowerCase();
  uri.hash = '';
  for (const key of [...uri.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) uri.searchParams.delete(key);
  }
  uri.pathname = uri.pathname.replace(/\/+$/, '') || '/';
  return uri.toString().replace(/\/+$/, '');
}

export function extractCommonHtmlMetadata(html: string, pageUrl: string): LinkCaptureMetadata {
  let title = metaContent(html, 'property', 'og:title') ?? metaContent(html, 'name', 'twitter:title');
  title ??= html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  const description = metaContent(html, 'property', 'og:description') ?? metaContent(html, 'name', 'description');
  const imageRaw = metaContent(html, 'property', 'og:image') ?? metaContent(html, 'name', 'twitter:image');
  const imageUrl = safeHttpsUrl(imageRaw, pageUrl);
  const siteName = metaContent(html, 'property', 'og:site_name');
  const publishedAt = metaContent(html, 'property', 'article:published_time');
  return { sourceUrl: pageUrl, resolvedUrl: pageUrl, title, description, imageUrl, siteName, publishedAt };
}

export function extractJsonLdNodes(html: string): Array<Record<string, unknown>> {
  const matches = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const nodes: Array<Record<string, unknown>> = [];
  for (const match of matches) {
    try {
      nodes.push(...flattenJsonLd(JSON.parse(match[1].trim())));
    } catch {
      // Invalid JSON-LD is ignored; OpenGraph/generic fallback remains available.
    }
  }
  return nodes;
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const graph = Array.isArray(record['@graph']) ? record['@graph'].flatMap(flattenJsonLd) : [];
  return [record, ...graph];
}

function structuredSuggestion(node: Record<string, unknown>): LinkCaptureSuggestion | null {
  for (const type of schemaTypes(node['@type'])) {
    const normalized = type.toLowerCase();
    if (normalized === 'recipe') return { destination: 'recipe', confidence: 'high', reason: 'schema_org_recipe' };
    if (normalized === 'book') return resourceStructured('Book', 'schema_org_book');
    if (normalized === 'movie') return resourceStructured('Movie', 'schema_org_movie');
    if (normalized === 'tvseries') return resourceStructured('Show', 'schema_org_series');
    if (normalized === 'videoobject') return resourceStructured('Video', 'schema_org_video');
    if (normalized === 'podcastepisode' || normalized === 'podcastseries') return resourceStructured('Podcast', 'schema_org_podcast');
    if (normalized === 'article' || normalized === 'newsarticle' || normalized === 'blogposting') return resourceStructured('Article', 'schema_org_article');
    if (normalized === 'course') return resourceStructured('Course', 'schema_org_course');
  }
  return null;
}

function resourceStructured(resourceMediaType: string, reason: string): LinkCaptureSuggestion {
  return { destination: 'resource', confidence: 'high', reason, resourceMediaType };
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map(item => String(item));
  return [];
}

function metaContent(html: string, attr: 'name' | 'property', value: string): string | undefined {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(`<meta\\b(?=[^>]*\\b${attr}=["']${escaped}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`, 'i').exec(html)?.[1];
  return first?.trim() || undefined;
}

function safeHttpsUrl(value: string | undefined, base: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'https:' && url.hostname ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
