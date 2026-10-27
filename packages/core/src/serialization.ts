/** Deterministic JSON for this protocol. Not a general RFC 8785 implementation. */
export function stableJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === 'boolean' || typeof item === 'string')
      return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Non-finite JSON number');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new TypeError('Unsupported JSON value');
    if (seen.has(item)) throw new TypeError('Cyclic JSON value');
    seen.add(item);
    let result: string;
    if (Array.isArray(item)) {
      result = '[' + Array.from(item, encode).join(',') + ']';
    } else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        throw new TypeError('Only plain JSON objects are supported');
      }
      const record = item as Record<string, unknown>;
      result =
        '{' +
        Object.keys(record)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encode(record[key]))
          .join(',') +
        '}';
    }
    seen.delete(item);
    return result;
  }
  return encode(value);
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Hashes canonical JSON, including JSON quotes for a string value. */
export async function contentHash(value: unknown): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(stableJson(value)));
}
