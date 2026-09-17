export type ResourceMetadataSource =
  | 'openLibrary'
  | 'googleBooks'
  | 'imdb'
  | 'amazon'
  | 'goodreads'
  | 'unknown';

export type ResourceDuplicateReason =
  | 'sourceUrl'
  | 'isbn'
  | 'googleBooksId'
  | 'imdbId'
  | 'title';

export interface ResourceIdentity {
  id?: string;
  title: string;
  mediaType?: string;
  media_type?: string;
  sourceUrl?: string;
  source_url?: string;
  isbn?: string;
  googleBooksId?: string;
  google_books_id?: string;
  imdbId?: string;
  imdb_id?: string;
  archived?: boolean;
}

export interface ResourceDuplicateCandidate {
  id: string;
  reasons: ResourceDuplicateReason[];
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectResourceMetadataSource(url: string): ResourceMetadataSource {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return 'unknown';
  }

  if (parsed.protocol.toLowerCase() !== 'https:' || !parsed.hostname) {
    return 'unknown';
  }

  const host = parsed.hostname.toLowerCase();
  if (hostMatches(host, 'openlibrary.org')) return 'openLibrary';
  if (
    hostMatches(host, 'books.google.com') ||
    (hostMatches(host, 'play.google.com') && parsed.pathname.startsWith('/store/books'))
  ) {
    return 'googleBooks';
  }
  if (hostMatches(host, 'imdb.com')) return 'imdb';
  if (hostMatches(host, 'amazon.com') || hostMatches(host, 'amazon.com.br')) {
    return 'amazon';
  }
  if (hostMatches(host, 'goodreads.com')) return 'goodreads';
  return 'unknown';
}

export function isFetchableResourceUrl(url: string): boolean {
  return detectResourceMetadataSource(url) !== 'unknown';
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizedOptional(value: string | undefined, normalizeUrl = false): string {
  let normalized = value?.trim() ?? '';
  if (normalizeUrl) normalized = normalized.replace(/\/+$/, '');
  return normalized.toLowerCase();
}

function sameNonEmpty(
  left: string | undefined,
  right: string | undefined,
  normalizeUrl = false,
): boolean {
  const a = normalizedOptional(left, normalizeUrl);
  const b = normalizedOptional(right, normalizeUrl);
  return a.length > 0 && b.length > 0 && a === b;
}

function mediaType(resource: ResourceIdentity): string {
  return resource.mediaType ?? resource.media_type ?? '';
}

function sourceUrl(resource: ResourceIdentity): string | undefined {
  return resource.sourceUrl ?? resource.source_url;
}

function googleBooksId(resource: ResourceIdentity): string | undefined {
  return resource.googleBooksId ?? resource.google_books_id;
}

function imdbId(resource: ResourceIdentity): string | undefined {
  return resource.imdbId ?? resource.imdb_id;
}

/**
 * Duplicate detection only. This policy never merges or overwrites a Resource;
 * callers must surface candidates and require an explicit user choice.
 */
export function findResourceDuplicates(
  candidate: ResourceIdentity,
  existing: readonly ResourceIdentity[],
): ResourceDuplicateCandidate[] {
  const results: ResourceDuplicateCandidate[] = [];

  for (const resource of existing) {
    if (resource.archived === true) continue;

    const reasons: ResourceDuplicateReason[] = [];
    if (sameNonEmpty(sourceUrl(candidate), sourceUrl(resource), true)) reasons.push('sourceUrl');
    if (sameNonEmpty(candidate.isbn, resource.isbn)) reasons.push('isbn');
    if (sameNonEmpty(googleBooksId(candidate), googleBooksId(resource))) reasons.push('googleBooksId');
    if (sameNonEmpty(imdbId(candidate), imdbId(resource))) reasons.push('imdbId');
    if (
      normalizeText(candidate.title) === normalizeText(resource.title) &&
      normalizeText(mediaType(candidate)) === normalizeText(mediaType(resource))
    ) {
      reasons.push('title');
    }

    if (reasons.length > 0) {
      results.push({ id: resource.id ?? '', reasons });
    }
  }

  return results;
}
