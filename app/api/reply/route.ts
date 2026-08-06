import { NextResponse, type NextRequest } from 'next/server';

import {
  answerQuestion,
  approveReply,
  dismissReply,
  draftReply,
  openReplies,
  replyById,
} from '@/lib/reply-assist';
import { sendReply } from '@/lib/send';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** Everything waiting to be answered, or one of them in full. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  const id = request.nextUrl.searchParams.get('id');
  if (id) {
    const reply = await replyById(id, user.id);
    if (!reply) return NextResponse.json({ error: 'That one is no longer here.' }, { status: 404 });
    return NextResponse.json({ reply });
  }
  return NextResponse.json({ replies: await openReplies(user.id) });
}

/**
 * Answer, approve, send, dismiss, or supply the one missing fact.
 *
 * Sending is deliberately not budget-gated and not held for the send window.
 * Answering somebody who wrote to you is not outreach, and a person waiting on
 * a reply does not care that it is Friday.
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
  const id = String(payload.id ?? '');

  if (action === 'answer_question') {
    // The user typed the fact the draft was missing. It is stored on their
    // profile, not used once, so the same question is never asked twice.
    const result = await answerQuestion(id, user.id, String(payload.answer ?? ''));
    const reply = await replyById(id, user.id);
    return NextResponse.json({ ok: result.ok, reply });
  }

  if (action === 'approve') {
    const ok = await approveReply(id, user.id, payload.edited ? String(payload.edited) : undefined);
    return NextResponse.json(ok ? { ok } : { error: 'That one was already dealt with.' }, {
      status: ok ? 200 : 409,
    });
  }

  if (action === 'send') {
    if (payload.edited) await approveReply(id, user.id, String(payload.edited));
    else await approveReply(id, user.id);
    const result = await sendReply(id, user);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (action === 'dismiss') {
    // A legitimate outcome: not every reply needs one from us, and a card that
    // cannot be cleared is a card the user starts ignoring.
    return NextResponse.json({ ok: await dismissReply(id, user.id) });
  }

  if (action === 'redraft') {
    const inboundId = String(payload.inboundId ?? '');
    const result = await draftReply(inboundId, user.id);
    return NextResponse.json({ ok: result.kind === 'drafted', ...result });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
