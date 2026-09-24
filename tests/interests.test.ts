import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { companyInterests, matchRoleInterests, normalizeForMatch } from '../lib/interests';
import { scoreRole } from '../lib/scoring';
import type { Company, Profile } from '../lib/types';

const titleTags = (title: string, division?: string) =>
  matchRoleInterests({ title, division }).filter((m) => m.via === 'title').map((m) => m.id);

test('titles in each field are tagged', () => {
  assert.deepEqual(titleTags('Investment Analyst - Private Equity'), ['investing']);
  assert.deepEqual(titleTags('Senior Portfolio Manager, Fixed Income'), ['investing']);
  assert.deepEqual(titleTags('Credit Analyst - Corporate Banking'), ['finance']);
  assert.deepEqual(titleTags('SOC Analyst L2'), ['cyber']);
  assert.deepEqual(titleTags('GRC Specialist'), ['cyber']);
  assert.deepEqual(titleTags('Machine Learning Engineer'), ['ai']);
  assert.deepEqual(titleTags('Senior Data Scientist (NLP)'), ['ai']);
  assert.deepEqual(titleTags('AI Engineer'), ['ai']);
});

test('matching is whole-word, so place names and similar words do not leak in', () => {
  assert.deepEqual(titleTags('Retail Sales Associate - Dubai Mall'), []);
  assert.deepEqual(titleTags('Maintenance Technician, Al Ain'), []);
  // "securities" is investing, and never counts as cyber "security".
  assert.deepEqual(titleTags('Securities Operations Officer'), ['investing']);
  assert.equal(normalizeForMatch('M&A / Deals — Associate'), ' m&a deals associate ');
});

test('the usual UAE traps are not tagged', () => {
  for (const t of [
    'Security Guard',
    'Senior Security Officer',
    'Real Estate Broker',
    'Project Portfolio Manager',
    'Key Account Manager',
    'Blood Bank Technologist',
    'Car Dealer Sales Executive',
    'Trade Marketing Manager',
    'Talent Acquisition Specialist',
  ]) {
    assert.deepEqual(titleTags(t), [], t);
  }
});

test('a description only adds a weaker mention, and only with several field phrases', () => {
  const role = { title: 'Data Engineer', description: 'Build pipelines for our machine learning models using PyTorch.' };
  assert.deepEqual(
    matchRoleInterests(role).map((m) => [m.id, m.via]),
    [['ai', 'mention']]
  );
  const passing = { title: 'Sales Executive', description: 'Sell our AI-powered platform.' };
  assert.deepEqual(matchRoleInterests(passing), [], 'one passing "AI" in a sales job is not an AI role');
  // A department in the field is a mention too.
  assert.deepEqual(matchRoleInterests({ title: 'Executive Assistant', division: 'Treasury' }).map((m) => m.via), ['mention']);
});

test('a vetoed title stays out even if its description is full of field words', () => {
  const r = matchRoleInterests({
    title: 'Security Guard',
    description: 'Monitor CCTV, SOC procedures, incident response, firewall rooms and threat intelligence briefings.',
  });
  assert.deepEqual(r.filter((m) => m.id === 'cyber'), []);
});

const company = (sector: string, interests?: Company['interests']): Company => ({
  id: 'c', name: 'X', sector, location: 'Dubai', tier: 'target', emiratisation: true, createdAt: '', interests,
});

test('companies: curated tags win, otherwise the sector decides', () => {
  assert.deepEqual(companyInterests(company('Sovereign Wealth Fund')), ['investing']);
  assert.deepEqual(companyInterests(company('Islamic Banking')), ['finance']);
  assert.deepEqual(companyInterests(company('Managed Security Services (MSSP)')), ['cyber']);
  assert.deepEqual(companyInterests(company('AI Research & Higher Education')), ['ai']);
  assert.deepEqual(companyInterests(company('Money Exchange & Remittance')), ['finance'], 'an exchange house is not investing');
  assert.deepEqual(companyInterests(company('Banking & Capital Markets Law')), [], 'law firms are not tagged');
  assert.deepEqual(companyInterests(company('Banking', ['investing', 'finance'])), ['investing', 'finance']);
  assert.deepEqual(companyInterests(company('Banking', [])), [], 'an explicit empty list means none');
});

/* ------------------------------------------------------------- ranking */

const base: Profile = { name: '', headline: '', phone: '', linkedinUrl: '' };

test('with fields chosen, a role in one counts as on-target without a matching title', () => {
  const profile = { ...base, interests: ['investing' as const] };
  const portfolio = scoreRole({ roleTitle: 'Portfolio Analyst', companyName: 'X', location: 'Abu Dhabi' }, profile);
  const hr = scoreRole({ roleTitle: 'HR Coordinator', companyName: 'X', location: 'Abu Dhabi' }, profile);
  assert.ok(portfolio.score >= 55, `portfolio ${portfolio.score}`);
  assert.ok(portfolio.reasons.some((r) => /Investing/.test(r)));
  assert.ok(hr.score <= 25, 'a role outside your fields is capped');
});

test('a description mention and an employer in your field both help, less than the title', () => {
  const profile = { ...base, interests: ['ai' as const] };
  const titled = scoreRole({ roleTitle: 'ML Engineer', companyName: 'X', location: 'Dubai' }, profile);
  const mentioned = scoreRole({ roleTitle: 'Data Engineer', companyName: 'X', location: 'Dubai', interests: [], interestMentions: ['ai'] }, profile);
  const atAiCo = scoreRole({ roleTitle: 'Data Engineer', companyName: 'X', location: 'Dubai' }, profile, company('Artificial Intelligence'));
  assert.ok(titled.score > mentioned.score && mentioned.score > 25);
  assert.ok(atAiCo.reasons.some((r) => /AI employer/.test(r)));
});

test('no fields chosen leaves scoring exactly as before', () => {
  const a = scoreRole({ roleTitle: 'HR Coordinator', companyName: 'X', location: 'Dubai' }, base);
  const b = scoreRole({ roleTitle: 'HR Coordinator', companyName: 'X', location: 'Dubai' }, { ...base, interests: [] });
  assert.deepEqual(a, b);
});

test('saving new fields on the profile re-ranks roles already in the pipeline', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fields-'));
  const file = path.join(dir, 'db.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      profile: base,
      companies: [],
      contacts: [], outreach: [], templates: [], jobSources: [], runs: [], events: [],
      applications: [
        { id: 'a', companyName: 'X', roleTitle: 'Threat Intelligence Analyst', location: 'Dubai', stage: 'found', score: 20, createdAt: '' },
        { id: 'b', companyName: 'X', roleTitle: 'Store Supervisor', location: 'Dubai', stage: 'found', score: 40, createdAt: '' },
      ],
    })
  );
  process.env.DB_PATH = file;
  const { PATCH } = await import('../app/api/profile/route');
  const { readDb } = await import('../lib/store');
  const res = await PATCH(
    new Request('http://x/api/profile', { method: 'PATCH', body: JSON.stringify({ interests: ['cyber', 'nonsense', 'cyber'] }) }) as never
  );
  const profile = await res.json();
  assert.deepEqual(profile.interests, ['cyber'], 'unknown and duplicate fields are dropped');
  const db = await readDb();
  const threat = db.applications.find((a) => a.id === 'a')!;
  const store = db.applications.find((a) => a.id === 'b')!;
  assert.ok(threat.score! > store.score!, `${threat.score} vs ${store.score}`);
  assert.ok(threat.scoreReasons!.some((r) => /Cyber/.test(r)));
});

test('imported roles carry their field tags, including mentions from the description', async () => {
  const { newApplication, PipelineIndex } = await import('../lib/importer');
  const db = {
    profile: { ...base, interests: ['finance' as const] },
    companies: [], contacts: [], outreach: [], templates: [], jobSources: [], runs: [], events: [], applications: [],
  };
  const app = newApplication(
    {
      title: 'Operations Analyst',
      location: 'Dubai',
      url: 'https://x.co/1',
      description: 'Support month end close, reconciliations and IFRS financial statements for our banking clients.',
    },
    { companyName: 'X', source: 'greenhouse', nowIso: '2026-09-24T00:00:00Z' },
    db,
    new PipelineIndex(db)
  );
  assert.equal(app.interests, undefined, 'no field in the title');
  assert.deepEqual(app.interestMentions, ['finance']);
  assert.ok(app.scoreReasons!.some((r) => /mentions Finance/.test(r)));
});

/* ---------------------------------------------------------- regression */

/**
 * Titles found by stress-testing the rules against real UAE postings: each
 * must (or must not) be tagged with its field. Adding a phrase that breaks
 * one of these means it catches more than it should.
 */
test('regression titles from the stress test', async () => {
  const fixtures = (await import('./fixtures/interest-titles.json')).default as Record<
    string,
    { mustMatch: string[]; mustNotMatch: string[] }
  >;
  const failures: string[] = [];
  for (const [id, { mustMatch, mustNotMatch }] of Object.entries(fixtures)) {
    for (const t of mustMatch) if (!titleTags(t).includes(id as never)) failures.push(`${id} should match: ${t}`);
    for (const t of mustNotMatch) if (titleTags(t).includes(id as never)) failures.push(`${id} should NOT match: ${t}`);
  }
  assert.deepEqual(failures, []);
});
