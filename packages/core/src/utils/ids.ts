/**
 * UUID v4 (crypto.randomUUID is native in Workers).
 */
export function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Deterministic ID from a source + external key, so re-runs produce the same internal id.
 * Useful for idempotent stub-row inserts.
 */
export async function deterministicId(source: string, externalId: string): Promise<string> {
  const input = `${source}::${externalId}`;
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // format like a UUID for readability
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
