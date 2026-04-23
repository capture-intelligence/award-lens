export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
}

/**
 * Exponential backoff retry with jitter.
 * Defaults tuned for public federal APIs (be polite on rate limits).
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 60_000,
    shouldRetry = defaultShouldRetry,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !shouldRetry(err)) break;
      const backoff = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = Math.random() * 0.3 * backoff;
      await sleep(backoff + jitter);
    }
  }
  throw lastErr;
}

function defaultShouldRetry(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Retry on transport errors, 429, 5xx
  return /\b(429|5\d\d|timeout|ECONNRESET|fetch failed|NetworkError)\b/i.test(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
