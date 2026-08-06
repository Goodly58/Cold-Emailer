/**
 * The send path.
 *
 * A send can be lost to a crash. It may never be duplicated. Everything here
 * follows from that asymmetry — a lost send is a follow-up; a duplicate is an
 * email the recipient reads twice from someone asking them for a favour.
 *
 * The sequence, and every step of it matters:
 *
 *   1. Compare-and-swap `approved → sending`. Zero rows changed means somebody
 *      else already has it — a second tab, a double tap — and we abort.
 *   2. Re-check the thread for inbound we have not seen, INSIDE the swap. The
 *      poller races; the send gate cannot lose.
 *   3. Persist our RFC822 Message-ID *before* calling Gmail.
 *   4. Call Gmail. On a network failure, never blind-retry: probe
 *      `rfc822msgid:` first, because "we did not hear back" and "it did not
 *      send" are different states.
 *   5. Store the sent body verbatim. That, not the generated text, is what
 *      follow-up generation and any later dispute read.
 */
import { toUaeDate } from './calendar';
import { SEND_ABANDONED_MS, SEND_IN_FLIGHT_GRACE_MS } from './durations';
import { execute, query, queryOne, transaction } from './db/client';
import { lockEvidenceForSend } from './evidence';
import { gmailRequest, GmailError } from './gmail/client';
import { newId, nowIso } from './ids';
import { logEvent, logError } from './log';
import { buildMime, newMessageId, toGmailRaw, withSignature } from './mime';
import { sendBlockFor, type User } from './user';

export interface SendResult {
  ok: boolean;
  outreachId: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  /** Plain language, always. Never an SMTP code or a stack trace. */
  message: string;
  reason?:
    | 'not_approved'
    | 'already_sending'
    | 'reply_arrived'
    | 'blocked'
    | 'suppressed'
    | 'no_address'
    | 'gmail_error';
}

interface OutreachRow {
  id: string;
  person_id: string;
  user_id: string;
  step: number;
  subject: string | null;
  body: string | null;
  evidence_ids: string;
  status: string;
  rfc822_message_id: string | null;
  gmail_thread_id: string | null;
  references_chain: string;
}

/**
 * Sends one approved draft.
 *
 * Every guard returns a sentence a person can act on. "This person replied
 * while you were reading" is useful; "409 Conflict" is not.
 */
export async function sendOutreach(
  outreachId: string,
  user: User,
  now: Date = new Date()
): Promise<SendResult> {
  const block = sendBlockFor(user, now);
  if (block.blocked) {
    await logEvent({
      event: 'send_blocked',
      userId: user.id,
      entityType: 'outreach',
      entityId: outreachId,
      detail: { reason: block.reason },
    });
    return { ok: false, outreachId, message: block.userMessage!, reason: 'blocked' };
  }

  const outreach = await queryOne<OutreachRow>('SELECT * FROM outreach WHERE id = ?', [outreachId]);
  if (!outreach) return { ok: false, outreachId, message: 'That draft is no longer here.', reason: 'not_approved' };

  const person = await queryOne<{
    id: string;
    email: string | null;
    email_status: string;
    full_name_raw: string;
    company_id: string;
    status: string;
  }>('SELECT id, email, email_status, full_name_raw, company_id, status FROM person WHERE id = ?', [
    outreach.person_id,
  ]);

  if (!person?.email) {
    return { ok: false, outreachId, message: 'There is no address for this person yet.', reason: 'no_address' };
  }

  // Hard rule 3, checked at the last possible moment: an address can be
  // downgraded between drafting and sending.
  if (person.email_status !== 'verified' && person.email_status !== 'accept_all') {
    return {
      ok: false,
      outreachId,
      message: 'That address is not confirmed, so nothing was sent.',
      reason: 'no_address',
    };
  }

  const { checkSuppression } = await import('./people');
  const suppression = await checkSuppression(person.email);
  if (suppression.suppressed) {
    await execute(`UPDATE outreach SET status = 'closed', updated_at = ? WHERE id = ?`, [nowIso(), outreachId]);
    return { ok: false, outreachId, message: suppression.message!, reason: 'suppressed' };
  }

  const messageId = outreach.rfc822_message_id ?? newMessageId();

  // ---- The compare-and-swap, with the reply gate inside it ----------------
  const claimed = await transaction(async (tx) => {
    const [current] = await tx.query<{ status: string }>('SELECT status FROM outreach WHERE id = ?', [outreachId]);
    if (!current) return { claimed: false as const, reason: 'not_approved' as const };
    if (current.status === 'sending') return { claimed: false as const, reason: 'already_sending' as const };
    if (current.status !== 'approved') return { claimed: false as const, reason: 'not_approved' as const };

    // Anything inbound on this person's threads that has not been processed
    // supersedes the send. The poller may not have got here yet; this is the
    // guard that cannot lose the race.
    const unseen = await tx.query<{ n: number }>(
      `SELECT count(*) AS n FROM inbound
        WHERE person_id = ? AND classification NOT IN ('auto_reply_ooo', 'auto_ack_unmonitored', 'bounce')`,
      [outreach.person_id]
    );
    if ((unseen[0]?.n ?? 0) > 0) {
      await tx.execute(
        `UPDATE outreach SET status = 'superseded_by_reply', updated_at = ? WHERE id = ?`,
        [nowIso(), outreachId]
      );
      return { claimed: false as const, reason: 'reply_arrived' as const };
    }

    const changed = await tx.execute(
      `UPDATE outreach
          SET status = 'sending', rfc822_message_id = ?, updated_at = ?
        WHERE id = ? AND status = 'approved'`,
      [messageId, nowIso(), outreachId]
    );
    return changed === 1 ? { claimed: true as const } : { claimed: false as const, reason: 'already_sending' as const };
  });

  if (!claimed.claimed) {
    const messages: Record<string, string> = {
      not_approved: 'That draft was already dealt with.',
      already_sending: 'Sent from another device a moment ago.',
      reply_arrived: 'They replied while you were reading this. Read it before writing again.',
    };
    return { ok: false, outreachId, message: messages[claimed.reason], reason: claimed.reason };
  }

  // ---- Build and send ----------------------------------------------------
  const references: string[] = JSON.parse(outreach.references_chain);
  const body = withSignature(outreach.body ?? '', user.signatureBlock);

  const mime = buildMime({
    fromName: user.canonicalName ?? user.name,
    fromEmail: user.sendAsEmail ?? user.gmailAddress!,
    toName: person.full_name_raw,
    toEmail: person.email,
    subject: outreach.subject ?? '',
    body,
    messageId,
    inReplyTo: references.length > 0 ? references[references.length - 1] : null,
    references,
  });

  try {
    const response = await gmailRequest<{ id: string; threadId: string }>(user.id, '/users/me/messages/send', {
      method: 'POST',
      body: {
        raw: toGmailRaw(mime),
        ...(outreach.gmail_thread_id ? { threadId: outreach.gmail_thread_id } : {}),
      },
    });

    await recordSent(outreach, {
      gmailMessageId: response.id,
      gmailThreadId: response.threadId,
      messageId,
      body,
      references,
      userId: user.id,
      personId: person.id,
      now,
    });

    return {
      ok: true,
      outreachId,
      gmailMessageId: response.id,
      gmailThreadId: response.threadId,
      message: 'Sent.',
    };
  } catch (e) {
    // Never blind-retry. Gmail may have accepted it and dropped the response.
    const found = await probeForSentMessage(user.id, messageId);
    if (found) {
      await recordSent(outreach, {
        gmailMessageId: found.id,
        gmailThreadId: found.threadId,
        messageId,
        body,
        references,
        userId: user.id,
        personId: person.id,
        now,
      });
      return { ok: true, outreachId, gmailMessageId: found.id, gmailThreadId: found.threadId, message: 'Sent.' };
    }

    // Left in `sending` on purpose: the repair sweep resolves it by probing
    // again, and reverts only after a day of the message never appearing.
    await logError('error', e, {
      userId: user.id,
      entityType: 'outreach',
      entityId: outreachId,
      detail: { stage: 'send' },
    });
    return {
      ok: false,
      outreachId,
      message:
        e instanceof GmailError
          ? e.userMessage
          : 'We could not reach your email just now. Nothing was lost — try again shortly.',
      reason: 'gmail_error',
    };
  }
}

async function recordSent(
  outreach: OutreachRow,
  input: {
    gmailMessageId: string;
    gmailThreadId: string;
    messageId: string;
    body: string;
    references: string[];
    userId: string;
    personId: string;
    now: Date;
  }
): Promise<void> {
  const at = nowIso(input.now);
  const sentDateUae = toUaeDate(input.now);
  const evidenceIds: string[] = JSON.parse(outreach.evidence_ids);

  await execute(
    `UPDATE outreach
        SET status = 'sent', gmail_message_id = ?, gmail_thread_id = ?,
            sent_body_verbatim = ?, sent_at = ?, sent_date_uae = ?,
            references_chain = ?, updated_at = ?
      WHERE id = ?`,
    [
      input.gmailMessageId,
      input.gmailThreadId,
      input.body,
      at,
      sentDateUae,
      JSON.stringify([...input.references, input.messageId]),
      at,
      outreach.id,
    ]
  );

  await execute(`UPDATE person SET status = 'in_sequence', updated_at = ? WHERE id = ?`, [at, input.personId]);

  // The hook is spent for this company. Rotation now needs a different one.
  await lockEvidenceForSend(evidenceIds, input.personId, input.userId);

  // The cross-client ledger. Redundant with one user, which is the point.
  await execute(
    `INSERT INTO contact_ledger (id, person_id, user_id, outreach_id, evidence_ids, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId('ledger'), input.personId, input.userId, outreach.id, outreach.evidence_ids, at]
  );

  const person = await queryOne<{ contact_type: string }>('SELECT contact_type FROM person WHERE id = ?', [
    input.personId,
  ]);

  await logEvent({
    event: 'sent',
    userId: input.userId,
    entityType: 'outreach',
    entityId: outreach.id,
    detail: {
      step: outreach.step,
      contactType: person?.contact_type,
      evidenceCount: evidenceIds.length,
      sentDateUae,
    },
  });
}

/** Did Gmail accept a message carrying our Message-ID? */
async function probeForSentMessage(
  userId: string,
  messageId: string
): Promise<{ id: string; threadId: string } | null> {
  try {
    const bare = messageId.replace(/^<|>$/g, '');
    const result = await gmailRequest<{ messages?: Array<{ id: string; threadId: string }> }>(
      userId,
      '/users/me/messages',
      { query: { q: `rfc822msgid:${bare}`, maxResults: '1' } }
    );
    const hit = result.messages?.[0];
    return hit ? { id: hit.id, threadId: hit.threadId } : null;
  } catch {
    return null;
  }
}

/**
 * The repair sweep: resolves rows stuck in `sending`.
 *
 * Found at Gmail → it went out, backfill and move on. Absent after a day →
 * it did not, revert to approved so the user can decide again. Anything
 * younger than an hour is left alone; it may simply still be in flight.
 */
export async function repairStuckSends(userId: string, now: Date = new Date()): Promise<{
  recovered: number;
  reverted: number;
  pending: number;
}> {
  const stuck = await query<OutreachRow & { updated_at: string }>(
    `SELECT * FROM outreach WHERE status = 'sending' AND user_id = ?`,
    [userId]
  );

  let recovered = 0;
  let reverted = 0;
  let pending = 0;

  for (const row of stuck) {
    const ageMs = now.getTime() - Date.parse(row.updated_at);
    if (ageMs < SEND_IN_FLIGHT_GRACE_MS) {
      pending++;
      continue;
    }

    const found = row.rfc822_message_id ? await probeForSentMessage(userId, row.rfc822_message_id) : null;
    if (found) {
      await recordSent(row, {
        gmailMessageId: found.id,
        gmailThreadId: found.threadId,
        messageId: row.rfc822_message_id!,
        body: row.body ?? '',
        references: JSON.parse(row.references_chain),
        userId,
        personId: row.person_id,
        now,
      });
      recovered++;
      continue;
    }

    if (ageMs > SEND_ABANDONED_MS) {
      await execute(`UPDATE outreach SET status = 'approved', updated_at = ? WHERE id = ?`, [nowIso(now), row.id]);
      reverted++;
    } else {
      pending++;
    }
  }

  if (recovered > 0 || reverted > 0) {
    await logEvent({ event: 'sweep_ran', userId, detail: { repair: { recovered, reverted, pending } } });
  }

  return { recovered, reverted, pending };
}

/** Approves a draft. Separate from sending: approval is the human's act. */
export async function approveDraft(outreachId: string, editedBody?: string): Promise<boolean> {
  const changed = await execute(
    `UPDATE outreach
        SET status = 'approved', body = COALESCE(?, body), updated_at = ?
      WHERE id = ? AND status IN ('drafted', 'stale', 'approved')`,
    [editedBody ?? null, nowIso(), outreachId]
  );
  return changed === 1;
}
