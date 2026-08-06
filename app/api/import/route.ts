import { NextRequest, NextResponse } from 'next/server';
import { PLATFORMS, fetchJobs, isPlatform, validSlug } from '@/lib/ats';

export const runtime = 'nodejs';

/**
 * One-off fetch of a single board, for the manual import box on the pipeline
 * page. Scheduled polling goes through /api/cron/refresh instead.
 */
export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source') || '';
  const slug = req.nextUrl.searchParams.get('slug')?.trim().toLowerCase() || '';

  if (!isPlatform(source)) {
    return NextResponse.json(
      { error: `source must be one of: ${PLATFORMS.join(', ')}` },
      { status: 400 }
    );
  }
  if (!validSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  try {
    const jobs = await fetchJobs(source, slug);
    return NextResponse.json({ jobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'import failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
