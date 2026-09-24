import type { CareerEvent, EventKind } from './types';

/** Today as YYYY-MM-DD in the viewer's own timezone. toISOString() would give
 *  the UTC date, which in the UAE is still "yesterday" until 4am. */
export function todayLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from a to b, both YYYY-MM-DD. Done in UTC so daylight-saving
 *  shifts (for anyone viewing from abroad) can't produce a fractional day. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export type EventState = 'tbc' | 'upcoming' | 'live' | 'ended';

export interface EventTiming {
  state: EventState;
  /** Days until the first day; 0 on the day itself. Absent when tbc. */
  daysUntil?: number;
  /** "in 4 days", "Tomorrow", "Day 2 of 3", "Ended". */
  label: string;
  /** Starts within two weeks — time to register and send pre-event emails. */
  soon: boolean;
}

export function eventTiming(event: Pick<CareerEvent, 'startDate' | 'endDate'>, today = todayLocal()): EventTiming {
  if (!event.startDate) {
    return { state: 'tbc', label: 'Dates not announced', soon: false };
  }

  const end = event.endDate || event.startDate;
  const untilStart = daysBetween(today, event.startDate);
  const untilEnd = daysBetween(today, end);

  if (untilEnd < 0) {
    return { state: 'ended', daysUntil: untilStart, label: 'Ended', soon: false };
  }
  if (untilStart <= 0) {
    const length = daysBetween(event.startDate, end) + 1;
    const day = -untilStart + 1;
    return {
      state: 'live',
      daysUntil: untilStart,
      label: length > 1 ? `Happening now — day ${day} of ${length}` : 'Happening today',
      soon: true,
    };
  }
  return {
    state: 'upcoming',
    daysUntil: untilStart,
    label: untilStart === 1 ? 'Tomorrow' : `in ${untilStart} days`,
    soon: untilStart <= 14,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday };
}

/** "Mon 28 – Wed 30 Sep 2026", "Mon 30 Nov – Tue 1 Dec 2026", or the date note. */
export function formatEventDates(event: Pick<CareerEvent, 'startDate' | 'endDate' | 'dateNote'>): string {
  if (!event.startDate) return event.dateNote || 'Dates not announced';
  const s = parts(event.startDate);
  const startLabel = `${DAYS[s.weekday]} ${s.d}`;
  if (!event.endDate || event.endDate === event.startDate) {
    return `${startLabel} ${MONTHS[s.m - 1]} ${s.y}`;
  }
  const e = parts(event.endDate);
  const endLabel = `${DAYS[e.weekday]} ${e.d} ${MONTHS[e.m - 1]} ${e.y}`;
  if (s.y !== e.y) return `${startLabel} ${MONTHS[s.m - 1]} ${s.y} – ${endLabel}`;
  if (s.m !== e.m) return `${startLabel} ${MONTHS[s.m - 1]} – ${endLabel}`;
  return `${startLabel} – ${endLabel}`;
}

/**
 * Google Calendar "add event" link — an ordinary URL the browser opens, so
 * no calendar access or OAuth is involved. All-day format; the end date is
 * exclusive in Google's scheme, hence the extra day.
 */
export function googleCalendarUrl(event: CareerEvent): string | undefined {
  if (!event.startDate) return undefined;
  const compact = (iso: string) => iso.replace(/-/g, '');
  const end = event.endDate || event.startDate;
  const [y, m, d] = end.split('-').map(Number);
  const after = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

  const details = [event.description, event.hours ? `Hours: ${event.hours}` : '', event.url || '']
    .filter(Boolean)
    .join('\n\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.name,
    dates: `${compact(event.startDate)}/${compact(after)}`,
    location: [event.venue, event.city].filter(Boolean).join(', '),
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export interface ChecklistItem {
  id: string;
  label: string;
}

const FAIR_CHECKLIST: ChecklistItem[] = [
  { id: 'register', label: 'Registered online — entry is free for Emirati visitors' },
  { id: 'linkedin', label: 'LinkedIn headline says "UAE National", Open to Work is on' },
  { id: 'targets', label: 'Target list of exhibitors, in the order you will visit them' },
  { id: 'preEmail', label: 'Pre-event emails sent to recruiters at your top exhibitors' },
  { id: 'cv', label: '20+ printed CVs with "UAE National" in the header' },
  { id: 'pitch', label: '30-second pitch rehearsed: who you are, what you want, why them' },
  { id: 'followUp', label: 'Follow-ups sent within 48 hours to everyone you met' },
];

const EXPO_CHECKLIST: ChecklistItem[] = [
  { id: 'register', label: 'Registered — check whether the visitor pass is paid' },
  { id: 'targets', label: 'Target list of stands, and who staffs them' },
  { id: 'preEmail', label: 'Pre-event emails asking for ten minutes at their stand' },
  { id: 'pitch', label: '30-second pitch rehearsed' },
  { id: 'cards', label: 'Business cards or a LinkedIn QR code ready' },
  { id: 'followUp', label: 'Follow-ups sent within 48 hours to everyone you met' },
];

export function checklistFor(kind: EventKind): ChecklistItem[] {
  return kind === 'industry-expo' ? EXPO_CHECKLIST : FAIR_CHECKLIST;
}

export function checklistProgress(event: Pick<CareerEvent, 'kind' | 'checklist'>): { done: number; total: number } {
  const items = checklistFor(event.kind);
  const done = items.filter((i) => event.checklist?.[i.id]).length;
  return { done, total: items.length };
}

/** Upcoming and live events first by start date, then undated ones. */
export function sortEvents(events: CareerEvent[]): CareerEvent[] {
  return [...events].sort((a, b) => {
    if (a.startDate && b.startDate) return a.startDate.localeCompare(b.startDate);
    if (a.startDate) return -1;
    if (b.startDate) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** An event's name without the year and punctuation, for spotting the same event under two ids. */
export function eventNameKey(name: string): string {
  return name.toLowerCase().replace(/\b(19|20)\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Seed rows missing from the live list, matched on id. Rows the user has
 * hidden still exist, so they're never re-added; that's why seeded events
 * are hidden rather than deleted.
 */
export function missingById<T extends { id: string }>(live: T[], seed: T[]): T[] {
  const have = new Set(live.map((x) => x.id));
  return seed.filter((x) => !have.has(x.id));
}
