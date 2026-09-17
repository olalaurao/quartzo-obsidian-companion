import {
  secureRemoteFetch,
  remoteResponseText,
  type RemoteFetchResponse,
} from '../../platform/remote-fetch-security';
import {
  detectResourceMetadataSource,
  type ResourceMetadataSource,
} from '../../core/resource-capture/policy';

const RESOURCE_ALLOWED_HOSTS = new Set([
  'openlibrary.org',
  'covers.openlibrary.org',
  'books.google.com',
  'play.google.com',
  'googleapis.com',
  'imdb.com',
  'omdbapi.com',
  'amazon.com',
  'amazon.com.br',
  'goodreads.com',
]);

export interface ResourceMetadataDraft {
  sourceUrl: string;
  source: ResourceMetadataSource;
  fetched: boolean;
  title?: string;
  mediaType?: string;
  cover?: string;
  synopsis?: string;
  author?: string;
  year?: number;
  pages?: number;
  category?: string;
  isbn?: string;
  googleBooksId?: string;
  imdbId?: string;
}

export type ResourceMetadataFetcher = (url: string) => Promise<RemoteFetchResponse>;

function cleaned(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result || undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function yearFrom(value: unknown): number | undefined {
  const match = cleaned(value)?.match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function decodeHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .trim() || undefined;
}

function metaContent(html: string, keys: readonly string[]): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase();
    if (keys.some(candidate => candidate.toLowerCase() === key)) {
      return decodeHtml(attributes.get('content'));
    }
  }
  return undefined;
}

function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Metadata provider returned invalid JSON.');
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function openLibraryId(uri: URL): { kind: 'works' | 'books'; id: string } | null {
  const match = uri.pathname.match(/^\/(works|books)\/([^/?#]+)/i);
  if (!match) return null;
  return { kind: match[1].toLowerCase() as 'works' | 'books', id: match[2] };
}

function googleBooksId(uri: URL): string | null {
  return uri.searchParams.get('id')?.trim() || null;
}

export class ResourceMetadataService {
  constructor(private readonly fetcher: ResourceMetadataFetcher = ResourceMetadataService.defaultFetcher) {}

  static async defaultFetcher(url: string): Promise<RemoteFetchResponse> {
    return secureRemoteFetch(url, {
      policy: {
        allowedHosts: RESOURCE_ALLOWED_HOSTS,
        maxBytes: 1024 * 1024,
      },
      headers: {
        'User-Agent': 'Quartzo-Obsidian-Companion/0.1',
        Accept: 'application/json,text/html,application/xhtml+xml,text/plain;q=0.8',
      },
    });
  }

  async fetch(url: string): Promise<ResourceMetadataDraft> {
    const sourceUrl = url.trim();
    const source = detectResourceMetadataSource(sourceUrl);
    const base: ResourceMetadataDraft = { sourceUrl, source, fetched: false };
    if (source === 'unknown') return base;

    try {
      if (source === 'openLibrary') return await this.fetchOpenLibrary(base);
      if (source === 'googleBooks') return await this.fetchGoogleBooks(base);
      return await this.fetchOpenGraph(base);
    } catch {
      return base;
    }
  }

  private async fetchOpenLibrary(base: ResourceMetadataDraft): Promise<ResourceMetadataDraft> {
    const parsed = new URL(base.sourceUrl);
    const identity = openLibraryId(parsed);
    if (!identity) return base;
    const response = await this.fetcher(`https://openlibrary.org/${identity.kind}/${identity.id}.json`);
    if (response.statusCode < 200 || response.statusCode >= 300) return base;
    const json = jsonObject(remoteResponseText(response));
    const description = typeof json.description === 'string'
      ? json.description
      : json.description && typeof json.description === 'object' && !Array.isArray(json.description)
        ? cleaned((json.description as Record<string, unknown>).value)
        : undefined;
    const covers = Array.isArray(json.covers) ? json.covers : [];
    const coverId = positiveInteger(covers[0]);
    const isbn = stringArray(json.isbn_13)[0] ?? stringArray(json.isbn_10)[0];
    return {
      ...base,
      fetched: true,
      title: cleaned(json.title),
      mediaType: 'Book',
      cover: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
      synopsis: description,
      author: cleaned(json.by_statement),
      year: yearFrom(json.first_publish_date ?? json.publish_date),
      pages: positiveInteger(json.number_of_pages),
      isbn,
    };
  }

  private async fetchGoogleBooks(base: ResourceMetadataDraft): Promise<ResourceMetadataDraft> {
    const id = googleBooksId(new URL(base.sourceUrl));
    if (!id) return base;
    const response = await this.fetcher(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}`);
    if (response.statusCode < 200 || response.statusCode >= 300) return base;
    const json = jsonObject(remoteResponseText(response));
    const volume = json.volumeInfo && typeof json.volumeInfo === 'object' && !Array.isArray(json.volumeInfo)
      ? json.volumeInfo as Record<string, unknown>
      : {};
    const imageLinks = volume.imageLinks && typeof volume.imageLinks === 'object' && !Array.isArray(volume.imageLinks)
      ? volume.imageLinks as Record<string, unknown>
      : {};
    const identifiers = Array.isArray(volume.industryIdentifiers) ? volume.industryIdentifiers : [];
    let isbn: string | undefined;
    for (const raw of identifiers) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const type = cleaned(item.type);
      if (type === 'ISBN_13' || (!isbn && type === 'ISBN_10')) isbn = cleaned(item.identifier);
    }
    return {
      ...base,
      fetched: true,
      title: cleaned(volume.title),
      mediaType: 'Book',
      cover: cleaned(imageLinks.thumbnail)?.replace(/^http:/i, 'https:'),
      synopsis: cleaned(volume.description),
      author: stringArray(volume.authors).join(', ') || undefined,
      year: yearFrom(volume.publishedDate),
      pages: positiveInteger(volume.pageCount),
      category: stringArray(volume.categories)[0],
      isbn,
      googleBooksId: id,
    };
  }

  private async fetchOpenGraph(base: ResourceMetadataDraft): Promise<ResourceMetadataDraft> {
    const response = await this.fetcher(base.sourceUrl);
    if (response.statusCode < 200 || response.statusCode >= 300) return base;
    const html = remoteResponseText(response);
    const mediaType = base.source === 'imdb' ? 'Movie' : base.source === 'goodreads' ? 'Book' : 'General';
    const imdbId = base.source === 'imdb' ? base.sourceUrl.match(/\/title\/(tt\d+)/i)?.[1] : undefined;
    return {
      ...base,
      fetched: true,
      title: metaContent(html, ['og:title', 'twitter:title']),
      mediaType,
      cover: metaContent(html, ['og:image', 'twitter:image']),
      synopsis: metaContent(html, ['og:description', 'description', 'twitter:description']),
      author: metaContent(html, ['author', 'book:author']),
      isbn: metaContent(html, ['book:isbn', 'isbn']),
      imdbId,
    };
  }
}
