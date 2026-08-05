import { NextRequest, NextResponse } from 'next/server';

// Imports live job listings from public, documented ATS board APIs.
// These endpoints are intentionally public (they power companies' own
// careers pages), so this is ToS-clean — unlike scraping LinkedIn.
//
//   Greenhouse: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
//   Lever:      https://api.lever.co/v0/postings/{slug}?mode=json

export interface ImportedJob {
  title: string;
  location: string;
  url: string;
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
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Greenhouse returned ${res.status} — check the board slug`);
      const data = await res.json();
      jobs = (data.jobs || []).map((j: { title: string; location?: { name?: string }; absolute_url: string }) => ({
        title: j.title,
        location: j.location?.name || '',
        url: j.absolute_url,
      }));
    } else if (source === 'lever') {
      const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Lever returned ${res.status} — check the company slug`);
      const data = await res.json();
      jobs = (Array.isArray(data) ? data : []).map(
        (j: { text: string; categories?: { location?: string }; hostedUrl: string }) => ({
          title: j.text,
          location: j.categories?.location || '',
          url: j.hostedUrl,
        })
      );
    } else {
      return NextResponse.json({ error: 'source must be greenhouse or lever' }, { status: 400 });
    }
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'import failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
