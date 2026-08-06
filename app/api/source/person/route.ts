import { NextResponse, type NextRequest } from 'next/server';

import {
  assignToLadder,
  createPerson,
  mergePeople,
  personEligibility,
  refreshPersonStatus,
  type ContactType,
} from '@/lib/people';
import { logError } from '@/lib/log';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Adds a person found at any tier, with the minutes it took.
 *
 * The minutes matter as much as the person: founder labour is the real COGS,
 * and six months from now pricing needs minutes-per-send from a dataset nobody
 * will otherwise have collected.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 400 });
  }

  if (payload.action === 'merge') {
    const { keepId, mergeId } = payload as { keepId?: string; mergeId?: string };
    if (!keepId || !mergeId) return NextResponse.json({ error: 'Need both ids.' }, { status: 400 });
    await mergePeople(keepId, mergeId);
    return NextResponse.json({ ok: true, eligibility: await personEligibility(keepId) });
  }

  const {
    companyId,
    fullNameRaw,
    roleTitle,
    contactType,
    sourceTier,
    anchorSourceUrl,
    sourceUrls,
    freshnessDate,
    gender,
    nationalityBucket,
    seniorityTier,
    honorificDeclared,
    honorificSource,
    honorificSourceUrl,
    minutesSpent,
  } = payload as Record<string, never>;

  if (!companyId || !fullNameRaw || !contactType || !sourceTier) {
    return NextResponse.json(
      { error: 'Need at least a company, a name, what they do, and where you found them.' },
      { status: 400 }
    );
  }

  // An honorific with no source is refused at the schema level; refusing here
  // gives a sentence instead of a constraint violation.
  if (honorificDeclared && (!honorificSource || !honorificSourceUrl)) {
    return NextResponse.json(
      {
        error:
          'An honorific needs the page it was copied from. Titles are never derived from a job title or a family name — that is how "Dear Eng. Priya" and "Dear Sheikh Al Mazrouei" happen.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await createPerson({
      companyId,
      fullNameRaw,
      roleTitle: roleTitle ?? null,
      contactType: contactType as ContactType,
      sourceTier: Number(sourceTier) as 1 | 2 | 3 | 4,
      anchorSourceUrl: anchorSourceUrl ?? null,
      sourceUrls: Array.isArray(sourceUrls) ? sourceUrls : [],
      freshnessDate: freshnessDate ?? null,
      gender: gender ?? 'unknown',
      nationalityBucket: nationalityBucket ?? 'unknown',
      seniorityTier: seniorityTier ? (Number(seniorityTier) as 1 | 2 | 3 | 4) : null,
      honorificDeclared: honorificDeclared ?? null,
      honorificSource: honorificSource ?? null,
      honorificSourceUrl: honorificSourceUrl ?? null,
      minutesSpent: minutesSpent ? Number(minutesSpent) : null,
      userId: user.id,
    });

    if (!result.duplicateOf) {
      await assignToLadder(result.id, companyId, contactType as ContactType);
      await refreshPersonStatus(result.id);
    }

    return NextResponse.json({
      ...result,
      eligibility: await personEligibility(result.id),
    });
  } catch (e) {
    await logError('error', e, { userId: user.id, detail: { stage: 'create_person' } });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not save that person.' },
      { status: 400 }
    );
  }
}
