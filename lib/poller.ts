/**
 * Reply polling.
 *
 * Three decisions here are load-bearing, and all three are the opposite of the
 * obvious implementation:
 *
 *   1. **Every thread ever sent, forever.** Not just live sequences. Three
 *      weeks after a break-up, "we just opened two Nafis-track roles — still
 *      interested?" is the best email the user will get all month, and a poller
 *      that watches only active sequences never sees it.
 *   2. **`threads.get`, not `messages.list`.** The list endpoint excludes SPAM
 *      and TRASH by default, so a genuine reply that Gmail misfiled is
 *      invisible — and the break-up then fires at the one person who answered.
 *      Fetching the thread returns its spam-labelled messages too.
 *   3. **Thread-first matching.** A message is attached to the outreach on its
 *      thread regardless of who sent it. legal-compliance@company.ae replying
 *      "we treat this as a PDPL matter" is not a known person_id, and matching
 *      by sender would drop it while follow-up 1 is still scheduled.
 *
 * Polling is coarse on purpose — every 10-15 minutes, never per-minute. The SLA
 * is measured in working days and a quota storm costs more than a delay.
 */
import { classify, type InboundMessage } from './classifier';
import { execute, query, queryOne } from './db/client';
import { DAY_MS, POLL_STALENESS_MS } from './durations';
import { gmailRequest, GmailError } from './gmail/client';
import { newId, nowIso } from './ids';
import { logEvent, logError } from './log';
import {
  applyClassification,
  markUserTookOver,
  recordInbound,
  reopenForLateReply,
  type TransitionResult,
} from './state-machine';
import type { User } from './user';

/** Closed threads are still watched, just once a day rather than every sweep. */
const DORMANT_THREAD_INTERVAL_MS = DAY_MS;

/** After this many consecutive failures a thread stops being retried each sweep. */
const FAILURE_LIMIT = 5;

/** Person statuses that mean the sequence was already over when this landed. */
const CLOSED_STATUSES = ['closed_silent', 'closed_won_silent', 'dead_end_mailbox', 'departed'];

// ---------------------------------------------------------------------------
// Gmail message shapes (only the parts we read)
// ---------------------------------------------------------------------------

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

interface GmailThread {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
}

export interface PollResult {
  threadsExamined: number;
  threadsFetched: number;
  newInbound: number;
  transitions: Array<{ personId: string | null; summary: string }>;
  userTookOver: number;
  spamFound: number;
  failures: number;
  /** True when the sweep completed cleanly enough to unblock sending. */
  healthy: boolean;
}

// ---------------------------------------------------------------------------
// Header and body helpers
// ---------------------------------------------------------------------------

function headerMap(message: GmailMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of message.payload?.headers ?? []) {
    // Lower-cased keys because Gmail is inconsistent about `Message-ID` vs
    // `Message-Id`, and the classifier's header checks must not depend on it.
    out[header.name.toLowerCase()] = header.value;
  }
  return out;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * The readable text of a message.
 *
 * Plain text wins over HTML: an OOO auto-reply rendered as a table of `<td>`s
 * still has to yield "back on 12 January" to the date extractor. Falls back to
 * a crude tag strip rather than giving the classifier nothing, because "no
 * body" defaults to `human_reply` and stops a sequence for no reason.
 */
export function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return '';

  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: GmailPart) => {
    // Attachments are never the message. A 4 MB PDF decoded into the
    // classifier's prompt is both useless and expensive.
    if (part.filename) return;
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plain.push(decodeBase64Url(part.body.data));
      else if (part.mimeType === 'text/html') html.push(decodeBase64Url(part.body.data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  if (plain.length > 0) return plain.join('\n').trim();
  if (html.length > 0) return stripHtml(html.join('\n'));
  return '';
}

/**
 * The machine-readable half of a delivery status notification.
 *
 * A DSN carries its verdict in a `message/delivery-status` part — `Status:
 * 4.2.2` for a full mailbox, `5.1.1` for an address that does not exist — and
 * `extractBody` deliberately keeps only text/plain and text/html, so that part
 * was invisible. The classifier's regex therefore never matched, every bounce
 * fell through to "hard", and a mailbox that was merely full permanently burned
 * a real contact along with the whole domain's address pattern.
 */
export function extractDeliveryStatus(payload: GmailPart | undefined): string {
  if (!payload) return '';
  const parts: string[] = [];

  const walk = (part: GmailPart) => {
    if (part.mimeType?.startsWith('message/') && part.body?.data) {
      parts.push(decodeBase64Url(part.body.data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  return parts.join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `"Fatima Al Marri" <f.almarri@x.ae>` → `f.almarri@x.ae`. */
export function addressOf(header: string | undefined): string {
  if (!header) return '';
  const angled = header.match(/<([^>]+)>/);
  return (angled ? angled[1] : header).trim().toLowerCase();
}

/** Every address on a comma-separated header, quoted display names and all. */
export function addressList(header: string | undefined): string[] {
  return addressEntries(header).map((e) => e.email);
}

export interface AddressEntry {
  name: string | null;
  email: string;
}

/**
 * Addresses with their display names.
 *
 * The name is the payload in exactly one case, and it is the most valuable
 * message the product ever receives: "looping in Sara who runs our Nafis
 * programme" arrives as `"Sara Al Nuaimi" <s.alnuaimi@bank.ae>` in the CC line.
 * Reducing that to an address throws away the half that makes it usable.
 */
export function addressEntries(header: string | undefined): AddressEntry[] {
  if (!header) return [];
  return header
    // Split on commas that are not inside a quoted display name — `"Ali, Dr."`
    // is one recipient, not two.
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => {
      const email = addressOf(part);
      if (!email) return null;
      const name = part
        .replace(/<[^>]*>/, '')
        .replace(/["']/g, '')
        .trim();
      // A bare address has no display name. `k@bank.ae` as a "name" would end
      // up in a salutation.
      return { name: name && name !== email ? name : null, email };
    })
    .filter((e): e is AddressEntry => e !== null);
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface ThreadRow {
  gmail_thread_id: string;
  last_history_id: string | null;
  last_polled_at: string | null;
  active: number;
  failures: number;
}

/**
 * Reconciles the watch list with reality: every thread we have ever sent on is
 * watched, and a thread is `active` only while something on it is still live.
 *
 * Runs first every sweep so a send that happened thirty seconds ago is already
 * being watched, and so a sequence that closed stops costing a fetch per sweep.
 */
export async function syncThreadWatchList(userId: string, now: Date = new Date()): Promise<number> {
  const at = nowIso(now);
  const inserted = await execute(
    `INSERT INTO thread_poll (gmail_thread_id, user_id, active, created_at, updated_at)
     SELECT DISTINCT o.gmail_thread_id, o.user_id, 1, ?, ?
       FROM outreach o
      WHERE o.user_id = ? AND o.gmail_thread_id IS NOT NULL
     ON CONFLICT (gmail_thread_id) DO NOTHING`,
    [at, at, userId]
  );

  // `active` is derived, never set by hand: a thread is live while any outreach
  // on it can still move. A late reply on an inactive thread is still seen —
  // just a day later, which is the right trade for a thread nobody expects
  // anything on.
  await execute(
    `UPDATE thread_poll
        SET active = CASE WHEN EXISTS (
              SELECT 1 FROM outreach o
               WHERE o.gmail_thread_id = thread_poll.gmail_thread_id
                 AND o.status IN ('queued', 'drafted', 'stale', 'needs_fact',
                                  'approved', 'sending', 'sent', 'paused_pending_reply')
            ) THEN 1 ELSE 0 END,
            updated_at = ?
      WHERE user_id = ?`,
    [at, userId]
  );

  return inserted;
}

/** Threads due a fetch this sweep. */
async function threadsDue(userId: string, now: Date): Promise<ThreadRow[]> {
  const cutoff = nowIso(new Date(now.getTime() - DORMANT_THREAD_INTERVAL_MS));
  return query<ThreadRow>(
    // A retired thread is retried once a day, not abandoned. `failures` is only
    // reset by a successful fetch, so excluding retired threads outright meant
    // they could never succeed again and therefore never be un-retired: an hour
    // of Gmail 500s across five sweeps would have permanently blinded the
    // poller to every thread it had, silently, forever.
    `SELECT gmail_thread_id, last_history_id, last_polled_at, active, failures
       FROM thread_poll
      WHERE user_id = ?
        AND (
          (failures < ? AND (active = 1 OR last_polled_at IS NULL OR last_polled_at < ?))
          OR (failures >= ? AND (last_polled_at IS NULL OR last_polled_at < ?))
        )
      ORDER BY active DESC, last_polled_at IS NULL DESC, last_polled_at ASC`,
    [userId, FAILURE_LIMIT, cutoff, FAILURE_LIMIT, cutoff]
  );
}

/**
 * One poll pass.
 *
 * Returns `healthy: false` rather than throwing when Gmail is unreachable. The
 * caller's job is then to leave `last_successful_poll_at` alone, which blocks
 * sending — deriving dates forward while blind is fine, sending while blind is
 * not (hard rule 10).
 */
export async function pollReplies(user: User, now: Date = new Date()): Promise<PollResult> {
  const result: PollResult = {
    threadsExamined: 0,
    threadsFetched: 0,
    newInbound: 0,
    transitions: [],
    userTookOver: 0,
    spamFound: 0,
    failures: 0,
    healthy: true,
  };

  if (user.connectionState !== 'connected') {
    result.healthy = false;
    return result;
  }

  await syncThreadWatchList(user.id, now);
  const threads = await threadsDue(user.id, now);
  result.threadsExamined = threads.length;

  // Our own addresses, for the "user replied from Gmail themselves" check.
  const ourAddresses = new Set(
    [user.gmailAddress, user.sendAsEmail].filter(Boolean).map((a) => a!.toLowerCase())
  );

  for (const thread of threads) {
    try {
      const fetched = await pollThread(user, thread, ourAddresses, now);
      result.threadsFetched += fetched.fetched ? 1 : 0;
      result.newInbound += fetched.newInbound;
      result.userTookOver += fetched.userTookOver;
      result.spamFound += fetched.spam ? 1 : 0;
      result.transitions.push(...fetched.transitions);
    } catch (e) {
      result.failures++;

      // A thread deleted in Gmail 404s forever. Counting failures retires it
      // instead of spending a request on it every sweep for the rest of time.
      const permanent = e instanceof GmailError && (e.status === 404 || e.status === 400);
      await execute(
        `UPDATE thread_poll SET failures = failures + ?, last_polled_at = ?, updated_at = ?
          WHERE gmail_thread_id = ?`,
        [permanent ? FAILURE_LIMIT : 1, nowIso(now), nowIso(now), thread.gmail_thread_id]
      );

      // An auth failure means every remaining thread will fail the same way.
      // Stopping keeps one revoked token from burning the whole quota.
      if (e instanceof GmailError && (e.status === 401 || e.status === 403)) {
        result.healthy = false;
        await logError('error', e, { userId: user.id, detail: { stage: 'poll', fatal: true } });
        break;
      }
      await logError('error', e, {
        userId: user.id,
        entityType: 'thread',
        entityId: thread.gmail_thread_id,
        detail: { stage: 'poll' },
      });
    }
  }

  // Any thread failing is not "blind": the rest were read. Only an auth failure
  // or a total wipe-out means we cannot trust what we know.
  if (threads.length > 0 && result.failures === threads.length) result.healthy = false;

  // Healthy means "we can currently see every live conversation", which is what
  // hard rule 10 is actually asserting when it unblocks sending. Counting a
  // sweep as healthy because nothing happened to fail is not the same thing: a
  // thread that has been erroring for hours is one we are blind to, whether or
  // not this particular pass tried it.
  //
  // Only *active* threads count. A closed sequence polled yesterday is the
  // documented once-a-day cadence, not blindness — the reply it might carry is
  // weeks late already, and holding every send for it would be worse.
  const [staleActive] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM thread_poll
      WHERE user_id = ? AND active = 1
        AND (last_polled_at IS NULL OR last_polled_at < ?)`,
    [user.id, nowIso(new Date(now.getTime() - POLL_STALENESS_MS))]
  );
  if ((staleActive?.n ?? 0) > 0) result.healthy = false;

  if (result.healthy) {
    await execute('UPDATE app_user SET last_successful_poll_at = ?, updated_at = ? WHERE id = ?', [
      nowIso(now),
      nowIso(now),
      user.id,
    ]);
  }

  await logEvent({
    event: 'sweep_ran',
    userId: user.id,
    detail: { poll: { ...result, transitions: result.transitions.length } },
    level: result.healthy ? 'info' : 'warn',
  });

  return result;
}

interface ThreadOutcome {
  fetched: boolean;
  newInbound: number;
  userTookOver: number;
  spam: boolean;
  transitions: Array<{ personId: string | null; summary: string }>;
}

async function pollThread(
  user: User,
  thread: ThreadRow,
  ourAddresses: Set<string>,
  now: Date
): Promise<ThreadOutcome> {
  const outcome: ThreadOutcome = {
    fetched: false,
    newInbound: 0,
    userTookOver: 0,
    spam: false,
    transitions: [],
  };

  const data = await gmailRequest<GmailThread>(
    user.id,
    `/users/me/threads/${encodeURIComponent(thread.gmail_thread_id)}`,
    { query: { format: 'full' } }
  );
  outcome.fetched = true;

  const at = nowIso(now);
  const messages = data.messages ?? [];

  // Nothing changed since last time. Recording the historyId lets the next
  // sweep still fetch (threads.get has no conditional form) but skips all the
  // parsing, classification and DB work below.
  const unchanged = thread.last_history_id !== null && thread.last_history_id === (data.historyId ?? null);

  await execute(
    `UPDATE thread_poll
        SET last_history_id = ?, last_polled_at = ?, message_count = ?, failures = 0,
            in_spam = ?, updated_at = ?
      WHERE gmail_thread_id = ?`,
    [
      data.historyId ?? null,
      at,
      messages.length,
      messages.some((m) => m.labelIds?.includes('SPAM')) ? 1 : 0,
      at,
      thread.gmail_thread_id,
    ]
  );

  if (unchanged) return outcome;

  // Which messages on this thread are ours, and who the thread belongs to.
  const ours = await query<{ gmail_message_id: string | null; id: string; person_id: string; step: number }>(
    `SELECT gmail_message_id, id, person_id, step FROM outreach
      WHERE gmail_thread_id = ? AND gmail_message_id IS NOT NULL
      ORDER BY step DESC`,
    [thread.gmail_thread_id]
  );
  // Replies this product sent are ours too. Without them the next sweep sees a
  // message from the user's own address that is not in `outreach`, concludes
  // they answered by hand in Gmail, and cancels the queued follow-ups — the
  // product sabotaging itself for having been used.
  const oursByReply = await query<{ gmail_message_id: string | null }>(
    'SELECT gmail_message_id FROM reply_draft WHERE gmail_thread_id = ? AND gmail_message_id IS NOT NULL',
    [thread.gmail_thread_id]
  );
  const ourMessageIds = new Set([
    ...ours.map((o) => o.gmail_message_id!),
    ...oursByReply.map((o) => o.gmail_message_id!),
  ]);
  const latestOutreach = ours[0] ?? null;

  for (const message of messages) {
    if (ourMessageIds.has(message.id)) continue;

    const headers = headerMap(message);
    const from = addressOf(headers.from);

    // Register: "User acts manually in Gmail and the robot contradicts them".
    // A message from the user's own address that we did not send means they
    // took over — four days later we would otherwise send "just checking you
    // saw this" into a warm thread.
    if (ourAddresses.has(from)) {
      if (!latestOutreach) continue;
      const person = await queryOne<{ status: string }>('SELECT status FROM person WHERE id = ?', [
        latestOutreach.person_id,
      ]);
      if (person?.status === 'user_took_over') continue;
      const transition = await markUserTookOver(latestOutreach.person_id, now);
      await recordAction(user.id, latestOutreach.person_id, null, transition, null, now);
      outcome.userTookOver++;
      outcome.transitions.push({ personId: latestOutreach.person_id, summary: transition.summary });
      continue;
    }

    // Already seen. The unique index on gmail_message_id is the real guard;
    // this just avoids paying for a classification to discover that.
    const seen = await queryOne<{ id: string }>('SELECT id FROM inbound WHERE gmail_message_id = ?', [
      message.id,
    ]);
    if (seen) continue;

    const inSpam = message.labelIds?.includes('SPAM') ?? false;
    if (inSpam) outcome.spam = true;

    const participants = [
      ...addressEntries(headers.from),
      ...addressEntries(headers.to),
      ...addressEntries(headers.cc),
    ];

    const parsed: InboundMessage = {
      from,
      to: addressList(headers.to),
      cc: addressList(headers.cc),
      subject: headers.subject ?? '',
      // The delivery-status part is appended for DSNs only. It is what carries
      // `Status: 4.2.2` versus `5.1.1` — the difference between retrying and
      // burning a real contact — and it lives outside the readable body.
      body: [extractBody(message.payload) || (message.snippet ?? ''), extractDeliveryStatus(message.payload)]
        .filter(Boolean)
        .join('\n'),
      headers,
    };

    const classification = await classify(parsed);

    // Thread-first: the person is whoever owns this thread, even when the
    // sender is an address we have never emailed.
    const personId = latestOutreach?.person_id ?? null;
    const inboundId = await recordInbound({
      outreachId: latestOutreach?.id ?? null,
      personId,
      threadId: thread.gmail_thread_id,
      messageId: message.id,
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      subject: parsed.subject,
      body: parsed.body,
      receivedAt: message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : nowIso(now),
      classification,
      participants,
      // The real header, not Gmail's internal id: `In-Reply-To` must carry
      // what the recipient's client actually saw.
      rfc822MessageId: headers['message-id'] ?? null,
      // Honour Reply-To when they set one — a shared mailbox answering on
      // somebody's behalf is exactly when it matters.
      replyTo: addressOf(headers['reply-to']) || null,
    });
    outcome.newInbound++;

    if (!personId) {
      // A reply on a thread with no outreach row is possible after a manual
      // Sent-folder import. Recorded, surfaced, but not acted on: there is no
      // state to change.
      outcome.transitions.push({ personId: null, summary: `Inbound on an untracked thread from ${parsed.from}.` });
      continue;
    }

    const person = await queryOne<{ company_id: string; status: string }>(
      'SELECT company_id, status FROM person WHERE id = ?',
      [personId]
    );
    if (!person) continue;

    const transition = await applyClassification(classification, {
      userId: user.id,
      personId,
      companyId: person.company_id,
      inboundId,
      now,
    });

    // A real reply arriving on a closed sequence reopens it and un-dormants the
    // company. Auto-replies do not: an OOO on a dead thread is noise.
    if (CLOSED_STATUSES.includes(person.status) && reopensSequence(classification.classification)) {
      const reopened = await reopenForLateReply(user.id, personId, person.company_id, now);
      await recordAction(user.id, personId, person.company_id, reopened, inboundId, now);
      outcome.transitions.push({ personId, summary: reopened.summary });
    }

    await recordAction(user.id, personId, person.company_id, transition, inboundId, now);

    // The card, immediately. Their words and the countdown are what stop the
    // user freezing; the written draft follows from the sweep a few minutes
    // later. No model call happens here — a reply that arrived at 09:00 must
    // not be invisible until the cron runs at 09:15.
    const { ensureReplyDraft } = await import('./reply-assist');
    await ensureReplyDraft(inboundId, user.id, now);

    if (inSpam) {
      await recordAction(
        user.id,
        personId,
        person.company_id,
        {
          summary: 'Found in spam.',
          superseded: 0,
          action: {
            kind: 'mark_not_spam',
            // Marking it also trains Gmail, which is the part worth doing.
            message: 'Their reply landed in your spam folder. Open it and press "Not spam" — it helps the next one arrive properly.',
            url: `https://mail.google.com/mail/u/0/#spam/${thread.gmail_thread_id}`,
          },
        },
        inboundId,
        now
      );
    }

    outcome.transitions.push({ personId, summary: transition.summary });
  }

  return outcome;
}

/**
 * A message that reopens a closed sequence.
 *
 * Not simply "any human reply". A rejection or a removal request arriving on a
 * closed thread is a closed thread being closed harder, and treating it as a
 * late reopening would set the company to `paused_late_reply` — overwriting a
 * ninety-day dormancy, or worse, a permanent `suppressed_by_request`. The one
 * state this product must never be able to undo is the one somebody explicitly
 * asked for.
 */
function reopensSequence(classification: string): boolean {
  return ![
    'auto_reply_ooo',
    'auto_ack_unmonitored',
    'bounce',
    'gateway_challenge',
    // Every one of these is its own terminal handler, and each sets a company
    // state that outranks "they came back to us".
    'rejection_hard',
    'rejection_soft',
    'removal_request',
    'complaint_escalation',
    'departed',
  ].includes(classification);
}

// ---------------------------------------------------------------------------
// Next Actions
// ---------------------------------------------------------------------------

/**
 * Persists whatever a transition asked a human to do.
 *
 * A toast is useless to someone who opens the app once a day, so an action
 * survives until it is resolved. `ON CONFLICT DO NOTHING` against the partial
 * unique index is what makes a repeated sweep idempotent instead of stacking
 * five identical cards.
 */
export async function recordAction(
  userId: string,
  personId: string | null,
  companyId: string | null,
  transition: TransitionResult,
  inboundId: string | null,
  now: Date = new Date()
): Promise<void> {
  const action = transition.action;
  if (!action || action.kind === 'none' || !action.message) return;

  // The partial unique index cannot help when there is no person: SQLite treats
  // NULLs as distinct, so an action about the system rather than about somebody
  // — "confirm the Eid dates" — would stack one card per sweep, four an hour,
  // until the user stopped reading the list entirely.
  if (personId === null) {
    const open = await queryOne<{ id: string }>(
      `SELECT id FROM next_action
        WHERE user_id = ? AND kind = ? AND person_id IS NULL AND resolved_at IS NULL`,
      [userId, action.kind]
    );
    if (open) return;
  }

  await execute(
    `INSERT INTO next_action (id, user_id, kind, message, url, person_id, company_id, inbound_id, warm, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      newId('action'),
      userId,
      action.kind,
      action.message,
      action.url ?? null,
      personId,
      companyId,
      inboundId,
      // Warm means a person is waiting. A calendar chore is not, and must never
      // sort above someone who wrote to you.
      personId === null ? 0 : 1,
      nowIso(now),
    ]
  );
}

export interface OpenAction {
  id: string;
  kind: string;
  message: string;
  url: string | null;
  personId: string | null;
  personName: string | null;
  companyName: string | null;
  createdAt: string;
}

/** Open actions, warm first. This is the top of the dashboard. */
export async function openActions(userId: string, limit = 20): Promise<OpenAction[]> {
  const rows = await query<{
    id: string;
    kind: string;
    message: string;
    url: string | null;
    person_id: string | null;
    person_name: string | null;
    company_name: string | null;
    created_at: string;
  }>(
    `SELECT a.id, a.kind, a.message, a.url, a.person_id,
            p.full_name_raw AS person_name, c.name AS company_name, a.created_at
       FROM next_action a
       LEFT JOIN person p ON p.id = a.person_id
       LEFT JOIN company c ON c.id = COALESCE(a.company_id, p.company_id)
      WHERE a.user_id = ? AND a.resolved_at IS NULL
      ORDER BY a.warm DESC, a.created_at ASC
      LIMIT ?`,
    [userId, limit]
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    url: r.url,
    personId: r.person_id,
    personName: r.person_name,
    companyName: r.company_name,
    createdAt: r.created_at,
  }));
}

export async function resolveAction(id: string, now: Date = new Date()): Promise<boolean> {
  const changed = await execute(
    'UPDATE next_action SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL',
    [nowIso(now), id]
  );
  return changed === 1;
}

// ---------------------------------------------------------------------------
// The Sent-folder scan
// ---------------------------------------------------------------------------

export interface PriorContact {
  address: string;
  subject: string;
  sentAt: string;
  threadId: string;
}

/**
 * Has the user already emailed this domain themselves?
 *
 * Run when a company is added. "You emailed them in June — follow up or skip?"
 * is the difference between an informed approach and the user looking like they
 * forgot their own conversation. Read-only: it never creates outreach rows.
 */
export async function scanSentForDomain(
  userId: string,
  domain: string,
  limit = 5
): Promise<PriorContact[]> {
  const clean = domain.replace(/^www\./, '').toLowerCase();
  let list: { messages?: Array<{ id: string }> };
  try {
    list = await gmailRequest(userId, '/users/me/messages', {
      query: { q: `in:sent to:${clean}`, maxResults: String(limit) },
    });
  } catch {
    // A failed scan must never block adding a company. Silence here just means
    // the user does not get the heads-up.
    return [];
  }

  const found: PriorContact[] = [];
  for (const stub of list.messages ?? []) {
    try {
      const message = await gmailRequest<GmailMessage>(userId, `/users/me/messages/${stub.id}`, {
        query: { format: 'metadata' },
      });
      const headers = headerMap(message);
      found.push({
        address: addressOf(headers.to),
        subject: headers.subject ?? '(no subject)',
        sentAt: message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : '',
        threadId: message.threadId,
      });
    } catch {
      continue;
    }
  }
  return found;
}
