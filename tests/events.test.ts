import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  checklistFor,
  checklistProgress,
  daysBetween,
  eventTiming,
  formatEventDates,
  googleCalendarUrl,
  missingById,
  sortEvents,
  todayLocal,
} from '../lib/events';
import { canonical, findByName, indexByName } from '../lib/names';
import { mergeTemplate } from '../lib/merge';
import type { CareerEvent, Company, Db } from '../lib/types';

function ev(over: Partial<CareerEvent>): CareerEvent {
  return {
    id: 'x',
    name: 'Test Fair',
    kind: 'emirati-fair',
    venue: 'Hall',
    city: 'Dubai',
    status: 'interested',
    createdAt: '',
    ...over,
  };
}

/* --------------------------------------------------------------- dates */

test('todayLocal is the viewer-local calendar date', () => {
  // 01:30 local on 25 Sep is still 24 Sep in UTC for anyone east of GMT —
  // exactly the case where toISOString() would be a day behind in the UAE.
  const d = new Date(2026, 8, 25, 1, 30);
  assert.equal(todayLocal(d), '2026-09-25');
});

test('daysBetween counts whole calendar days across month and year ends', () => {
  assert.equal(daysBetween('2026-09-24', '2026-09-28'), 4);
  assert.equal(daysBetween('2026-11-30', '2026-12-01'), 1);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(daysBetween('2026-09-28', '2026-09-24'), -4);
  // Spans a European DST change: must still be a whole number.
  assert.equal(daysBetween('2026-10-20', '2026-11-02'), 13);
});

/* -------------------------------------------------------------- timing */

const ruya = ev({ startDate: '2026-09-28', endDate: '2026-09-30' });

test("Ru'ya reads as 4 days away on 24 September, and is flagged soon", () => {
  const t = eventTiming(ruya, '2026-09-24');
  assert.equal(t.state, 'upcoming');
  assert.equal(t.daysUntil, 4);
  assert.equal(t.label, 'in 4 days');
  assert.equal(t.soon, true);
});

test('the day before reads as tomorrow', () => {
  assert.equal(eventTiming(ruya, '2026-09-27').label, 'Tomorrow');
});

test('a multi-day event is live on every one of its days', () => {
  assert.equal(eventTiming(ruya, '2026-09-28').label, 'Happening now — day 1 of 3');
  assert.equal(eventTiming(ruya, '2026-09-30').label, 'Happening now — day 3 of 3');
  assert.equal(eventTiming(ruya, '2026-09-30').state, 'live');
});

test('an event is ended only after its last day', () => {
  assert.equal(eventTiming(ruya, '2026-10-01').state, 'ended');
});

test('a one-day event reads as happening today', () => {
  const t = eventTiming(ev({ startDate: '2026-10-05' }), '2026-10-05');
  assert.equal(t.label, 'Happening today');
});

test('soon means within two weeks, not beyond', () => {
  const fair = ev({ startDate: '2026-11-17', endDate: '2026-11-19' });
  assert.equal(eventTiming(fair, '2026-11-03').soon, true); // 14 days
  assert.equal(eventTiming(fair, '2026-11-02').soon, false); // 15 days
});

test('an undated event is tbc, never soon', () => {
  const t = eventTiming(ev({ dateNote: 'Usually February' }), '2026-09-24');
  assert.equal(t.state, 'tbc');
  assert.equal(t.soon, false);
  assert.equal(t.daysUntil, undefined);
});

/* ---------------------------------------------------------- formatting */

test('formatEventDates handles same-month, cross-month and cross-year ranges', () => {
  assert.equal(formatEventDates(ruya), 'Mon 28 – Wed 30 Sep 2026');
  assert.equal(
    formatEventDates(ev({ startDate: '2026-11-30', endDate: '2026-12-02' })),
    'Mon 30 Nov – Wed 2 Dec 2026'
  );
  assert.equal(
    formatEventDates(ev({ startDate: '2026-12-31', endDate: '2027-01-02' })),
    'Thu 31 Dec 2026 – Sat 2 Jan 2027'
  );
  assert.equal(formatEventDates(ev({ startDate: '2026-10-05' })), 'Mon 5 Oct 2026');
  assert.equal(formatEventDates(ev({ dateNote: 'Usually February' })), 'Usually February');
});

test('the calendar link uses an exclusive end date, as Google expects', () => {
  const url = new URL(googleCalendarUrl(ruya)!);
  assert.equal(url.hostname, 'calendar.google.com');
  // 28–30 Sep inclusive is 20260928/20261001 in Google's all-day format.
  assert.equal(url.searchParams.get('dates'), '20260928/20261001');
});

test('the calendar link rolls the exclusive end over a month boundary', () => {
  const url = new URL(googleCalendarUrl(ev({ startDate: '2026-11-29', endDate: '2026-11-30' }))!);
  assert.equal(url.searchParams.get('dates'), '20261129/20261201');
});

test('an undated event has no calendar link', () => {
  assert.equal(googleCalendarUrl(ev({})), undefined);
});

/* ----------------------------------------------------------- checklist */

test('fairs and expos get different prep checklists', () => {
  const fair = checklistFor('emirati-fair').map((i) => i.id);
  const expo = checklistFor('industry-expo').map((i) => i.id);
  assert.ok(fair.includes('cv'), 'a fair needs printed CVs');
  assert.ok(expo.includes('cards'), 'an expo needs cards');
  assert.ok(fair.includes('preEmail') && expo.includes('preEmail'));
});

test('checklist progress counts only ticked items for that kind', () => {
  const p = checklistProgress(
    ev({ kind: 'emirati-fair', checklist: { register: true, cv: true, cards: true, bogus: true } })
  );
  // "cards" belongs to the expo list and "bogus" to none, so neither counts.
  assert.deepEqual(p, { done: 2, total: checklistFor('emirati-fair').length });
});

/* ---------------------------------------------------------- ordering */

test('sortEvents puts dated events first, in date order, then undated ones', () => {
  const sorted = sortEvents([
    ev({ id: 'c', name: 'Zed', dateNote: 'tbc' }),
    ev({ id: 'b', startDate: '2026-11-17' }),
    ev({ id: 'a', startDate: '2026-09-28' }),
    ev({ id: 'd', name: 'Alpha', dateNote: 'tbc' }),
  ]);
  assert.deepEqual(sorted.map((e) => e.id), ['a', 'b', 'd', 'c']);
});

/* ------------------------------------------------------------- seeding */

test('missingById adds only what is absent', () => {
  const live = [{ id: 'a' }, { id: 'b' }];
  const seed = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(missingById(live, seed), [{ id: 'c' }]);
});

test('a hidden seeded event is never re-added', () => {
  // Hidden rather than deleted is what keeps it gone across syncs.
  const live = [{ id: 'ev-ruya-2026', hidden: true }];
  const seed = [{ id: 'ev-ruya-2026' }];
  assert.deepEqual(missingById(live, seed), []);
});

/* ------------------------------------------------------ name matching */

test("canonical keeps e& distinct instead of collapsing it to 'e'", () => {
  assert.equal(canonical('e& (Etisalat Group)'), 'eand');
});

test('findByName resolves acronyms and full names to the same company', () => {
  const companies = [
    { name: 'Abu Dhabi Islamic Bank (ADIB)' },
    { name: 'DEWA' },
    { name: 'Google (Dubai)' },
    { name: 'LinkedIn (Dubai)' },
  ];
  const index = indexByName(companies);
  assert.equal(findByName(index, 'ADIB')?.name, 'Abu Dhabi Islamic Bank (ADIB)');
  assert.equal(findByName(index, 'Dubai Electricity and Water Authority (DEWA)')?.name, 'DEWA');
  // "(Dubai)" is a location, not an acronym — the two must stay separate.
  assert.equal(findByName(index, 'LinkedIn (Dubai)')?.name, 'LinkedIn (Dubai)');
  assert.equal(findByName(index, 'Nonexistent Co'), undefined);
});

/* ------------------------------------------------------ seed integrity */

test('seeded events are well formed', async () => {
  const db = (await import('../data/db.json')) as unknown as Db;
  const events = db.events;
  assert.ok(events.length >= 4, 'expected the starter events');

  const ids = events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate event ids');

  const kinds = new Set(['emirati-fair', 'career-fair', 'industry-expo']);
  for (const e of events) {
    assert.ok(e.id.startsWith('ev-'), `${e.id} must use the seeded-id prefix`);
    assert.ok(kinds.has(e.kind), `${e.name}: bad kind ${e.kind}`);
    assert.equal(e.status, 'interested');
    if (e.startDate) {
      assert.match(e.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(!e.endDate || e.endDate >= e.startDate, `${e.name} ends before it starts`);
    } else {
      assert.ok(e.dateNote, `${e.name} has no dates, so it needs a dateNote`);
    }
  }
});

test('seeded exhibitors resolve to companies in the database', async () => {
  const db = (await import('../data/db.json')) as unknown as Db;
  const index = indexByName(db.companies as Company[]);
  // Named exhibitors that aren't employers in the company list.
  const notCompanies = new Set(['UAE Armed Forces']);

  const unresolved: string[] = [];
  for (const e of db.events) {
    for (const name of e.exhibitors || []) {
      if (notCompanies.has(name)) continue;
      if (!findByName(index, name)) unresolved.push(`${e.name}: ${name}`);
    }
  }
  assert.deepEqual(unresolved, [], 'exhibitor names should link to a company row');
});

/* ---------------------------------------------------------- templates */

test('the event templates fill in the event name', async () => {
  const db = (await import('../data/db.json')) as unknown as Db;
  const pre = db.templates.find((t) => t.id === 't7');
  const post = db.templates.find((t) => t.id === 't8');
  assert.ok(pre && post, 'pre- and post-event templates should be seeded');

  const profile = { name: 'Saeed', headline: 'Analyst', phone: '', linkedinUrl: '' };
  const subject = mergeTemplate(pre.subject, { company: 'DEWA', event: "Ru'ya Careers UAE 2026" }, profile);
  assert.equal(subject, "Ru'ya Careers UAE 2026: could I stop by the DEWA stand?");
  assert.match(mergeTemplate(post.subject, {}, profile), /\[event name\]/, 'missing event shows a placeholder');
});

/* ------------------------------------------------------ sync endpoint */

test('sync-seed brings new events into an existing database exactly once', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'events-sync-'));
  const file = path.join(dir, 'db.json');
  // An older database: seeded before events existed, with one hidden event.
  await fs.writeFile(
    file,
    JSON.stringify({
      profile: { name: '', headline: '', phone: '', linkedinUrl: '' },
      companies: [],
      contacts: [],
      applications: [],
      outreach: [],
      templates: [{ id: 't1', name: 'x', category: 'x', subject: 's', body: 'b' }],
      jobSources: [],
      runs: [],
      events: [{ id: 'ev-gitex-2026', name: 'GITEX', kind: 'industry-expo', venue: '', city: '', status: 'skipped', hidden: true, createdAt: '' }],
    })
  );
  process.env.DB_PATH = file;

  const { POST } = await import('../app/api/sync-seed/route');
  const first = await (await POST()).json();
  const second = await (await POST()).json();

  const seed = (await import('../data/db.json')) as unknown as Db;
  assert.equal(first.events, seed.events.length - 1, 'every seeded event except the one already present');
  assert.ok(first.templates >= 2, 'the event templates arrive too');
  assert.deepEqual(second, { events: 0, templates: 0, templatesUpdated: 0, companiesTagged: 0 }, 'a second sync adds nothing');

  const after = JSON.parse(await fs.readFile(file, 'utf8')) as Db;
  const gitex = after.events.find((e) => e.id === 'ev-gitex-2026');
  assert.equal(gitex?.hidden, true, 'a hidden event stays hidden');
  assert.equal(gitex?.status, 'skipped', "the user's own status is untouched");
});

test('sync-seed corrects an unedited starter template but leaves an edited one', async () => {
  const seed = (await import('../data/db.json')) as unknown as Db;
  const current = seed.templates.find((t) => t.id === 't2')!;
  const outdated = current.body.replace("and I'm registered with Nafis.", 'and Nafis support (salary top-up and employer pension contribution) applies.');
  assert.notEqual(outdated, current.body);

  for (const [body, expected] of [
    [outdated, current.body],
    ['My own words.', 'My own words.'],
  ]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tpl-sync-'));
    const file = path.join(dir, 'db.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        profile: { name: '', headline: '', phone: '', linkedinUrl: '' },
        companies: [], contacts: [], applications: [], outreach: [], jobSources: [], runs: [], events: seed.events,
        templates: seed.templates.map((t) => (t.id === 't2' ? { ...t, body } : t)),
      })
    );
    process.env.DB_PATH = file;
    const { POST } = await import('../app/api/sync-seed/route');
    await POST();
    const after = JSON.parse(await fs.readFile(file, 'utf8')) as Db;
    assert.equal(after.templates.find((t) => t.id === 't2')!.body, expected);
  }
});
