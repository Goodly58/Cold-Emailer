/**
 * The one Gmail API wrapper. Every call to Google goes through here so the
 * backoff, the token bucket, and the token refresh exist in exactly one place
 * (ULTRAPROMPT §4).
 *
 * Polling is deliberately coarse — every 10-15 minutes, never per-minute. The
 * SLA on this product is measured in working days, and a quota storm after a
 * quiet Eid week costs more than a fifteen-minute delay ever will.
 */
import { OAuthError, refreshAccessToken } from './oauth';
import { decrypt, encrypt } from '../crypto';
import { execute, queryOne } from '../db/client';
import { nowIso } from '../ids';
import { logEvent } from '../log';

const API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/** Refresh a little early so a request never races its own expiry. */
const EXPIRY_MARGIN_MS = 60_000;

export class GmailError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  /** Calm, plain-language rendering. Never an SMTP code, never a stack trace. */
  readonly userMessage: string;

  constructor(message: string, opts: { status?: number; retryable?: boolean; userMessage?: string } = {}) {
    super(message);
    this.name = 'GmailError';
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.userMessage =
      opts.userMessage ?? 'We could not reach your email just now. Nothing was lost — try again shortly.';
  }
}

// ---------------------------------------------------------------------------
// Per-user token bucket
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const BUCKET_CAPACITY = 20;
const BUCKET_REFILL_PER_SECOND = 4;
const buckets = new Map<string, Bucket>();

async function takeToken(userId: string): Promise<void> {
  const now = Date.now();
  const bucket = buckets.get(userId) ?? { tokens: BUCKET_CAPACITY, lastRefillMs: now };
  const elapsedSeconds = (now - bucket.lastRefillMs) / 1000;
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedSeconds * BUCKET_REFILL_PER_SECOND);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    const waitMs = ((1 - bucket.tokens) / BUCKET_REFILL_PER_SECOND) * 1000;
    buckets.set(userId, bucket);
    await sleep(waitMs);
    return takeToken(userId);
  }

  bucket.tokens -= 1;
  buckets.set(userId, bucket);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, so parallel retries do not synchronize. */
function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

interface TokenRow {
  refresh_token_encrypted: string;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
  granted_scopes: string;
}

/**
 * A usable access token for this user, refreshing if needed.
 *
 * An `invalid_grant` here means the user revoked access (or a testing-mode
 * token hit its 7-day expiry). That flips `connection_state`, which blocks
 * every send until they reconnect — the countdowns keep deriving forward, but
 * nothing goes out while we are blind.
 */
export async function accessTokenFor(userId: string): Promise<string> {
  const row = await queryOne<TokenRow>(
    `SELECT refresh_token_encrypted, access_token_encrypted, access_token_expires_at, granted_scopes
       FROM oauth_token WHERE user_id = ?`,
    [userId]
  );
  if (!row) {
    throw new GmailError('no stored token for user', {
      userMessage: 'Your email is not connected yet.',
    });
  }

  if (
    row.access_token_encrypted &&
    row.access_token_expires_at &&
    Date.parse(row.access_token_expires_at) - EXPIRY_MARGIN_MS > Date.now()
  ) {
    return decrypt(row.access_token_encrypted);
  }

  try {
    const refreshed = await refreshAccessToken(decrypt(row.refresh_token_encrypted));
    await execute(
      `UPDATE oauth_token
          SET access_token_encrypted = ?, access_token_expires_at = ?, updated_at = ?
        WHERE user_id = ?`,
      [encrypt(refreshed.accessToken), refreshed.expiresAt, nowIso(), userId]
    );
    await execute(`UPDATE app_user SET connection_state = 'connected', updated_at = ? WHERE id = ?`, [
      nowIso(),
      userId,
    ]);
    return refreshed.accessToken;
  } catch (e) {
    if (e instanceof OAuthError && e.kind === 'invalid_grant') {
      await markDisconnected(userId, 'revoked');
      throw new GmailError('refresh token rejected', { userMessage: e.userMessage });
    }
    throw e;
  }
}

export async function markDisconnected(
  userId: string,
  state: 'expired' | 'revoked' | 'disconnected'
): Promise<void> {
  await execute('UPDATE app_user SET connection_state = ?, updated_at = ? WHERE id = ?', [
    state,
    nowIso(),
    userId,
  ]);
  await logEvent({
    event: 'gmail_disconnected',
    userId,
    detail: { state },
    level: state === 'revoked' ? 'warn' : 'info',
  });
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function classify(status: number): { retryable: boolean; userMessage: string } {
  if (status === 429 || status >= 500) {
    return {
      retryable: true,
      userMessage: 'Gmail is busy right now. We will try again automatically.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      userMessage: 'Your email connection needs renewing. Reconnecting takes one tap and nothing is lost.',
    };
  }
  return {
    retryable: false,
    userMessage: 'We could not reach your email just now. Nothing was lost — try again shortly.',
  };
}

/** A raw Gmail API call, rate-limited and retried. */
export async function gmailRequest<T>(
  userId: string,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  const { method = 'GET', body, query } = init;
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  let lastError: GmailError = new GmailError('request never ran');

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt - 1));
    await takeToken(userId);

    const token = await accessTokenFor(userId);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      lastError = new GmailError(e instanceof Error ? e.message : 'network error', { retryable: true });
      continue;
    }

    if (response.ok) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const detail = await response.text().catch(() => '');
    const { retryable, userMessage } = classify(response.status);
    lastError = new GmailError(`Gmail ${method} ${path} → ${response.status}: ${detail.slice(0, 300)}`, {
      status: response.status,
      retryable,
      userMessage,
    });
    if (!retryable) throw lastError;
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// The calls week 1 needs
// ---------------------------------------------------------------------------

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  historyId: string;
}

/**
 * The connected address, straight from Google. This is the identity anchor: on
 * reconnect we compare against it and refuse a mismatch, because every stored
 * thread id belongs to this mailbox.
 */
export async function getProfile(userId: string): Promise<GmailProfile> {
  return gmailRequest<GmailProfile>(userId, '/users/me/profile');
}

export interface SendAsEntry {
  sendAsEmail: string;
  displayName?: string;
  signature?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  verificationStatus?: 'accepted' | 'pending' | 'verificationStatusUnspecified';
}

/**
 * The addresses this mailbox may send as. Only verified ones are offered —
 * an unverified alias is accepted by the API and then bounces or rewrites at
 * delivery, which the user would experience as "my email didn't arrive".
 */
export async function listSendAs(userId: string): Promise<SendAsEntry[]> {
  const result = await gmailRequest<{ sendAs?: SendAsEntry[] }>(userId, '/users/me/settings/sendAs');
  return (result.sendAs ?? []).filter(
    (entry) => entry.isPrimary === true || entry.verificationStatus === 'accepted'
  );
}

/** One send-as entry, including its signature HTML. */
export async function getSendAs(userId: string, sendAsEmail: string): Promise<SendAsEntry> {
  return gmailRequest<SendAsEntry>(
    userId,
    `/users/me/settings/sendAs/${encodeURIComponent(sendAsEmail)}`
  );
}
