import { NextResponse, type NextRequest } from 'next/server';

import { applyHygieneAnswer, listBlocked, type BlockReason } from '@/lib/blocklist';
import { saveAnswer } from '@/lib/profile';
import { advanceOnboarding, currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Which hygiene question maps to which block reason. */
const REASONS: Record<string, BlockReason> = {
  current_employers: 'current_employer',
  recent_applications: 'recent_application',
  never_contact: 'never_contact',
};

/**
 * Records the three hygiene answers and blocks what they name.
 *
 * The raw text is stored as well as the matches, because a company the user
 * named that is not in the database yet still has to be blockable when it is
 * added later — and because the founder needs to see what the matcher missed.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: Record<string, string>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'That did not save. Try once more.' }, { status: 400 });
  }

  const blocked: string[] = [];
  const unmatched: string[] = [];

  for (const [field, reason] of Object.entries(REASONS)) {
    const raw = (payload[field] ?? '').trim();
    await saveAnswer(user.id, field, raw);
    if (!raw) continue;

    const result = await applyHygieneAnswer(user.id, raw, reason);
    blocked.push(...result.blocked);
    unmatched.push(...result.unmatched);
  }

  await advanceOnboarding(user.id, 'cv');

  return NextResponse.json({
    blocked,
    // Surfaced, not swallowed: the user sees which names we could not place, so
    // they never assume a block took effect when it did not.
    unmatched,
    total: (await listBlocked(user.id)).length,
  });
}
