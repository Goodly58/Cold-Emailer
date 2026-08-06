import { NextResponse, type NextRequest } from 'next/server';

import { gateStatus, rebuildIntroBlocks, saveFollowupAnswer } from '@/lib/profile';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Answers the single follow-up on a thin field. We ask once; we never nag. */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: { field?: string; answer?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'That did not save. Try once more.' }, { status: 400 });
  }

  if (!payload.field || typeof payload.answer !== 'string') {
    return NextResponse.json({ error: 'That did not save. Try once more.' }, { status: 400 });
  }

  const specificity = await saveFollowupAnswer(user.id, payload.field, payload.answer);
  await rebuildIntroBlocks(user.id);

  return NextResponse.json({ specificity, gate: await gateStatus(user.id) });
}
