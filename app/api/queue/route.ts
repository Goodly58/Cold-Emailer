import { NextResponse } from 'next/server';

import { openActions } from '@/lib/poller';
import { buildQueue } from '@/lib/queue';
import { sweep, welcomeBack } from '@/lib/scheduler';
import { currentUser, sendBlockFor } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Today's queue.
 *
 * The full sweep runs first, every time the screen opens — reply poll, repair,
 * invariants, recompute, freshness — and sends stay blocked until it finishes.
 * Someone returning after ten days would otherwise batch-send a queue holding a
 * replied thread, a bounce, and a "since my note last week" that is two weeks
 * wrong.
 *
 * Pre-drafting is left to the cron. It costs a Claude call each and would put
 * fifteen seconds between tapping the app and seeing anything, which for this
 * user is indistinguishable from broken.
 */
export async function GET() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') {
    return NextResponse.json({ error: 'Finish setting up first.', step: user.onboardingStep }, { status: 409 });
  }

  const swept = await sweep(user, { predraft: false });

  // Re-read the user: the poll may have just refreshed `last_successful_poll_at`
  // (which unblocks sending) or found the token revoked (which blocks it).
  const fresh = (await currentUser()) ?? user;
  const block = sendBlockFor(fresh);
  const queue = await buildQueue(fresh);

  return NextResponse.json({
    ...queue,
    actions: await openActions(fresh.id, 5),
    welcome: await welcomeBack(fresh),
    freshness: swept.freshness,
    replies: swept.poll?.transitions ?? [],
    sendBlock: block.blocked ? { reason: block.reason, message: block.userMessage } : null,
    paused: fresh.paused,
    placed: Boolean(fresh.placedDate),
  });
}
