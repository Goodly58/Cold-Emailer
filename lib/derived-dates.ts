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
}

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

  // The anchor is the send date of the previous step: "+4 working days" is
  // counted from when the recipient could first have read us, not from when
  // the row was created.
  const pending = await query<PendingRow>(
    `SELECT o.id, o.person_id, o.step, o.due_working_days, o.scheduled_date,
            prev.sent_date_uae AS anchor_sent_date
       FROM outreach o
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

    const derived = clampRecomputedDueDate(
      nextDue(row.anchor_sent_date, row.due_working_days, calendar),
      today
    );
    const regenerate = crossesUnconfirmedWindow(today, derived, calendar);
    const gap = workingDaysBetween(row.anchor_sent_date, derived, calendar);

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
