/**
 * What a classified message does to the state.
 *
 * Every transition here exists because of a specific way the naive version
 * embarrasses the user. The comments name the failure rather than restating the
 * code, because in six months the code will be obvious and the reason will not.
 */
import { addDays, nextDue, todayUae } from './calendar';
import { loadCalendar } from './calendar-store';
import type { Classification, ClassificationResult } from './classifier';
import { execute, query, queryOne, transaction } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';
import { markDeparted, suppress } from './people';

export interface TransitionResult {
  /** What the founder sees in the log, and the user sees on the dashboard. */
  summary: string;
  personStatus?: string;
  companyStatus?: string;
  superseded: number;
  /** Something a human has to do, surfaced at the top of the queue. */
  action?: { kind: string; message: string; url?: string | null };
}

interface Context {
  userId: string;
  personId: string;
  companyId: string;
  inboundId: string;
  now: Date;
}

/**
 * Applies one classification.
 *
 * The supersede is atomic and happens first for anything that counts as a
 * reply: the contact says "happy to chat" at 08:40 and the pre-drafted bump
 * must not be sendable at 09:05.
 */
export async function applyClassification(
  result: ClassificationResult,
  context: Context
): Promise<TransitionResult> {
  const handler = HANDLERS[result.classification];
  const outcome = await handler(result, context);

  await logEvent({
    event: outcome.summary.startsWith('Bounce') ? 'bounce' : 'reply',
    userId: context.userId,
    entityType: 'person',
    entityId: context.personId,
    detail: {
      classification: result.classification,
      via: result.via,
      confidence: result.confidence,
      language: result.language,
      summary: outcome.summary,
    },
  });

  return outcome;
}

/**
 * Everything queued, drafted or approved for this person becomes terminal, in
 * one transaction. The poller can lose the race with a user pressing Send; this
 * is what makes losing it harmless.
 */
async function supersedeQueued(personId: string, at: string): Promise<number> {
  return transaction(async (tx) =>
    tx.execute(
      `UPDATE outreach
          SET status = 'superseded_by_reply', updated_at = ?
        WHERE person_id = ? AND status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved')`,
      [at, personId]
    )
  );
}

async function setCompanyState(
  userId: string,
  companyId: string,
  status: string,
  dormantUntil: string | null,
  at: string
): Promise<void> {
  await execute(
    `INSERT INTO user_company_state (user_id, company_id, status, dormant_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, company_id) DO UPDATE SET
       status = excluded.status, dormant_until = excluded.dormant_until, updated_at = excluded.updated_at`,
    [userId, companyId, status, dormantUntil, at, at]
  );
}

/**
 * Freezes every other live sequence at this organisation.
 *
 * A positive reply makes the whole company one conversation. Person 2 receiving
 * a cold email at the company the user is visiting on Tuesday is the failure
 * this prevents.
 */
async function freezeSiblings(userId: string, companyId: string, exceptPersonId: string, at: string): Promise<number> {
  return execute(
    `UPDATE outreach
        SET status = 'paused_pending_reply', updated_at = ?
      WHERE user_id = ?
        AND status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved')
        AND person_id IN (SELECT id FROM person WHERE company_id = ? AND id <> ?)`,
    [at, userId, companyId, exceptPersonId]
  );
}

type Handler = (result: ClassificationResult, context: Context) => Promise<TransitionResult>;

const HANDLERS: Record<Classification, Handler> = {
  // -------------------------------------------------------------------------
  // Real replies
  // -------------------------------------------------------------------------

  human_positive: async (_result, { userId, personId, companyId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'replied', updated_at = ? WHERE id = ?`, [at, personId]);

    // The whole company freezes, not just this person. No calendar integration
    // exists in v1, so an interview being arranged in Gmail is invisible to us
    // — and a cold email to a colleague mid-arrangement is unrecoverable.
    await setCompanyState(userId, companyId, 'in_conversation', null, at);
    const frozen = await freezeSiblings(userId, companyId, personId, at);

    return {
      summary: 'Positive reply. The whole company is on hold until you resolve it.',
      personStatus: 'replied',
      companyStatus: 'in_conversation',
      superseded: superseded + frozen,
      action: {
        kind: 'reply_assist',
        message: 'Reply within a working day. This is the moment the whole thing was for.',
      },
    };
  },

  neutral_question: async (_result, { personId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'replied', updated_at = ? WHERE id = ?`, [at, personId]);
    return {
      summary: 'They asked something. Answer it.',
      personStatus: 'replied',
      superseded,
      action: { kind: 'reply_assist', message: 'They asked you a question. Answering today keeps this alive.' },
    };
  },

  document_request: async (_result, { personId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'replied', updated_at = ? WHERE id = ?`, [at, personId]);
    return {
      summary: 'They asked for your CV.',
      personStatus: 'replied',
      superseded,
      action: {
        kind: 'reply_assist_cv',
        message: 'They asked for your CV. It is ready — this is a two-tap reply, and it is urgent.',
      },
    };
  },

  // -------------------------------------------------------------------------
  // No
  // -------------------------------------------------------------------------

  rejection_hard: async (_result, { userId, personId, companyId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'closed_silent', updated_at = ? WHERE id = ?`, [at, personId]);

    // A no kills the whole ladder. "Our quota is met this year" recorded as a
    // terminal reply for one person means the HR lead gets emailed after
    // cooldown and walks over: didn't you already tell this guy no?
    const dormantUntil = addDays(todayUae(now), 90);
    await setCompanyState(userId, companyId, 'dormant', dormantUntil, at);
    const frozen = await freezeSiblings(userId, companyId, personId, at);
    await execute(
      `UPDATE person SET status = 'closed_silent', updated_at = ?
        WHERE company_id = ? AND status IN ('ready', 'queued', 'in_sequence')`,
      [at, companyId]
    );

    return {
      summary: `They said no. The company rests until ${dormantUntil}.`,
      personStatus: 'closed_silent',
      companyStatus: 'dormant',
      superseded: superseded + frozen,
      action: {
        kind: 'thank_you',
        message: 'A short thank-you costs nothing and they remember it. Closed and moved on — this is how the numbers work.',
      },
    };
  },

  rejection_soft: async (result, { userId, personId, companyId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'closed_silent', updated_at = ? WHERE id = ?`, [at, personId]);

    // A stated timeframe is a re-approach date. Honouring it, and saying so,
    // converts a no-for-now into the warmest possible later opening.
    const until = result.extracted.date ?? addDays(todayUae(now), 90);
    await setCompanyState(userId, companyId, 'dormant', until, at);
    await freezeSiblings(userId, companyId, personId, at);

    return {
      summary: `Not now. We will come back on ${until}, referencing what they said.`,
      personStatus: 'closed_silent',
      companyStatus: 'dormant',
      superseded,
    };
  },

  removal_request: async (_result, { userId, personId, companyId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);

    const person = await queryOne<{ email: string | null }>('SELECT email FROM person WHERE id = ?', [personId]);
    if (person?.email) {
      await suppress({ email: person.email, scope: 'person', reason: 'removal_request' });
    }
    // Person AND company. Five days later the ladder would otherwise cold-email
    // the colleague two desks away, who forwards it to IT.
    await setCompanyState(userId, companyId, 'suppressed_by_request', null, at);
    const frozen = await freezeSiblings(userId, companyId, personId, at);

    return {
      summary: 'They asked us to stop. That is permanent, for them and the company.',
      personStatus: 'suppressed',
      companyStatus: 'suppressed_by_request',
      superseded: superseded + frozen,
      action: {
        kind: 'confirm_removal',
        message: 'One line confirming you have removed them. Not a red failure — this is how the numbers work.',
      },
    };
  },

  complaint_escalation: async (_result, { userId, personId, companyId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);

    const company = await queryOne<{ domain: string }>('SELECT domain FROM company WHERE id = ?', [companyId]);
    if (company) await suppress({ domain: company.domain, scope: 'domain', reason: 'complaint_escalation' });

    await setCompanyState(userId, companyId, 'suppressed_by_request', null, at);
    const frozen = await freezeSiblings(userId, companyId, personId, at);

    return {
      summary: 'A complaint. The whole domain is suppressed, now rather than at the next sweep.',
      companyStatus: 'suppressed_by_request',
      superseded: superseded + frozen,
      action: {
        kind: 'apologise_once',
        message: 'One short apology, then nothing further. Reply once, never argue.',
      },
    };
  },

  // -------------------------------------------------------------------------
  // Redirections
  // -------------------------------------------------------------------------

  referral: async (result, { userId, personId, companyId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'replied', updated_at = ? WHERE id = ?`, [at, personId]);

    // Everyone on this thread is warm now. Cold-emailing someone you were just
    // introduced to is the single most avoidable embarrassment in the product.
    await markThreadParticipantsWarm(personId, companyId, at);

    await setCompanyState(userId, companyId, 'paused_referral', null, at);
    const frozen = await freezeSiblings(userId, companyId, personId, at);

    return {
      summary: result.extracted.successor
        ? `They pointed you at ${result.extracted.successor}. Everyone on that thread is warm now.`
        : 'They pointed you at someone else. Everyone on that thread is warm now.',
      personStatus: 'replied',
      companyStatus: 'paused_referral',
      superseded: superseded + frozen,
      action: {
        kind: 'warm_reply',
        message: 'Reply in the thread they made, not with a new cold email. The introduction is the whole value.',
      },
    };
  },

  departed: async (result, { userId, personId, companyId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await markDeparted(personId, result.extracted.successor);

    return {
      summary: result.extracted.successor
        ? `${result.extracted.successor} has taken over. Their evidence is stale.`
        : 'They have left. Their evidence is stale and the ladder moves on.',
      personStatus: 'departed',
      superseded,
      action: result.extracted.successor
        ? {
            kind: 'add_successor',
            message: `Add ${result.extracted.successor} — an email that honestly references the redirect is warm, not cold.`,
          }
        : undefined,
    };
  },

  prior_contact_callout: async (_result, { personId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'replied', updated_at = ? WHERE id = ?`, [at, personId]);
    return {
      summary: 'They noticed you wrote to a colleague.',
      personStatus: 'replied',
      superseded,
      action: {
        kind: 'honest_pivot',
        message:
          'Say why, plainly: you were not sure who owns this, and it looks like they do. Dodging gets you caught being strategic in a small office.',
      },
    };
  },

  provenance_challenge: async (_result, { personId, now }) => {
    const at = nowIso(now);
    const superseded = await supersedeQueued(personId, at);
    await execute(`UPDATE person SET status = 'replied', updated_at = ? WHERE id = ?`, [at, personId]);

    const sources = await query<{ url: string }>('SELECT url FROM person_source WHERE person_id = ?', [personId]);

    return {
      summary: 'They asked how you got their address.',
      personStatus: 'replied',
      superseded,
      action: {
        kind: 'answer_provenance',
        message: sources.length
          ? `Answer honestly: you saw their role on ${sources[0].url} and used the company's standard address format. Honesty converts some of these into conversations; evasion converts all of them into spam reports.`
          : "Answer honestly about where you found them and how the address was worked out. Evasion converts this into a spam report.",
      },
    };
  },

  // -------------------------------------------------------------------------
  // Not replies
  // -------------------------------------------------------------------------

  auto_reply_ooo: async (result, { personId, now }) => {
    const calendar = await loadCalendar();
    const at = nowIso(now);

    // Not a reply and not a touch. Reschedule and regenerate the opener — the
    // gap makes "following up on my note" wrong, and a warm "hope you had a
    // good break" is what a person would actually write.
    //
    // No parseable date means five working days, not a guess: a wrong date
    // fires "Eid Mubarak" a week late, which is worse than a generic opener.
    const resumeOn = result.extracted.date
      ? nextDue(result.extracted.date, 2, calendar)
      : nextDue(todayUae(now), 5, calendar);

    // Written to `hold_until` as well as `scheduled_date`. The nightly
    // recomputation derives dates from the calendar and would otherwise undo
    // this within hours, firing the follow-up into the empty office anyway.
    // If the shift lands past the break-up, the cadence stretches — the
    // sequence is never closed for being away.
    const moved = await execute(
      `UPDATE outreach
          SET scheduled_date = ?, hold_until = ?, regenerate_at_send = 1,
              status = 'stale', updated_at = ?
        WHERE person_id = ? AND status IN ('queued', 'drafted', 'approved', 'stale')`,
      [resumeOn, resumeOn, at, personId]
    );

    return {
      summary: result.extracted.date
        ? `Out of office until ${result.extracted.date}. Picking up ${resumeOn}.`
        : `Out of office. Pausing until ${resumeOn}.`,
      superseded: 0,
      action: moved > 0 ? undefined : { kind: 'none', message: '' },
    };
  },

  auto_ack_unmonitored: async (result, { personId, now }) => {
    const at = nowIso(now);
    await execute(
      `UPDATE person SET status = 'dead_end_mailbox', role_based = 1, updated_at = ? WHERE id = ?`,
      [at, personId]
    );
    await execute(
      `UPDATE outreach SET status = 'closed', updated_at = ?
        WHERE person_id = ? AND status IN ('queued', 'drafted', 'approved', 'stale', 'needs_fact')`,
      [at, personId]
    );

    // Nobody human saw anything, so the full cooldown would be wasted — the
    // ladder advances after a short gap instead.
    return {
      summary: 'An automated acknowledgement from an unmonitored mailbox. Not a reply, and not a touch.',
      personStatus: 'dead_end_mailbox',
      superseded: 0,
      action: result.extracted.url
        ? { kind: 'portal', message: 'They pointed at a portal. Worth applying through it by hand.', url: result.extracted.url }
        : undefined,
    };
  },

  gateway_challenge: async (result, { personId, companyId, now }) => {
    const at = nowIso(now);

    // The countdown is running on an email nobody has seen. Follow-ups would
    // fire into quarantine and the ladder would rotate off the best contact for
    // false silence.
    await execute(
      `UPDATE outreach
          SET scheduled_date = NULL, countdown_paused = 1, status = 'stale', updated_at = ?
        WHERE person_id = ? AND status IN ('queued', 'drafted', 'approved')`,
      [at, personId]
    );
    await execute('UPDATE company SET gateway = 1, updated_at = ? WHERE id = ?', [at, companyId]);

    return {
      summary: 'The message was quarantined by their gateway. The countdown is paused.',
      superseded: 0,
      action: {
        kind: 'gateway',
        message: 'Their system wants you to confirm you are a person. One click, and the sequence restarts from day zero.',
        url: result.extracted.url,
      },
    };
  },

  bounce: async (result, { personId, companyId, now }) => {
    const at = nowIso(now);
    const soft = result.note.includes('soft');

    if (soft) {
      const calendar = await loadCalendar();
      const retryOn = nextDue(todayUae(now), 1, calendar);
      await execute(
        `UPDATE outreach SET scheduled_date = ?, hold_until = ?, status = 'stale', updated_at = ?
          WHERE person_id = ? AND status IN ('approved', 'drafted')`,
        [retryOn, retryOn, at, personId]
      );
      return {
        summary: `Bounce, temporary. Their mailbox was full or their server was busy. Retrying ${retryOn}.`,
        superseded: 0,
      };
    }

    const person = await queryOne<{ email: string | null }>('SELECT email FROM person WHERE id = ?', [personId]);
    await execute(`UPDATE person SET email_status = 'bounced', status = 'closed_silent', updated_at = ? WHERE id = ?`, [
      at,
      personId,
    ]);
    await execute(
      `UPDATE outreach SET status = 'bounced', updated_at = ?
        WHERE person_id = ? AND status IN ('queued', 'drafted', 'approved', 'stale', 'sent')`,
      [at, personId]
    );

    // If this was the domain's only exemplar, every sibling address minted from
    // its pattern is a guess again.
    if (person?.email) {
      const { markExemplarBounced } = await import('./email-pattern');
      await markExemplarBounced(person.email);
    }

    return {
      // Framing matters: this is a routine, uninformative event and the user
      // should not read it as their fault or as a failure.
      summary: "Bounce. That address wasn't active — usually it means they changed jobs. Moving to the next contact.",
      personStatus: 'closed_silent',
      superseded: 0,
      action: { kind: 'rotate', message: 'Nobody saw anything, so the next person can be approached right away.' },
    };
  },
};

/**
 * Anyone on an inbound thread is warm, and a cold sequence to them is blocked.
 *
 * The person copied into a referral is frequently already rank 2 on the ladder,
 * which is exactly how they end up receiving a cold email days after a warm
 * introduction.
 */
async function markThreadParticipantsWarm(personId: string, companyId: string, at: string): Promise<void> {
  const inbound = await query<{ from_address: string; to_addresses: string; cc_addresses: string }>(
    'SELECT from_address, to_addresses, cc_addresses FROM inbound WHERE person_id = ?',
    [personId]
  );

  const addresses = new Set<string>();
  for (const row of inbound) {
    addresses.add(row.from_address.toLowerCase());
    for (const list of [row.to_addresses, row.cc_addresses]) {
      for (const address of JSON.parse(list) as string[]) addresses.add(address.toLowerCase());
    }
  }
  if (addresses.size === 0) return;

  const placeholders = [...addresses].map(() => '?').join(', ');
  await execute(
    `UPDATE person SET in_warm_thread = 1, updated_at = ?
      WHERE company_id = ? AND lower(email) IN (${placeholders})`,
    [at, companyId, ...addresses]
  );
}

/**
 * A reply arriving after the sequence closed and the company went dormant.
 *
 * Three weeks post-breakup, "we just opened two Nafis-track roles" is the best
 * email the user will get all month, and polling only active sequences would
 * miss it entirely.
 */
export async function reopenForLateReply(
  userId: string,
  personId: string,
  companyId: string,
  now: Date = new Date()
): Promise<TransitionResult> {
  const at = nowIso(now);
  await execute(`UPDATE person SET status = 'replied', updated_at = ? WHERE id = ?`, [at, personId]);
  await setCompanyState(userId, companyId, 'paused_late_reply', null, at);
  const frozen = await freezeSiblings(userId, companyId, personId, at);

  return {
    summary: 'A late reply on a thread we had closed. The company is on hold again.',
    personStatus: 'replied',
    companyStatus: 'paused_late_reply',
    superseded: frozen,
    action: { kind: 'reply_assist', message: 'They came back to you weeks later. That is a strong signal — answer it today.' },
  };
}

/**
 * Person 1 replies after person 2's sequence has already started.
 *
 * A reply always wins. Person 2 pauses rather than closing, because "person 1
 * was a dead end" is a real outcome and resuming should not need re-sourcing.
 */
export async function resolveReplyConflict(
  userId: string,
  companyId: string,
  keepPersonId: string,
  choice: 'going_with_reply' | 'reply_was_dead_end',
  now: Date = new Date()
): Promise<TransitionResult> {
  const at = nowIso(now);

  if (choice === 'going_with_reply') {
    // Only email 1 ever went out to person 2. Never send a retraction.
    await execute(
      `UPDATE person SET status = 'closed_silent', updated_at = ?
        WHERE company_id = ? AND id <> ? AND status IN ('in_sequence', 'queued', 'ready')`,
      [at, companyId, keepPersonId]
    );
    await execute(
      `UPDATE outreach SET status = 'closed', updated_at = ?
        WHERE user_id = ? AND status = 'paused_pending_reply'
          AND person_id IN (SELECT id FROM person WHERE company_id = ? AND id <> ?)`,
      [at, userId, companyId, keepPersonId]
    );
    await setCompanyState(userId, companyId, 'in_conversation', null, at);
    return { summary: 'Going with the person who replied. The other sequence closed quietly.', superseded: 0 };
  }

  // Resume, through the stale-redraft rule so the dates and the wording are
  // both recomputed rather than picked up mid-sentence.
  const resumed = await execute(
    `UPDATE outreach SET status = 'stale', updated_at = ?
      WHERE user_id = ? AND status = 'paused_pending_reply'
        AND person_id IN (SELECT id FROM person WHERE company_id = ?)`,
    [at, userId, companyId]
  );
  await setCompanyState(userId, companyId, 'active', null, at);
  return { summary: `Resuming ${resumed} paused step(s) with fresh dates and wording.`, superseded: 0 };
}

/**
 * The user replied from Gmail themselves, or sent a copy-pasted draft by hand.
 *
 * Four days later the tool would otherwise send "just checking you saw this"
 * into a warm thread. Any message on a tracked thread authored by the user's
 * own address, that is not one of ours, means they have taken over.
 */
export async function markUserTookOver(personId: string, now: Date = new Date()): Promise<TransitionResult> {
  const at = nowIso(now);
  await execute(`UPDATE person SET status = 'user_took_over', updated_at = ? WHERE id = ?`, [at, personId]);
  const cancelled = await execute(
    `UPDATE outreach SET status = 'closed', updated_at = ?
      WHERE person_id = ? AND status IN ('queued', 'drafted', 'approved', 'stale', 'needs_fact')`,
    [at, personId]
  );
  return {
    summary: 'You replied to this one yourself, so the queued follow-ups are cancelled.',
    personStatus: 'user_took_over',
    superseded: cancelled,
    action: { kind: 'resume_offer', message: 'Want us to pick this thread back up?' },
  };
}

/** Records an inbound message. Thread-first: the sender need not be known. */
export async function recordInbound(input: {
  outreachId: string | null;
  personId: string | null;
  threadId: string;
  messageId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  receivedAt: string;
  classification: ClassificationResult;
}): Promise<string> {
  const id = newId('inbound');
  await execute(
    `INSERT INTO inbound
       (id, outreach_id, person_id, gmail_thread_id, gmail_message_id, from_address, to_addresses,
        cc_addresses, subject, body_text, language, classification, classifier_note,
        extracted_date, extracted_successor, extracted_url, received_at, processed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (gmail_message_id) DO NOTHING`,
    [
      id,
      input.outreachId,
      input.personId,
      input.threadId,
      input.messageId,
      input.from,
      JSON.stringify(input.to),
      JSON.stringify(input.cc),
      input.subject,
      input.body.slice(0, 20000),
      input.classification.language,
      input.classification.classification,
      `${input.classification.via}/${input.classification.confidence}: ${input.classification.note}`,
      input.classification.extracted.date ?? null,
      input.classification.extracted.successor ?? null,
      input.classification.extracted.url ?? null,
      input.receivedAt,
      nowIso(),
      nowIso(),
    ]
  );

  // The insert may have been skipped as a duplicate — polling is idempotent and
  // the same message is seen every sweep. Returning the id we minted rather
  // than the one that exists would hand callers a dangling reference, and the
  // next foreign key that points at it fails.
  const stored = await queryOne<{ id: string }>('SELECT id FROM inbound WHERE gmail_message_id = ?', [
    input.messageId,
  ]);
  return stored?.id ?? id;
}
