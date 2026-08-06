// Fetch helpers for talking to third-party job boards: retries with backoff,
// error classification, and a concurrency gate so a large refresh doesn't open
// 200 sockets at once or get us rate-limited.

export class FetchError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** 429 and 5xx are worth retrying; 4xx means the slug is wrong. */
function classify(status: number): { retryable: boolean; message: string } {
  if (status === 429) return { retryable: true, message: 'rate limited (429)' };
  if (status === 404) return { retryable: false, message: 'not found (404) — check the slug' };
  if (status === 403) return { retryable: false, message: 'forbidden (403) — private, or the request was blocked' };
  if (status === 401) return { retryable: false, message: 'unauthorized (401)' };
  if (status >= 500) return { retryable: true, message: `server error (${status})` };
  return { retryable: false, message: `HTTP ${status}` };
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** Called before each retry — useful for logging. */
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
}

const DEFAULT_HEADERS = {
  accept: 'application/json',
  // Some boards reject requests with no UA; identify honestly rather than
  // impersonating a browser.
  'user-agent': 'JobSearchEngine/1.0 (personal job search tool)',
};

function backoff(attempt: number): number {
  // 500ms, 1s, 2s, 4s… with jitter so parallel retries don't sync up.
  const base = 500 * 2 ** attempt;
  return Math.min(base, 8000) + Math.floor(Math.random() * 250);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch JSON with timeout, retry-with-backoff, and typed errors. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, timeoutMs = 15_000, retries = 2, onRetry } = opts;

  let lastError: FetchError = new FetchError('request never ran');

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = backoff(attempt - 1);
      onRetry?.(attempt, delay, lastError.message);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        method,
        headers: { ...DEFAULT_HEADERS, ...headers },
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const { retryable, message } = classify(res.status);
        lastError = new FetchError(message, res.status, retryable);
        if (!retryable) throw lastError;
        continue;
      }

      const text = await res.text();
      if (!text.trim()) throw new FetchError('empty response body', res.status, true);

      try {
        return JSON.parse(text) as T;
      } catch {
        // HTML instead of JSON usually means the board moved or the slug is
        // wrong and we hit a redirect to a marketing page.
        throw new FetchError('response was not JSON — check the slug/endpoint', res.status, false);
      }
    } catch (e) {
      if (e instanceof FetchError) {
        lastError = e;
        if (!e.retryable) throw e;
        continue;
      }
      const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      lastError = new FetchError(
        isTimeout ? `timed out after ${timeoutMs}ms` : e instanceof Error ? e.message : 'network error',
        undefined,
        true
      );
    }
  }

  throw lastError;
}

/**
 * Runs tasks with a bounded number in flight. Job boards get unhappy if you
 * hammer them, and serverless functions have socket limits.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Canonical form of a job URL, so the same posting reached via different
 * query strings or trailing slashes doesn't get imported twice.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.protocol = 'https:';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    // Strip tracking and session noise; keep params that identify the job.
    const drop = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gh_src', 'gh_jid_src', 'source', 'ref', 'referrer', 'src', 'trackingtag',
    ];
    for (const key of [...u.searchParams.keys()]) {
      if (drop.includes(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}
