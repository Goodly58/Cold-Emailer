import { NextResponse, type NextRequest } from 'next/server';

import { query } from '@/lib/db/client';
import { patternFor } from '@/lib/email-pattern';
import { peopleForCompany, personEligibility } from '@/lib/people';
import { emiratisationPageCandidates } from '@/lib/tier3';

export const dynamic = 'force-dynamic';

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  sector: string | null;
  segment: string;
  org_type: string | null;
  propensity: number;
  experiment_arm: string | null;
  careers_url: string | null;
  emiratisation_notes: string | null;
}

/**
 * The sourcing worklist, and the detail behind one company.
 *
 * Ordered by what is worth an hour: companies with a ladder plan and no people
 * on it, highest propensity first. Propensity rather than quota pressure —
 * a company behind on its quota is often defensive and has no Emirati hiring
 * function, while an over-compliant one runs a permanent pipeline with a named
 * lead and a budget.
 */
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('id');

  if (!companyId) {
    const rows = await query<CompanyRow & { people: number; slots: number }>(
      `SELECT c.*,
              (SELECT count(*) FROM person p WHERE p.company_id = c.id) AS people,
              (SELECT count(*) FROM ladder_slot s WHERE s.company_id = c.id) AS slots
         FROM company c
        WHERE c.segment = 'private'
          AND c.domain NOT IN (SELECT domain FROM blocked_domain)
        ORDER BY people ASC, c.propensity DESC, c.name ASC
        LIMIT 200`
    );
    return NextResponse.json({ companies: rows });
  }

  const [company] = await query<CompanyRow>('SELECT * FROM company WHERE id = ?', [companyId]);
  if (!company) return NextResponse.json({ error: 'No such company.' }, { status: 404 });

  const people = await peopleForCompany(companyId);
  const withEligibility = await Promise.all(
    people.map(async (p) => ({
      id: p.id,
      fullNameRaw: p.full_name_raw,
      roleTitle: p.role_title,
      contactType: p.contact_type,
      sourceTier: p.source_tier,
      ladderRank: p.ladder_rank,
      email: p.email,
      emailStatus: p.email_status,
      status: p.status,
      anchorSourceUrl: p.anchor_source_url,
      freshnessDate: p.freshness_date,
      sources: p.corroborating_source_count,
      honorific: p.honorific_declared,
      eligibility: await personEligibility(p.id),
    }))
  );

  const [slots, evidence] = await Promise.all([
    query<{ rank: number; contact_type: string; person_id: string | null }>(
      'SELECT rank, contact_type, person_id FROM ladder_slot WHERE company_id = ? ORDER BY rank',
      [companyId]
    ),
    query<{ id: string; tier: number; quote: string; source_url: string; usable: number; unusable_reason: string | null; person_id: string | null; identity_match: string | null }>(
      `SELECT id, tier, quote, source_url, usable, unusable_reason, person_id, identity_match
         FROM evidence WHERE company_id = ? AND kind = 'external'
        ORDER BY tier ASC, captured_at DESC`,
      [companyId]
    ),
  ]);

  return NextResponse.json({
    company,
    people: withEligibility,
    ladder: slots,
    evidence,
    pattern: await patternFor(company.domain),
    // The first Tier-2 check, ahead of generic leadership pages: it is the only
    // verified free source that reliably reaches the junior tier.
    emiratisationPageCandidates: emiratisationPageCandidates(company.domain),
  });
}
