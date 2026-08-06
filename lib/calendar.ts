/**
 * The UAE working-day calendar. This is the ONLY module in the codebase
 * allowed to do date arithmetic (ULTRAPROMPT §5 "All date math must be
 * Asia/Dubai calendar dates"; CI enforces it with a grep).
 *
 * Two rules live here and they are different things:
 *
 *   1. COUNTING (hard rule 6). Follow-up countdowns are measured in UAE
 *      working days: Mon–Fri, minus public-holiday windows and the late-Ramadan
 *      pause. Saturday and Sunday are the UAE weekend since 2022 — not Fri–Sat.
 *      `nextDue()` is the single function that does this.
 *
 *   2. SENDING (CULTURE.md §9, lint rule 7). A day can be a working day and
 *      still be a bad day to land in someone's inbox. Friday is a half-day for
 *      government and carries Friday prayers; Sunday is the weekend for
 *      government and for private firms on Sat–Sun. The safe band is Mon–Thu.
 *      `nextSendWindowDay()` does this, and it never changes the countdown.
 *
 * Everything is a UAE calendar date ("YYYY-MM-DD"), never a timestamp.
 * Asia/Dubai is a fixed UTC+4 with no DST, so a date is derived by shifting the
 * instant and reading the UTC calendar — which makes every function here
 * independent of the server's TZ. The test suite runs under
 * TZ=America/New_York to prove it.
 */

/** A calendar date in Asia/Dubai, "YYYY-MM-DD". Never a timestamp. */
export type UaeDate = string;

const MS_PER_DAY = 86_400_000;
const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;

/** How far ahead we will search before deciding the calendar is broken. */
const MAX_SEARCH_DAYS = 400;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

export type WindowKind = 'public_holiday' | 'ramadan_pause';

export interface CalendarWindow {
  name: string;
  kind: WindowKind;
  /** Inclusive. */
  start: UaeDate;
  /** Inclusive. */
  end: UaeDate;
  /**
   * Islamic dates finalize on moon-sighting. An unconfirmed window counts as
   * fully non-working — correct-and-late beats warm-and-wrong (ULTRAPROMPT §5,
   * "scheduled_date is derived, never authoritative").
   */
  confirmed: boolean;
}

export interface WorkingCalendar {
  windows: CalendarWindow[];
  /** Bumped on every calendar edit so stale derived dates are detectable. */
  version: number;
}

export const EMPTY_CALENDAR: WorkingCalendar = { windows: [], version: 0 };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function assertUaeDate(value: string): UaeDate {
  if (!DATE_RE.test(value)) {
    throw new CalendarError(`not a UAE calendar date: ${JSON.stringify(value)}`);
  }
  // Rejects 2026-02-30 and friends by round-tripping.
  if (fromDayNumber(toDayNumber(value)) !== value) {
    throw new CalendarError(`not a real calendar date: ${value}`);
  }
  return value;
}

/** The UAE calendar date an instant falls on. */
export function toUaeDate(instant: Date): UaeDate {
  const ms = instant.getTime();
  if (!Number.isFinite(ms)) throw new CalendarError('invalid instant');
  return new Date(ms + UAE_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today, in Dubai. Pass `now` in tests; never call `new Date()` elsewhere. */
export function todayUae(now: Date = new Date()): UaeDate {
  return toUaeDate(now);
}

function toDayNumber(date: UaeDate): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function fromDayNumber(dayNumber: number): UaeDate {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
function dayOfWeek(date: UaeDate): number {
  return new Date(toDayNumber(date) * MS_PER_DAY).getUTCDay();
}

export function addDays(date: UaeDate, days: number): UaeDate {
  return fromDayNumber(toDayNumber(assertUaeDate(date)) + days);
}

export function daysBetween(from: UaeDate, to: UaeDate): number {
  return toDayNumber(assertUaeDate(to)) - toDayNumber(assertUaeDate(from));
}

export function compareDates(a: UaeDate, b: UaeDate): number {
  return toDayNumber(assertUaeDate(a)) - toDayNumber(assertUaeDate(b));
}

export function isWeekend(date: UaeDate): boolean {
  const dow = dayOfWeek(assertUaeDate(date));
  return dow === 6 || dow === 0; // Saturday, Sunday
}

/** The window covering this date, if any. Unconfirmed windows count. */
export function windowCovering(
  date: UaeDate,
  calendar: WorkingCalendar
): CalendarWindow | null {
  assertUaeDate(date);
  for (const w of calendar.windows) {
    if (compareDates(date, w.start) >= 0 && compareDates(date, w.end) <= 0) return w;
  }
  return null;
}

/** A working day for COUNTING purposes: Mon–Fri, outside every window. */
export function isWorkingDay(date: UaeDate, calendar: WorkingCalendar): boolean {
  if (isWeekend(date)) return false;
  return windowCovering(date, calendar) === null;
}

/**
 * A day it is acceptable to actually land an email on: Mon–Thu, outside every
 * window (CULTURE.md §9). Strictly narrower than `isWorkingDay`.
 */
export function isSendWindowDay(date: UaeDate, calendar: WorkingCalendar): boolean {
  const dow = dayOfWeek(assertUaeDate(date));
  if (dow < 1 || dow > 4) return false; // Mon=1 … Thu=4
  return windowCovering(date, calendar) === null;
}

function search(
  from: UaeDate,
  calendar: WorkingCalendar,
  predicate: (d: UaeDate, c: WorkingCalendar) => boolean,
  label: string
): UaeDate {
  let cursor = assertUaeDate(from);
  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    if (predicate(cursor, calendar)) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new CalendarError(
    `no ${label} found within ${MAX_SEARCH_DAYS} days of ${from} — the calendar has a window that never ends`
  );
}

/** This date if it is a working day, else the next one. */
export function nextWorkingDay(from: UaeDate, calendar: WorkingCalendar): UaeDate {
  return search(from, calendar, isWorkingDay, 'working day');
}

/** This date if it is inside the send window, else the next one that is. */
export function nextSendWindowDay(from: UaeDate, calendar: WorkingCalendar): UaeDate {
  return search(from, calendar, isSendWindowDay, 'send-window day');
}

// ---------------------------------------------------------------------------
// The countdown
// ---------------------------------------------------------------------------

/**
 * The single date function of the outreach state machine (hard rule 15).
 *
 *   anchor = the send date if it was a working day, else the next working day
 *   due    = the k-th working day strictly after the anchor
 *
 * A send that lands on a weekend or inside a holiday still anchors to a real
 * working day, so "+4 working days" always means four days on which somebody
 * could have read the email.
 *
 * @param sentDateUae  the UAE calendar date step n was sent
 * @param workingDays  k, the countdown from PLAN §5 (4, then 5 more)
 */
export function nextDue(
  sentDateUae: UaeDate,
  workingDays: number,
  calendar: WorkingCalendar
): UaeDate {
  assertUaeDate(sentDateUae);
  if (!Number.isInteger(workingDays) || workingDays < 1) {
    throw new CalendarError(`workingDays must be a positive integer, got ${workingDays}`);
  }

  const anchor = nextWorkingDay(sentDateUae, calendar);

  let cursor = anchor;
  let counted = 0;
  for (let i = 0; i < MAX_SEARCH_DAYS && counted < workingDays; i++) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor, calendar)) counted++;
  }
  if (counted < workingDays) {
    throw new CalendarError(
      `could not count ${workingDays} working days after ${sentDateUae} within ${MAX_SEARCH_DAYS} days`
    );
  }
  return cursor;
}

/** Working days in (from, to]. Used for the gap that triggers re-introduction mode. */
export function workingDaysBetween(
  from: UaeDate,
  to: UaeDate,
  calendar: WorkingCalendar
): number {
  assertUaeDate(from);
  assertUaeDate(to);
  if (compareDates(from, to) >= 0) return 0;

  // A long span is old data, not a bug.
  //
  // This used to throw past 400 days, on the reasoning that such a gap must be
  // a mistake. It is not: a person sits in `closed_silent` forever, a row sits
  // in `paused_pending_reply` indefinitely, and a user can come back after a
  // year. Every caller here is asking "how long has it been" — the sweep's
  // rotation cooldown, the nightly recompute, the welcome-back line — so the
  // throw did not surface a bug, it detonated the entire scheduler on a
  // fourteen-month-old row and stopped every follow-up in the system.
  //
  // The honest answer to "more working days than we count" is the cap. Nothing
  // downstream distinguishes 300 from 3,000: they are all "long ago".
  const span = daysBetween(from, to);
  if (span > MAX_SEARCH_DAYS) return LONG_AGO_WORKING_DAYS;

  let count = 0;
  let cursor = from;
  for (let i = 0; i < span; i++) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor, calendar)) count++;
  }
  return count;
}

/** What `workingDaysBetween` reports for a span beyond its search window. */
export const LONG_AGO_WORKING_DAYS = Math.floor((MAX_SEARCH_DAYS * 5) / 7);

/**
 * Guard for recomputing a derived due date after a calendar edit
 * (ULTRAPROMPT §5): a date may move later freely, but may only move earlier to
 * tomorrow at the soonest — otherwise a retroactive holiday correction can make
 * a follow-up due in the past and fire it the moment the sweep runs.
 *
 * Two details that only show up in a live sweep:
 *
 *   - The floor is the next **working day** after today, not the next calendar
 *     day. Clamping to a bare tomorrow lands follow-ups on Saturdays, where
 *     they sit outside the send window doing nothing while the countdown reads
 *     as satisfied.
 *   - A date equal to today is not "in the past" — it is due now, which is what
 *     the countdown has said all along. Pushing it out would move a legitimate
 *     follow-up every time the sweep happened to run after 20:00 UTC, when
 *     Dubai has already rolled over to the next day.
 */
export function clampRecomputedDueDate(
  recomputed: UaeDate,
  todayUaeDate: UaeDate,
  calendar: WorkingCalendar = EMPTY_CALENDAR
): UaeDate {
  assertUaeDate(recomputed);
  assertUaeDate(todayUaeDate);
  if (compareDates(recomputed, todayUaeDate) >= 0) return recomputed;
  return nextWorkingDay(addDays(todayUaeDate, 1), calendar);
}

/**
 * True when a draft crosses an unconfirmed window between now and its due date,
 * which means any holiday-flavoured opener in it must be regenerated at send
 * time rather than bound now (`outreach.regenerate_at_send`).
 */
export function crossesUnconfirmedWindow(
  from: UaeDate,
  to: UaeDate,
  calendar: WorkingCalendar
): boolean {
  assertUaeDate(from);
  assertUaeDate(to);
  return calendar.windows.some(
    (w) => !w.confirmed && compareDates(w.end, from) >= 0 && compareDates(w.start, to) <= 0
  );
}
