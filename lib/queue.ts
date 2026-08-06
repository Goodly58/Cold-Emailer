/**
 * Building today's queue.
 *
 * Two forces pull against each other here and both are real:
 *
 *   - The ceiling is a MAXIMUM, not a target. A 10-15/day pipeline against
 *     fifteen minutes of actual weekly usage means every session opens with a
 *     backlog — which for this user is the strongest abandonment driver there
 *     is. So the queue targets the observed send rate, and there is no total
 *     backlog count anywhere in the UI.
 *   - Deliverability is silent until it is catastrophic. The ceiling ramps
 *     3 → 5 → 10 → 15 over two weeks in code, follow-ups drain before new
 *     emails, and no organisation hears from us twice inside 48 hours.
 *
 * Everything here is a maximum the Send button is governed by. There is no
 * "approve all", deliberately, and nothing sends because a number said it could.
 */
import {
  addDays,
  compareDates,
  isSendWindowDay,
  nextSendWindowDay,
  todayUae,
  workingDaysBetween,
} from './calendar';
import { loadCalendar } from './calendar-store';
import { execute, query, queryOne } from './db/client';
import { SAME_DOMAIN_SPACING_MS } from './durations';
import { nowIso } from './ids';
import { familyOf, orgFamilyKeys, ORG_FAMILY_SQL, orgFamilyArgs } from './org';
import { logEvent } from './log';
import type { User } from './user';

/** The ramp, in days since the first send. Deliverability, not politeness. */
const CEILING_RAMP: Array<{ afterDays: number; ceiling: number }> = [
  { afterDays: 0, ceiling: 3 },
  { afterDays: 3, ceiling: 5 },
  { afterDays: 7, ceiling: 10 },
  { afterDays: 14, ceiling: 15 },
];

/** Follow-ups have their own budget and always drain first. */
export const FOLLOW_UP_CAP = 20;
export const COMBINED_CAP = 25;

/** A drafted first email goes stale after this many working days; a follow-up sooner. */
const STALE_AFTER_WORKING_DAYS = { first: 3, followUp: 2 } as const;

export interface Budget {
  ceiling: number;
  firstEmailsRemaining: number;
  followUpsRemaining: number;
  sentToday: number;
  /** What the queue actually offers — the observed rate, not the ceiling. */
  target: number;
  rampNote: string;
}

/**
 * Today's budget.
 *
 * The ramp is keyed to the first send rather than the account age, so a user
 * who sets up and then disappears for a month still starts at three.
 */
export async function budgetFor(user: User, now: Date = new Date()): Promise<Budget> {
  const today = todayUae(now);

  const first = await queryOne<{ sent_date_uae: string }>(
    `SELECT sent_date_uae FROM outreach
      WHERE user_id = ? AND status IN ('sent', 'replied', 'bounced') AND sent_date_uae IS NOT NULL
      ORDER BY sent_date_uae ASC LIMIT 1`,
    [user.id]
  );

  let ceiling = CEILING_RAMP[0].ceiling;
  let rampNote = 'Starting slow on purpose — a new mailbox that suddenly sends fifteen a day gets filtered.';

  if (first) {
    for (const stage of CEILING_RAMP) {
      if (compareDates(today, addDays(first.sent_date_uae, stage.afterDays)) >= 0) {
        ceiling = stage.ceiling;
      }
    }
    if (ceiling === CEILING_RAMP[CEILING_RAMP.length - 1].ceiling) rampNote = '';
  }

  const [sentToday] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM outreach WHERE user_id = ? AND sent_date_uae = ?`,
    [user.id, today]
  );
  const [followUpsToday] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM outreach WHERE user_id = ? AND sent_date_uae = ? AND step > 1`,
    [user.id, today]
  );

  const sent = sentToday?.n ?? 0;
  const followUps = followUpsToday?.n ?? 0;
  const firstEmails = sent - followUps;

  // The queue offers what this person actually sends, plus a little room.
  // Offering fifteen to someone who sends three manufactures a backlog.
  const [trailing] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM outreach
      WHERE user_id = ? AND step = 1 AND sent_date_uae >= ?`,
    [user.id, addDays(today, -7)]
  );
  const observedPerDay = Math.max(1, Math.round((trailing?.n ?? 0) / 7));
  const target = Math.min(ceiling, Math.max(2, Math.ceil(observedPerDay * 1.2)));

  return {
    ceiling,
    firstEmailsRemaining: Math.max(0, Math.min(ceiling - firstEmails, COMBINED_CAP - sent)),
    followUpsRemaining: Math.max(0, Math.min(FOLLOW_UP_CAP - followUps, COMBINED_CAP - sent)),
    sentToday: sent,
    target,
    rampNote,
  };
}

export interface QueueItem {
  outreachId: string;
  personId: string;
  personName: string;
  companyId: string;
  companyName: string;
  contactType: string;
  step: number;
  subject: string | null;
  body: string | null;
  status: string;
  scheduledDate: string | null;
  /** Working days until due. Negative means overdue — follow-ups only. */
  dueInWorkingDays: number | null;
  sendable: boolean;
  blockedReason: string | null;
}

export interface TodayQueue {
  followUps: QueueItem[];
  firstEmails: QueueItem[];
  needsFact: Array<{ outreachId: string; personName: string; companyName: string; request: string }>;
  budget: Budget;
  deferred: number;
  /** One line framing the session with a finish line, never a backlog. */
  headline: string;
}

interface QueueRow {
  id: string;
  person_id: string;
  step: number;
  subject: string | null;
  body: string | null;
  status: string;
  scheduled_date: string | null;
  updated_at: string;
  person_name: string;
  contact_type: string;
  company_id: string;
  company_name: string;
  org_group_id: string;
  email_status: string;
  person_status: string;
}

const QUEUE_SELECT = `
  SELECT o.id, o.person_id, o.step, o.subject, o.body, o.status, o.scheduled_date, o.updated_at,
         p.full_name_raw AS person_name, p.contact_type, p.email_status, p.status AS person_status,
         c.id AS company_id, c.name AS company_name, c.org_group_id
    FROM outreach o
    JOIN person p ON p.id = o.person_id
    JOIN company c ON c.id = p.company_id
   WHERE o.user_id = ?`;

/**
 * Today's queue.
 *
 * Order is not cosmetic: follow-ups first because they have deadlines and cold
 * emails do not, then the safest first email — an Emiratisation lead with the
 * strongest evidence, whose job is literally to want this email — because the
 * gap between "viewed a draft" and "sent one" is where users silently churn.
 */
export async function buildQueue(user: User, now: Date = new Date()): Promise<TodayQueue> {
  const today = todayUae(now);
  const calendar = await loadCalendar();
  const budget = await budgetFor(user, now);

  // CULTURE.md §9: Mon-Thu only. The cards still render — someone opening the
  // app on a Saturday to an empty screen assumes it is broken, whereas "three
  // ready, held until Monday" is reassuring and true. The Send button is what
  // is switched off, not the screen.
  const outsideWindow = !isSendWindowDay(today, calendar);
  const nextWindowDay = outsideWindow ? nextSendWindowDay(today, calendar) : null;

  // Two org groups a founder has linked as one employer must compare equal
  // everywhere below, or a parent and its distinct-domain subsidiary both get
  // offered the same morning — two emails into one office.
  const families = await orgFamilyKeys();

  const rows = await query<QueueRow>(
    // A paused countdown is excluded outright. A gateway-quarantined step has
    // no scheduled_date, and "no date" would otherwise read as "due now" — the
    // follow-up offered into a quarantine the recipient never released.
    `${QUEUE_SELECT} AND o.status IN ('drafted', 'stale', 'approved', 'needs_fact')
       AND o.countdown_paused = 0
     ORDER BY o.step DESC, o.scheduled_date ASC NULLS LAST, o.created_at ASC`,
    [user.id]
  );

  // Organisations already written to inside the spacing window. Enforced at
  // org_group, so "Emirates NBD" and "Emirates NBD Capital" count as one.
  const recentlyContacted = new Set(
    (
      await query<{ org_group_id: string }>(
        `SELECT DISTINCT c.org_group_id
           FROM outreach o JOIN person p ON p.id = o.person_id JOIN company c ON c.id = p.company_id
          WHERE o.user_id = ? AND o.sent_at IS NOT NULL AND o.sent_at > ?`,
        [user.id, new Date(now.getTime() - SAME_DOMAIN_SPACING_MS).toISOString()]
      )
    ).map((r) => familyOf(r.org_group_id, families))
  );

  // One live sequence per organisation.
  const liveSequences = new Set(
    (
      await query<{ org_group_id: string }>(
        `SELECT DISTINCT c.org_group_id
           FROM outreach o JOIN person p ON p.id = o.person_id JOIN company c ON c.id = p.company_id
          WHERE o.user_id = ? AND o.status = 'sent' AND p.status = 'in_sequence'`,
        [user.id]
      )
    ).map((r) => familyOf(r.org_group_id, families))
  );

  const followUps: QueueItem[] = [];
  const firstEmails: QueueItem[] = [];
  const needsFact: TodayQueue['needsFact'] = [];
  const offeredOrgs = new Set<string>();
  let deferred = 0;

  for (const row of rows) {
    if (row.status === 'needs_fact') {
      needsFact.push({
        outreachId: row.id,
        personName: row.person_name,
        companyName: row.company_name,
        request: row.body ?? 'One specific, recent fact about this person would unblock it.',
      });
      continue;
    }

    const isFollowUp = row.step > 1;
    const due = row.scheduled_date;
    if (isFollowUp && due && compareDates(due, today) > 0) continue; // not yet
    const family = familyOf(row.org_group_id, families);
    if (!isFollowUp && liveSequences.has(family)) continue; // one at a time

    let blockedReason: string | null = null;
    if (outsideWindow) {
      blockedReason = `Held until ${nextWindowDay} — an email landing now would be read on Monday at best.`;
    } else if (recentlyContacted.has(family) || offeredOrgs.has(family)) {
      blockedReason = 'Someone else at this company heard from you in the last two days. This waits.';
    } else if (row.person_status === 'replied' || row.person_status === 'replied_external') {
      blockedReason = 'They already replied.';
    } else if (row.email_status !== 'verified' && row.email_status !== 'accept_all') {
      blockedReason = 'The address is not confirmed yet.';
    }

    const item: QueueItem = {
      outreachId: row.id,
      personId: row.person_id,
      personName: row.person_name,
      companyId: row.company_id,
      companyName: row.company_name,
      contactType: row.contact_type,
      step: row.step,
      subject: row.subject,
      body: row.body,
      status: row.status,
      scheduledDate: due,
      dueInWorkingDays: due ? workingDaysBetween(today, due, calendar) || (compareDates(due, today) < 0 ? -1 : 0) : null,
      sendable: blockedReason === null,
      blockedReason,
    };

    // Everything blocked for a per-contact reason drops out of the list — the
    // user cannot act on it and a card they cannot use is noise. The send
    // window is the exception: it blocks the whole day, and an empty screen on
    // a Saturday reads as broken rather than as "nothing to do today".
    if (blockedReason && !outsideWindow) {
      deferred++;
      continue;
    }

    if (isFollowUp) {
      if (followUps.length < budget.followUpsRemaining) {
        followUps.push(item);
        offeredOrgs.add(family);
      } else deferred++;
    } else {
      const room = Math.min(budget.firstEmailsRemaining, budget.target);
      if (firstEmails.length < Math.max(0, room - followUps.length)) {
        firstEmails.push(item);
        offeredOrgs.add(family);
      } else deferred++;
    }
  }

  // Safest first: the person whose job is to want this email.
  firstEmails.sort((a, b) => rank(a.contactType) - rank(b.contactType));

  const total = followUps.length + firstEmails.length;
  if (outsideWindow) {
    return {
      followUps,
      firstEmails,
      needsFact,
      budget,
      deferred,
      headline:
        total === 0
          ? `Nothing to do today. Emails go out Monday to Thursday — anything ready will be waiting on ${nextWindowDay}.`
          : `${total} ready, held until ${nextWindowDay}. Monday to Thursday is the only window that lands properly in the Gulf, so today is genuinely a day off.`,
    };
  }

  const headline =
    total === 0
      ? needsFact.length > 0
        ? `${needsFact.length} contact${needsFact.length === 1 ? '' : 's'} need one more fact before we can write anything worth sending.`
        : 'Nothing to send right now. We will have more ready shortly.'
      : `Today: ${total} email${total === 1 ? '' : 's'}, about ${Math.max(1, Math.round(total * 1.5))} minutes.`;

  return { followUps, firstEmails, needsFact, budget, deferred, headline };
}

function rank(contactType: string): number {
  return { emiratisation_lead: 0, hr: 1, hiring_manager: 2, exec: 3 }[contactType] ?? 4;
}

/**
 * The freshness pass a returning user's queue must survive before anything is
 * sendable.
 *
 * Someone back after ten days would otherwise batch-send a queue containing a
 * replied thread, a bounce, and "since my note last week" that is two weeks
 * wrong. Sends are blocked until this completes — which is also why the Review
 * screen shows "welcome back, here are today's three" rather than the backlog.
 */
export async function freshnessPass(user: User, now: Date = new Date()): Promise<{
  staled: number;
  superseded: number;
}> {
  const today = todayUae(now);
  const calendar = await loadCalendar();

  // Anything queued for a person who has since replied is terminal, not stale.
  const superseded = await execute(
    `UPDATE outreach
        SET status = 'superseded_by_reply', updated_at = ?
      WHERE user_id = ?
        AND status IN ('queued', 'drafted', 'stale', 'approved')
        AND person_id IN (SELECT id FROM person WHERE status IN ('replied', 'replied_external', 'departed', 'suppressed'))`,
    [nowIso(now), user.id]
  );

  const drafts = await query<{ id: string; step: number; scheduled_date: string | null; updated_at: string }>(
    `SELECT id, step, scheduled_date, updated_at FROM outreach
      WHERE user_id = ? AND status IN ('drafted', 'approved')`,
    [user.id]
  );

  let staled = 0;
  for (const draft of drafts) {
    const anchor = draft.scheduled_date ?? todayUae(new Date(draft.updated_at));
    const limit = draft.step > 1 ? STALE_AFTER_WORKING_DAYS.followUp : STALE_AFTER_WORKING_DAYS.first;
    if (workingDaysBetween(anchor, today, calendar) > limit) {
      await execute(`UPDATE outreach SET status = 'stale', updated_at = ? WHERE id = ?`, [nowIso(now), draft.id]);
      staled++;
    }
  }

  if (staled > 0 || superseded > 0) {
    await logEvent({ event: 'draft_stale', userId: user.id, detail: { staled, superseded } });
  }
  return { staled, superseded };
}

/**
 * Whether this draft may be sent right now, and if not, why in one sentence.
 *
 * The Send button is governed by the invariants, not by user stamina: past the
 * budget a draft renders with Send disabled and stays `drafted`. There is no
 * hidden auto-send queue, because hard rule 1 has no exceptions.
 */
export async function sendPermission(
  user: User,
  outreachId: string,
  now: Date = new Date()
): Promise<{ allowed: boolean; message?: string }> {
  // CULTURE.md §9. Monday to Thursday is the only window that is safe for every
  // org type in the UAE: government works to Friday midday, Friday prayers take
  // the middle of the day, Saturday is the weekend for essentially everyone,
  // and Sunday is the weekend for government and most private firms. An email
  // landing on any of them is buried by Monday morning — which reads to the
  // sender as silence and to the recipient as nothing at all.
  const calendar = await loadCalendar();
  const today = todayUae(now);
  if (!isSendWindowDay(today, calendar)) {
    const next = nextSendWindowDay(today, calendar);
    return {
      allowed: false,
      message: `Nothing sends today — it would be read on Monday at best, buried under a weekend of email. Everything is held until ${next}, which costs you nothing.`,
    };
  }

  const budget = await budgetFor(user, now);
  const row = await queryOne<{ step: number; org_group_id: string }>(
    `SELECT o.step, c.org_group_id
       FROM outreach o JOIN person p ON p.id = o.person_id JOIN company c ON c.id = p.company_id
      WHERE o.id = ?`,
    [outreachId]
  );
  if (!row) return { allowed: false, message: 'That draft is no longer here.' };

  const remaining = row.step > 1 ? budget.followUpsRemaining : budget.firstEmailsRemaining;
  if (remaining <= 0) {
    return {
      allowed: false,
      message: "That is today's lot. The rest unlock tomorrow at 9:00 Gulf — sending more in one go is how a personal mailbox gets filtered.",
    };
  }

  const [recent] = await query<{ n: number }>(
    `SELECT count(*) AS n
       FROM outreach o JOIN person p ON p.id = o.person_id JOIN company c ON c.id = p.company_id
      WHERE o.user_id = ? AND c.org_group_id IN ${ORG_FAMILY_SQL} AND o.sent_at > ?`,
    [user.id, ...orgFamilyArgs(row.org_group_id), new Date(now.getTime() - SAME_DOMAIN_SPACING_MS).toISOString()]
  );
  if ((recent?.n ?? 0) > 0) {
    return {
      allowed: false,
      message: 'Someone else at this company heard from you in the last two days. Two emails into one office in one week is worse than none.',
    };
  }

  return { allowed: true };
}
