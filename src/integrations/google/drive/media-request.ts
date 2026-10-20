import { randomUUID } from 'crypto';

/**
 * Keep metadata and arbitrary bytes in one SDK-authenticated request. The Google
 * SDK's renderer multipart builder includes strings only, silently omitting a
 * Buffer; its Node builder instead expects a stream. Neither owns our bytes.
 */
export function binaryMediaRequest(
  operation: 'create' | 'update', metadata: Record<string, unknown>, content: Uint8Array, ifMatch?: string,
) {
  const bytes = Buffer.from(content);
  const json = Buffer.from(JSON.stringify(metadata), 'utf8');
  let boundary: string;
  do { boundary = `quartzo-${randomUUID()}`; }
  while (bytes.includes(boundary) || json.includes(boundary));
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    json,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    url: operation === 'create'
      ? 'https://www.googleapis.com/upload/drive/v3/files'
      : 'https://www.googleapis.com/upload/drive/v2/files/{fileId}',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
    body,
  };
}
