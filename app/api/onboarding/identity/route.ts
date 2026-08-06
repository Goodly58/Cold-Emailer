import { NextResponse, type NextRequest } from 'next/server';

import { getSendAs, GmailError, listSendAs } from '@/lib/gmail/client';
import { logError, logEvent } from '@/lib/log';
import { nowIso } from '@/lib/ids';
import { advanceOnboarding, currentUser, updateUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Strips a Gmail HTML signature down to text.
 *
 * The signature is a fixed sign-off block that sits outside the 120-word
 * budget, and the user has to be able to read it to confirm it — so it is
 * shown as text, not as markup.
 */
function signatureToText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The addresses this mailbox can send from, plus the display name Google has
 * on file.
 *
 * The display name matters: the from-line can read "mohd shamsi 98" while the
 * signature says "Mohammed Al Shamsi", and the recipient sees both. Showing
 * them side by side is the only way the user notices.
 */
export async function GET() {
  const user = await currentUser();

  if (user.connectionState !== 'connected') {
    return NextResponse.json(
      { error: 'Your email is not connected yet.', needsConnect: true },
      { status: 409 }
    );
  }

  try {
    const entries = await listSendAs(user.id);
    return NextResponse.json({
      addresses: entries.map((e) => ({
        email: e.sendAsEmail,
        displayName: e.displayName ?? '',
        isDefault: e.isDefault ?? false,
        isPrimary: e.isPrimary ?? false,
        signature: signatureToText(e.signature),
      })),
      gmailAddress: user.gmailAddress,
      canonicalName: user.canonicalName,
    });
  } catch (e) {
    await logError('error', e, { userId: user.id, detail: { stage: 'identity_list' } });
    return NextResponse.json(
      { error: e instanceof GmailError ? e.userMessage : 'We could not read your email settings just now.' },
      { status: 502 }
    );
  }
}

/** Saves the chosen send-as address, the name spelling, and the sign-off. */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: { sendAsEmail?: string; canonicalName?: string; signatureBlock?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'That did not save. Try once more.' }, { status: 400 });
  }

  if (!payload.sendAsEmail || !payload.canonicalName?.trim()) {
    return NextResponse.json(
      { error: 'Pick the address to send from and confirm how your name is spelled.' },
      { status: 400 }
    );
  }

  // Only a verified address may be chosen. An unverified alias is accepted by
  // the API and then rewritten or bounced at delivery, which the user would
  // experience as "my email never arrived".
  let verified: Awaited<ReturnType<typeof listSendAs>>;
  try {
    verified = await listSendAs(user.id);
  } catch (e) {
    await logError('error', e, { userId: user.id, detail: { stage: 'identity_verify' } });
    return NextResponse.json(
      { error: e instanceof GmailError ? e.userMessage : 'We could not check that address just now.' },
      { status: 502 }
    );
  }

  const match = verified.find(
    (v) => v.sendAsEmail.toLowerCase() === payload.sendAsEmail!.toLowerCase()
  );
  if (!match) {
    return NextResponse.json(
      { error: 'That address is not verified in Gmail yet, so mail from it would not arrive. Pick another.' },
      { status: 400 }
    );
  }

  // Re-fetch so the stored signature is what Gmail holds now, not what the
  // list call happened to return.
  let signature = payload.signatureBlock ?? '';
  try {
    signature = signatureToText((await getSendAs(user.id, match.sendAsEmail)).signature) || signature;
  } catch {
    // A missing signature is not a failure — most personal accounts have none.
  }

  await updateUser(user.id, {
    sendAsEmail: match.sendAsEmail,
    canonicalName: payload.canonicalName.trim(),
    signatureBlock: signature.trim() || null,
    signatureFetchedAt: nowIso(),
    name: payload.canonicalName.trim(),
  });
  await advanceOnboarding(user.id, 'interview');
  await logEvent({
    event: 'identity_block_confirmed',
    userId: user.id,
    detail: { sendAsEmail: match.sendAsEmail, hasSignature: signature.trim().length > 0 },
  });

  return NextResponse.json({ ok: true });
}
