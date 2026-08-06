import { NextResponse, type NextRequest } from 'next/server';

import { queryOne } from '@/lib/db/client';
import { disputeEvidence, storeEvidence, type EvidenceTier } from '@/lib/evidence';
import { logError } from '@/lib/log';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Captures one evidence row.
 *
 * Every gate runs here rather than at draft time, so the founder learns a
 * quote is unusable while they are still looking at the source — not three
 * days later when the queue is short and nobody remembers where it came from.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 400 });
  }

  if (payload.action === 'dispute') {
    const id = payload.id as string;
    if (!id) return NextResponse.json({ error: 'Which one?' }, { status: 400 });
    await disputeEvidence(id);
    return NextResponse.json({ ok: true });
  }

  const {
    companyId,
    personId,
    tier,
    quote,
    quoteTranslated,
    language,
    sourceUrl,
    contextSnippet,
    minutesSpent,
  } = payload as Record<string, never>;

  if (!companyId || !tier || !quote || !sourceUrl) {
    return NextResponse.json(
      { error: 'Need the company, the tier, what they said, and the link it came from.' },
      { status: 400 }
    );
  }

  try {
    const company = await queryOne<{ name: string }>('SELECT name FROM company WHERE id = ?', [companyId]);
    const person = personId
      ? await queryOne<{ full_name_raw: string; role_title: string | null; anchor_source_url: string | null }>(
          'SELECT full_name_raw, role_title, anchor_source_url FROM person WHERE id = ?',
          [personId]
        )
      : null;

    const result = await storeEvidence(
      {
        companyId,
        personId: personId ?? null,
        tier: Number(tier) as EvidenceTier,
        quote,
        quoteTranslated: quoteTranslated ?? null,
        language: language ?? 'en',
        sourceUrl,
        contextSnippet: contextSnippet ?? null,
        minutesSpent: minutesSpent ? Number(minutesSpent) : null,
        userId: user.id,
      },
      company && person
        ? {
            companyName: company.name,
            personName: person.full_name_raw,
            roleTitle: person.role_title,
            anchorUrl: person.anchor_source_url,
          }
        : undefined
    );

    return NextResponse.json(result);
  } catch (e) {
    await logError('error', e, { userId: user.id, detail: { stage: 'store_evidence' } });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not save that.' },
      { status: 400 }
    );
  }
}
