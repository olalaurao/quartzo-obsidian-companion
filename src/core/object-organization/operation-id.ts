/**
 * Object Organization — operation-id generation (§7)
 *
 * Every structural or bulk operation must carry a stable operationId.
 * operationId is NOT a timestamp — it's a deterministic hash of the operation inputs.
 * Rerunning the same operation must not duplicate effects.
 */

/**
 * Generates a deterministic operation ID from the operation kind and its primary inputs.
 * Uses a simple string hash — suitable for content-addressable identity within a session.
 * Not a cryptographic hash.
 *
 * Invariant: same kind + same inputs → same ID.
 * Invariant: different kind or inputs → (overwhelmingly) different ID.
 */
export function generateOperationId(kind: string, inputs: Record<string, unknown>): string {
  const canonical = JSON.stringify({ kind, ...sortedKeys(inputs) });
  return `${kind}-${simpleHash(canonical)}`;
}

/**
 * Returns whether two operationIds represent the same operation.
 */
export function isSameOperation(a: string, b: string): boolean {
  return a === b;
}

function sortedKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v)
        ? sortedKeys(v as Record<string, unknown>)
        : v]),
  );
}

/**
 * Fast, non-cryptographic deterministic hash of a string.
 * Produces a hex-like string for use in operation IDs.
 */
function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h.toString(16).padStart(8, '0');
}
