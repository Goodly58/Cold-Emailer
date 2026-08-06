import { NextResponse } from 'next/server';

import { gateStatus, rebuildIntroBlocks } from '@/lib/profile';
import { fieldByKey } from '@/lib/interview';
import { logEvent } from '@/lib/log';
import { advanceOnboarding, currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Finishes onboarding — but only if the profile can actually carry an email.
 *
 * The gate refuses with the specific fields that need work, never a generic
 * "incomplete". A user blocked here can always see exactly which question to
 * go back to.
 */
export async function POST() {
  const user = await currentUser();

  if (user.connectionState !== 'connected') {
    return NextResponse.json(
      { error: 'Connect your email first — that is the part everything else runs on.', step: 'connect' },
      { status: 409 }
    );
  }

  const gate = await gateStatus(user.id);
  if (!gate.complete) {
    const label = (key: string) => fieldByKey(key)?.question ?? key;
    await logEvent({
      event: 'profile_gate_blocked',
      userId: user.id,
      detail: { missing: gate.missing, thin: gate.thin },
    });
    return NextResponse.json(
      {
        error:
          gate.missing.length > 0
            ? 'A couple of questions are still blank.'
            : 'One answer needs a bit more detail before it can go in an email.',
        step: 'interview',
        missing: gate.missing.map(label),
        thin: gate.thin.map(label),
      },
      { status: 409 }
    );
  }

  await rebuildIntroBlocks(user.id);
  await advanceOnboarding(user.id, 'done');
  await logEvent({ event: 'onboarding_completed', userId: user.id });

  return NextResponse.json({ ok: true });
}
