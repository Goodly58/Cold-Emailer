import { NextResponse } from 'next/server';

import { buildQueue, freshnessPass } from '@/lib/queue';
import { repairStuckSends } from '@/lib/send';
import { currentUser, sendBlockFor } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Today's queue.
 *
 * The freshness pass runs first, every time, and sends stay blocked until it
 * finishes. Someone returning after ten days would otherwise batch-send a queue
 * holding a replied thread, a bounce, and a "since my note last week" that is
 * two weeks wrong.
 */
export async function GET() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') {
    return NextResponse.json({ error: 'Finish setting up first.', step: user.onboardingStep }, { status: 409 });
  }

  const [freshness] = await Promise.all([freshnessPass(user), repairStuckSends(user.id)]);
  const queue = await buildQueue(user);
  const block = sendBlockFor(user);

  return NextResponse.json({
    ...queue,
    freshness,
    sendBlock: block.blocked ? { reason: block.reason, message: block.userMessage } : null,
    paused: user.paused,
    placed: Boolean(user.placedDate),
  });
}
