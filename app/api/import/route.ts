import { NextRequest, NextResponse } from 'next/server';

// Imports live job listings from public, documented ATS board APIs.
// These endpoints are intentionally public (they power companies' own
// careers pages), so this is ToS-clean — unlike scraping LinkedIn.
//
//   Greenhouse:      https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
//   Lever:           https://api.lever.co/v0/postings/{slug}?mode=json
//   Ashby:           https://api.ashbyhq.com/posting-api/job-board/{slug}
//   Workable:        https://apply.workable.com/api/v1/widget/accounts/{slug}
//   SmartRecruiters: https://api.smartrecruiters.com/v1/companies/{slug}/postings
//   Recruitee:       https://{slug}.recruitee.com/api/offers/

export interface ImportedJob {
  title: string;
  location: string;
  url: string;
}

async function fetchJson(url: string, sourceName: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${sourceName} returned ${res.status} — check the slug`);
  return res.json();
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source');
  const slug = req.nextUrl.searchParams.get('slug')?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  try {
    let jobs: ImportedJob[] = [];
    if (source === 'greenhouse') {
      const data = (await fetchJson(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
        'Greenhouse'
      )) as { jobs?: Array<{ title: string; location?: { name?: string }; absolute_url: string }> };
      jobs = (data.jobs || []).map((j) => ({
        title: j.title,
        location: j.location?.name || '',
        url: j.absolute_url,
      }));
    } else if (source === 'lever') {
      const data = (await fetchJson(
        `https://api.lever.co/v0/postings/${slug}?mode=json`,
        'Lever'
      )) as Array<{ text: string; categories?: { location?: string }; hostedUrl: string }>;
      jobs = (Array.isArray(data) ? data : []).map((j) => ({
        title: j.text,
        location: j.categories?.location || '',
        url: j.hostedUrl,
      }));
    } else if (source === 'ashby') {
      const data = (await fetchJson(
        `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
        'Ashby'
      )) as { jobs?: Array<{ title: string; location?: string; jobUrl?: string; applyUrl?: string }> };
      jobs = (data.jobs || []).map((j) => ({
        title: j.title,
        location: j.location || '',
        url: j.jobUrl || j.applyUrl || '',
      }));
    } else if (source === 'workable') {
      const data = (await fetchJson(
        `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
        'Workable'
      )) as { jobs?: Array<{ title: string; city?: string; country?: string; url: string }> };
      jobs = (data.jobs || []).map((j) => ({
        title: j.title,
        location: [j.city, j.country].filter(Boolean).join(', '),
        url: j.url,
      }));
    } else if (source === 'smartrecruiters') {
      const data = (await fetchJson(
        `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
        'SmartRecruiters'
      )) as {
        content?: Array<{ id: string; name: string; location?: { city?: string; country?: string } }>;
      };
      jobs = (data.content || []).map((j) => ({
        title: j.name,
        location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
        url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
      }));
    } else if (source === 'recruitee') {
      const data = (await fetchJson(`https://${slug}.recruitee.com/api/offers/`, 'Recruitee')) as {
        offers?: Array<{ title: string; location?: string; careers_url?: string }>;
      };
      jobs = (data.offers || []).map((j) => ({
        title: j.title,
        location: j.location || '',
        url: j.careers_url || '',
      }));
    } else {
      return NextResponse.json(
        { error: 'source must be one of: greenhouse, lever, ashby, workable, smartrecruiters, recruitee' },
        { status: 400 }
      );
    }
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'import failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
