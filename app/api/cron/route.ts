import { NextResponse, type NextRequest } from 'next/server';

import { query } from '@/lib/db/client';
import { logError } from '@/lib/log';
import { sweep } from '@/lib/scheduler';
import { getUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * The scheduled sweep.
 *
 * Called every 10-15 minutes by whatever runs the cron — a platform scheduler,
 * a systemd timer, or the founder's laptop. **It does not matter which, and it
 * does not matter if it misses.** The sweep is stateless and idempotent: a run
 * that never happened is indistinguishable from one that happened and found
 * nothing to do, which is the property that survives a three-day outage.
 *
 * Never per-minute. The SLA here is measured in working days, and a quota storm
 * after a quiet Eid week costs more than a fifteen-minute delay ever will.
 *
 * `CRON_SECRET` gates it. Without one set, only local requests are served: an
 * open sweep endpoint is a way for a stranger to burn the user's Gmail quota.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (secret) {
    if (provided !== secret) {
      return NextResponse.json({ error: 'No.' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Set CRON_SECRET before running the sweep in production.' },
      { status: 503 }
    );
  }

  // Every user with a finished setup. There is one today; the loop is here so
  // that stays an implementation detail rather than an assumption.
  const users = await query<{ id: string }>(
    `SELECT id FROM app_user WHERE onboarding_step = 'done'`
  );

  const results = [];
  for (const row of users) {
    const user = await getUser(row.id);
    if (!user) continue;
    try {
      results.push({ userId: user.id, ...(await sweep(user)) });
    } catch (e) {
      // One user's failure must not stop the others, and a 500 here would make
      // the scheduler retry the whole batch.
      await logError('error', e, { userId: user.id, detail: { stage: 'cron' } });
      results.push({ userId: user.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}

/** A health check the founder can hit from a phone. */
export async function GET() {
  const [pending] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM outreach WHERE status IN ('queued', 'drafted', 'stale', 'approved')`
  );
  const [lastSweep] = await query<{ at: string | null }>(
    `SELECT max(at) AS at FROM event_log WHERE event = 'sweep_ran'`
  );
  return NextResponse.json({ ok: true, liveDrafts: pending?.n ?? 0, lastSweepAt: lastSweep?.at ?? null });
}
