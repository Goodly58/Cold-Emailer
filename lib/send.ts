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
import {
  buildMime,
  buildReplyMime,
  newMessageId,
  toGmailRaw,
  withSignature,
  type Attachment,
} from './mime';
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
  const body = withSignature(outreach.body ?? '', user.signatureBlock, user.canonicalName ?? user.name);

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
    /** The day it actually went out. The repair sweep knows better than `now`. */
    sentDateUae?: string;
  }
): Promise<void> {
  const at = nowIso(input.now);
  const sentDateUae = input.sentDateUae ?? toUaeDate(input.now);
  const evidenceIds: string[] = JSON.parse(outreach.evidence_ids);

  // One transaction. These four writes describe a single fact — this email went
  // out — and a crash between them leaves the email sent with its evidence
  // unlocked, so the next person on the ladder gets the same hook and the two
  // of them compare notes. The `WHERE status <> 'sent'` guard makes it
  // idempotent: the repair sweep and the send path can both arrive here for the
  // same row, and only the first does anything.
  const recorded = await transaction(async (tx) => {
    const changed = await tx.execute(
      `UPDATE outreach
          SET status = 'sent', gmail_message_id = ?, gmail_thread_id = ?,
              sent_body_verbatim = ?, sent_at = ?, sent_date_uae = ?,
              references_chain = ?, updated_at = ?
        WHERE id = ? AND status <> 'sent'`,
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
    if (changed === 0) return false;

    // Never over a reply. A message that arrived while the Gmail call was in
    // flight has already been recorded by the poller, and forcing the person
    // back to `in_sequence` would erase it — the sequence then carries on
    // chasing somebody who has already answered.
    await tx.execute(
      `UPDATE person SET status = 'in_sequence', updated_at = ?
        WHERE id = ? AND status IN ('ready', 'queued', 'in_sequence')`,
      [at, input.personId]
    );

    // The cross-client ledger. Redundant with one user, which is the point.
    await tx.execute(
      `INSERT INTO contact_ledger (id, person_id, user_id, outreach_id, evidence_ids, sent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId('ledger'), input.personId, input.userId, outreach.id, outreach.evidence_ids, at]
    );
    return true;
  });

  if (!recorded) return;

  // The hook is spent for this company. Rotation now needs a different one.
  await lockEvidenceForSend(evidenceIds, input.personId, input.userId);

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

/**
 * Did Gmail accept a message carrying our Message-ID?
 *
 * Returns the send time as well, because a recovery can happen a day after the
 * fact: dating it "now" would move the whole cadence a day and spend the wrong
 * day's budget on an email that went out yesterday.
 */
async function probeForSentMessage(
  userId: string,
  messageId: string
): Promise<{ id: string; threadId: string; internalDate?: string } | null> {
  try {
    const bare = messageId.replace(/^<|>$/g, '');
    const result = await gmailRequest<{ messages?: Array<{ id: string; threadId: string }> }>(
      userId,
      '/users/me/messages',
      { query: { q: `rfc822msgid:${bare}`, maxResults: '1' } }
    );
    const hit = result.messages?.[0];
    if (!hit) return null;

    try {
      const full = await gmailRequest<{ internalDate?: string }>(userId, `/users/me/messages/${hit.id}`, {
        query: { format: 'metadata' },
      });
      return { id: hit.id, threadId: hit.threadId, internalDate: full.internalDate };
    } catch {
      return { id: hit.id, threadId: hit.threadId };
    }
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
  if (stuck.length === 0) return { recovered: 0, reverted: 0, pending: 0 };

  const owner = await queryOne<{ signature_block: string | null; canonical_name: string | null; name: string }>(
    'SELECT signature_block, canonical_name, name FROM app_user WHERE id = ?',
    [userId]
  );
  const signature = owner?.signature_block ?? null;

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
      const sentAt = found.internalDate ? new Date(Number(found.internalDate)) : now;
      await recordSent(row, {
        gmailMessageId: found.id,
        gmailThreadId: found.threadId,
        messageId: row.rfc822_message_id!,
        // The signature went out with it, so the verbatim record has to include
        // it — this column is what follow-up generation and any later dispute
        // read, and "what we think we sent" is not good enough for either.
        body: withSignature(row.body ?? '', signature, owner?.canonical_name ?? owner?.name ?? null),
        references: JSON.parse(row.references_chain),
        userId,
        personId: row.person_id,
        now,
        // Dated when it actually went out, which may be yesterday.
        sentDateUae: toUaeDate(sentAt),
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

/**
 * Sends an approved reply.
 *
 * The same shape as a cold send — claim, persist the Message-ID, call Gmail,
 * probe rather than retry — with three deliberate differences:
 *
 *   - **No budget, no window, no spacing, and no pause.** Answering someone who
 *     wrote to you is not outreach and must never be rationed by a
 *     deliverability ceiling or held for a Monday. The `paused` and `placed`
 *     gates are skipped for the same reason, and in the placed case it is
 *     load-bearing: "I got the job" routes every warm thread to a courteous
 *     withdrawal through this exact path, and blocking it would leave the user
 *     silently ghosting the people who helped them.
 *   - **No suppression check on the recipient.** They emailed us. Refusing to
 *     answer a removal request because the address is suppressed would be the
 *     tool preventing the one reply that request requires.
 *   - **An attachment is possible**, for exactly one case: they asked for the
 *     CV.
 *
 * The connection gate still applies: nothing sends while the Gmail connection
 * is not live. Unlike a cold send, the six-hour poll-staleness gate does not —
 * that rule exists so nobody is chased after they answered, and this *is* the
 * answer to somebody who wrote.
 */
export async function sendReply(
  replyId: string,
  user: User,
  now: Date = new Date()
): Promise<SendResult> {
  if (user.connectionState !== 'connected') {
    return {
      ok: false,
      outreachId: replyId,
      message: 'Reconnect your email to send this — nothing is lost.',
      reason: 'blocked',
    };
  }

  const reply = await queryOne<{
    id: string;
    person_id: string;
    subject: string | null;
    body: string | null;
    classification: string;
    gmail_thread_id: string | null;
    in_reply_to: string | null;
    references_chain: string;
    status: string;
    reply_to_address: string | null;
    from_address: string | null;
  }>(
    `SELECT r.*, i.reply_to_address, i.from_address
       FROM reply_draft r JOIN inbound i ON i.id = r.inbound_id
      WHERE r.id = ? AND r.user_id = ?`,
    [replyId, user.id]
  );

  if (!reply) return { ok: false, outreachId: replyId, message: 'That one is no longer here.', reason: 'not_approved' };
  if (!reply.body?.trim()) {
    return { ok: false, outreachId: replyId, message: 'There is nothing written yet.', reason: 'not_approved' };
  }

  const person = await queryOne<{ email: string | null; full_name_raw: string }>(
    'SELECT email, full_name_raw FROM person WHERE id = ?',
    [reply.person_id]
  );
  if (!person?.email) {
    return { ok: false, outreachId: replyId, message: 'There is no address to reply to.', reason: 'no_address' };
  }

  const { claimReplyForSend } = await import('./reply-assist');
  const messageId = await claimReplyForSend(replyId, user.id);
  if (!messageId) {
    return {
      ok: false,
      outreachId: replyId,
      message: reply.status === 'sent' ? 'Already sent.' : 'Approve it first.',
      reason: reply.status === 'sending' ? 'already_sending' : 'not_approved',
    };
  }

  let attachment: Attachment | null = null;
  if (reply.classification === 'document_request') {
    const { currentCv, cvContent } = await import('./cv');
    const current = await currentCv(user.id);
    // Only an approved CV is ever attached. An unreviewed one going to a hiring
    // manager is worse than a line saying it is coming.
    if (current?.approved) {
      const file = await cvContent(user.id, current.id);
      if (file) {
        attachment = { filename: file.filename, mimeType: file.mimeType, content: file.content };
      }
    }

    // The drafted body says "my CV is attached", because that is what the
    // intent line told the model to write. Sending that sentence with nothing
    // attached is worse than not replying at all: it reads as careless to the
    // one person who asked for something concrete, and the user only finds out
    // when they do not hear back. Refuse rather than send it.
    if (!attachment) {
      await execute(`UPDATE reply_draft SET status = 'approved', updated_at = ? WHERE id = ?`, [
        nowIso(now),
        replyId,
      ]);
      return {
        ok: false,
        outreachId: replyId,
        message: current
          ? 'This reply says your CV is attached, and your CV is not approved yet. Approve it first — it takes one look.'
          : 'This reply says your CV is attached, and there is no CV on file yet. Add one and it will go with this.',
        reason: 'no_address',
      };
    }
  }

  const body = withSignature(reply.body, user.signatureBlock, user.canonicalName ?? user.name);
  const references: string[] = JSON.parse(reply.references_chain);

  // Answer whoever actually wrote, not whoever we originally wrote to.
  // Thread-first matching is the whole design here: legal-compliance@ replying
  // about a PDPL matter, or a colleague answering on someone's behalf, both
  // attach to this outreach — and sending the answer to the original contact
  // instead is worse than not answering, because the person who raised it never
  // hears back and the person who did not raise it gets an apology.
  const toEmail = reply.reply_to_address || reply.from_address || person.email;
  const toName = toEmail.toLowerCase() === person.email.toLowerCase() ? person.full_name_raw : null;

  const mime = buildReplyMime({
    fromName: user.canonicalName ?? user.name,
    fromEmail: user.sendAsEmail ?? user.gmailAddress!,
    toName,
    toEmail,
    subject: reply.subject ?? '',
    body,
    messageId,
    inReplyTo: reply.in_reply_to,
    references,
    attachment,
  });

  const at = nowIso(now);
  try {
    const response = await gmailRequest<{ id: string; threadId: string }>(user.id, '/users/me/messages/send', {
      method: 'POST',
      body: {
        raw: toGmailRaw(mime),
        ...(reply.gmail_thread_id ? { threadId: reply.gmail_thread_id } : {}),
      },
    });

    await execute(
      `UPDATE reply_draft
          SET status = 'sent', gmail_message_id = ?, gmail_thread_id = ?,
              sent_body_verbatim = ?, sent_at = ?, updated_at = ?
        WHERE id = ?`,
      [response.id, response.threadId, body, at, at, replyId]
    );
    await resolveReplyActions(user.id, reply.person_id, at);

    await logEvent({
      event: 'sent',
      userId: user.id,
      entityType: 'reply',
      entityId: replyId,
      detail: { classification: reply.classification, attachedCv: attachment !== null },
    });

    return { ok: true, outreachId: replyId, gmailMessageId: response.id, message: 'Sent.' };
  } catch (e) {
    const found = await probeForSentMessage(user.id, messageId);
    if (found) {
      // It went out; only the response was lost. Everything the happy path does
      // has to happen here too, or the user is left looking at a card asking
      // them to reply to somebody they have already replied to.
      await execute(
        `UPDATE reply_draft SET status = 'sent', gmail_message_id = ?, sent_body_verbatim = ?,
                                sent_at = ?, updated_at = ? WHERE id = ?`,
        [found.id, body, at, at, replyId]
      );
      await resolveReplyActions(user.id, reply.person_id, at);
      await logEvent({
        event: 'sent',
        userId: user.id,
        entityType: 'reply',
        entityId: replyId,
        detail: { classification: reply.classification, attachedCv: attachment !== null, recovered: true },
      });
      return { ok: true, outreachId: replyId, gmailMessageId: found.id, message: 'Sent.' };
    }

    // Back to approved so the button works again — the user is standing here
    // waiting, unlike a cold send. The Message-ID is deliberately kept on the
    // row: the next attempt reuses it, so if this one did in fact reach Gmail
    // and only the response was lost, the probe above finds it and the retry
    // records rather than duplicates.
    await execute(`UPDATE reply_draft SET status = 'approved', updated_at = ? WHERE id = ?`, [at, replyId]);
    await logError('error', e, { userId: user.id, entityType: 'reply', entityId: replyId });
    return {
      ok: false,
      outreachId: replyId,
      message:
        e instanceof GmailError
          ? e.userMessage
          : 'We could not reach your email just now. Nothing was lost — try again shortly.',
      reason: 'gmail_error',
    };
  }
}

/**
 * The actions that sending a reply discharges — and only those.
 *
 * Resolving everything open for the person would silently clear the "mark this
 * as Not Spam" prompt, which is the one that trains Gmail and is not done by
 * replying, and any "add their successor" note.
 */
async function resolveReplyActions(userId: string, personId: string, at: string): Promise<void> {
  await execute(
    `UPDATE next_action SET resolved_at = ?
      WHERE user_id = ? AND person_id = ? AND resolved_at IS NULL
        AND kind IN ('reply_assist', 'reply_assist_cv', 'warm_reply', 'confirm_removal',
                     'apologise_once', 'answer_provenance', 'thank_you', 'honest_pivot')`,
    [at, userId, personId]
  );
}

/** Approves a draft. Separate from sending: approval is the human's act. */
export async function approveDraft(outreachId: string, editedBody?: string): Promise<boolean> {
  // `stale` is deliberately absent unless the user rewrote it themselves.
  //
  // Stale means the wording is out of date — the gap it references has grown,
  // or a holiday moved underneath it — and it is waiting to be regenerated.
  // Approving one as-is sends "since my note last week" two weeks late. An
  // edited body is different: the user has just read and rewritten it, so it is
  // theirs and current by definition.
  const allowed = editedBody ? "('drafted', 'stale', 'approved')" : "('drafted', 'approved')";
  const changed = await execute(
    `UPDATE outreach
        SET status = 'approved', body = COALESCE(?, body), updated_at = ?
      WHERE id = ? AND status IN ${allowed}`,
    [editedBody ?? null, nowIso(), outreachId]
  );
  return changed === 1;
}
