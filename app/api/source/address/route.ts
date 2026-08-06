import { NextResponse, type NextRequest } from 'next/server';

import { queryOne } from '@/lib/db/client';
import { patternFor, recordExemplar, resolveAddressFor, verifyAddress } from '@/lib/email-pattern';
import { checkSuppression, personEligibility, refreshPersonStatus } from '@/lib/people';
import { execute } from '@/lib/db/client';
import { nowIso } from '@/lib/ids';

export const dynamic = 'force-dynamic';

/**
 * Address work: record an exemplar seen in public, infer and verify an address,
 * or verify one typed in by hand.
 *
 * The exemplar path is the one that matters. A domain with fewer than two
 * independently sourced addresses cannot produce a trustworthy guess, so
 * "find one address written down somewhere public" is the actual unblocking
 * action — and it is far faster than it sounds once you know to look for it.
 */
export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 400 });
  }

  const action = payload.action as string;

  if (action === 'exemplar') {
    const { domain, address, fullNameRaw, sourceUrl } = payload as Record<string, string>;
    if (!domain || !address || !sourceUrl) {
      return NextResponse.json(
        { error: 'Need the address and the page you saw it on. An address with no provenance is a guess.' },
        { status: 400 }
      );
    }
    const pattern = await recordExemplar({ domain, address, fullNameRaw: fullNameRaw ?? address, sourceUrl });
    return NextResponse.json({ pattern });
  }

  if (action === 'verify') {
    const { personId, address } = payload as Record<string, string>;
    if (!address) return NextResponse.json({ error: 'Which address?' }, { status: 400 });

    const suppression = await checkSuppression(address);
    if (suppression.suppressed) {
      return NextResponse.json({ error: suppression.message }, { status: 409 });
    }

    const result = await verifyAddress(address);
    if (personId) {
      await execute('UPDATE person SET email = ?, email_status = ?, updated_at = ? WHERE id = ?', [
        address.toLowerCase(),
        result.status === 'guessed' ? 'guessed' : result.status,
        nowIso(),
        personId,
      ]);
      await refreshPersonStatus(personId);
    }
    return NextResponse.json({
      ...result,
      eligibility: personId ? await personEligibility(personId) : null,
    });
  }

  if (action === 'resolve') {
    const personId = payload.personId as string;
    if (!personId) return NextResponse.json({ error: 'Which person?' }, { status: 400 });

    const person = await queryOne<{ company_id: string }>('SELECT company_id FROM person WHERE id = ?', [personId]);
    if (!person) return NextResponse.json({ error: 'No such person.' }, { status: 404 });

    const company = await queryOne<{ domain: string }>('SELECT domain FROM company WHERE id = ?', [person.company_id]);
    const suppression = await checkSuppression(null, company?.domain ?? null);
    if (suppression.suppressed) {
      return NextResponse.json({ error: suppression.message }, { status: 409 });
    }

    const result = await resolveAddressFor(personId);
    await refreshPersonStatus(personId);
    return NextResponse.json({
      ...result,
      pattern: company ? await patternFor(company.domain) : null,
      eligibility: await personEligibility(personId),
    });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
