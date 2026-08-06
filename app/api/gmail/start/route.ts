import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { buildAuthUrl, OAuthError } from '@/lib/gmail/oauth';
import { logEvent } from '@/lib/log';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Sends the user to Google's consent screen.
 *
 * They only arrive here after the pre-consent explainer, so the screen Google
 * shows is one they have already been walked through — that explainer is what
 * stops the red-triangle "unverified app" page from ending the onboarding
 * (register: "Google 'unverified app' warning kills onboarding at step one").
 */
export async function GET() {
  const user = await currentUser();

  try {
    const state = randomBytes(24).toString('base64url');
    const jar = await cookies();
    jar.set('oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
      path: '/',
    });

    await logEvent({ event: 'gmail_consent_opened', userId: user.id });

    // On reconnect, pin the account chooser to the mailbox we already hold
    // threads for. Without this it defaults to whichever Google account is
    // signed in, and a successful OAuth against the wrong one corrupts
    // every stored thread id.
    return NextResponse.redirect(buildAuthUrl({ state, loginHint: user.gmailAddress }));
  } catch (e) {
    const message =
      e instanceof OAuthError ? e.userMessage : 'We could not open the Google screen just now.';
    return NextResponse.redirect(
      new URL(
        `/onboarding?problem=${encodeURIComponent(message)}`,
        process.env.APP_BASE_URL ?? 'http://localhost:3000'
      )
    );
  }
}
