/**
 * Answering a real reply.
 *
 * The register calls this the product's climax and its most likely point of
 * failure in the same sentence: the interview invite arrives, the user panics,
 * decides to "do it properly tomorrow", and four days later the manager has
 * moved on. Everything else in this codebase exists to produce this moment.
 *
 * Three decisions follow from that.
 *
 * **A reply is a queue item, not an exit.** It is drafted, reviewed and sent
 * through the same screen as everything else, so the user never has to switch
 * into a different mode of working while nervous.
 *
 * **The same clarify-and-refuse contract applies.** A reply is the email most
 * likely to contain a specific question — notice period, salary, when can you
 * start — and therefore the one where a helpful model is most tempted to invent
 * an answer on the user's behalf. A missing fact becomes a one-tap question to
 * the user. It is never guessed. The user's name is on this.
 *
 * **The countdown is one working day, shown in hours.** "Due tomorrow" is easy
 * to postpone. "9 hours left" is not.
 */
import { addDays, isWorkingDay, nextWorkingDay, todayUae, type WorkingCalendar } from './calendar';
import { loadCalendar } from './calendar-store';
import type { Classification } from './classifier';
import { askClaude, isClaudeConfigured } from './claude';
import { execute, query, queryOne } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';
import { newMessageId, replySubject } from './mime';
import { generatorProfile } from './profile';
import { BANNED_PHRASES } from './template';

/** Classifications that deserve a drafted answer. */
const WORTH_ANSWERING: Classification[] = [
  'human_positive',
  'neutral_question',
  'document_request',
  'referral',
  'rejection_hard',
  'rejection_soft',
  'removal_request',
  'complaint_escalation',
  'provenance_challenge',
  'prior_contact_callout',
  'departed',
];

/** What each kind of reply is for, in one line the model must obey. */
const INTENT: Partial<Record<Classification, string>> = {
  human_positive:
    'They are interested. Answer whatever they asked, confirm you are available, and make the next step easy to say yes to. Do not oversell — they already said yes to talking.',
  neutral_question:
    'They asked something specific. Answer exactly that, in the first line, and stop. Do not use their question as an opening to pitch again.',
  document_request:
    'They asked for your CV. Say it is attached, add one line of context, and nothing else. This is a two-line email.',
  referral:
    'They introduced you to a colleague. Thank the person who made the introduction in one line, then address the new person directly. The introduction is the whole value — do not restate your cold pitch to someone who now knows you.',
  rejection_hard:
    'They said no. Thank them for the clear answer, in two lines, asking for nothing. No "keep me in mind", no attempt to reopen. A graceful no is remembered in a small market.',
  rejection_soft:
    'They said not now, and may have named a time. Thank them, repeat the timeframe back so it is on record, and say you will come back then. Ask for nothing else.',
  removal_request:
    'They asked you to stop. One line confirming you have removed them and will not write again. No explanation, no defence, no final pitch.',
  complaint_escalation:
    'They are upset about being contacted. One short apology, no argument, no justification, no further contact. Reply once and stop.',
  provenance_challenge:
    'They asked how you got their address. Answer honestly and specifically using the source URL supplied, say the address was worked out from their company format, and apologise if it was unwelcome. Evasion turns this into a spam report.',
  prior_contact_callout:
    'They noticed you wrote to a colleague. Say plainly why: you were not sure who owns this, and it looks like they do. Do not dodge.',
  departed:
    'They or their system said the person has left. Thank whoever answered, and ask nothing further of them.',
};

const CONTRACT = `You write one short reply, in English, on behalf of an Emirati university student job-hunting in the UAE.

THE CONTRACT, WHICH OVERRIDES EVERY OTHER INSTRUCTION:
- You may state ONLY facts that appear in the PROFILE block below, or that the recipient themselves stated in the message you are answering.
- You may not invent a date, a notice period, a salary expectation, a qualification, an availability, or a preference. Not one.
- If answering them properly needs a fact you do not have, output exactly:
  ASK: <the single question to put to the student, in their own language, in one line>
  Asking is a correct answer. An invented commitment is not — the student has to live with whatever you write.
- Never apologise for writing to them unless the intent line below tells you to.
- Never restate the original pitch. They have read it.

VOICE:
- Under 90 words. Shorter is better; some of these are two lines.
- Plain words, short sentences. It should read like the student typed it themselves in two minutes.
- No em dashes, no exclamation marks, no bullet points.
- Banned outright: I came across · resonated · excited to · delve · leverage · passionate about · reaching out · pick your brain · virtual coffee · let's connect · I'd love to · just checking in · I know you're busy · circle back · touch base.
- Match their register: if they wrote formally, reply formally. If they wrote two words, do not write twelve lines.

OUTPUT FORMAT — nothing else:
BODY:
<the reply, without the greeting line and without the sign-off; both are added separately>`;

export interface ReplyDraft {
  id: string;
  personId: string;
  personName: string;
  companyName: string;
  classification: Classification;
  subject: string;
  body: string | null;
  question: string | null;
  status: string;
  /** Their message, so the user can see what they are answering. */
  inboundBody: string;
  inboundTranslated: string | null;
  inboundLanguage: string;
  dueDateUae: string | null;
  /** Working hours left, for the countdown. Negative means overdue. */
  hoursLeft: number | null;
  attachCv: boolean;
}

interface InboundRow {
  id: string;
  person_id: string;
  gmail_thread_id: string;
  gmail_message_id: string;
  rfc822_message_id: string | null;
  reply_to_address: string | null;
  from_address: string;
  subject: string | null;
  body_text: string | null;
  language: string | null;
  classification: Classification;
  received_at: string;
}

/**
 * Drafts a reply to one inbound message.
 *
 * Idempotent: `UNIQUE (inbound_id)` means the sweep can call this every fifteen
 * minutes without producing a stack of near-identical answers to the same
 * email.
 */
/**
 * Puts the card on the screen immediately, with no model call.
 *
 * Called from the poller, the moment a reply is classified. The countdown and
 * the recipient's own words are the parts that stop the user freezing; the
 * written draft is the convenience, and it can follow a few minutes later from
 * the sweep. Waiting for a Claude call before showing anything would mean a
 * reply that arrived at 09:00 was invisible until the cron ran at 09:15 — on
 * the one screen where minutes matter.
 */
export async function ensureReplyDraft(
  inboundId: string,
  userId: string,
  now: Date = new Date()
): Promise<string | null> {
  const inbound = await queryOne<InboundRow>('SELECT * FROM inbound WHERE id = ?', [inboundId]);
  if (!inbound?.person_id) return null;
  if (!WORTH_ANSWERING.includes(inbound.classification)) return null;

  const existing = await queryOne<{ id: string }>('SELECT id FROM reply_draft WHERE inbound_id = ?', [
    inboundId,
  ]);
  if (existing) return existing.id;

  const calendar = await loadCalendar();
  return store({
    userId,
    inbound,
    personId: inbound.person_id,
    subject: replySubject(inbound.subject ?? ''),
    body: null,
    question: 'Writing a suggested reply. It will appear here shortly — or write your own now, which is always better.',
    status: 'write_yourself',
    due: replyDeadline(calendar, now),
    now,
  });
}

export async function draftReply(
  inboundId: string,
  userId: string,
  now: Date = new Date()
): Promise<{ kind: 'drafted' | 'needs_fact' | 'write_yourself' | 'skipped'; id?: string; detail?: string }> {
  const inbound = await queryOne<InboundRow>('SELECT * FROM inbound WHERE id = ?', [inboundId]);
  if (!inbound?.person_id) return { kind: 'skipped', detail: 'no person on this thread' };
  if (!WORTH_ANSWERING.includes(inbound.classification)) {
    return { kind: 'skipped', detail: `${inbound.classification} needs no reply` };
  }

  const existing = await queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM reply_draft WHERE inbound_id = ?',
    [inboundId]
  );
  // Never rewrite something the user has already approved or sent. A
  // `write_yourself` row is retried: the API key may have been set since, and a
  // drafted reply beats an empty box.
  if (existing && existing.status !== 'needs_fact' && existing.status !== 'write_yourself') {
    return { kind: 'skipped', id: existing.id, detail: 'already drafted' };
  }

  const person = await queryOne<{
    full_name_raw: string;
    company_id: string;
    anchor_source_url: string | null;
  }>('SELECT full_name_raw, company_id, anchor_source_url FROM person WHERE id = ?', [inbound.person_id]);
  if (!person) return { kind: 'skipped', detail: 'person gone' };

  const company = await queryOne<{ name: string }>('SELECT name FROM company WHERE id = ?', [
    person.company_id,
  ]);

  const profile = await generatorProfile(userId);
  const calendar = await loadCalendar();
  const due = replyDeadline(calendar, now);

  // The thread, so a reply answers what was actually said rather than the
  // classification label. Our own sent bodies are included: "as I mentioned"
  // has to be true.
  const ours = await query<{ sent_body_verbatim: string | null; step: number }>(
    `SELECT sent_body_verbatim, step FROM outreach
      WHERE person_id = ? AND sent_body_verbatim IS NOT NULL ORDER BY step`,
    [inbound.person_id]
  );

  if (!isClaudeConfigured()) {
    // Degrade to the card without a body rather than to nothing. The coaching
    // and the countdown are most of the value; the draft is the convenience.
    const id = await store({
      existingId: existing?.id,
      userId,
      inbound,
      personId: inbound.person_id,
      subject: replySubject(inbound.subject ?? ''),
      body: null,
      question: 'The drafting service is not configured, so this one is yours to write. It is short — a few lines is right.',
      status: 'write_yourself',
      due,
      now,
    });
    return { kind: 'write_yourself', id };
  }

  const prompt = [
    `INTENT: ${INTENT[inbound.classification] ?? 'Answer them plainly and briefly.'}`,
    '',
    `THEY WROTE (${inbound.language ?? 'en'}):`,
    (inbound.body_text ?? '').slice(0, 4000),
    '',
    ours.length > 0 ? 'WHAT THE STUDENT SENT THEM EARLIER:' : '',
    ours.map((o) => `[touch ${o.step}] ${o.sent_body_verbatim}`).join('\n\n').slice(0, 3000),
    '',
    'PROFILE — the only facts you may state about the student:',
    Object.entries(profile)
      .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n'),
    inbound.classification === 'provenance_challenge' && person.anchor_source_url
      ? `\nWHERE THEIR ROLE WAS FOUND: ${person.anchor_source_url}`
      : '',
    '',
    `They are ${person.full_name_raw} at ${company?.name ?? 'their company'}.`,
  ]
    .filter(Boolean)
    .join('\n');

  // Translated before the draft, so the card can show the user what they are
  // approving even if the drafting call itself then fails.
  if (inbound.language && inbound.language !== 'en') await translateInbound(inbound.id);

  const raw = await askClaude({ system: CONTRACT, prompt, effort: 'medium', maxTokens: 900 });
  if (!raw) {
    const id = await store({
      existingId: existing?.id,
      userId,
      inbound,
      personId: inbound.person_id,
      subject: replySubject(inbound.subject ?? ''),
      body: null,
      question: 'We could not draft this one. It is short — worth writing yourself, today.',
      status: 'write_yourself',
      due,
      now,
    });
    return { kind: 'write_yourself', id };
  }

  const asked = raw.match(/^ASK:\s*(.+)$/m);
  if (asked) {
    const id = await store({
      existingId: existing?.id,
      userId,
      inbound,
      personId: inbound.person_id,
      subject: replySubject(inbound.subject ?? ''),
      body: null,
      question: asked[1].trim(),
      status: 'needs_fact',
      due,
      now,
    });
    await logEvent({
      event: 'draft_refused',
      userId,
      entityType: 'inbound',
      entityId: inboundId,
      detail: { stage: 'reply_assist', question: asked[1].trim() },
    });
    return { kind: 'needs_fact', id, detail: asked[1].trim() };
  }

  const body = raw.replace(/^BODY:\s*/im, '').trim();
  const banned = BANNED_PHRASES.filter((p) => p.phrase.test(body));
  if (banned.length > 0) {
    // One retry is not worth a second API call here: the reply is short, the
    // user is going to read it anyway, and a lint note on the card is more
    // honest than a silent rewrite.
    await logEvent({
      event: 'draft_generated',
      userId,
      entityType: 'inbound',
      entityId: inboundId,
      detail: { stage: 'reply_assist', lint: banned.map((b) => b.label) },
    });
  }

  const id = await store({
    existingId: existing?.id,
    userId,
    inbound,
    personId: inbound.person_id,
    subject: replySubject(inbound.subject ?? ''),
    body,
    question: null,
    status: 'drafted',
    due,
    now,
  });

  await logEvent({
    event: 'draft_generated',
    userId,
    entityType: 'inbound',
    entityId: inboundId,
    detail: { stage: 'reply_assist', classification: inbound.classification },
  });

  return { kind: 'drafted', id };
}

async function store(input: {
  existingId?: string;
  userId: string;
  inbound: InboundRow;
  personId: string;
  subject: string;
  body: string | null;
  question: string | null;
  status: string;
  due: string;
  now: Date;
}): Promise<string> {
  const at = nowIso(input.now);
  const id = input.existingId ?? newId('reply');

  // The reply threads on the message it answers, using its real RFC822
  // Message-ID. Gmail's API message id is an opaque internal handle, and
  // `<{that}@mail.gmail.com>` is a header that has never existed anywhere — a
  // reply carrying it arrives as an orphan in the very thread it answers.
  //
  // Null when the header was missing, which is rarer than it sounds and better
  // handled by omitting In-Reply-To than by inventing one: Gmail's own threadId
  // still groups it in the user's mailbox, and the subject carries `Re:`.
  const theirMessageId = input.inbound.rfc822_message_id?.trim() || null;

  await execute(
    `INSERT INTO reply_draft
       (id, user_id, person_id, inbound_id, classification, subject, body, status, question,
        gmail_thread_id, in_reply_to, references_chain, due_date_uae, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (inbound_id) DO UPDATE SET
       subject = excluded.subject, body = excluded.body, status = excluded.status,
       question = excluded.question, due_date_uae = excluded.due_date_uae,
       updated_at = excluded.updated_at`,
    [
      id,
      input.userId,
      input.personId,
      input.inbound.id,
      input.inbound.classification,
      input.subject,
      input.body,
      input.status,
      input.question,
      input.inbound.gmail_thread_id,
      theirMessageId,
      JSON.stringify(theirMessageId ? [theirMessageId] : []),
      input.due,
      at,
      at,
    ]
  );

  return id;
}

// ---------------------------------------------------------------------------
// Reading them back
// ---------------------------------------------------------------------------

interface DraftRow {
  id: string;
  person_id: string;
  classification: Classification;
  subject: string | null;
  body: string | null;
  question: string | null;
  status: string;
  due_date_uae: string | null;
  person_name: string;
  company_name: string;
  inbound_body: string | null;
  inbound_translated: string | null;
  inbound_language: string | null;
  received_at: string;
}

const DRAFT_SELECT = `
  SELECT r.id, r.person_id, r.classification, r.subject, r.body, r.question, r.status,
         r.due_date_uae,
         COALESCE(r.inbound_translated, i.translated_text) AS inbound_translated,
         p.full_name_raw AS person_name, c.name AS company_name,
         i.body_text AS inbound_body, i.language AS inbound_language, i.received_at
    FROM reply_draft r
    JOIN person p ON p.id = r.person_id
    JOIN company c ON c.id = p.company_id
    JOIN inbound i ON i.id = r.inbound_id
   WHERE r.user_id = ?`;

/** Everything waiting to be answered, most urgent first. */
export async function openReplies(userId: string, now: Date = new Date()): Promise<ReplyDraft[]> {
  const rows = await query<DraftRow>(
    `${DRAFT_SELECT} AND r.status IN ('drafted', 'needs_fact', 'write_yourself', 'approved')
     ORDER BY r.due_date_uae ASC, r.created_at ASC`,
    [userId]
  );
  return rows.map((row) => toDraft(row, now));
}

export async function replyById(id: string, userId: string, now: Date = new Date()): Promise<ReplyDraft | null> {
  const row = await queryOne<DraftRow>(`${DRAFT_SELECT} AND r.id = ?`, [userId, id]);
  return row ? toDraft(row, now) : null;
}

function toDraft(row: DraftRow, now: Date): ReplyDraft {
  return {
    id: row.id,
    personId: row.person_id,
    personName: row.person_name,
    companyName: row.company_name,
    classification: row.classification,
    subject: row.subject ?? '',
    body: row.body,
    question: row.question,
    status: row.status,
    inboundBody: row.inbound_body ?? '',
    inboundTranslated: row.inbound_translated,
    inboundLanguage: row.inbound_language ?? 'en',
    dueDateUae: row.due_date_uae,
    hoursLeft: row.due_date_uae ? hoursUntilEndOf(row.due_date_uae, now) : null,
    // The one classification where the CV is the entire point of the reply.
    attachCv: row.classification === 'document_request',
  };
}

/** Below this many hours left, "today" stops being an honest deadline. */
const TOO_LATE_TODAY_HOURS = 3;

/**
 * When a reply is due.
 *
 * "Within one working day" read literally — the *next* working day — produces
 * 88 hours on a Friday, and 88 hours is not a deadline, it is a shrug. The
 * mechanism this whole feature rests on is the pressure of a number in hours,
 * and a number that large removes it entirely.
 *
 * So the deadline is today whenever today is a working day with meaningful time
 * left in it, and the next working day otherwise. A reply that arrives at 16:30
 * gets tomorrow rather than a countdown that is already expiring, because a
 * deadline nobody could have met teaches the user to ignore deadlines.
 */
export function replyDeadline(calendar: WorkingCalendar, now: Date = new Date()): string {
  const today = todayUae(now);
  if (isWorkingDay(today, calendar) && hoursUntilEndOf(today, now) >= TOO_LATE_TODAY_HOURS) {
    return today;
  }
  // The next working day, not `nextDue(today, 1)`. `nextDue` counts a full
  // working day *after* its anchor, which on a Saturday lands on Tuesday — a
  // reply that arrived at the weekend is due Monday, not the day after Monday.
  return nextWorkingDay(addDays(today, 1), calendar);
}

/**
 * Hours until the end of the working day the reply is due.
 *
 * A countdown in hours is the whole mechanism. "Due tomorrow" gets postponed
 * indefinitely; "9 hours left" does not, and the difference between those two
 * framings is, in the register's words, the difference between an interview and
 * a lead that moved on.
 *
 * Dubai is a fixed UTC+4 with no daylight saving, so the end of the working day
 * — 17:00 Gulf — is 13:00 UTC on that date, which needs no timezone library and
 * cannot drift twice a year.
 */
export function hoursUntilEndOf(dueDateUae: string, now: Date = new Date()): number {
  const deadline = Date.parse(`${dueDateUae}T13:00:00.000Z`);
  return Math.round((deadline - now.getTime()) / 3_600_000);
}

/** How the countdown reads on the card. */
export function countdownLabel(hoursLeft: number | null): string {
  if (hoursLeft === null) return '';
  if (hoursLeft < 0) return 'Overdue. Still worth sending — late beats never, by a lot.';
  if (hoursLeft <= 3) return `${hoursLeft} hours left today.`;
  if (hoursLeft <= 24) return `${hoursLeft} hours left.`;
  return 'Due tomorrow. Today is better.';
}

/**
 * Every reply we should have drafted but have not.
 *
 * Called by the sweep. Bounded per run for the same reason cold pre-drafting is
 * — one Claude call each, and the user only reads a handful.
 */
export async function draftPendingReplies(
  userId: string,
  now: Date = new Date(),
  limit = 5
): Promise<{ drafted: number; needsFact: number }> {
  // Anything with no draft yet, plus the shells the poller put on screen
  // straight away and left for us to fill in. A row the user has already
  // approved, sent, dismissed, or been asked a question about is left alone.
  const pending = await query<{ id: string }>(
    `SELECT i.id FROM inbound i
       JOIN person p ON p.id = i.person_id
       LEFT JOIN reply_draft r ON r.inbound_id = i.id
      WHERE i.classification IN (${WORTH_ANSWERING.map(() => '?').join(', ')})
        AND (r.id IS NULL OR (r.status = 'write_yourself' AND r.body IS NULL))
      ORDER BY i.received_at DESC
      LIMIT ?`,
    [...WORTH_ANSWERING, limit]
  );

  let drafted = 0;
  let needsFact = 0;
  for (const row of pending) {
    const result = await draftReply(row.id, userId, now);
    if (result.kind === 'drafted') drafted++;
    if (result.kind === 'needs_fact' || result.kind === 'write_yourself') needsFact++;
  }
  return { drafted, needsFact };
}

/**
 * A plain-English rendering of a non-English inbound message.
 *
 * Register: an Arabic polite rejection read as neutral engagement produces an
 * enthusiastic English reply to a "no". The classifier handles Arabic, but the
 * user still has to understand what they are approving before they send it —
 * approving a reply to a message you cannot read is not approval.
 *
 * Stored, never re-fetched, and never sent: the reply itself stays English.
 */
export async function translateInbound(inboundId: string): Promise<string | null> {
  const row = await queryOne<{ body_text: string | null; language: string | null; translated_text: string | null }>(
    'SELECT body_text, language, translated_text FROM inbound WHERE id = ?',
    [inboundId]
  );
  if (!row?.body_text) return null;
  if (row.translated_text) return row.translated_text;
  // English needs no translation, and a call per poll for every English reply
  // would be most of the API bill.
  if (!row.language || row.language === 'en') return null;
  if (!isClaudeConfigured()) return null;

  const text = await askClaude({
    system:
      'You translate one email into plain English. Output the translation and nothing else — no preamble, no notes, no explanation of idiom. Keep the register: a formal message stays formal, a curt one stays curt. If a phrase is a polite formula with no English equivalent, translate what it means rather than what it says.',
    prompt: row.body_text.slice(0, 4000),
    effort: 'low',
    maxTokens: 800,
  });
  if (!text) return null;

  await execute('UPDATE inbound SET translated_text = ? WHERE id = ?', [text, inboundId]);
  return text;
}

/** The user answered the one-tap question. Re-draft with the fact in hand. */
export async function answerQuestion(
  replyId: string,
  userId: string,
  answer: string,
  now: Date = new Date()
): Promise<{ ok: boolean; detail?: string }> {
  const row = await queryOne<{ inbound_id: string; question: string | null }>(
    'SELECT inbound_id, question FROM reply_draft WHERE id = ? AND user_id = ?',
    [replyId, userId]
  );
  if (!row) return { ok: false, detail: 'That one is no longer here.' };

  // Stored as a profile answer, not as a one-off: "when can you start" is asked
  // by every second positive reply, and asking the user the same question four
  // times is how a tool stops being trusted.
  const { recordSideAnswer } = await import('./profile');
  await recordSideAnswer(userId, row.question ?? 'reply_detail', answer);

  const result = await draftReply(row.inbound_id, userId, now);
  return { ok: result.kind === 'drafted', detail: result.detail };
}

/** Approve, with any edits the user made. Their name is on it. */
export async function approveReply(replyId: string, userId: string, edited?: string): Promise<boolean> {
  const changed = await execute(
    `UPDATE reply_draft SET status = 'approved', body = COALESCE(?, body), updated_at = ?
      WHERE id = ? AND user_id = ? AND status IN ('drafted', 'write_yourself', 'approved')`,
    [edited ?? null, nowIso(), replyId, userId]
  );
  return changed === 1;
}

/** Not every reply needs answering by us. Closing one is a legitimate outcome. */
export async function dismissReply(replyId: string, userId: string): Promise<boolean> {
  const changed = await execute(
    `UPDATE reply_draft SET status = 'closed', updated_at = ? WHERE id = ? AND user_id = ?`,
    [nowIso(), replyId, userId]
  );
  return changed === 1;
}

/** A fresh Message-ID, persisted before the Gmail call. Same rule as a cold send. */
export async function claimReplyForSend(replyId: string, userId: string): Promise<string | null> {
  const messageId = newMessageId();
  const changed = await execute(
    `UPDATE reply_draft SET status = 'sending', rfc822_message_id = COALESCE(rfc822_message_id, ?), updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'approved'`,
    [messageId, nowIso(), replyId, userId]
  );
  if (changed !== 1) return null;
  const row = await queryOne<{ rfc822_message_id: string }>(
    'SELECT rfc822_message_id FROM reply_draft WHERE id = ?',
    [replyId]
  );
  return row?.rfc822_message_id ?? null;
}

/** Tomorrow, for the "not today" action. Never further — this is the urgent one. */
export function deferOneDay(now: Date = new Date()): string {
  return addDays(todayUae(now), 1);
}
