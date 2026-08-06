import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { updateDb } from '@/lib/store';
import { availableAggregators, getAggregator } from '@/lib/aggregators';
import { normalizeUrl } from '@/lib/http';
import { scoreRole } from '@/lib/scoring';
import type { Application } from '@/lib/types';

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

interface AggregatorJob {
  title: string;
  location: string;
  url: string;
  department?: string;
  company?: string;
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

  let jobs: AggregatorJob[];
  try {
    jobs = (await def.fetch(query, location)) as AggregatorJob[];
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'search failed' },
      { status: 502 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await updateDb((db) => {
    const byUrl = new Set(
      db.applications.filter((a) => a.jobUrl).map((a) => normalizeUrl(a.jobUrl!))
    );
    const companyByName = new Map(db.companies.map((c) => [c.name.trim().toLowerCase(), c]));

    let added = 0;
    for (const job of jobs) {
      if (!job.title || !job.url) continue;
      const key = normalizeUrl(job.url);
      if (byUrl.has(key)) continue;
      byUrl.add(key);

      const companyName = job.company || 'Unknown (via ' + def.label + ')';
      const company = companyByName.get(companyName.trim().toLowerCase());
      const { score, reasons } = scoreRole(
        { roleTitle: job.title, companyName, location: job.location, division: job.department },
        db.profile,
        company
      );

      const app: Application = {
        id: randomUUID(),
        companyName,
        roleTitle: job.title,
        jobUrl: job.url,
        location: job.location,
        division: job.department || undefined,
        source: def.id,
        stage: 'found',
        score,
        scoreReasons: reasons,
        emiratiAngle: /uae|u\.a\.e|dubai|abu dhabi|sharjah|ajman|fujairah|ras al|umm al|emirat/i.test(
          job.location || ''
        ),
        isNew: true,
        lastSeenAt: today,
        createdAt: new Date().toISOString(),
      };
      db.applications.unshift(app);
      added += 1;
    }
    return { added, found: jobs.length };
  });

  return NextResponse.json(result);
}
