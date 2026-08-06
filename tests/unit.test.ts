import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUrl, mapWithConcurrency, fetchJson } from '../lib/http';
import { splitName, generateCandidates, inferPattern, divisionsForSector } from '../lib/email-finder';
import { slugCandidates, isPlatform, validSlug, matchesKeywords } from '../lib/ats';
import { scoreRole, scoreBand } from '../lib/scoring';
import { sanitize, stripProtected, ValidationError } from '../lib/validate';
import { mergeTemplate, gmailComposeUrl } from '../lib/merge';
import type { Profile } from '../lib/types';

const realFetch = globalThis.fetch;

/* ------------------------------------------------------------------ http */

test('normalizeUrl collapses tracking params and trailing slashes', () => {
  assert.equal(
    normalizeUrl('https://boards.greenhouse.io/acme/jobs/123?utm_source=linkedin'),
    'https://boards.greenhouse.io/acme/jobs/123'
  );
  assert.equal(normalizeUrl('https://WWW.Example.com/job/1/'), 'https://example.com/job/1');
  // The same posting reached two ways must produce one key, or the scraper
  // re-imports it on every run.
  assert.equal(normalizeUrl('https://x.co/j/1?utm_source=a'), normalizeUrl('https://x.co/j/1/'));
});

test('normalizeUrl keeps identifying params', () => {
  assert.equal(normalizeUrl('https://x.co/j?gh_src=abc&id=9'), 'https://x.co/j?id=9');
});

test('normalizeUrl passes through unparseable input', () => {
  assert.equal(normalizeUrl('not a url'), 'not a url');
});

test('mapWithConcurrency respects the limit and preserves order', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 5, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.ok(peak <= 5, `peak ${peak} exceeded limit`);
  assert.deepEqual(out.slice(0, 3), [0, 2, 4]);
  assert.equal(out[19], 38);
});

test('fetchJson retries transient failures then succeeds', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls < 3) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const result = await fetchJson<{ ok: boolean }>('https://x.co/api');
  assert.equal(result.ok, true);
  assert.equal(calls, 3);
});

test('fetchJson does not retry a 404', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('', { status: 404 });
  }) as typeof fetch;

  await assert.rejects(() => fetchJson('https://x.co/api'), /not found/);
  assert.equal(calls, 1, 'a wrong slug should fail fast, not back off');
});

test('fetchJson rejects HTML served in place of JSON', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;
  await assert.rejects(() => fetchJson('https://x.co/api'), /not JSON/);
});

/* ---------------------------------------------------------- email finder */

test('splitName keeps Arabic particles with the surname', () => {
  assert.deepEqual(splitName('Sara Al Mansoori'), { first: 'sara', last: 'almansoori' });
  assert.deepEqual(splitName('Ahmed bin Rashid Al Maktoum'), { first: 'ahmed', last: 'almaktoum' });
  assert.deepEqual(splitName('Fatima bint Zayed'), { first: 'fatima', last: 'bintzayed' });
  assert.deepEqual(splitName('John Smith'), { first: 'john', last: 'smith' });
});

test('splitName rejects a single token', () => {
  assert.equal(splitName('Sara'), null);
  assert.equal(splitName('   '), null);
});

test('generateCandidates ranks first.last first and dedupes', () => {
  const out = generateCandidates('Sara Al Mansoori', 'bankfab.com');
  assert.equal(out[0], 'sara.almansoori@bankfab.com');
  assert.ok(out.includes('s.almansoori@bankfab.com'));
  assert.equal(new Set(out).size, out.length);
});

test('generateCandidates honours a known company pattern', () => {
  const out = generateCandidates('Sara Al Mansoori', 'bankfab.com', 'flast');
  assert.equal(out[0], 'salmansoori@bankfab.com');
});

test('generateCandidates cleans a pasted URL into a domain', () => {
  const out = generateCandidates('John Smith', 'https://www.example.com/careers');
  assert.equal(out[0], 'john.smith@example.com');
});

test('inferPattern recovers the pattern from a known address', () => {
  assert.equal(inferPattern('sara.almansoori@fab.com', 'Sara Al Mansoori'), 'first.last');
  assert.equal(inferPattern('s.almansoori@fab.com', 'Sara Al Mansoori'), 'f.last');
  assert.equal(inferPattern('weird+thing@fab.com', 'Sara Al Mansoori'), null);
});

test('divisionsForSector maps sectors to sensible presets', () => {
  assert.ok(divisionsForSector('Islamic Banking').includes('Retail Banking'));
  assert.ok(divisionsForSector('AI / Tech').includes('Engineering'));
  assert.ok(divisionsForSector('Something Unheard Of').includes('Operations'));
});

/* -------------------------------------------------------------------- ats */

test('slugCandidates strips corporate noise words', () => {
  const fab = slugCandidates('First Abu Dhabi Bank (FAB)');
  assert.ok(fab.includes('firstabudhabibank'));
  const ihc = slugCandidates('International Holding Company (IHC)');
  assert.ok(ihc.some((s) => s.includes('holding')));
  assert.deepEqual(slugCandidates('Careem'), ['careem']);
});

test('slugCandidates only emits valid slugs', () => {
  for (const slug of slugCandidates('e& (Etisalat Group)')) {
    assert.ok(validSlug(slug), `${slug} is not a valid slug`);
  }
});

test('validSlug rejects injection-ish input', () => {
  assert.equal(validSlug('acme'), true);
  assert.equal(validSlug('acme-co'), true);
  assert.equal(validSlug('../etc/passwd'), false);
  assert.equal(validSlug('a b'), false);
  assert.equal(validSlug(''), false);
});

test('isPlatform gates unknown platforms', () => {
  assert.equal(isPlatform('greenhouse'), true);
  assert.equal(isPlatform('nonsense'), false);
});

test('matchesKeywords filters on title and location', () => {
  const job = { title: 'Data Analyst', location: 'Dubai, UAE', url: 'https://x.co/1' };
  assert.equal(matchesKeywords(job, ''), true, 'blank filter keeps everything');
  assert.equal(matchesKeywords(job, 'dubai'), true);
  assert.equal(matchesKeywords(job, 'analyst, engineer'), true);
  assert.equal(matchesKeywords(job, 'nurse'), false);
});

/* --------------------------------------------------------------- scoring */

const profile: Profile = {
  name: 'A',
  headline: '',
  phone: '',
  linkedinUrl: '',
  targetTitles: 'data analyst, business analyst',
  targetKeywords: 'python, sql, banking',
  excludeKeywords: 'sales, driver',
  targetSeniority: 2,
};

const dreamCompany = {
  id: 'c1',
  name: 'FAB',
  sector: 'Banking',
  location: 'Abu Dhabi',
  tier: 'dream' as const,
  emiratisation: true,
  createdAt: '',
};

test('scoreRole ranks an on-target UAE role highly', () => {
  const r = scoreRole(
    { roleTitle: 'Data Analyst', companyName: 'FAB', location: 'Dubai, UAE' },
    profile,
    dreamCompany
  );
  assert.ok(r.score >= 80, `expected a strong score, got ${r.score}`);
  assert.equal(scoreBand(r.score), 'strong');
});

test('scoreRole zeroes an excluded title outright', () => {
  const r = scoreRole(
    { roleTitle: 'Sales Executive', companyName: 'FAB', location: 'Dubai, UAE' },
    profile,
    dreamCompany
  );
  assert.equal(r.score, 0);
});

test('company prestige cannot float an irrelevant role', () => {
  // The failure this guards against: a nurse vacancy at a dream-tier bank in
  // Dubai collecting enough location/tier points to look worth reading.
  const r = scoreRole(
    { roleTitle: 'Registered Nurse', companyName: 'FAB', location: 'Dubai, UAE' },
    profile,
    dreamCompany
  );
  assert.ok(r.score <= 25, `expected a capped score, got ${r.score}`);
  assert.equal(scoreBand(r.score), 'weak');
});

test('scoreRole still ranks sensibly with no preferences set', () => {
  const bare: Profile = { name: '', headline: '', phone: '', linkedinUrl: '' };
  const r = scoreRole(
    { roleTitle: 'Anything At All', companyName: 'FAB', location: 'Dubai, UAE' },
    bare,
    dreamCompany
  );
  assert.ok(r.score > 0, 'an unconfigured profile should not zero every role');
});

test('scoreRole rewards UAE locations over foreign ones', () => {
  const uae = scoreRole({ roleTitle: 'Data Analyst', companyName: 'X', location: 'Sharjah, UAE' }, profile);
  const abroad = scoreRole({ roleTitle: 'Data Analyst', companyName: 'X', location: 'London, UK' }, profile);
  assert.ok(uae.score > abroad.score);
});

/* ------------------------------------------------------------- validation */

test('sanitize strips prototype-pollution keys', () => {
  // Parsed from JSON, so __proto__ arrives as a genuine own-property rather
  // than being swallowed by object-literal semantics — this is the shape a
  // real request body has.
  const hostile = JSON.parse('{"name":"ok","__proto__":{"bad":1},"constructor":"x","prototype":"y"}');
  const out = sanitize(hostile);

  assert.equal(out.name, 'ok');
  // Check own-properties: `out.constructor` resolves up the prototype chain to
  // Object even when nothing was copied.
  assert.equal(Object.hasOwn(out, 'constructor'), false);
  assert.equal(Object.hasOwn(out, 'prototype'), false);
  assert.equal(Object.hasOwn(out, '__proto__'), false);
  assert.equal(({} as Record<string, unknown>).bad, undefined, 'Object.prototype was polluted');
});

test('sanitize rejects non-objects', () => {
  assert.throws(() => sanitize([1, 2, 3]), ValidationError);
  assert.throws(() => sanitize('string'), ValidationError);
  assert.throws(() => sanitize(null), ValidationError);
});

test('sanitize drops nesting deeper than one level', () => {
  const out = sanitize({ a: { b: { c: { d: 1 } } } });
  assert.deepEqual(out.a, {});
});

test('sanitize keeps scalar arrays and drops object arrays', () => {
  const out = sanitize({ tags: ['a', 'b', 1, true, { nested: 1 }] });
  assert.deepEqual(out.tags, ['a', 'b', 1, true]);
});

test('stripProtected removes server-owned fields', () => {
  const out = stripProtected({ id: 'hacked', createdAt: '1999', name: 'keep' });
  assert.equal(out.id, undefined);
  assert.equal(out.createdAt, undefined);
  assert.equal(out.name, 'keep');
});

/* ----------------------------------------------------------------- merge */

test('mergeTemplate fills contact and profile fields', () => {
  const p: Profile = { name: 'Saeed', headline: 'Analyst', phone: '+971', linkedinUrl: 'https://li' };
  const out = mergeTemplate('Hi {{firstName}} at {{company}} — {{myName}} ({{headline}})', { firstName: 'Sara', company: 'FAB' }, p);
  assert.equal(out, 'Hi Sara at FAB — Saeed (Analyst)');
});

test('mergeTemplate leaves unknown placeholders alone', () => {
  const p: Profile = { name: '', headline: '', phone: '', linkedinUrl: '' };
  assert.match(mergeTemplate('{{unknownThing}}', {}, p), /\{\{unknownThing\}\}/);
});

test('mergeTemplate substitutes a placeholder for missing fields', () => {
  const p: Profile = { name: '', headline: '', phone: '', linkedinUrl: '' };
  assert.match(mergeTemplate('{{company}}', {}, p), /\[company\]/);
});

test('gmailComposeUrl encodes recipient, subject and body', () => {
  const url = gmailComposeUrl('a@b.com', 'Hello & welcome', 'line one\nline two');
  assert.ok(url.startsWith('https://mail.google.com/mail/?'));
  assert.ok(url.includes('to=a%40b.com'));
  assert.ok(url.includes('Hello+%26+welcome'));
});

/* --------------------------------------------------------- ats registry */

test('every platform definition builds a well-formed request', async () => {
  const { PLATFORM_DEFS } = await import('../lib/ats-registry');
  for (const def of PLATFORM_DEFS) {
    const cfg: Record<string, string> = { slug: 'acme' };
    for (const f of def.fields) cfg[f.key] = f.placeholder;
    const req = def.build(cfg);
    assert.ok(req.url.startsWith('https://'), `${def.id} produced a non-https URL: ${req.url}`);
    assert.ok(!req.url.includes('{'), `${def.id} left an unsubstituted placeholder: ${req.url}`);
    if (req.method === 'POST') {
      assert.ok(req.body, `${def.id} is POST but sends no body`);
      assert.doesNotThrow(() => JSON.parse(req.body!), `${def.id} body is not valid JSON`);
    }
  }
});

test('every platform parser tolerates empty and malformed responses', async () => {
  const { PLATFORM_DEFS } = await import('../lib/ats-registry');
  for (const def of PLATFORM_DEFS) {
    const cfg: Record<string, string> = { slug: 'acme' };
    for (const f of def.fields) cfg[f.key] = f.placeholder;
    // A board with no openings, and a response shaped nothing like expected,
    // must both yield an empty list rather than throwing mid-refresh.
    assert.deepEqual(def.parse({}, cfg), [], `${def.id} choked on {}`);
    assert.deepEqual(def.parse(null, cfg), [], `${def.id} choked on null`);
    assert.deepEqual(def.parse({ unexpected: 'shape' }, cfg), [], `${def.id} choked on a wrong shape`);
  }
});

test('workday builds tenant/datacentre/site into its URL', async () => {
  const { getPlatform } = await import('../lib/ats-registry');
  const wd = getPlatform('workday')!;
  const req = wd.build({ slug: 'acmecorp', dc: 'wd3', site: 'External_Careers' });
  assert.equal(req.method, 'POST');
  assert.ok(req.url.includes('acmecorp.wd3.myworkdayjobs.com'));
  assert.ok(req.url.includes('/wday/cxs/acmecorp/External_Careers/jobs'));
});

test('workday parses postings into absolute apply URLs', async () => {
  const { getPlatform } = await import('../lib/ats-registry');
  const wd = getPlatform('workday')!;
  const jobs = wd.parse(
    { jobPostings: [{ title: 'Data Analyst', locationsText: 'Dubai', externalPath: '/job/Dubai/Data-Analyst_R-1' }] },
    { slug: 'acmecorp', dc: 'wd3', site: 'External_Careers' }
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Data Analyst');
  assert.ok(jobs[0].url.startsWith('https://acmecorp.wd3.myworkdayjobs.com/en-US/External_Careers/job/'));
});

test('fetchJobsFor refuses a platform missing a required field', async () => {
  const { fetchJobsFor } = await import('../lib/ats-registry');
  await assert.rejects(() => fetchJobsFor('workday', { slug: 'acme' }), /Data centre/);
});

test('discovery skips platforms whose identifiers cannot be guessed', async () => {
  const { PLATFORM_DEFS } = await import('../lib/ats-registry');
  const workday = PLATFORM_DEFS.find((p) => p.id === 'workday')!;
  const greenhouse = PLATFORM_DEFS.find((p) => p.id === 'greenhouse')!;
  assert.equal(workday.discoverable, false, 'probing Workday by name would be wasted requests');
  assert.equal(greenhouse.discoverable, true);
});

/* --------------------------------------------------------------- sectors */

test('sectorGroup classifies the seeded company sectors', async () => {
  const { sectorGroup } = await import('../lib/sectors');
  const db = await import('../data/db.json');
  const companies = (db as unknown as { companies: Array<{ sector: string }> }).companies;

  const unclassified = companies.filter((c) => sectorGroup(c.sector) === 'Other');
  const share = unclassified.length / companies.length;
  // The filter is only useful if nearly everything lands in a real group.
  assert.ok(share < 0.05, `${(share * 100).toFixed(1)}% unclassified — filter would be noisy`);
});

test('sectorGroup maps representative sectors correctly', async () => {
  const { sectorGroup } = await import('../lib/sectors');
  const cases: Array<[string, string]> = [
    ['Islamic Banking', 'Banking & Finance'],
    ['Money Exchange & Remittance', 'Banking & Finance'],
    ['Oil & Gas Upstream', 'Energy & Utilities'],
    ['District Cooling', 'Energy & Utilities'],
    ['Private University', 'Education'],
    ['Municipal Services', 'Government & Public'],
    ['Hospital Group', 'Healthcare'],
    ['Master Developer', 'Real Estate & Construction'],
    ['Ports & Terminals', 'Transport & Logistics'],
    ['Hypermarket Chain', 'Retail & Consumer'],
    ['Hotel Operator', 'Hospitality & Tourism'],
    ['Management Consulting', 'Professional Services'],
    ['Aluminium Smelting', 'Industry & Manufacturing'],
  ];
  for (const [sector, expected] of cases) {
    assert.equal(sectorGroup(sector), expected, `"${sector}" grouped wrongly`);
  }
});

/* ------------------------------------------------------- seed integrity */

test('seed company ids are unique', async () => {
  // The store keys rows on (collection, id). Duplicate ids collide on the
  // primary key and silently drop companies on first load — this caught five
  // real developers being overwritten by restaurant chains.
  const db = await import('../data/db.json');
  const companies = (db as unknown as { companies: Array<{ id: string; name: string }> }).companies;
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const c of companies) {
    const prior = seen.get(c.id);
    if (prior) collisions.push(`${c.id}: "${prior}" vs "${c.name}"`);
    else seen.set(c.id, c.name);
  }
  assert.deepEqual(collisions, [], 'duplicate company ids would drop rows');
});

test('seed companies are well formed', async () => {
  const db = await import('../data/db.json');
  const companies = (db as unknown as {
    companies: Array<{ id: string; name: string; sector: string; location: string; tier: string; domain?: string }>;
  }).companies;

  assert.ok(companies.length > 500, 'the starter database should be substantial');

  const tiers = new Set(['dream', 'target', 'backup']);
  for (const c of companies) {
    assert.ok(c.id && c.name && c.sector && c.location, `incomplete row: ${JSON.stringify(c).slice(0, 80)}`);
    assert.ok(tiers.has(c.tier), `bad tier "${c.tier}" on ${c.name}`);
    if (c.domain) {
      assert.match(c.domain, /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/, `bad domain on ${c.name}: ${c.domain}`);
    }
  }
});

test('seed company names are unique', async () => {
  const db = await import('../data/db.json');
  const companies = (db as unknown as { companies: Array<{ name: string }> }).companies;
  const names = companies.map((c) => c.name.trim().toLowerCase());
  assert.equal(new Set(names).size, names.length, 'duplicate company names');
});
