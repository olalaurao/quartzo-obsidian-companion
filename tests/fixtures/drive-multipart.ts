import { strict as assert } from 'node:assert';

/** Decode the request at the fake HTTP boundary, independently of the producer. */
export function decodeDriveMultipart(options: { headers: Record<string, string>; body?: unknown }) {
  const type = options.headers['Content-Type'] ?? options.headers['content-type'];
  const boundary = /boundary=([^;]+)/.exec(type)?.[1];
  assert.ok(boundary);
  const body = Buffer.from(options.body as Uint8Array);
  const marker = Buffer.from(`\r\n--${boundary}\r\n`);
  const split = body.indexOf(marker);
  const headerEnd = body.indexOf('\r\n\r\n');
  const mediaStart = body.indexOf('\r\n\r\n', split + marker.length) + 4;
  const mediaEnd = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
  assert.ok(split > headerEnd && mediaStart > split && mediaEnd >= mediaStart);
  return {
    metadata: JSON.parse(body.subarray(headerEnd + 4, split).toString('utf8')),
    bytes: Buffer.from(body.subarray(mediaStart, mediaEnd)),
  };
}
