/**
 * The sweep.
 *
 * This is a **stateless, idempotent sweep, not a tick**. Nothing here depends on
 * a job firing at a particular moment, because a three-day outage would then
 * silently drop every follow-up whose fire-moment fell inside it. Instead each
 * run asks the same question of the current state — "what should exist by now?"
 * — and makes it exist. Running it twice is a no-op; running it three days late
 * produces exactly the rows an on-time run would have, which then flow through
 * the stale-redraft rule so the wording is right for the day it actually sends.
 *
 * Order is deliberate, and each step depends on the one before it:
 *
 *   1. repair    — resolve anything stuck mid-send before reading statuses
 *   2. poll      — a reply must supersede before we would create a follow-up
 *   3. invariants— a follow-up whose predecessor never sent cannot exist
 *   4. wake      — companies whose dormancy has expired come back
 *   5. advance   — create the next step of every live sequence
 *   6. rotate    — move up the ladder after silence (never after a rejection)
 *   7. recompute — derive every due date from the current calendar
 *   8. predraft  — write the ones coming due
 *   9. freshness — expire drafts that have gone stale
 */
import { addDays, compareDates, nextDue, todayUae, workingDaysBetween } from './calendar';
import { loadCalendar, currentCalendarVersion } from './calendar-store';
import { execute, query, queryOne } from './db/client';
import { CADENCE_WORKING_DAYS, recomputeDerivedDates, type RecomputeResult } from './derived-dates';
import { generate, loadContext } from './generator';
import { newId, nowIso } from './ids';
import { logEvent } from './log';
import { ORG_FAMILY_SQL, orgFamilyArgs } from './org';
import { pollReplies, type PollResult } from './poller';
import { draftPendingReplies } from './reply-assist';
import { freshnessPass } from './queue';
import { repairStuckSends } from './send';
import type { User } from './user';

/**
 * Working days of silence after a whole sequence before the ladder moves on.
 * Waived when nobody saw anything (a bounce, an unmonitored mailbox).
 */
const LADDER_COOLDOWN_WORKING_DAYS = 5;

/** A gateway challenge nobody completed becomes a soft bounce after this. */
const GATEWAY_PATIENCE_WORKING_DAYS = 5;

/** Pre-drafting costs a Claude call each; only write what is nearly due. */
const PREDRAFT_HORIZON_WORKING_DAYS = 1;
const PREDRAFT_PER_SWEEP = 12;

/** Company states in which no new outreach may be created, for anyone. */
const FROZEN_COMPANY_STATES = [
  'dormant',
  'suppressed_by_request',
  'in_conversation',
  'paused_referral',
  'paused_late_reply',
  'reply_conflict',
  'blocked',
];

export interface SweepResult {
  ranAt: string;
  repair: { recovered: number; reverted: number; pending: number };
  poll: PollResult | null;
  invariantsFixed: number;
  woken: number;
  advanced: number;
  rotated: number;
  gatewayTimedOut: number;
  recompute: RecomputeResult;
  predrafted: number;
  refused: number;
  /** Replies pre-written for the user. Always drafted before cold emails. */
  repliesDrafted: number;
  /** Unconfirmed holiday windows the founder is being nudged about. */
  confirmationTasks: number;
  /** Evidence whose source page has gone since it was captured. */
  deadLinks: number;
  freshness: { staled: number; superseded: number };
  skipped: string | null;
}

/**
 * One full pass.
 *
 * `poll: false` exists for tests and for the on-open freshness pass, which has
 * already polled. Everything else runs every time — the whole point is that no
 * step may be conditional on when the last run happened.
 */
export async function sweep(
  user: User,
  options: { now?: Date; poll?: boolean; predraft?: boolean } = {}
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const result: SweepResult = {
    ranAt: nowIso(now),
    repair: { recovered: 0, reverted: 0, pending: 0 },
    poll: null,
    invariantsFixed: 0,
    woken: 0,
    advanced: 0,
    rotated: 0,
    gatewayTimedOut: 0,
    recompute: { examined: 0, changed: 0, flaggedForRegeneration: 0, calendarVersion: 0 },
    predrafted: 0,
    refused: 0,
    repliesDrafted: 0,
    confirmationTasks: 0,
    deadLinks: 0,
    freshness: { staled: 0, superseded: 0 },
    skipped: null,
  };

  // Pause and "I got the job" freeze the sweep entirely. Not a filter on the
  // queue — the rows must not be created at all, or resuming would surface a
  // backlog of drafts written for a week that has passed.
  if (user.paused || user.placedDate) {
    result.skipped = user.placedDate ? 'placed' : 'paused';
    return result;
  }

  result.repair = await repairStuckSends(user.id, now);
  if (options.poll !== false) result.poll = await pollReplies(user, now);

  result.invariantsFixed = await enforceInvariants(user, now);
  result.woken = await wakeDormantCompanies(user, now);
  result.gatewayTimedOut = await timeOutGatewayChallenges(user, now);
  result.advanced = await advanceSequences(user, now);
  result.rotated = await rotateLadders(user, now);

  // Run again over what was just created. Advancing and rotating are the only
  // things in this file that add rows, so the second pass is what makes the
  // sweep converge in one run rather than settling on the next — otherwise a
  // step created here sits live until tomorrow before the org-group check sees
  // it, and "running the sweep twice is a no-op" is quietly false.
  result.invariantsFixed += await enforceInvariants(user, now);

  result.recompute = await recomputeDerivedDates({ now });

  if (options.predraft !== false) {
    // Replies first, always. Someone is waiting on one of these; nobody is
    // waiting on a cold email, and if the budget for Claude calls runs short in
    // a single sweep it must run short on the cold half.
    const replies = await draftPendingReplies(user.id, now);
    result.repliesDrafted = replies.drafted + replies.needsFact;

    const drafted = await predraftDue(user, now);
    result.predrafted = drafted.drafted;
    result.refused = drafted.refused;
  }

  result.confirmationTasks = await raiseConfirmationTasks(user, now);

  // The dead-link gate. A hook whose source page has gone cannot be checked by
  // the user in the ten seconds the Review screen gives them, which is the only
  // thing standing between a stale claim and a stranger's inbox. Bounded per
  // sweep, and it never touches LinkedIn — hard rule 7 has no exception for a
  // HEAD request.
  const { checkLinks } = await import('./evidence');
  result.deadLinks = (await checkLinks(20)).dead;

  result.freshness = await freshnessPass(user, now);

  await logEvent({
    event: 'sweep_ran',
    userId: user.id,
    detail: {
      advanced: result.advanced,
      rotated: result.rotated,
      predrafted: result.predrafted,
      refused: result.refused,
      repliesDrafted: result.repliesDrafted,
      woken: result.woken,
      invariantsFixed: result.invariantsFixed,
      gatewayTimedOut: result.gatewayTimedOut,
    },
  });

  return result;
}

// ---------------------------------------------------------------------------
// 3. Invariants
// ---------------------------------------------------------------------------

/**
 * The invariants that must hold whatever else happened.
 *
 * These are repairs, not assertions. A crash, a manual edit, or a race can put
 * the database in a state the code never intends; the sweep's job is to put it
 * back rather than to throw at three in the morning.
 */
async function enforceInvariants(user: User, now: Date): Promise<number> {
  const at = nowIso(now);
  let fixed = 0;

  // A sequence advances only after a confirmed send. A follow-up whose
  // predecessor never went out would open "following up on my note" about a
  // note that does not exist — the user disappears for ten days and comes back
  // to an email that makes them look confused.
  fixed += await execute(
    `UPDATE outreach SET status = 'closed', updated_at = ?
      WHERE user_id = ? AND step > 1
        AND status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved')
        AND NOT EXISTS (
          SELECT 1 FROM outreach prev
           WHERE prev.person_id = outreach.person_id
             AND prev.step = 1
             AND prev.status IN ('sent', 'replied', 'bounced', 'superseded_by_reply')
        )`,
    [at, user.id]
  );

  // A person left mid-sequence with nothing live and no way forward.
  //
  // Reachable whenever a step is closed rather than sent — a blocking
  // salutation lint, a manual close, a halt from the generator. `in_sequence`
  // with no live row and no third touch means `advanceSequences` will not
  // create anything (`ON CONFLICT DO NOTHING` on the closed row) and
  // `rotateLadders` will not move on (it requires the sequence to be finished),
  // so the person is stranded forever and takes their company's ladder with
  // them: one-live-sequence-per-organisation keeps everybody else frozen behind
  // a sequence that can never end.
  fixed += await execute(
    `UPDATE person SET status = 'closed_silent', updated_at = ?
      WHERE status = 'in_sequence'
        AND EXISTS (SELECT 1 FROM outreach o WHERE o.person_id = person.id AND o.user_id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM outreach o
           WHERE o.person_id = person.id
             AND o.status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved',
                              'sending', 'paused_pending_reply')
        )
        AND NOT EXISTS (
          SELECT 1 FROM outreach o
           WHERE o.person_id = person.id AND o.step = 3 AND o.status IN ('sent', 'replied', 'bounced')
        )
        AND EXISTS (
          SELECT 1 FROM outreach o WHERE o.person_id = person.id AND o.status = 'closed'
        )`,
    [at, user.id]
  );

  // Anything live for a person who is no longer approachable. Suppression is
  // checked before drafting too; this catches rows that were already sitting in
  // the queue when the suppression landed.
  fixed += await execute(
    `UPDATE outreach SET status = 'closed', updated_at = ?
      WHERE user_id = ?
        AND status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved')
        AND person_id IN (
          SELECT id FROM person
           WHERE status IN ('suppressed', 'departed', 'dead_end_mailbox', 'user_took_over',
                            'closed_won_silent', 'replied_external')
        )`,
    [at, user.id]
  );

  // One live sequence per organisation, enforced at org_group so "Emirates NBD"
  // and "Emirates NBD Capital" cannot both be running. The oldest live sequence
  // keeps its place; the others pause rather than close, because "that contact
  // was a dead end" is a real outcome and resuming should not need re-sourcing.
  const conflicts = await query<{ org_group_id: string; keep_person: string }>(
    `SELECT c.org_group_id,
            (SELECT p2.id
               FROM person p2 JOIN company c2 ON c2.id = p2.company_id
               JOIN outreach o2 ON o2.person_id = p2.id
              WHERE c2.org_group_id = c.org_group_id AND p2.status = 'in_sequence'
                AND o2.status = 'sent'
              ORDER BY o2.sent_at ASC LIMIT 1) AS keep_person
       FROM person p JOIN company c ON c.id = p.company_id
      WHERE p.status = 'in_sequence'
      GROUP BY c.org_group_id
     HAVING count(DISTINCT p.id) > 1`,
    []
  );

  for (const conflict of conflicts) {
    if (!conflict.keep_person) continue;

    // Visible and resolvable, not just paused. Setting rows to
    // `paused_pending_reply` with no company state and no card left the loser
    // frozen with nothing anywhere to explain it or release it — the dashboard
    // only renders a decision for companies in `reply_conflict`.
    const company = await queryOne<{ id: string }>(
      'SELECT company_id AS id FROM person WHERE id = ?',
      [conflict.keep_person]
    );
    if (company) {
      await execute(
        `INSERT INTO user_company_state (user_id, company_id, status, created_at, updated_at)
         VALUES (?, ?, 'reply_conflict', ?, ?)
         ON CONFLICT (user_id, company_id) DO UPDATE SET status = 'reply_conflict', updated_at = excluded.updated_at
         WHERE user_company_state.status NOT IN ('suppressed_by_request', 'dormant', 'in_conversation')`,
        [user.id, company.id, at, at]
      );
    }

    fixed += await execute(
      `UPDATE outreach SET status = 'paused_pending_reply', updated_at = ?
        WHERE user_id = ?
          AND status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved')
          AND person_id IN (
            SELECT p.id FROM person p JOIN company c ON c.id = p.company_id
             WHERE c.org_group_id IN ${ORG_FAMILY_SQL} AND p.id <> ? AND p.status = 'in_sequence'
          )`,
      [at, user.id, ...orgFamilyArgs(conflict.org_group_id), conflict.keep_person]
    );
  }

  return fixed;
}

// ---------------------------------------------------------------------------
// 4. Waking
// ---------------------------------------------------------------------------

/**
 * Dormancy expires by date, never by countdown from a tick.
 *
 * `suppressed_by_request` is deliberately absent: a removal request has no
 * expiry, and no sweep may undo it.
 */
async function wakeDormantCompanies(user: User, now: Date): Promise<number> {
  return execute(
    `UPDATE user_company_state
        SET status = 'active', dormant_until = NULL, updated_at = ?
      WHERE user_id = ? AND status = 'dormant'
        AND dormant_until IS NOT NULL AND dormant_until <= ?`,
    [nowIso(now), user.id, todayUae(now)]
  );
}

// ---------------------------------------------------------------------------
// 5. Advancing a live sequence
// ---------------------------------------------------------------------------

interface SentRow {
  outreach_id: string;
  person_id: string;
  step: number;
  sent_date_uae: string;
  subject: string | null;
  gmail_thread_id: string | null;
  references_chain: string;
  person_status: string;
  company_id: string;
  company_status: string | null;
}

/**
 * Creates the next step of every sequence that is still alive.
 *
 * Idempotent by construction: `UNIQUE (person_id, step)` means a second run
 * inserts nothing. The row is created `queued` with no body — pre-drafting is a
 * separate, budgeted step, so a sweep after an outage does not fire twenty
 * Claude calls at once.
 */
async function advanceSequences(user: User, now: Date): Promise<number> {
  const calendar = await loadCalendar();
  const version = await currentCalendarVersion();
  const at = nowIso(now);

  const sent = await query<SentRow>(
    `SELECT o.id AS outreach_id, o.person_id, o.step, o.sent_date_uae, o.subject,
            o.gmail_thread_id, o.references_chain,
            p.status AS person_status, p.company_id,
            s.status AS company_status
       FROM outreach o
       JOIN person p ON p.id = o.person_id
       LEFT JOIN user_company_state s ON s.company_id = p.company_id AND s.user_id = o.user_id
      WHERE o.user_id = ? AND o.status = 'sent' AND o.sent_date_uae IS NOT NULL
        AND o.step < 3
        AND p.status = 'in_sequence'
        -- Never manufacture a touch that the sequence has already moved past.
        -- A person who has had the break-up must not be handed a "just checking
        -- you saw this" afterwards, whatever gap the row history has in it.
        AND NOT EXISTS (
          SELECT 1 FROM outreach later
           WHERE later.person_id = o.person_id AND later.step > o.step
        )`,
    [user.id]
  );

  let created = 0;

  for (const row of sent) {
    if (row.company_status && FROZEN_COMPANY_STATES.includes(row.company_status)) continue;

    const nextStep = (row.step + 1) as 2 | 3;

    // Both offsets are measured from touch 1 (template-doctrine §(d): 0 → +4 →
    // +15), so step 3's anchor is the first email's send date, not step 2's.
    const anchor = await anchorFor(row.person_id, row.sent_date_uae);
    const dueWorkingDays = CADENCE_WORKING_DAYS[nextStep - 2];

    // Step 2 is a reply on the same thread; step 3 is a fresh email with a new
    // subject, so it inherits neither the thread id nor the References chain.
    const threaded = nextStep === 2;

    const changed = await execute(
      `INSERT INTO outreach
         (id, person_id, user_id, step, status, due_working_days, scheduled_date,
          calendar_version, gmail_thread_id, references_chain, subject, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (person_id, step) DO NOTHING`,
      [
        newId('outreach'),
        row.person_id,
        user.id,
        nextStep,
        dueWorkingDays,
        nextDue(anchor, dueWorkingDays, calendar),
        version,
        threaded ? row.gmail_thread_id : null,
        threaded ? row.references_chain : '[]',
        threaded && row.subject ? replySubjectOf(row.subject) : null,
        at,
        at,
      ]
    );
    created += changed;
  }

  return created;
}

/** Touch 1's send date, which every later offset counts from. */
async function anchorFor(personId: string, fallback: string): Promise<string> {
  const first = await queryOne<{ sent_date_uae: string | null }>(
    `SELECT sent_date_uae FROM outreach
      WHERE person_id = ? AND step = 1 AND sent_date_uae IS NOT NULL`,
    [personId]
  );
  return first?.sent_date_uae ?? fallback;
}

/** `Re:` exactly once, verbatim after it — Outlook threads on the subject too. */
function replySubjectOf(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

// ---------------------------------------------------------------------------
// 6. Ladder rotation
// ---------------------------------------------------------------------------

interface LadderCandidate {
  person_id: string;
  company_id: string;
  org_group_id: string;
  person_status: string;
  email_status: string;
  last_sent_date: string | null;
  company_status: string | null;
}

/**
 * Moves to the next contact at a company after the sequence ran out.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 *   - Rotation is legal **only after silence**. Never after any classified
 *     rejection. "Our quota is met this year" followed, a week later, by an
 *     email to the HR lead is the failure this guards.
 *   - The cooldown is waived when nobody saw anything. A hard bounce or an
 *     unmonitored mailbox means the message was never read by a human, so
 *     making the user wait a week costs a contact for nothing.
 */
async function rotateLadders(user: User, now: Date): Promise<number> {
  const calendar = await loadCalendar();
  const today = todayUae(now);
  const at = nowIso(now);

  const finished = await query<LadderCandidate>(
    `SELECT p.id AS person_id, p.company_id, p.status AS person_status, p.email_status,
            c.org_group_id, s.status AS company_status,
            (SELECT max(o2.sent_date_uae) FROM outreach o2
              WHERE o2.person_id = p.id AND o2.sent_date_uae IS NOT NULL) AS last_sent_date
       FROM person p
       JOIN company c ON c.id = p.company_id
       LEFT JOIN user_company_state s ON s.company_id = p.company_id AND s.user_id = ?
      WHERE p.status IN ('in_sequence', 'closed_silent', 'dead_end_mailbox', 'departed')
        AND EXISTS (SELECT 1 FROM outreach o WHERE o.person_id = p.id AND o.status IN ('sent', 'bounced'))
        AND NOT EXISTS (
          SELECT 1 FROM outreach o
           WHERE o.person_id = p.id
             AND o.status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved', 'sending')
        )`,
    [user.id]
  );

  let rotated = 0;

  for (const row of finished) {
    // A rejection, a removal request or a live conversation all live in the
    // company state. Rotation past any of them is the single most damaging
    // thing this product could do in a small market.
    if (row.company_status && FROZEN_COMPANY_STATES.includes(row.company_status)) continue;

    const nobodySawIt =
      row.email_status === 'bounced' ||
      row.person_status === 'dead_end_mailbox' ||
      row.person_status === 'departed';

    if (!nobodySawIt) {
      // Silence only counts once the sequence is actually finished: all three
      // touches sent, or the last one long enough ago.
      if (row.person_status !== 'closed_silent' && !(await sequenceExhausted(row.person_id))) continue;
      if (!row.last_sent_date) continue;
      if (workingDaysBetween(row.last_sent_date, today, calendar) < LADDER_COOLDOWN_WORKING_DAYS) continue;
    }

    // One live sequence per organisation: if anyone else at the group is
    // already mid-sequence, this rotation waits rather than doubling up.
    const [live] = await query<{ n: number }>(
      `SELECT count(*) AS n
         FROM person p JOIN company c ON c.id = p.company_id
        WHERE c.org_group_id IN ${ORG_FAMILY_SQL} AND p.status = 'in_sequence' AND p.id <> ?`,
      [...orgFamilyArgs(row.org_group_id), row.person_id]
    );
    if ((live?.n ?? 0) > 0) continue;

    // The next rung: ready, never contacted, and not already warm from a thread
    // (you do not cold-email someone you were introduced to).
    const next = await queryOne<{ id: string }>(
      `SELECT p.id FROM person p
        WHERE p.company_id = ? AND p.status = 'ready' AND p.in_warm_thread = 0
          AND p.email IS NOT NULL AND p.email_status IN ('verified', 'accept_all')
          AND NOT EXISTS (SELECT 1 FROM outreach o WHERE o.person_id = p.id)
        ORDER BY p.ladder_rank IS NULL, p.ladder_rank ASC, p.created_at ASC
        LIMIT 1`,
      [row.company_id]
    );
    if (!next) continue;

    const changed = await execute(
      `INSERT INTO outreach (id, person_id, user_id, step, status, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'queued', ?, ?)
       ON CONFLICT (person_id, step) DO NOTHING`,
      [newId('outreach'), next.id, user.id, at, at]
    );

    if (changed > 0) {
      await execute(`UPDATE person SET status = 'queued', updated_at = ? WHERE id = ?`, [at, next.id]);
      // The person we are rotating off is done, silently. No break-up beyond
      // the one already sent, and no note to them that they were replaced.
      if (row.person_status === 'in_sequence') {
        await execute(`UPDATE person SET status = 'closed_silent', updated_at = ? WHERE id = ?`, [at, row.person_id]);
      }
      rotated += changed;
    }
  }

  return rotated;
}

/** All three touches sent, or the break-up already gone out. */
async function sequenceExhausted(personId: string): Promise<boolean> {
  const [row] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM outreach
      WHERE person_id = ? AND step = 3 AND status IN ('sent', 'replied', 'bounced')`,
    [personId]
  );
  return (row?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Gateway challenges that were never completed
// ---------------------------------------------------------------------------

/**
 * A quarantined email nobody released.
 *
 * The countdown was paused when the challenge arrived. After a week of nothing,
 * the honest reading is that the message was never delivered — so it is treated
 * as a soft bounce and the ladder is allowed to move, rather than leaving the
 * best contact at the company frozen forever.
 */
async function timeOutGatewayChallenges(user: User, now: Date): Promise<number> {
  const calendar = await loadCalendar();
  const today = todayUae(now);

  const stalled = await query<{ person_id: string; received_at: string }>(
    `SELECT i.person_id, i.received_at
       FROM inbound i
       JOIN person p ON p.id = i.person_id
      WHERE i.classification = 'gateway_challenge'
        AND p.status = 'in_sequence'
        AND EXISTS (SELECT 1 FROM outreach o
                     WHERE o.person_id = i.person_id AND o.countdown_paused = 1)`,
    []
  );

  let timedOut = 0;
  for (const row of stalled) {
    const arrived = todayUae(new Date(row.received_at));
    if (workingDaysBetween(arrived, today, calendar) < GATEWAY_PATIENCE_WORKING_DAYS) continue;

    const at = nowIso(now);
    await execute(`UPDATE person SET status = 'closed_silent', updated_at = ? WHERE id = ?`, [at, row.person_id!]);
    // The pause is lifted as the rows close, so a later manual reopen does not
    // inherit a stopped clock nobody can see.
    await execute(
      `UPDATE outreach SET status = 'closed', countdown_paused = 0, updated_at = ?
        WHERE person_id = ? AND status IN ('queued', 'drafted', 'stale', 'needs_fact', 'approved')`,
      [at, row.person_id!]
    );
    timedOut++;
  }
  return timedOut;
}

// ---------------------------------------------------------------------------
// 8. Pre-drafting
// ---------------------------------------------------------------------------

/**
 * Writes the drafts that are about to be needed.
 *
 * Budgeted on purpose. A sweep after a long absence could otherwise fire fifty
 * Claude calls in one go, and the user only ever sees a handful of them — the
 * queue targets the observed send rate, not the ceiling.
 */
async function predraftDue(user: User, now: Date): Promise<{ drafted: number; refused: number }> {
  const calendar = await loadCalendar();
  const today = todayUae(now);
  const horizon = nextDue(today, PREDRAFT_HORIZON_WORKING_DAYS, calendar);

  // `regenerate_at_send` is why `drafted` appears here alongside `queued` and
  // `stale`. It marks a draft whose wording was bound before a holiday window
  // moved underneath it — the flag was set faithfully in three places and read
  // in none, so the "holiday openers bind at send-eligibility time" rule was
  // written down, stamped on the row, and never acted on. A draft carrying it
  // is rewritten here, once, and the flag cleared.
  const due = await query<{
    id: string;
    person_id: string;
    step: number;
    scheduled_date: string | null;
  }>(
    `SELECT o.id, o.person_id, o.step, o.scheduled_date
       FROM outreach o
       JOIN person p ON p.id = o.person_id
      WHERE o.user_id = ?
        AND (o.status IN ('queued', 'stale') OR (o.status = 'drafted' AND o.regenerate_at_send = 1))
        AND p.status IN ('ready', 'queued', 'in_sequence')
        AND o.countdown_paused = 0
        AND (o.scheduled_date IS NULL OR o.scheduled_date <= ?)
      ORDER BY o.step DESC, o.scheduled_date IS NULL, o.scheduled_date ASC
      LIMIT ?`,
    [user.id, horizon, PREDRAFT_PER_SWEEP]
  );

  let drafted = 0;
  let refused = 0;

  for (const row of due) {
    // A draft whose date has since moved past the horizon is not written now.
    if (row.scheduled_date && compareDates(row.scheduled_date, horizon) > 0) continue;

    // The same gate the Review screen's generate action runs — but only for a
    // first email, which is the only one built on evidence.
    //
    // `personEligibility` asks whether we know enough about a stranger to write
    // something specific and true about them. Touches 2 and 3 assert nothing
    // about them: one is "any thoughts?" on the existing thread and the other
    // closes it. Gating those on evidence freshness would strand a live
    // sequence — the first email already sent — behind a card asking for a fact
    // that the follow-up was never going to use, with no way for the user to
    // clear it.
    if (row.step === 1) {
      const { personEligibility } = await import('./people');
      const eligibility = await personEligibility(row.person_id, now);
      if (!eligibility.eligible) {
        await execute(
          `UPDATE outreach SET status = 'needs_fact', body = ?, updated_at = ? WHERE id = ?`,
          [eligibility.blockers[0].message, nowIso(now), row.id]
        );
        refused++;
        continue;
      }
    }

    const context = await loadContext(row.person_id, user.id, row.step as 1 | 2 | 3);
    if (!context) continue;

    const outcome = await generate(context, now);
    const at = nowIso(now);

    if (outcome.kind === 'halt') {
      await execute(`UPDATE outreach SET status = 'closed', updated_at = ? WHERE id = ?`, [at, row.id]);
      await logEvent({
        event: 'draft_refused',
        userId: user.id,
        entityType: 'outreach',
        entityId: row.id,
        detail: { halt: outcome.reason },
      });
      continue;
    }

    if (outcome.kind === 'refusal') {
      // Never a generic email and never an empty queue: the user gets a card
      // naming the one fact that would unblock it.
      await execute(
        `UPDATE outreach SET status = 'needs_fact', body = ?, updated_at = ? WHERE id = ?`,
        [outcome.refusal.collectionRequest, at, row.id]
      );
      refused++;
      continue;
    }

    await execute(
      `UPDATE outreach
          SET subject = COALESCE(subject, ?), body = ?, evidence_ids = ?, template_version = ?,
              subject_variant = ?, premise_tier = ?, status = 'drafted',
              regenerate_at_send = 0, updated_at = ?
        WHERE id = ?`,
      [
        outcome.draft.subject,
        outcome.draft.body,
        JSON.stringify(outcome.draft.evidenceIds),
        outcome.draft.templateVersion,
        outcome.draft.subjectVariant,
        outcome.draft.premiseTier,
        at,
        row.id,
      ]
    );
    drafted++;
  }

  return { drafted, refused };
}

// ---------------------------------------------------------------------------
// Confirming a holiday window before it arrives
// ---------------------------------------------------------------------------

/** How far ahead the founder is asked to confirm an unconfirmed window. */
const CONFIRM_WINDOW_LEAD_DAYS = 3;

/**
 * The "confirm Eid dates" task.
 *
 * Islamic holidays finalise on moon-sighting, and the government sometimes adds
 * a day two days out. Until a window is confirmed it counts as fully
 * non-working, and every draft crossing it carries `regenerate_at_send` — so
 * nothing breaks if nobody ever confirms it. What is lost is the warm opener: a
 * generic line goes out where "hope you had a good Eid" would have landed.
 *
 * Correct beats warm-but-wrong, which is why this is a nudge and not a block.
 */
export async function confirmationTasks(
  userId: string,
  now: Date = new Date()
): Promise<Array<{ id: string; name: string; start: string; end: string }>> {
  const { listWindows } = await import('./calendar-store');
  const today = todayUae(now);
  const horizon = addDays(today, CONFIRM_WINDOW_LEAD_DAYS);

  return (await listWindows())
    .filter(
      (w) =>
        !w.confirmed &&
        compareDates(w.start, horizon) <= 0 &&
        // Past windows are nobody's problem: the dates they governed have
        // already been derived and sent.
        compareDates(w.end, today) >= 0
    )
    .map((w) => ({ id: w.id, name: w.name, start: w.start, end: w.end }));
}

/** Raises the nudge as a Next Action, once, three days out. */
async function raiseConfirmationTasks(user: User, now: Date): Promise<number> {
  const { recordAction } = await import('./poller');
  const tasks = await confirmationTasks(user.id, now);

  for (const task of tasks) {
    await recordAction(
      user.id,
      null,
      null,
      {
        summary: `Confirm ${task.name}.`,
        superseded: 0,
        action: {
          kind: `confirm_window:${task.id}`,
          message: `${task.name} is pencilled in for ${task.start} to ${task.end} but not confirmed. Check the announced dates and set them — it decides whether the emails going out that week say anything about the holiday.`,
          url: '/calendar',
        },
      },
      null,
      now
    );
  }
  return tasks.length;
}

// ---------------------------------------------------------------------------
// Returning after an absence
// ---------------------------------------------------------------------------

export interface WelcomeBack {
  awayWorkingDays: number;
  /** The one line the returning user sees. Never a backlog count. */
  headline: string;
  show: boolean;
}

/**
 * What a user who has been away is told.
 *
 * The register item this exists for: someone back after ten days must see
 * "Welcome back — here are today's 3", never a backlog. A backlog is the
 * strongest abandonment driver this product has, and the count is the part that
 * does the damage, so it is never rendered.
 */
export async function welcomeBack(user: User, now: Date = new Date()): Promise<WelcomeBack> {
  const calendar = await loadCalendar();
  const today = todayUae(now);

  const last = await queryOne<{ at: string }>(
    `SELECT max(at) AS at FROM event_log
      WHERE user_id = ? AND event IN ('sent', 'draft_generated', 'draft_edited')`,
    [user.id]
  );
  if (!last?.at) return { awayWorkingDays: 0, headline: '', show: false };

  const away = workingDaysBetween(todayUae(new Date(last.at)), today, calendar);
  if (away < 3) return { awayWorkingDays: away, headline: '', show: false };

  return {
    awayWorkingDays: away,
    headline:
      'Welcome back. Everything paused while you were away and we have checked for replies — here is today, not a backlog.',
    show: true,
  };
}

/**
 * The date a paused user's sequences would resume from.
 *
 * Shown on the pause control so the choice is informed: pausing does not lose
 * anything, and the dates recompute from the day they come back.
 */
export function resumePreview(now: Date = new Date()): string {
  return addDays(todayUae(now), 1);
}
