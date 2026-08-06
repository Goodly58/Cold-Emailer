import { NextResponse, type NextRequest } from 'next/server';

import { gateStatus, rebuildIntroBlocks, saveAnswer, saveVerificationFraming } from '@/lib/profile';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Saves one interview answer and reports back whether it was concrete enough.
 *
 * The response carries the follow-up question when there is one, so the client
 * can show it inline rather than making the user wait for a separate round
 * trip — this is the whole "exactly one concrete follow-up per thin field"
 * mechanic.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: { field?: string; value?: unknown; verificationFraming?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'That did not save. Try once more.' }, { status: 400 });
  }

  if (!payload.field) {
    return NextResponse.json({ error: 'That did not save. Try once more.' }, { status: 400 });
  }

  try {
    const result = await saveAnswer(user.id, payload.field, payload.value ?? '', {
      verificationFraming: payload.verificationFraming ?? null,
    });
    if (payload.verificationFraming) {
      await saveVerificationFraming(user.id, payload.field, payload.verificationFraming);
    }
    await rebuildIntroBlocks(user.id);

    return NextResponse.json({
      specificity: result.specificity,
      followupQuestion: result.followupQuestion,
      gate: await gateStatus(user.id),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'That did not save. Try once more.' },
      { status: 400 }
    );
  }
}
