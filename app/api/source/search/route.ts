import { NextResponse, type NextRequest } from 'next/server';

import { buildSearchPlan, extractReportingLine, runSearch } from '@/lib/tier3';

export const dynamic = 'force-dynamic';

/**
 * Tier-3 search: build the query, run it if an API is configured, and mark
 * every hit with whether it actually places the person in the UAE.
 *
 * Nothing here touches linkedin.com. It reads search results, which is a
 * different thing legally and technically, and the distinction is the whole
 * reason hard rule 7 is survivable.
 */
export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 400 });
  }

  // Job ads name roles and reporting lines, never the manager. Extracting the
  // title turns an unbounded search into a two-term query.
  if (payload.action === 'extract_titles') {
    const text = String(payload.jobAdText ?? '');
    const titles = extractReportingLine(text);
    return NextResponse.json({
      titles,
      note:
        titles.length > 0
          ? 'These are the roles the ad reports into. Search for one of them by name.'
          : 'No reporting line in that ad. Most UAE postings do not name one — try the company leadership page instead.',
    });
  }

  const { companyName, title, qualifier } = payload as Record<string, string>;
  if (!companyName || !title) {
    return NextResponse.json({ error: 'Need a company and a job title.' }, { status: 400 });
  }

  const plan = buildSearchPlan({ companyName, title, qualifier: qualifier ?? null });
  const results = await runSearch(plan);

  return NextResponse.json({ plan, ...results });
}
