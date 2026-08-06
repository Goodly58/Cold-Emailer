import { NextResponse, type NextRequest } from 'next/server';

import { execute, queryOne } from '@/lib/db/client';
import { todayUae } from '@/lib/calendar';
import { nowIso } from '@/lib/ids';
import { logEvent } from '@/lib/log';
import { openActions, resolveAction } from '@/lib/poller';
import { resolveReplyConflict } from '@/lib/state-machine';
import { currentUser, updateUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Everything waiting on a human, warm first. */
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ actions: await openActions(user.id) });
}

/**
 * The controls that live beside the actions.
 *
 * Pause, "I got the job", resolving a card, and the reply-conflict choice. All
 * of them are one tap and all of them say plainly what happens next — the user
 * is on a phone, once a day, and a control whose consequence is unclear does
 * not get used.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 400 });
  }

  const action = String(payload.action ?? '');

  if (action === 'resolve') {
    const ok = await resolveAction(String(payload.id ?? ''));
    return NextResponse.json({ ok });
  }

  if (action === 'pause' || action === 'resume') {
    const paused = action === 'pause';
    await updateUser(user.id, { paused });
    return NextResponse.json({
      ok: true,
      paused,
      message: paused
        ? 'Everything is on hold. Nothing sends and nothing is lost — the dates recompute from the day you come back.'
        : 'Back on. We have rechecked for replies and the dates have been recomputed.',
    });
  }

  if (action === 'placed') {
    // The headline metric, and the moment the product is supposed to end. It
    // never fires a queued follow-up at someone the user is now colleagues
    // with, and it never ghosts a warm thread.
    const at = nowIso();
    const today = todayUae();

    // Silent early sequences close silently: no break-up to someone who never
    // engaged, from a candidate who no longer needs anything.
    const closed = await execute(
      `UPDATE outreach SET status = 'closed', updated_at = ?
        WHERE user_id = ? AND status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved')
          AND person_id IN (SELECT id FROM person WHERE status IN ('ready', 'queued', 'in_sequence'))`,
      [at, user.id]
    );
    await execute(
      `UPDATE person SET status = 'closed_won_silent', updated_at = ?
        WHERE status IN ('queued', 'in_sequence')
          AND id IN (SELECT person_id FROM outreach WHERE user_id = ?)`,
      [at, user.id]
    );

    // Warm threads get a courteous withdrawal through the normal Review queue,
    // not a silent close. These are real relationships in a small market.
    const warm = await queryOne<{ n: number }>(
      `SELECT count(*) AS n FROM person WHERE status = 'replied'`
    );

    await updateUser(user.id, { placedDate: today });
    await logEvent({
      event: 'placed',
      userId: user.id,
      detail: { date: today, closedSilently: closed, warmThreads: warm?.n ?? 0 },
    });

    return NextResponse.json({
      ok: true,
      closedSilently: closed,
      warmThreads: warm?.n ?? 0,
      message:
        (warm?.n ?? 0) > 0
          ? `Congratulations. ${closed} quiet sequences closed without a word, and ${warm!.n} people who replied to you are worth a short note — they are in your queue.`
          : `Congratulations. ${closed} quiet sequences closed without a word. Nothing further will send.`,
    });
  }

  if (action === 'reply_conflict') {
    const { companyId, keepPersonId, choice } = payload as Record<string, string>;
    if (choice !== 'going_with_reply' && choice !== 'reply_was_dead_end') {
      return NextResponse.json({ error: 'Which one?' }, { status: 400 });
    }
    const result = await resolveReplyConflict(user.id, companyId, keepPersonId, choice);
    return NextResponse.json({ ok: true, message: result.summary });
  }

  if (action === 'interview_booked') {
    // Logged as its own event because it is the denominator of the third
    // pricing number, and because it is the thing worth celebrating.
    await logEvent({
      event: 'interview_booked',
      userId: user.id,
      entityType: 'person',
      entityId: String(payload.personId ?? ''),
    });
    return NextResponse.json({ ok: true, message: 'Recorded. That is the whole point of this.' });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
