import { NextRequest, NextResponse } from 'next/server';
import { updateDb } from '@/lib/store';
import { availableAggregators, getAggregator } from '@/lib/aggregators';
import type { AtsJob } from '@/lib/ats-registry';
import { PipelineIndex, addAltUrl, newApplication, saveDescriptions, takeDescription } from '@/lib/importer';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Which aggregators exist and which have their keys configured. */
export async function GET() {
  return NextResponse.json({
    aggregators: availableAggregators().map((a) => ({
      id: a.id,
      label: a.label,
      configured: a.configured,
      envKeys: a.envKeys,
      signupUrl: a.signupUrl,
      freeTier: a.freeTier,
    })),
  });
}

/** Search an aggregator and import the results into the pipeline. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  const query = String(body.query || '').slice(0, 200);
  const location = String(body.location || 'United Arab Emirates').slice(0, 100);

  const def = getAggregator(id);
  if (!def) {
    return NextResponse.json({ error: 'unknown aggregator' }, { status: 400 });
  }
  const missing = def.envKeys.filter((k) => !process.env[k]);
  if (missing.length) {
    return NextResponse.json(
      { error: `${def.label} needs ${missing.join(' and ')} set in your environment` },
      { status: 400 }
    );
  }

  let jobs: AtsJob[];
  try {
    jobs = await def.fetch(query, location);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'search failed' },
      { status: 502 }
    );
  }

  const nowIso = new Date().toISOString();
  const descriptions: Array<[string, string]> = [];

  const result = await updateDb((db) => {
    const index = new PipelineIndex(db);
    let added = 0;
    let merged = 0;

    for (const job of jobs) {
      if (!job.title || !job.url || index.findByUrl(job.url)) continue;

      const companyName = job.company || `Unknown (via ${def.label})`;
      // Already in the pipeline from a company board: keep that (it has the
      // direct apply link) and just remember this listing.
      const twin = job.company ? index.findRole(companyName, job.title, job.location) : undefined;
      if (twin) {
        addAltUrl(twin, job.url);
        index.addUrl(twin, job.url);
        merged += 1;
        continue;
      }

      const app = newApplication(job, { companyName, source: def.id, nowIso }, db, index);
      const write = takeDescription(app, job);
      if (write) descriptions.push(write);
      db.applications.unshift(app);
      index.add(app);
      added += 1;
    }
    return { added, merged, found: jobs.length };
  });

  await saveDescriptions(descriptions);

  return NextResponse.json(result);
}
