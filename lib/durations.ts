/**
 * Millisecond durations for instant arithmetic.
 *
 * These are NOT calendar dates, and the distinction is the whole reason
 * lib/calendar.ts exists. "Six hours since the last poll" and "this row has
 * been stuck for a day" are questions about elapsed time, which a UTC clock
 * answers correctly. "Is the follow-up due?" is a question about the Asia/Dubai
 * calendar, which it does not.
 *
 * If you are reaching for one of these to answer a question about a *day* —
 * which day something is due, how many working days apart two things are, what
 * date it is in Dubai — use lib/calendar.ts instead. That is the mistake the
 * CI guard exists to catch, and putting the constants here keeps the guard
 * meaningful rather than working around it.
 */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Hard rule 10: no send while the last successful poll is older than this. */
export const POLL_STALENESS_MS = 6 * HOUR_MS;

/** Never two sends to the same organisation inside this window. */
export const SAME_DOMAIN_SPACING_MS = 48 * HOUR_MS;

/** A send in flight is not yet stuck. */
export const SEND_IN_FLIGHT_GRACE_MS = 1 * HOUR_MS;

/** After this, a row still in `sending` that Gmail has never seen is not sent. */
export const SEND_ABANDONED_MS = 24 * HOUR_MS;
