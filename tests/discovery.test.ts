import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { mergeDiscovered, type FoundEvent } from '../lib/event-discovery';
import { setAiClientForTests, type AiClient } from '../lib/ai';
import type { CareerEvent } from '../lib/types';

const TODAY = '2026-09-24';
const NOW = '2026-09-24T08:00:00Z';

const known = (): CareerEvent[] => [
  {
    id: 'ev-sharjah-nce',
    name: 'National Career Exhibition (Sharjah)',
    kind: 'emirati-fair',
    dateNote: 'Usually February',
    venue: 'Expo Centre Sharjah',
    city: 'Sharjah',
    status: 'registered',
    checklist: { register: true },
    notes: 'Bring 20 CVs',
    exhibitors: ['ADNOC'],
    createdAt: '',
  },
  {
    id: 'ev-ruya-2026',
    name: "Ru'ya Careers UAE 2026",
    kind: 'emirati-fair',
    startDate: '2026-09-28',
    endDate: '2026-09-30',
    venue: 'DWTC',
    city: 'Dubai',
    status: 'interested',
    hidden: true,
    createdAt: '',
  },
];

const found = (over: Partial<FoundEvent>): FoundEvent => ({
  matchesId: '',
  name: 'Some Fair 2026',
  kind: 'career-fair',
  interests: [],
  startDate: '',
  endDate: '',
  dateNote: '',
  venue: '',
  city: 'Dubai',
  url: 'https://example.ae/fair',
  registerUrl: '',
  description: '',
  exhibitors: [],
  sourceUrl: 'https://example.ae/news',
  ...over,
});

test('announced dates fill in an undated event and keep everything you set', () => {
  const events = known();
  const r = mergeDiscovered(
    events,
    [found({ matchesId: 'ev-sharjah-nce', name: 'National Career Exhibition 2027', kind: 'emirati-fair', startDate: '2027-02-09', endDate: '2027-02-11', exhibitors: ['ADNOC', 'Etisalat by e&'] })],
    TODAY,
    NOW
  );
  assert.equal(r.added.length, 0);
  const nce = events[0];
  assert.equal(nce.startDate, '2027-02-09');
  assert.equal(nce.endDate, '2027-02-11');
  assert.equal(nce.dateNote, undefined, 'the "usually February" note goes once dates exist');
  assert.equal(nce.status, 'registered');
  assert.deepEqual(nce.checklist, { register: true });
  assert.equal(nce.notes, 'Bring 20 CVs');
  assert.deepEqual(nce.exhibitors, ['ADNOC', 'Etisalat by e&'], 'exhibitors are added, never removed or duplicated');
  assert.deepEqual(r.updated[0].fields.sort(), ['dateNote', 'endDate', 'exhibitors', 'startDate', 'url'], 'a missing website is filled too');
});

test('field tags from a discovered event are added to a known one, never removed', () => {
  const events = known();
  events[1].interests = ['finance'];
  mergeDiscovered(events, [found({ matchesId: 'ev-ruya-2026', name: "Ru'ya Careers UAE 2026", interests: ['ai', 'cyber'] })], TODAY, NOW);
  assert.deepEqual(events[1].interests, ['finance', 'cyber', 'ai']);
  const r = mergeDiscovered([], [found({ name: 'GISEC Global 2027', startDate: '2027-05-04', interests: ['cyber'] })], TODAY, NOW);
  assert.deepEqual(r.added[0].interests, ['cyber']);
});

test('a hidden event stays hidden even when updated', () => {
  const events = known();
  mergeDiscovered(events, [found({ matchesId: 'ev-ruya-2026', name: "Ru'ya Careers UAE 2026", registerUrl: 'https://ruya.ae/register' })], TODAY, NOW);
  assert.equal(events[1].hidden, true);
  assert.equal(events[1].registerUrl, 'https://ruya.ae/register');
});

test('new events are added once, with a stable id', () => {
  const events = known();
  const f = found({ name: 'Abu Dhabi Aviation Careers Day 2026', startDate: '2026-11-10', endDate: '2026-11-10' });
  const first = mergeDiscovered(events, [f, f], TODAY, NOW);
  assert.equal(first.added.length, 1, 'duplicates in one batch collapse');
  assert.equal(first.added[0].id, 'ev-ai-abu-dhabi-aviation-careers-day-2026');
  assert.equal(first.added[0].discovered, true);
  assert.equal(first.added[0].status, 'interested');
  events.push(...first.added);
  const again = mergeDiscovered(events, [f], TODAY, NOW);
  assert.equal(again.added.length, 0, 'and not again next week');
});

test('a known event reported as new is still recognised by name', () => {
  const events = known();
  const r = mergeDiscovered(events, [found({ name: "Ru'ya Careers UAE", startDate: '2026-09-28', endDate: '2026-09-30', url: 'https://ruyacareers.ae' })], TODAY, NOW);
  assert.equal(r.added.length, 0);
});

test('next year’s edition of an event that has ended is a new event', () => {
  const events = known();
  events[1].startDate = '2025-09-28';
  events[1].endDate = '2025-09-30';
  events[1].name = "Ru'ya Careers UAE 2025";
  const r = mergeDiscovered(events, [found({ matchesId: 'ev-ruya-2026', name: "Ru'ya Careers UAE 2027", startDate: '2027-01-12', endDate: '2027-01-14' })], TODAY, NOW);
  assert.equal(r.added.length, 1);
  assert.equal(events[1].startDate, '2025-09-28', 'the past edition keeps its own dates and notes');
});

test('past, far-future, malformed and sourceless events are dropped', () => {
  const r = mergeDiscovered(
    known(),
    [
      found({ name: 'Old Fair 2025', startDate: '2025-03-01', endDate: '2025-03-02' }),
      found({ name: 'Far Fair 2029', startDate: '2029-03-01' }),
      found({ name: 'Bad Date Fair', startDate: '2026-13-45' }),
      found({ name: 'No Link Fair 2026', startDate: '2026-12-01', url: 'not a url' }),
    ],
    TODAY,
    NOW
  );
  assert.equal(r.added.length, 1, 'only the undated-but-valid one (bad date treated as unannounced) survives');
  assert.equal(r.added[0].name, 'Bad Date Fair');
  assert.equal(r.added[0].startDate, undefined);
  assert.equal(r.skipped, 3);
});

test('swapped start and end dates are put right', () => {
  const r = mergeDiscovered([], [found({ name: 'Swap Fair 2026', startDate: '2026-12-03', endDate: '2026-12-01' })], TODAY, NOW);
  assert.equal(r.added[0].startDate, '2026-12-01');
  assert.equal(r.added[0].endDate, '2026-12-03');
});

test('the discovery pass records into the database and remembers when it ran', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'disc-'));
  const file = path.join(dir, 'db.json');
  await fs.writeFile(file, JSON.stringify({
    profile: { name: '', headline: '', phone: '', linkedinUrl: '' },
    companies: [], contacts: [], applications: [], outreach: [], templates: [], jobSources: [], runs: [], events: known(),
  }));
  process.env.DB_PATH = file;

  const year = new Date().getUTCFullYear() + 1;
  setAiClientForTests({
    beta: {
      messages: {
        create: async () => ({
          stop_reason: 'tool_use',
          model: 'claude-opus-5',
          usage: { input_tokens: 10000, output_tokens: 2000 },
          content: [
            { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} },
            { type: 'tool_use', id: 't1', name: 'record_events', input: { events: [found({ name: `Test Fair ${year}`, startDate: `${year}-03-01`, endDate: `${year}-03-02` })] } },
          ],
        }),
      },
    },
  } as unknown as AiClient);

  try {
    const { discoverEvents, lastDiscovery, discoveryDue } = await import('../lib/event-discovery');
    const r = await discoverEvents();
    assert.equal(r.added.length, 1);
    assert.equal(r.searches, 1);
    const meta = await lastDiscovery();
    assert.equal(meta?.added, 1);
    assert.equal(await discoveryDue(), false, 'not due again for a week');
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.ok(saved.events.some((e: CareerEvent) => e.name === `Test Fair ${year}`));
  } finally {
    setAiClientForTests(null);
  }
});
