/**
 * Google OAuth for Gmail.
 *
 * Exactly two scopes, and this is a hard rule, not a default:
 *
 *   gmail.send      — the only way an email leaves
 *   gmail.readonly  — reply and bounce detection
 *
 * `gmail.compose` is deliberately absent. SQLite is the only draft store
 * (ULTRAPROMPT §3 rule 13), so there is nothing to compose with, and dropping
 * the scope shrinks the CASA audit surface the product will have to pass
 * before user #2. Changing this list is a "stop and ask the founder" decision
 * (§7 Working Agreements).
 */

export const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export class OAuthError extends Error {
  /** Plain-language text safe to render to the user. Never SMTP or API jargon. */
  readonly userMessage: string;
  readonly kind:
    | 'not_configured'
    | 'declined'
    | 'missing_scope'
    | 'exchange_failed'
    | 'invalid_grant'
    | 'network';

  constructor(kind: OAuthError['kind'], message: string, userMessage: string) {
    super(message);
    this.name = 'OAuthError';
    this.kind = kind;
    this.userMessage = userMessage;
  }
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Reads the OAuth app configuration. Missing configuration is a founder
 * problem, so the message says what to set rather than "invalid_client".
 */
export function oauthConfig(): OAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

  if (!clientId || !clientSecret) {
    throw new OAuthError(
      'not_configured',
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set',
      'Email connection is not set up yet. Nothing you did caused this.'
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${baseUrl.replace(/\/$/, '')}/api/gmail/callback`,
  };
}

export function isOauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The Google consent URL.
 *
 * `prompt=consent` forces a refresh token every time, including on reconnect —
 * without it Google returns none on a repeat authorization and the connection
 * silently cannot be renewed.
 *
 * `login_hint` is what stops the account-chooser defaulting to a different
 * signed-in Gmail on reconnect. Every stored thread id belongs to the original
 * mailbox, so reconnecting as someone else corrupts all state.
 */
export function buildAuthUrl(options: { state: string; loginHint?: string | null }): string {
  const config = oauthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    // Never silently accumulate scopes from another grant — we want to see
    // exactly what this consent screen returned.
    include_granted_scopes: 'false',
    state: options.state,
  });
  if (options.loginHint) params.set('login_hint', options.loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  grantedScopes: string[];
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new OAuthError(
      'network',
      `token endpoint unreachable: ${e instanceof Error ? e.message : String(e)}`,
      'We could not reach Google just now. Try again in a moment.'
    );
  }

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok || payload.error) {
    if (payload.error === 'invalid_grant') {
      throw new OAuthError(
        'invalid_grant',
        `invalid_grant: ${payload.error_description ?? ''}`,
        'Your email connection has expired. Reconnecting takes one tap and nothing is lost.'
      );
    }
    throw new OAuthError(
      'exchange_failed',
      `token exchange failed (${response.status}): ${payload.error ?? ''} ${payload.error_description ?? ''}`,
      'Something went wrong connecting your email. Try again — nothing was saved.'
    );
  }
  return payload;
}

/**
 * Swaps the callback code for tokens and checks what was actually granted.
 *
 * Google's granular consent lets the user untick "Send email" while the
 * authorization still succeeds. Without this check the failure surfaces days
 * later as a 403 mid-loop, when the user is trying to send their first email.
 */
export async function exchangeCode(code: string): Promise<TokenSet> {
  const config = oauthConfig();
  const payload = await postToken(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    })
  );

  if (!payload.access_token) {
    throw new OAuthError(
      'exchange_failed',
      'token response had no access_token',
      'Something went wrong connecting your email. Try again — nothing was saved.'
    );
  }

  const grantedScopes = (payload.scope ?? '').split(/\s+/).filter(Boolean);
  const missing = missingScopes(grantedScopes);
  if (missing.length > 0) {
    throw new OAuthError(
      'missing_scope',
      `granted scopes missing: ${missing.join(', ')}`,
      missing.includes('https://www.googleapis.com/auth/gmail.send')
        ? 'The permission to send email was not ticked, so nothing could be sent. Let us try that screen again — both boxes need to stay ticked.'
        : 'The permission to read replies was not ticked, so we could not tell you when someone answers. Let us try that screen again.'
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiryFrom(payload.expires_in),
    grantedScopes,
  };
}

/** Exchanges a stored refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const config = oauthConfig();
  const payload = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    })
  );

  if (!payload.access_token) {
    throw new OAuthError(
      'invalid_grant',
      'refresh response had no access_token',
      'Your email connection has expired. Reconnecting takes one tap and nothing is lost.'
    );
  }

  return {
    accessToken: payload.access_token,
    // A refresh grant does not return a new refresh token; the caller keeps
    // the one it already has.
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiryFrom(payload.expires_in),
    grantedScopes: (payload.scope ?? REQUIRED_SCOPES.join(' ')).split(/\s+/).filter(Boolean),
  };
}

/** Which required scopes are absent from what Google granted. */
export function missingScopes(granted: readonly string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !granted.includes(s));
}

/** Human-readable names for the pre-consent explainer. */
export const SCOPE_EXPLANATIONS: Array<{ scope: string; googleWording: string; whatItMeans: string }> = [
  {
    scope: REQUIRED_SCOPES[0],
    googleWording: 'Send email on your behalf',
    whatItMeans:
      'Emails you approve go out from your own address, exactly as you read them. Nothing sends on its own.',
  },
  {
    scope: REQUIRED_SCOPES[1],
    googleWording: 'Read, compose, send and permanently delete all your email from Gmail',
    whatItMeans:
      'This is how we spot replies so you never chase someone who already answered. We only ever open the threads this app started, and nothing is deleted.',
  },
];

function expiryFrom(expiresIn: number | undefined): string {
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600;
  return new Date(Date.now() + seconds * 1000).toISOString();
}
