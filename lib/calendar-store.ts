/**
 * Reading and editing the UAE working calendar.
 *
 * The arithmetic lives in lib/calendar.ts; this module only moves rows. The
 * seed below is deliberately conservative: every Islamic window ships
 * `confirmed = 0`, because those dates finalize on moon-sighting and an
 * unconfirmed window counts as fully non-working. Being a day too cautious
 * costs one working day; being a day wrong sends "Eid Mubarak" before Eid.
 */
import { assertUaeDate, type CalendarWindow, type WorkingCalendar, type WindowKind } from './calendar.ts';
import { execute, query, queryOne } from './db/client.ts';
import { newId, nowIso } from './ids.ts';
import { logEvent } from './log.ts';

interface WindowRow {
  id: string;
  name: string;
  kind: WindowKind;
  start_date: string;
  end_date: string;
  confirmed: number;
  note: string | null;
}

export interface StoredWindow extends CalendarWindow {
  id: string;
  note: string | null;
}

/**
 * UAE public holidays and the late-Ramadan pause, from 2026-08 forward.
 *
 * Gregorian-fixed dates are confirmed. Islamic dates are ESTIMATES with a
 * one-day margin either side and ship unconfirmed — the founder confirms each
 * one against the official announcement before it arrives, and the scheduler
 * treats the whole window as non-working until they do.
 */
export const SEED_WINDOWS: Array<Omit<StoredWindow, 'id'>> = [
  {
    name: "Prophet's Birthday (estimated)",
    kind: 'public_holiday',
    start: '2026-08-24',
    end: '2026-08-26',
    confirmed: false,
    note: 'Moon-sighting. Estimated 25 Aug 2026 with a day either side. Confirm against the official announcement.',
  },
  {
    name: 'Commemoration Day and National Day',
    kind: 'public_holiday',
    start: '2026-12-01',
    end: '2026-12-03',
    confirmed: true,
    note: 'Gregorian-fixed. Spans both readings of the Commemoration Day date (30 Nov / 1 Dec).',
  },
  {
    name: "New Year's Day",
    kind: 'public_holiday',
    start: '2027-01-01',
    end: '2027-01-01',
    confirmed: true,
    note: 'Gregorian-fixed.',
  },
  {
    name: 'Late Ramadan send pause (estimated)',
    kind: 'ramadan_pause',
    start: '2027-03-01',
    end: '2027-03-08',
    confirmed: false,
    note: 'Ramadan 1448 is estimated to begin ~8 Feb 2027; this pauses the last stretch before Eid. Working hours are legally shortened through the month, so replies slow before this window opens.',
  },
  {
    name: 'Eid al-Fitr (estimated)',
    kind: 'public_holiday',
    start: '2027-03-08',
    end: '2027-03-12',
    confirmed: false,
    note: 'Moon-sighting. Estimated 9-11 Mar 2027 with a day either side. Confirm before it arrives.',
  },
  {
    name: 'Arafat Day and Eid al-Adha (estimated)',
    kind: 'public_holiday',
    start: '2027-05-15',
    end: '2027-05-19',
    confirmed: false,
    note: 'Moon-sighting. Estimated 16-18 May 2027 with a day either side.',
  },
  {
    name: 'Islamic New Year (estimated)',
    kind: 'public_holiday',
    start: '2027-06-05',
    end: '2027-06-07',
    confirmed: false,
    note: 'Moon-sighting. Estimated 6 Jun 2027 with a day either side.',
  },
];

function toWindow(row: WindowRow): StoredWindow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    start: row.start_date,
    end: row.end_date,
    confirmed: row.confirmed === 1,
    note: row.note,
  };
}

/** Every stored window, earliest first. */
export async function listWindows(): Promise<StoredWindow[]> {
  const rows = await query<WindowRow>(
    'SELECT * FROM calendar_window ORDER BY start_date ASC, end_date ASC'
  );
  return rows.map(toWindow);
}

/** The calendar as `nextDue()` wants it, with the current version stamp. */
export async function loadCalendar(): Promise<WorkingCalendar> {
  const [windows, meta] = await Promise.all([
    listWindows(),
    queryOne<{ version: number }>('SELECT version FROM calendar_meta WHERE id = 1'),
  ]);
  return { windows, version: meta?.version ?? 1 };
}

export async function currentCalendarVersion(): Promise<number> {
  const meta = await queryOne<{ version: number }>('SELECT version FROM calendar_meta WHERE id = 1');
  return meta?.version ?? 1;
}

export interface WindowInput {
  name: string;
  kind: WindowKind;
  start: string;
  end: string;
  confirmed: boolean;
  note?: string | null;
}

function validate(input: WindowInput): void {
  assertUaeDate(input.start);
  assertUaeDate(input.end);
  if (input.end < input.start) {
    // Lexicographic comparison is exact for YYYY-MM-DD.
    throw new Error('the window ends before it starts');
  }
  if (!input.name.trim()) throw new Error('the window needs a name');
}

export async function addWindow(input: WindowInput): Promise<string> {
  validate(input);
  const id = newId('calendarWindow');
  const at = nowIso();
  await execute(
    `INSERT INTO calendar_window
       (id, name, kind, start_date, end_date, confirmed, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.kind, input.start, input.end, input.confirmed ? 1 : 0, input.note ?? null, at, at]
  );
  await logEvent({ event: 'calendar_edited', entityType: 'calendar_window', entityId: id, detail: { action: 'add', ...input } });
  return id;
}

export async function updateWindow(id: string, input: WindowInput): Promise<void> {
  validate(input);
  const changed = await execute(
    `UPDATE calendar_window
        SET name = ?, kind = ?, start_date = ?, end_date = ?, confirmed = ?, note = ?, updated_at = ?
      WHERE id = ?`,
    [input.name, input.kind, input.start, input.end, input.confirmed ? 1 : 0, input.note ?? null, nowIso(), id]
  );
  if (changed === 0) throw new Error(`no calendar window with id ${id}`);
  await logEvent({ event: 'calendar_edited', entityType: 'calendar_window', entityId: id, detail: { action: 'update', ...input } });
}

export async function deleteWindow(id: string): Promise<void> {
  const changed = await execute('DELETE FROM calendar_window WHERE id = ?', [id]);
  if (changed === 0) throw new Error(`no calendar window with id ${id}`);
  await logEvent({ event: 'calendar_edited', entityType: 'calendar_window', entityId: id, detail: { action: 'delete' } });
}

/**
 * Installs the calendar_meta row and the seed windows if they are missing.
 * Idempotent: a window is matched by (name, start_date) so re-running never
 * duplicates, and never overwrites a date the founder has since corrected.
 */
export async function ensureCalendarSeeded(): Promise<{ added: number }> {
  await execute(
    'INSERT OR IGNORE INTO calendar_meta (id, version, updated_at) VALUES (1, 1, ?)',
    [nowIso()]
  );

  const existing = await query<{ name: string; start_date: string }>(
    'SELECT name, start_date FROM calendar_window'
  );
  const seen = new Set(existing.map((r) => `${r.name}|${r.start_date}`));

  let added = 0;
  for (const w of SEED_WINDOWS) {
    if (seen.has(`${w.name}|${w.start}`)) continue;
    await addWindow(w);
    added++;
  }
  return { added };
}
