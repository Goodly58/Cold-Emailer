import { NextRequest, NextResponse } from 'next/server';
import { aiConfigured, aiErrorResponse } from '@/lib/ai';
import { discoverEvents, discoveryDue } from '@/lib/event-discovery';

export const runtime = 'nodejs';
// A web-search pass takes a minute or two.
export const maxDuration = 300;

/**
 * Weekly event discovery, called by Vercel Cron with the CRON_SECRET bearer
 * header. Skips quietly when AI isn't configured or it ran recently.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!aiConfigured()) return NextResponse.json({ skipped: 'AI is not configured' });
  if (!(await discoveryDue(6))) return NextResponse.json({ skipped: 'ran within the last week' });

  try {
    const r = await discoverEvents();
    return NextResponse.json({ added: r.added.length, updated: r.updated.length, skipped: r.skipped, searches: r.searches, usage: r.usage });
  } catch (e) {
    const { status, body } = aiErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}
