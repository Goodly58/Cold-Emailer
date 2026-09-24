import { NextResponse } from 'next/server';
import { aiConfigured, aiErrorResponse } from '@/lib/ai';
import { discoverEvents, lastDiscovery } from '@/lib/event-discovery';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** When the list was last checked, for the Events page. */
export async function GET() {
  return NextResponse.json({ configured: aiConfigured(), last: await lastDiscovery() });
}

/** "Check for new events" on the Events page. */
export async function POST() {
  try {
    const r = await discoverEvents();
    return NextResponse.json({
      added: r.added.map((e) => e.name),
      updated: r.updated,
      skipped: r.skipped,
      searches: r.searches,
      usage: r.usage,
    });
  } catch (e) {
    const { status, body } = aiErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}
