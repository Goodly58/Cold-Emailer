/**
 * What the dashboard shows, and what the pitch deck will need.
 *
 * The register item that governs this file: **a big "0 replies" in week one is
 * a statistically normal state displayed as failure**, and it is the strongest
 * abandonment driver the product has. The cadence puts most replies on days
 * 5-12, so for the first fortnight the honest reply count is zero and rendering
 * it prominently would end the account.
 *
 * So the dashboard leads on **leading indicators** — the things the user
 * actually controls and did this week — and reports replies only once there is
 * enough volume for the number to mean anything. Nothing here is a vanity
 * metric; they are simply the numbers that are true early.
 *
 * The attribution half is the weeks 5-6 requirement: the three pricing numbers
 * and the Experiment 1 comparison, each one query against the log table. Event
 * names were fixed from send #1 for exactly this reason.
 */
import { addDays, daysBetween, todayUae } from './calendar';
import { query, queryOne } from './db/client';

// ---------------------------------------------------------------------------
// Leading indicators
// ---------------------------------------------------------------------------

export interface LeadingIndicators {
  sentThisWeek: number;
  sentTotal: number;
  companiesInPlay: number;
  contactsReady: number;
  /** Follow-ups sent within a working day of coming due. Effort, not luck. */
  followUpsOnTime: number;
  followUpsDue: number;
  /** Working days since the first send. Drives what we are willing to claim. */
  daysRunning: number;
  /** True once the numbers below carry any signal at all. */
  repliesMeaningful: boolean;
  positiveReplies: number;
  totalReplies: number;
  /** One honest sentence about where this stands. */
  reading: string;
}

/** How many sends before a reply rate stops being noise. */
const SIGNAL_THRESHOLD = 20;

export async function leadingIndicators(userId: string, now: Date = new Date()): Promise<LeadingIndicators> {
  const today = todayUae(now);
  const weekStart = addDays(today, -7);

  const [
    [week],
    [total],
    [companies],
    [contacts],
    [first],
    [followUps],
    [onTime],
    [positive],
    [replies],
  ] = await Promise.all([
    query<{ n: number }>(
      `SELECT count(*) AS n FROM outreach WHERE user_id = ? AND sent_date_uae >= ?`,
      [userId, weekStart]
    ),
    query<{ n: number }>(`SELECT count(*) AS n FROM outreach WHERE user_id = ? AND sent_at IS NOT NULL`, [userId]),
    query<{ n: number }>(
      `SELECT count(DISTINCT p.company_id) AS n
         FROM outreach o JOIN person p ON p.id = o.person_id
        WHERE o.user_id = ? AND o.sent_at IS NOT NULL`,
      [userId]
    ),
    query<{ n: number }>(
      `SELECT count(*) AS n FROM person
        WHERE status = 'ready' AND email_status IN ('verified', 'accept_all')`
    ),
    query<{ d: string | null }>(
      `SELECT min(sent_date_uae) AS d FROM outreach WHERE user_id = ? AND sent_date_uae IS NOT NULL`,
      [userId]
    ),
    query<{ n: number }>(
      `SELECT count(*) AS n FROM outreach WHERE user_id = ? AND step > 1 AND sent_at IS NOT NULL`,
      [userId]
    ),
    query<{ n: number }>(
      // Sent on or before the day it came due. This is the one quality number
      // that is entirely within the user's control, which is why it is here and
      // a reply rate is not.
      `SELECT count(*) AS n FROM outreach
        WHERE user_id = ? AND step > 1 AND sent_date_uae IS NOT NULL
          AND scheduled_date IS NOT NULL AND sent_date_uae <= scheduled_date`,
      [userId]
    ),
    query<{ n: number }>(
      `SELECT count(*) AS n FROM inbound WHERE classification IN ('human_positive', 'referral', 'document_request')`
    ),
    query<{ n: number }>(
      `SELECT count(*) AS n FROM inbound
        WHERE classification NOT IN ('auto_reply_ooo', 'auto_ack_unmonitored', 'bounce',
                                     'gateway_challenge', 'unclassified')`
    ),
  ]);

  const sentTotal = total?.n ?? 0;
  const daysRunning = first?.d ? Math.max(0, daysBetween(first.d, today)) : 0;
  const repliesMeaningful = sentTotal >= SIGNAL_THRESHOLD;

  return {
    sentThisWeek: week?.n ?? 0,
    sentTotal,
    companiesInPlay: companies?.n ?? 0,
    contactsReady: contacts?.n ?? 0,
    followUpsOnTime: onTime?.n ?? 0,
    followUpsDue: followUps?.n ?? 0,
    daysRunning,
    repliesMeaningful,
    positiveReplies: positive?.n ?? 0,
    totalReplies: replies?.n ?? 0,
    reading: reading(sentTotal, daysRunning, repliesMeaningful, positive?.n ?? 0),
  };
}

/**
 * The one honest sentence.
 *
 * Never celebratory about nothing, never a scoreboard of zeros. Before the
 * cadence has had time to work, the truthful reading is about the work done,
 * because that is the only thing that has happened yet.
 */
function reading(sent: number, daysRunning: number, meaningful: boolean, positive: number): string {
  if (sent === 0) return 'Nothing has gone out yet. The first one is the hard one.';
  if (daysRunning < 5) {
    return 'Too early for replies. Most land between day 5 and day 12, after the first follow-up — quiet before then is what normal looks like.';
  }
  if (!meaningful) {
    return `${sent} sent. A reply rate does not mean anything below about ${SIGNAL_THRESHOLD}, so there is no number here yet — keep going.`;
  }
  if (positive === 0) {
    return `${sent} sent and no positive replies yet. That is within the normal range for cold outreach; the levers are the premise and who you are writing to, not the volume.`;
  }
  return `${sent} sent, ${positive} positive ${positive === 1 ? 'reply' : 'replies'}. That is roughly one in ${Math.round(sent / positive)}.`;
}

// ---------------------------------------------------------------------------
// Attribution (weeks 5-6)
// ---------------------------------------------------------------------------

export interface AttributionRow {
  dimension: string;
  value: string;
  sent: number;
  replies: number;
  positive: number;
  /** Null until the cell has enough sends to mean anything. */
  positiveRate: number | null;
}

/**
 * Reply rate by evidence tier, contact type, template variant, subject variant.
 *
 * One query per dimension, from the same join. The rate is deliberately null
 * below the signal threshold rather than shown as "0%" or "100%" off three
 * sends — a template killed on n=3 is a template killed at random.
 */
export async function attribution(
  userId: string,
  dimension: 'premise_tier' | 'contact_type' | 'template_version' | 'subject_variant'
): Promise<AttributionRow[]> {
  const column =
    dimension === 'contact_type' ? 'p.contact_type' : `o.${dimension}`;

  const rows = await query<{ value: string | null; sent: number; replies: number; positive: number }>(
    `SELECT ${column} AS value,
            count(*) AS sent,
            sum(CASE WHEN i.id IS NOT NULL THEN 1 ELSE 0 END) AS replies,
            sum(CASE WHEN i.classification IN ('human_positive', 'referral', 'document_request')
                     THEN 1 ELSE 0 END) AS positive
       FROM outreach o
       JOIN person p ON p.id = o.person_id
       LEFT JOIN inbound i
              ON i.person_id = o.person_id
             AND i.classification NOT IN ('auto_reply_ooo', 'auto_ack_unmonitored', 'bounce',
                                          'gateway_challenge', 'unclassified')
      WHERE o.user_id = ? AND o.sent_at IS NOT NULL
      GROUP BY ${column}
      ORDER BY sent DESC`,
    [userId]
  );

  return rows.map((r) => ({
    dimension,
    value: r.value === null ? '(none)' : String(r.value),
    sent: r.sent,
    replies: r.replies,
    positive: r.positive,
    positiveRate: r.sent >= SIGNAL_THRESHOLD ? r.positive / r.sent : null,
  }));
}

export interface PricingNumbers {
  minutesPerSend: number | null;
  sendsPerPositiveReply: number | null;
  repliesPerInterview: number | null;
  /** What each number rests on, so nobody quotes one built on four data points. */
  basis: { sends: number; positives: number; interviews: number; minutesLogged: number };
}

/**
 * The three numbers the pricing conversation needs.
 *
 * The friend phase is the only cheap unit-economics dataset this product will
 * ever have, which is why sourcing minutes are logged at capture time and event
 * names were frozen before send #1.
 */
export async function pricingNumbers(userId: string): Promise<PricingNumbers> {
  const [minutes] = await query<{ total: number; n: number }>(
    `SELECT coalesce(sum(CAST(json_extract(detail, '$.minutesSpent') AS REAL)), 0) AS total,
            count(*) AS n
       FROM event_log
      WHERE user_id = ? AND event = 'evidence_collected'
        AND json_extract(detail, '$.minutesSpent') IS NOT NULL`,
    [userId]
  );
  const [sends] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM outreach WHERE user_id = ? AND sent_at IS NOT NULL`,
    [userId]
  );
  const [positives] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM inbound
      WHERE classification IN ('human_positive', 'referral', 'document_request')`
  );
  const [interviews] = await query<{ n: number }>(
    `SELECT count(*) AS n FROM event_log WHERE user_id = ? AND event = 'interview_booked'`,
    [userId]
  );

  return {
    minutesPerSend: sends?.n ? (minutes?.total ?? 0) / sends.n : null,
    sendsPerPositiveReply: positives?.n ? (sends?.n ?? 0) / positives.n : null,
    repliesPerInterview: interviews?.n ? (positives?.n ?? 0) / interviews.n : null,
    basis: {
      sends: sends?.n ?? 0,
      positives: positives?.n ?? 0,
      interviews: interviews?.n ?? 0,
      minutesLogged: minutes?.n ?? 0,
    },
  };
}

export interface ExperimentResult {
  arm: 'A_hr_first' | 'B_manager_first';
  companies: number;
  sends: number;
  positive: number;
  positiveRate: number | null;
  minutesLogged: number;
}

export interface ExperimentComparison {
  arms: ExperimentResult[];
  /** The pre-registered decision, applied — or why it cannot be applied yet. */
  verdict: string;
}

/**
 * Experiment 1 — HR-first versus manager-first (PLAN §11).
 *
 * The decision rule was written down before the data existed, which is the only
 * thing that makes it a decision rule rather than a story: Arm A wins if it
 * lands within ~70% of Arm B's positive-reply rate at less than half the
 * effort. Sourcing an HR lead is minutes; sourcing a hiring manager is an
 * evening, and that difference is the whole point of the experiment.
 */
export async function experimentOne(userId: string): Promise<ExperimentComparison> {
  const rows = await query<{
    arm: 'A_hr_first' | 'B_manager_first';
    companies: number;
    sends: number;
    positive: number;
    minutes: number;
  }>(
    `SELECT c.experiment_arm AS arm,
            count(DISTINCT c.id) AS companies,
            count(o.id) AS sends,
            sum(CASE WHEN i.classification IN ('human_positive', 'referral', 'document_request')
                     THEN 1 ELSE 0 END) AS positive,
            coalesce((SELECT sum(CAST(json_extract(e.detail, '$.minutesSpent') AS REAL))
                        FROM event_log e
                       WHERE e.event = 'evidence_collected'
                         AND json_extract(e.detail, '$.companyId') IN (
                               SELECT c2.id FROM company c2 WHERE c2.experiment_arm = c.experiment_arm)), 0) AS minutes
       FROM company c
       JOIN person p ON p.company_id = c.id
       JOIN outreach o ON o.person_id = p.id AND o.user_id = ? AND o.sent_at IS NOT NULL
       LEFT JOIN inbound i ON i.person_id = p.id
      WHERE c.experiment_arm IS NOT NULL
      GROUP BY c.experiment_arm`,
    [userId]
  );

  const arms: ExperimentResult[] = rows.map((r) => ({
    arm: r.arm,
    companies: r.companies,
    sends: r.sends,
    positive: r.positive,
    positiveRate: r.sends >= SIGNAL_THRESHOLD ? r.positive / r.sends : null,
    minutesLogged: r.minutes,
  }));

  return { arms, verdict: verdictFor(arms) };
}

function verdictFor(arms: ExperimentResult[]): string {
  const a = arms.find((x) => x.arm === 'A_hr_first');
  const b = arms.find((x) => x.arm === 'B_manager_first');

  if (!a || !b) return 'Both arms need sends before there is anything to compare.';
  if (a.positiveRate === null || b.positiveRate === null) {
    return `Not enough data yet: ${a.sends} sends in the HR-first arm, ${b.sends} in the manager-first arm. The rule needs at least ${SIGNAL_THRESHOLD} in each.`;
  }

  const effortRatio = b.minutesLogged > 0 ? a.minutesLogged / b.minutesLogged : 1;
  const rateRatio = b.positiveRate > 0 ? a.positiveRate / b.positiveRate : 1;

  if (rateRatio >= 0.7 && effortRatio < 0.5) {
    return `HR-first is the default: it reaches ${Math.round(rateRatio * 100)}% of the manager-first reply rate for ${Math.round(effortRatio * 100)}% of the effort.`;
  }
  if (rateRatio < 0.7) {
    return `Manager-first wins on quality: HR-first reaches only ${Math.round(rateRatio * 100)}% of its reply rate. The extra sourcing time is buying something.`;
  }
  return `The reply rates are close (${Math.round(rateRatio * 100)}%) but so is the effort (${Math.round(effortRatio * 100)}%). No change — the rule needs a real effort gap to fire.`;
}

/** The single most useful debugging view: what happened, newest first. */
export async function recentEvents(userId: string, limit = 40) {
  return query<{ at: string; event: string; entity_type: string | null; detail: string; level: string }>(
    `SELECT at, event, entity_type, detail, level FROM event_log
      WHERE user_id = ? OR user_id IS NULL
      ORDER BY at DESC LIMIT ?`,
    [userId, limit]
  );
}

/** Whether anything at all has been sent — the dashboard's empty-state gate. */
export async function hasSent(userId: string): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*) AS n FROM outreach WHERE user_id = ? AND sent_at IS NOT NULL`,
    [userId]
  );
  return (row?.n ?? 0) > 0;
}
