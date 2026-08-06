import { NextRequest, NextResponse } from 'next/server';
import { refreshAllSources } from '@/lib/refresh';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Scheduled refresh. Vercel Cron calls this with
 * `Authorization: Bearer $CRON_SECRET`; the same endpoint backs the
 * "Refresh now" button, which arrives with a logged-in session cookie
 * (the middleware handles that case).
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authed =
    !secret ||
    req.headers.get('authorization') === `Bearer ${secret}` ||
    req.cookies.get('app_auth')?.value === process.env.APP_PASSWORD;

  if (!authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const onlyId = req.nextUrl.searchParams.get('sourceId') || undefined;
  try {
    const report = await refreshAllSources(onlyId);
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'refresh failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
