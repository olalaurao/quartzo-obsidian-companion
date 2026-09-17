import { describe, expect, it, vi } from 'vitest';
import { ResourceMetadataService } from '../../src/integrations/resource-metadata/service';
import type { RemoteFetchResponse } from '../../src/platform/remote-fetch-security';

function response(body: string, contentType = 'application/json'): RemoteFetchResponse {
  return {
    uri: new URL('https://fixture.test'),
    statusCode: 200,
    contentType,
    bodyBytes: new TextEncoder().encode(body),
  };
}

describe('ResourceMetadataService', () => {
  it('never performs a request for an arbitrary URL', async () => {
    const fetcher = vi.fn(async () => response('{}'));
    const result = await new ResourceMetadataService(fetcher).fetch('https://example.com/video-essay');
    expect(result).toEqual({
      sourceUrl: 'https://example.com/video-essay',
      source: 'unknown',
      fetched: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps Open Library JSON into a Resource draft', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe('https://openlibrary.org/works/OL262758W.json');
      return response(JSON.stringify({
        title: 'The Hobbit',
        description: { value: 'A hobbit goes on an unexpected journey.' },
        first_publish_date: '1937',
        covers: [123],
        by_statement: 'J. R. R. Tolkien',
      }));
    });
    const result = await new ResourceMetadataService(fetcher).fetch('https://openlibrary.org/works/OL262758W');
    expect(result).toMatchObject({
      fetched: true,
      source: 'openLibrary',
      title: 'The Hobbit',
      mediaType: 'Book',
      synopsis: 'A hobbit goes on an unexpected journey.',
      year: 1937,
      author: 'J. R. R. Tolkien',
      cover: 'https://covers.openlibrary.org/b/id/123-L.jpg',
    });
  });

  it('maps Google Books metadata without a live network request', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe('https://www.googleapis.com/books/v1/volumes/abc123');
      return response(JSON.stringify({
        volumeInfo: {
          title: 'Example Book',
          authors: ['A. Author'],
          publishedDate: '2020-04-03',
          pageCount: 321,
          categories: ['Fiction'],
          description: 'Description',
          imageLinks: { thumbnail: 'http://books.google.com/cover.jpg' },
          industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780000000001' }],
        },
      }));
    });
    const result = await new ResourceMetadataService(fetcher).fetch('https://books.google.com/books?id=abc123');
    expect(result).toMatchObject({
      fetched: true,
      source: 'googleBooks',
      googleBooksId: 'abc123',
      title: 'Example Book',
      author: 'A. Author',
      year: 2020,
      pages: 321,
      category: 'Fiction',
      isbn: '9780000000001',
      cover: 'https://books.google.com/cover.jpg',
    });
  });

  it('falls back to the manual draft when provider metadata fails', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    const result = await new ResourceMetadataService(fetcher).fetch('https://www.goodreads.com/book/show/1');
    expect(result).toEqual({
      sourceUrl: 'https://www.goodreads.com/book/show/1',
      source: 'goodreads',
      fetched: false,
    });
  });
});
