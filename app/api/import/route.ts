import { NextRequest, NextResponse } from 'next/server';
import { PLATFORMS, fetchJobs, isPlatform, validSlug } from '@/lib/ats';
import { PipelineIndex, addAltUrl, newApplication, saveDescriptions, takeDescription } from '@/lib/importer';
import { normalizeUrl } from '@/lib/http';
import { updateDb } from '@/lib/store';

/**
 * One-off fetch of a single board, for the manual import box on the pipeline
 * page. Scheduled polling goes through /api/cron/refresh instead.
 */

export const runtime = 'nodejs';

function parseTarget(source: string, slug: string): NextResponse | null {
  if (!isPlatform(source)) {
    return NextResponse.json({ error: `source must be one of: ${PLATFORMS.join(', ')}` }, { status: 400 });
  }
  if (!validSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }
  return null;
}

/** Preview a board. Descriptions are left out — they're only needed once a role is added. */
export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source') || '';
  const slug = req.nextUrl.searchParams.get('slug')?.trim().toLowerCase() || '';
  const bad = parseTarget(source, slug);
  if (bad) return bad;

  try {
    const jobs = await fetchJobs(source, slug);
    return NextResponse.json({
      jobs: jobs.map(({ description, ...job }) => ({ ...job, hasDescription: Boolean(description) })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'import failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Add chosen roles from a board to the pipeline. The board is fetched again
 * server-side so each role arrives with its description, pay and dates, and
 * goes through the same dedupe and scoring as the scheduled refresh.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const source = String(body.source || '');
  const slug = String(body.slug || '').trim().toLowerCase();
  const companyName = String(body.companyName || slug).trim().slice(0, 200);
  const urls: string[] = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 500) : [];
  const bad = parseTarget(source, slug);
  if (bad) return bad;
  if (urls.length === 0) return NextResponse.json({ error: 'no roles chosen' }, { status: 400 });

  let jobs;
  try {
    const wanted = new Set(urls.map(normalizeUrl));
    jobs = (await fetchJobs(source, slug)).filter((j) => wanted.has(normalizeUrl(j.url)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'import failed' }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const descriptions: Array<[string, string]> = [];
  const result = await updateDb((db) => {
    const index = new PipelineIndex(db);
    const added = [];
    let existing = 0;
    for (const job of jobs) {
      if (index.findByUrl(job.url)) {
        existing += 1;
        continue;
      }
      const twin = index.findRole(companyName, job.title, job.location);
      if (twin) {
        addAltUrl(twin, job.url);
        index.addUrl(twin, job.url);
        existing += 1;
        continue;
      }
      const app = newApplication(job, { companyName, source, nowIso }, db, index);
      const write = takeDescription(app, job);
      if (write) descriptions.push(write);
      db.applications.unshift(app);
      index.add(app);
      added.push(app);
    }
    return { added, existing };
  });

  if ((await saveDescriptions(descriptions)) < descriptions.length) {
    for (const a of result.added) a.hasDescription = false;
  }
  return NextResponse.json(result);
}
