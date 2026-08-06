/**
 * Working-day calendar suite (ULTRAPROMPT §6, Week 4 "Definition of done",
 * pulled forward because every countdown in the product depends on it).
 *
 * Runs under TZ=America/New_York (see the `test` script) so a server in the
 * wrong timezone fails here rather than in a recipient's inbox.
 *
 * Fixture week, March 2026:
 *   Mon 02 · Tue 03 · Wed 04 · Thu 05 · Fri 06 · Sat 07 · Sun 08
 *   Mon 09 · Tue 10 · Wed 11 · Thu 12 · Fri 13 · Sat 14 · Sun 15
 *   Mon 16 · Tue 17 · Wed 18 · Thu 19 · Fri 20
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CalendarError,
  EMPTY_CALENDAR,
  addDays,
  assertUaeDate,
  clampRecomputedDueDate,
  compareDates,
  crossesUnconfirmedWindow,
  isSendWindowDay,
  isWeekend,
  isWorkingDay,
  nextDue,
  nextSendWindowDay,
  nextWorkingDay,
  toUaeDate,
  todayUae,
  workingDaysBetween,
  type WorkingCalendar,
} from '../lib/calendar.ts';

function calendarOf(...windows: WorkingCalendar['windows']): WorkingCalendar {
  return { windows, version: 1 };
}

const holiday = (start: string, end: string, confirmed = true) => ({
  name: 'test window',
  kind: 'public_holiday' as const,
  start,
  end,
  confirmed,
});

// ---------------------------------------------------------------------------
// Asia/Dubai date derivation
// ---------------------------------------------------------------------------

test('an instant becomes the Dubai calendar date, not the server one', () => {
  // 21:30 UTC is already 01:30 the next day in Dubai (fixed UTC+4, no DST).
  assert.equal(toUaeDate(new Date('2026-03-05T21:30:00Z')), '2026-03-06');
  assert.equal(toUaeDate(new Date('2026-03-05T19:59:00Z')), '2026-03-05');
  assert.equal(toUaeDate(new Date('2026-03-05T20:00:00Z')), '2026-03-06');
  // Right through a US DST boundary, where a local-time implementation drifts.
  assert.equal(toUaeDate(new Date('2026-03-08T06:00:00Z')), '2026-03-08');
});

test('todayUae takes an injected instant so nothing depends on wall clock', () => {
  assert.equal(todayUae(new Date('2026-08-06T12:00:00Z')), '2026-08-06');
});

test('malformed dates are rejected rather than silently coerced', () => {
  assert.throws(() => assertUaeDate('2026-3-5'), CalendarError);
  assert.throws(() => assertUaeDate('2026-02-30'), CalendarError);
  assert.throws(() => assertUaeDate('not a date'), CalendarError);
  assert.equal(assertUaeDate('2026-02-28'), '2026-02-28');
});

// ---------------------------------------------------------------------------
// Weekend and window shape
// ---------------------------------------------------------------------------

test('the UAE weekend is Saturday and Sunday, not Friday and Saturday', () => {
  assert.equal(isWeekend('2026-03-06'), false, 'Friday is a working day for counting');
  assert.equal(isWeekend('2026-03-07'), true, 'Saturday');
  assert.equal(isWeekend('2026-03-08'), true, 'Sunday');
  assert.equal(isWeekend('2026-03-09'), false, 'Monday');
});

test('an unconfirmed window counts as fully non-working', () => {
  const cal = calendarOf(holiday('2026-03-09', '2026-03-11', false));
  assert.equal(isWorkingDay('2026-03-09', cal), false);
  assert.equal(isWorkingDay('2026-03-11', cal), false);
  assert.equal(isWorkingDay('2026-03-12', cal), true);
});

test('the send window is Mon-Thu even though Friday counts as a working day', () => {
  assert.equal(isWorkingDay('2026-03-06', EMPTY_CALENDAR), true);
  assert.equal(isSendWindowDay('2026-03-06', EMPTY_CALENDAR), false, 'Friday: no send');
  assert.equal(isSendWindowDay('2026-03-08', EMPTY_CALENDAR), false, 'Sunday: no send');
  assert.equal(isSendWindowDay('2026-03-05', EMPTY_CALENDAR), true, 'Thursday: send');
  assert.equal(nextSendWindowDay('2026-03-06', EMPTY_CALENDAR), '2026-03-09');
  assert.equal(nextSendWindowDay('2026-03-05', EMPTY_CALENDAR), '2026-03-05');
});

// ---------------------------------------------------------------------------
// nextDue — the table
// ---------------------------------------------------------------------------

const NO_HOLIDAYS = EMPTY_CALENDAR;

const eidLike = calendarOf(holiday('2026-03-09', '2026-03-11'));
const unconfirmedEid = calendarOf(holiday('2026-03-09', '2026-03-11', false));

const DUE_TABLE: Array<{
  name: string;
  sent: string;
  k: number;
  calendar: WorkingCalendar;
  expected: string;
}> = [
  // Plain weeks.
  { name: 'Mon send, +4', sent: '2026-03-02', k: 4, calendar: NO_HOLIDAYS, expected: '2026-03-06' },
  { name: 'Tue send, +4', sent: '2026-03-03', k: 4, calendar: NO_HOLIDAYS, expected: '2026-03-09' },
  { name: 'Thu send, +5 (the breakup leg)', sent: '2026-03-05', k: 5, calendar: NO_HOLIDAYS, expected: '2026-03-12' },
  { name: 'Fri send, +4 skips the weekend', sent: '2026-03-06', k: 4, calendar: NO_HOLIDAYS, expected: '2026-03-12' },

  // Weekend sends: the anchor moves to a day somebody could have read it.
  { name: 'Sat send anchors to Mon', sent: '2026-03-07', k: 4, calendar: NO_HOLIDAYS, expected: '2026-03-13' },
  { name: 'Sun send anchors to Mon', sent: '2026-03-08', k: 4, calendar: NO_HOLIDAYS, expected: '2026-03-13' },
  { name: 'Sat send, +1', sent: '2026-03-07', k: 1, calendar: NO_HOLIDAYS, expected: '2026-03-10' },

  // Holiday-adjacent: sent the working day before a three-day window.
  { name: 'holiday-adjacent send, +4', sent: '2026-03-06', k: 4, calendar: eidLike, expected: '2026-03-17' },
  { name: 'holiday-adjacent send, +1', sent: '2026-03-06', k: 1, calendar: eidLike, expected: '2026-03-12' },

  // Sent on a holiday: anchor is the first working day after the window.
  { name: 'on-holiday send anchors past the window', sent: '2026-03-10', k: 4, calendar: eidLike, expected: '2026-03-18' },

  // Unconfirmed windows behave identically to confirmed ones.
  { name: 'unconfirmed window still blocks', sent: '2026-03-06', k: 4, calendar: unconfirmedEid, expected: '2026-03-17' },

  // A window that swallows a whole week plus the weekend around it.
  {
    name: 'long window pushes well past the nominal date',
    sent: '2026-03-05',
    k: 2,
    calendar: calendarOf(holiday('2026-03-06', '2026-03-18')),
    expected: '2026-03-20',
  },
];

for (const row of DUE_TABLE) {
  test(`nextDue: ${row.name}`, () => {
    assert.equal(nextDue(row.sent, row.k, row.calendar), row.expected);
  });
}

test('nextDue is pure — same inputs, same answer, no mutation', () => {
  const cal = calendarOf(holiday('2026-03-09', '2026-03-11'));
  const snapshot = JSON.stringify(cal);
  assert.equal(nextDue('2026-03-06', 4, cal), nextDue('2026-03-06', 4, cal));
  assert.equal(JSON.stringify(cal), snapshot);
});

test('nextDue rejects a countdown that is not a positive integer', () => {
  assert.throws(() => nextDue('2026-03-02', 0, NO_HOLIDAYS), CalendarError);
  assert.throws(() => nextDue('2026-03-02', -1, NO_HOLIDAYS), CalendarError);
  assert.throws(() => nextDue('2026-03-02', 1.5, NO_HOLIDAYS), CalendarError);
});

test('a window with no end fails loudly instead of hanging', () => {
  const endless = calendarOf(holiday('2026-01-01', '2030-01-01'));
  assert.throws(() => nextDue('2026-03-02', 1, endless), CalendarError);
  assert.throws(() => nextWorkingDay('2026-03-02', endless), CalendarError);
});

// ---------------------------------------------------------------------------
// Retroactive calendar edits
// ---------------------------------------------------------------------------

test('a moon-sighting shift moves a derived due date later', () => {
  const before = nextDue('2026-03-06', 4, NO_HOLIDAYS);
  assert.equal(before, '2026-03-12');

  // The government confirms Eid a day either side of the estimate.
  const after = nextDue('2026-03-06', 4, calendarOf(holiday('2026-03-09', '2026-03-11')));
  assert.equal(after, '2026-03-17');
  assert.equal(compareDates(after, before) > 0, true);
});

test('a due date may move later freely but only to tomorrow at the earliest', () => {
  const today = '2026-03-16';
  // A window shrinking would otherwise pull the date into the past and fire
  // the follow-up the moment the sweep runs.
  assert.equal(clampRecomputedDueDate('2026-03-10', today), '2026-03-17');
  assert.equal(clampRecomputedDueDate('2026-03-16', today), '2026-03-17', 'today is too soon');
  assert.equal(clampRecomputedDueDate('2026-03-17', today), '2026-03-17');
  assert.equal(clampRecomputedDueDate('2026-03-25', today), '2026-03-25', 'later is fine');
});

test('drafts crossing an unconfirmed window are flagged for regeneration at send', () => {
  const cal = calendarOf(holiday('2026-03-09', '2026-03-11', false));
  assert.equal(crossesUnconfirmedWindow('2026-03-05', '2026-03-17', cal), true);
  assert.equal(crossesUnconfirmedWindow('2026-03-12', '2026-03-17', cal), false);
  assert.equal(crossesUnconfirmedWindow('2026-03-05', '2026-03-06', cal), false);
  // A confirmed window is safe to bind an opener against at draft time.
  assert.equal(
    crossesUnconfirmedWindow('2026-03-05', '2026-03-17', calendarOf(holiday('2026-03-09', '2026-03-11'))),
    false
  );
});

// ---------------------------------------------------------------------------
// Gap measurement (re-introduction mode)
// ---------------------------------------------------------------------------

test('workingDaysBetween counts the far end and not the near one', () => {
  assert.equal(workingDaysBetween('2026-03-02', '2026-03-06', NO_HOLIDAYS), 4);
  assert.equal(workingDaysBetween('2026-03-06', '2026-03-09', NO_HOLIDAYS), 1);
  assert.equal(workingDaysBetween('2026-03-02', '2026-03-02', NO_HOLIDAYS), 0);
  assert.equal(workingDaysBetween('2026-03-09', '2026-03-02', NO_HOLIDAYS), 0, 'backwards is zero');
  // (Mar 6, Mar 17] with Mon 9 – Wed 11 blocked out: Thu 12, Fri 13, Mon 16, Tue 17.
  assert.equal(
    workingDaysBetween('2026-03-06', '2026-03-17', calendarOf(holiday('2026-03-09', '2026-03-11'))),
    4
  );
});

test('a long pause is measurable, so a bump can be regenerated as a re-introduction', () => {
  // Late-Ramadan pause: the +4 leg stretches past the 10-working-day threshold
  // where "following up on last week's note" becomes nonsense.
  const pause = calendarOf({
    name: 'late Ramadan',
    kind: 'ramadan_pause',
    start: '2026-03-09',
    end: '2026-03-25',
    confirmed: false,
  });
  const due = nextDue('2026-03-06', 4, pause);
  assert.equal(workingDaysBetween('2026-03-06', due, NO_HOLIDAYS) > 10, true);
});

// ---------------------------------------------------------------------------
// Odds and ends
// ---------------------------------------------------------------------------

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});
