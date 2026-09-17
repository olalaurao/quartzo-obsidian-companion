import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export interface RemoteFetchPolicy {
  allowedSchemes: ReadonlySet<string>;
  allowedHosts?: ReadonlySet<string>;
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  allowedContentTypePrefixes: readonly string[];
  rejectPrivateNetworks: boolean;
}

export interface RemoteFetchResponse {
  uri: URL;
  statusCode: number;
  bodyBytes: Uint8Array;
  contentType?: string;
}

export interface RemoteTransportResponse {
  statusCode: number;
  headers: Record<string, string | undefined>;
  bodyBytes: Uint8Array;
}

export interface RemoteTransportOptions {
  headers: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxBytes: number;
  /** Public address returned by the security resolver for this exact request. */
  resolvedAddress?: string;
}

export type RemoteFetchTransport = (
  uri: URL,
  options: RemoteTransportOptions,
) => Promise<RemoteTransportResponse>;

export type HostResolver = (host: string) => Promise<string[]>;

export class RemoteFetchSecurityError extends Error {}

export const DEFAULT_REMOTE_FETCH_POLICY: RemoteFetchPolicy = {
  allowedSchemes: new Set(['https']),
  maxBytes: 1024 * 1024,
  maxRedirects: 4,
  timeoutMs: 10_000,
  allowedContentTypePrefixes: ['text/html', 'application/xhtml+xml', 'application/json', 'text/plain'],
  rejectPrivateNetworks: true,
};

function allowedHost(host: string, allowedHosts: ReadonlySet<string> | undefined): boolean {
  if (!allowedHosts || allowedHosts.size === 0) return true;
  const normalized = host.toLowerCase();
  return [...allowedHosts].some(raw => {
    const domain = raw.toLowerCase().trim();
    return domain.length > 0 && (normalized === domain || normalized.endsWith(`.${domain}`));
  });
}

export function isPrivateOrLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!normalized) return true;
  if (normalized === '::' || normalized === '::1') return true;

  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224;
  }

  if (isIP(normalized) === 6) {
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateOrLocalAddress(mapped[1]) : false;
  }
  return false;
}

export function validateRemoteUri(url: string, policy: RemoteFetchPolicy): URL {
  let uri: URL;
  try {
    uri = new URL(url.trim());
  } catch {
    throw new RemoteFetchSecurityError('This link is not supported for automatic import.');
  }
  if (!policy.allowedSchemes.has(uri.protocol.replace(/:$/, '').toLowerCase()) || !uri.hostname) {
    throw new RemoteFetchSecurityError('This link is not supported for automatic import.');
  }
  const host = uri.hostname.toLowerCase();
  if (host === 'localhost' || host === 'local' || host.endsWith('.localhost') || isPrivateOrLocalAddress(host)) {
    throw new RemoteFetchSecurityError('Private or local network addresses cannot be imported.');
  }
  if (!allowedHost(host, policy.allowedHosts)) {
    throw new RemoteFetchSecurityError('This host is not approved for automatic import.');
  }
  return uri;
}

async function defaultResolveHost(host: string): Promise<string[]> {
  const result = await lookup(host, { all: true, verbatim: true });
  return result.map(item => item.address);
}

async function resolvePublicAddress(
  uri: URL,
  policy: RemoteFetchPolicy,
  resolver: HostResolver,
): Promise<string | undefined> {
  if (!policy.rejectPrivateNetworks) return undefined;
  const addresses = await Promise.race([
    resolver(uri.hostname),
    new Promise<never>((_, reject) => setTimeout(() => reject(new RemoteFetchSecurityError('Remote lookup timed out.')), policy.timeoutMs)),
  ]);
  if (addresses.length === 0 || addresses.some(isPrivateOrLocalAddress)) {
    throw new RemoteFetchSecurityError('Private or local network addresses cannot be imported.');
  }
  return addresses[0];
}

export const nodeHttpsTransport: RemoteFetchTransport = (uri, options) => new Promise((resolve, reject) => {
  const req = request({
    protocol: uri.protocol,
    hostname: options.resolvedAddress ?? uri.hostname,
    port: uri.port || undefined,
    path: `${uri.pathname}${uri.search}`,
    method: 'GET',
    servername: uri.hostname,
    headers: {
      ...options.headers,
      host: uri.host,
    },
  }, response => {
    const chunks: Buffer[] = [];
    let total = 0;
    const declaredLength = Number(response.headers['content-length'] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      response.destroy();
      reject(new RemoteFetchSecurityError('The remote response is too large to import automatically.'));
      return;
    }
    response.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > options.maxBytes) {
        response.destroy(new RemoteFetchSecurityError('The remote response is too large to import automatically.'));
        return;
      }
      chunks.push(buffer);
    });
    response.on('error', reject);
    response.on('end', () => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])),
        bodyBytes: Buffer.concat(chunks),
      });
    });
  });
  req.setTimeout(options.timeoutMs, () => req.destroy(new RemoteFetchSecurityError('Remote request timed out.')));
  req.on('error', reject);
  req.end();
});

function validateContentType(contentType: string | undefined, policy: RemoteFetchPolicy): void {
  if (policy.allowedContentTypePrefixes.length === 0) return;
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  if (!normalized || !policy.allowedContentTypePrefixes.some(prefix => normalized.startsWith(prefix.toLowerCase()))) {
    throw new RemoteFetchSecurityError('The remote content type is not supported for automatic import.');
  }
}

export async function secureRemoteFetch(
  url: string,
  options: {
    policy?: Partial<RemoteFetchPolicy>;
    headers?: Readonly<Record<string, string>>;
    transport?: RemoteFetchTransport;
    resolver?: HostResolver;
  } = {},
): Promise<RemoteFetchResponse> {
  const policy: RemoteFetchPolicy = {
    ...DEFAULT_REMOTE_FETCH_POLICY,
    ...options.policy,
    allowedSchemes: options.policy?.allowedSchemes ?? DEFAULT_REMOTE_FETCH_POLICY.allowedSchemes,
    allowedContentTypePrefixes: options.policy?.allowedContentTypePrefixes ?? DEFAULT_REMOTE_FETCH_POLICY.allowedContentTypePrefixes,
  };
  const transport = options.transport ?? nodeHttpsTransport;
  const resolver = options.resolver ?? defaultResolveHost;
  let current = validateRemoteUri(url, policy);

  for (let redirectCount = 0; redirectCount <= policy.maxRedirects; redirectCount++) {
    const resolvedAddress = await resolvePublicAddress(current, policy, resolver);
    const response = await transport(current, {
      headers: options.headers ?? {},
      timeoutMs: policy.timeoutMs,
      maxBytes: policy.maxBytes,
      resolvedAddress,
    });
    if (response.bodyBytes.byteLength > policy.maxBytes) {
      throw new RemoteFetchSecurityError('The remote response is too large to import automatically.');
    }

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      if (!location) throw new RemoteFetchSecurityError('The remote server returned an invalid redirect.');
      if (redirectCount === policy.maxRedirects) {
        throw new RemoteFetchSecurityError('The remote server redirected too many times.');
      }
      current = validateRemoteUri(new URL(location, current).toString(), policy);
      continue;
    }

    const contentType = response.headers['content-type'];
    validateContentType(contentType, policy);
    return {
      uri: current,
      statusCode: response.statusCode,
      bodyBytes: response.bodyBytes,
      contentType,
    };
  }
  throw new RemoteFetchSecurityError('The remote server redirected too many times.');
}

export function remoteResponseText(response: RemoteFetchResponse): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(response.bodyBytes);
}
