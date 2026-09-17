import { describe, expect, it } from 'vitest';
import {
  secureRemoteFetch,
  validateRemoteUri,
  isPrivateOrLocalAddress,
  type RemoteFetchPolicy,
  type RemoteFetchTransport,
} from '../../src/platform/remote-fetch-security';

const policy: RemoteFetchPolicy = {
  allowedSchemes: new Set(['https']),
  allowedHosts: new Set(['example.com', 'openlibrary.org']),
  maxBytes: 16,
  maxRedirects: 2,
  timeoutMs: 1000,
  allowedContentTypePrefixes: ['application/json', 'text/html'],
  rejectPrivateNetworks: true,
};

const publicResolver = async (): Promise<string[]> => ['93.184.216.34'];

describe('remote fetch security', () => {
  it('rejects non-HTTPS and non-allowlisted hosts', () => {
    expect(() => validateRemoteUri('http://example.com/x', policy)).toThrow();
    expect(() => validateRemoteUri('https://evil.example.net/x', policy)).toThrow();
    expect(validateRemoteUri('https://books.openlibrary.org/x', policy).hostname).toBe('books.openlibrary.org');
  });

  it('recognizes private/local address families', () => {
    for (const address of ['127.0.0.1', '10.0.0.2', '172.16.0.2', '192.168.1.2', '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
      expect(isPrivateOrLocalAddress(address)).toBe(true);
    }
    expect(isPrivateOrLocalAddress('93.184.216.34')).toBe(false);
    expect(isPrivateOrLocalAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    const transport: RemoteFetchTransport = async () => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, bodyBytes: new Uint8Array() });
    await expect(secureRemoteFetch('https://example.com/x', {
      policy,
      resolver: async () => ['10.0.0.1'],
      transport,
    })).rejects.toThrow('Private or local');
  });

  it('revalidates redirects against the host allowlist', async () => {
    const transport: RemoteFetchTransport = async () => ({
      statusCode: 302,
      headers: { location: 'https://evil.example.net/redirected', 'content-type': 'text/html' },
      bodyBytes: new Uint8Array(),
    });
    await expect(secureRemoteFetch('https://example.com/start', { policy, resolver: publicResolver, transport })).rejects.toThrow('not approved');
  });

  it('enforces response size and content type', async () => {
    const oversized: RemoteFetchTransport = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      bodyBytes: new Uint8Array(17),
    });
    await expect(secureRemoteFetch('https://example.com/data', { policy, resolver: publicResolver, transport: oversized })).rejects.toThrow('too large');

    const binary: RemoteFetchTransport = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'application/octet-stream' },
      bodyBytes: new Uint8Array([1, 2]),
    });
    await expect(secureRemoteFetch('https://example.com/data', { policy, resolver: publicResolver, transport: binary })).rejects.toThrow('content type');
  });
});
