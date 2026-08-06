import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { encrypt } from '@/lib/crypto';
import { execute } from '@/lib/db/client';
import { getProfile } from '@/lib/gmail/client';
import { exchangeCode, OAuthError } from '@/lib/gmail/oauth';
import { nowIso } from '@/lib/ids';
import { logError, logEvent } from '@/lib/log';
import { advanceOnboarding, currentUser, updateUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

function back(params: Record<string, string>): NextResponse {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const url = new URL('/onboarding', base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/**
 * Where the Google consent screen returns to.
 *
 * Three things have to be right before this counts as connected, and each one
 * has its own plain-language failure:
 *
 *   1. The user did not press Cancel.
 *   2. Both scopes were actually granted. Google's granular consent lets them
 *      untick "Send email" while the authorization still succeeds; without
 *      this check the failure surfaces days later as a 403, at the moment they
 *      press Send for the first time.
 *   3. The mailbox is the one we already hold threads for.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  const params = request.nextUrl.searchParams;

  const jar = await cookies();
  const expectedState = jar.get('oauth_state')?.value;
  jar.delete('oauth_state');

  // 1 — the user pressed Cancel, or closed the Google screen.
  const googleError = params.get('error');
  if (googleError) {
    await logEvent({ event: 'gmail_scope_refused', userId: user.id, detail: { googleError }, level: 'warn' });
    return back({
      problem:
        googleError === 'access_denied'
          ? 'No problem — nothing was connected. You can try again whenever you are ready.'
          : 'Google stopped partway through. Nothing was connected; you can try again.',
    });
  }

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || !expectedState || state !== expectedState) {
    return back({ problem: 'That link had expired. Tap connect again and it will work.' });
  }

  try {
    // 2 — exchange, and refuse anything short of both scopes.
    const tokens = await exchangeCode(code);
    if (!tokens.refreshToken) {
      return back({
        problem:
          'Google did not give us a lasting connection. Tap connect again and approve the screen once more.',
      });
    }

    const at = nowIso();
    await execute(
      `INSERT INTO oauth_token
         (user_id, refresh_token_encrypted, access_token_encrypted, access_token_expires_at,
          granted_scopes, token_issued_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         access_token_encrypted  = excluded.access_token_encrypted,
         access_token_expires_at = excluded.access_token_expires_at,
         granted_scopes          = excluded.granted_scopes,
         token_issued_at         = excluded.token_issued_at,
         updated_at              = excluded.updated_at`,
      [
        user.id,
        encrypt(tokens.refreshToken),
        encrypt(tokens.accessToken),
        tokens.expiresAt,
        tokens.grantedScopes.join(' '),
        at,
        at,
      ]
    );
    await updateUser(user.id, { connectionState: 'connected' });

    // 3 — identity. Every stored thread id belongs to one mailbox.
    const profile = await getProfile(user.id);
    if (user.gmailAddress && user.gmailAddress.toLowerCase() !== profile.emailAddress.toLowerCase()) {
      await updateUser(user.id, { connectionState: 'disconnected' });
      await execute('DELETE FROM oauth_token WHERE user_id = ?', [user.id]);
      await logEvent({
        event: 'gmail_account_mismatch',
        userId: user.id,
        detail: { expected: user.gmailAddress, got: profile.emailAddress },
        level: 'warn',
      });
      return back({
        problem: `That was ${profile.emailAddress}, but this account is set up for ${user.gmailAddress}. Everything we track lives in that mailbox, so please sign in with it.`,
      });
    }

    await updateUser(user.id, { gmailAddress: profile.emailAddress });
    await advanceOnboarding(user.id, 'identity');
    await logEvent({
      event: 'gmail_connected',
      userId: user.id,
      detail: { address: profile.emailAddress, scopes: tokens.grantedScopes },
    });

    return back({ connected: '1' });
  } catch (e) {
    if (e instanceof OAuthError) {
      if (e.kind === 'missing_scope') {
        await logEvent({
          event: 'gmail_scope_refused',
          userId: user.id,
          detail: { message: e.message },
          level: 'warn',
        });
        // Not "completed onboarding with a token that cannot send" — the user
        // goes back to the same screen with an explanation of which box matters.
        return back({ problem: e.userMessage, retry: '1' });
      }
      await logError('error', e, { userId: user.id, detail: { stage: 'oauth_callback' } });
      return back({ problem: e.userMessage });
    }

    await logError('error', e, { userId: user.id, detail: { stage: 'oauth_callback' } });
    return back({
      problem: 'Something went wrong connecting your email. Nothing was saved — you can try again.',
    });
  }
}
