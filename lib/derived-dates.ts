/**
 * Recomputing `outreach.scheduled_date` (ULTRAPROMPT §5, "scheduled_date is
 * derived, never authoritative").
 *
 * Eid shifts a day on moon-sighting. The government adds a day off two days
 * out. A stored due date that was correct when it was written is wrong the
 * moment either happens, so nothing reads `scheduled_date` as truth — it is
 * recomputed nightly and on every calendar edit from (prior send date, working-
 * day count, current calendar).
 *
 * Two protections travel with the recomputation:
 *   - a date may move later freely but only to tomorrow at the earliest, so a
 *     retroactive correction cannot make a follow-up due in the past and fire
 *     it the instant the sweep runs;
 *   - a draft that crosses an unconfirmed window is marked `regenerate_at_send`,
 *     because a holiday opener must bind at send-eligibility time, not now.
 */
import { loadCalendar } from './calendar-store';
import {
  clampRecomputedDueDate,
  compareDates,
  crossesUnconfirmedWindow,
  nextDue,
  todayUae,
  workingDaysBetween,
  type WorkingCalendar,
} from './calendar';
import { execute, query } from './db/client';
import { nowIso } from './ids';
import { logEvent } from './log';

/** Statuses whose dates are still live. Terminal rows are left alone. */
const NON_TERMINAL = [
  'queued',
  'drafted',
  'stale',
  'needs_fact',
  'approved',
  'paused_pending_reply',
] as const;

interface PendingRow {
  id: string;
  person_id: string;
  step: number;
  due_working_days: number | null;
  scheduled_date: string | null;
  anchor_sent_date: string | null;
  previous_sent_date: string | null;
  hold_until: string | null;
  countdown_paused: number;
}

/**
 * The minimum gap between what the recipient actually last received and the
 * next touch, whatever the doctrine's offset from day 0 works out to.
 *
 * Both offsets are counted from touch 1 (0 → +4 → +15), which is right when the
 * sequence runs on time. It is wrong when it does not: a user who disappears
 * and sends touch 2 on day 13 would otherwise get touch 3 two days later, which
 * reads as pestering to the only person whose opinion matters here.
 */
const MIN_GAP_AFTER_PREVIOUS_SEND = 4;

export interface RecomputeResult {
  examined: number;
  changed: number;
  flaggedForRegeneration: number;
  calendarVersion: number;
}

/**
 * Recomputes every live due date against the current calendar.
 *
 * Idempotent by construction: it derives from stored facts rather than
 * adjusting stored dates, so running it twice — or after a three-day outage —
 * converges to the same answer.
 */
export async function recomputeDerivedDates(
  options: { now?: Date; calendar?: WorkingCalendar } = {}
): Promise<RecomputeResult> {
  const calendar = options.calendar ?? (await loadCalendar());
  const today = todayUae(options.now ?? new Date());

  // The anchor is touch 1's send date — template-doctrine §(d) counts both
  // offsets from day 0, not from the step before. `previous_sent_date` is what
  // the recipient actually last received, which only sets a floor.
  const pending = await query<PendingRow>(
    `SELECT o.id, o.person_id, o.step, o.due_working_days, o.scheduled_date,
            o.hold_until, o.countdown_paused,
            first.sent_date_uae AS anchor_sent_date,
            prev.sent_date_uae  AS previous_sent_date
       FROM outreach o
       LEFT JOIN outreach first
              ON first.person_id = o.person_id
             AND first.step = 1
             AND first.status IN ('sent', 'replied', 'bounced')
       LEFT JOIN outreach prev
              ON prev.person_id = o.person_id
             AND prev.step = o.step - 1
             AND prev.status IN ('sent', 'replied', 'bounced')
      WHERE o.status IN (${NON_TERMINAL.map(() => '?').join(', ')})`,
    [...NON_TERMINAL]
  );

  let changed = 0;
  let flagged = 0;

  for (const row of pending) {
    // Step 1 has no predecessor: it is due whenever the queue offers it, and
    // there is nothing to derive.
    if (row.step === 1 || !row.anchor_sent_date || !row.due_working_days) continue;

    // A gateway challenge stops the clock rather than moving it. There is no
    // honest date to count from when the recipient never received the email.
    if (row.countdown_paused === 1) continue;

    const fromDayZero = nextDue(row.anchor_sent_date, row.due_working_days, calendar);
    const floors = [
      // What the recipient actually last received sets a floor of its own.
      row.previous_sent_date && row.previous_sent_date !== row.anchor_sent_date
        ? nextDue(row.previous_sent_date, MIN_GAP_AFTER_PREVIOUS_SEND, calendar)
        : null,
      // "Back on the 18th" is a fact about the recipient, so it survives the
      // recomputation instead of being overwritten by it.
      row.hold_until,
    ].filter((d): d is string => d !== null);

    const derived = clampRecomputedDueDate(
      floors.reduce((latest, floor) => (compareDates(floor, latest) > 0 ? floor : latest), fromDayZero),
      today,
      calendar,
      row.scheduled_date
    );
    const regenerate = crossesUnconfirmedWindow(today, derived, calendar);
    // The gap the wording must match is the one the recipient experiences:
    // measured from their last email, not from the start of the sequence.
    const gap = workingDaysBetween(row.previous_sent_date ?? row.anchor_sent_date, derived, calendar);

    if (derived !== row.scheduled_date) changed++;
    if (regenerate) flagged++;

    await execute(
      `UPDATE outreach
          SET scheduled_date = ?, calendar_version = ?, regenerate_at_send = ?,
              gap_working_days = ?, updated_at = ?
        WHERE id = ?`,
      [derived, calendar.version, regenerate ? 1 : 0, gap, nowIso(), row.id]
    );
  }

  const result: RecomputeResult = {
    examined: pending.length,
    changed,
    flaggedForRegeneration: flagged,
    calendarVersion: calendar.version,
  };

  if (changed > 0 || flagged > 0) {
    await logEvent({ event: 'calendar_edited', detail: { recompute: result } });
  }
  return result;
}

/**
 * What the cadence looks like from a given send date, for the calendar screen.
 *
 * The founder edits an Eid window and immediately sees the countdown move —
 * which is the only way to be sure the edit did what they meant before it
 * reaches a real recipient.
 */
export interface CadencePreview {
  step: number;
  label: string;
  workingDays: number;
  dueDate: string;
  gapWorkingDays: number;
  crossesUnconfirmed: boolean;
}

/** PLAN §5 as amended by research/template-doctrine.md §(d): Day 0 → +4 → +15. */
export const CADENCE_WORKING_DAYS = [4, 15] as const;

export function previewCadence(sentDateUae: string, calendar: WorkingCalendar): CadencePreview[] {
  const labels = ['Follow-up', 'Break-up'];
  return CADENCE_WORKING_DAYS.map((workingDays, i) => {
    const dueDate = nextDue(sentDateUae, workingDays, calendar);
    return {
      step: i + 2,
      label: labels[i],
      workingDays,
      dueDate,
      gapWorkingDays: workingDaysBetween(sentDateUae, dueDate, calendar),
      crossesUnconfirmed: crossesUnconfirmedWindow(sentDateUae, dueDate, calendar),
    };
  });
}
