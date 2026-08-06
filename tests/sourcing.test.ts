/**
 * Week 2 acceptance tests (ULTRAPROMPT §6).
 *
 * The milestone is defined by one sentence: a deliberately-planted namesake,
 * transliteration twin, and catch-all domain all get caught by the gates, not
 * by luck — and no person without an anchor source can reach draft-eligible
 * state. Each of those is planted here on purpose.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveRegister,
  lintSalutation,
  parseName,
  phoneticKey,
  resolveSalutation,
} from '../lib/names';
import {
  addressParts,
  candidateAddresses,
  inferPatternFrom,
} from '../lib/email-pattern';
import { buildSearchPlan, checkGeography, extractReportingLine, parseResultTitle } from '../lib/tier3';
import { resolveIdentity, assessSensitivity } from '../lib/evidence';
import { draftEligibility, isRoleBasedAddress } from '../lib/people';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-sourcing-'));
  process.env.DB_PATH = join(dir, 'test.db');
});

after(async () => {
  const { closeDb } = await import('../lib/db/client');
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Names — CULTURE.md §3
// ---------------------------------------------------------------------------

test('"Al" is never split off, because "Dear Mr. Al," identifies the email as bulk', () => {
  const parsed = parseName('Ahmed Al Mazrouei');
  assert.equal(parsed.familyName, 'Al Mazrouei');
  assert.equal(parsed.familyNameDetected, true);
  assert.equal(parsed.givenName, 'Ahmed');
});

test('patronymic connectors are dropped, not treated as name tokens', () => {
  const parsed = parseName('Zayed bin Sultan Al Nahyan');
  assert.equal(parsed.tokens.includes('bin'), false);
  assert.equal(parsed.givenName, 'Zayed');
  assert.equal(parsed.familyName, 'Al Nahyan');
});

test('an unresolved patronymic chain reports no family name rather than guessing', () => {
  // "Ibrahim" here is the grandfather's given name. Addressing him as
  // Mr. Ibrahim addresses a man by it.
  const parsed = parseName('Ahmed Hassan Ibrahim');
  assert.equal(parsed.familyNameDetected, false);
  assert.equal(parsed.familyName, null);
});

test('transliteration twins collapse to one key, so one company cannot hold two rungs', () => {
  const variants = [
    'Mohammed Al Marri',
    'Mohamed AlMarri',
    'Muhammad Al-Marri',
    'Mohd Al Marri',
  ];
  const keys = new Set(variants.map((v) => phoneticKey(v)));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(' | ')}`);
});

test('a documented real-family spelling split still collapses', () => {
  // One documented Emirati family spells it Al Mehairi and Al Muhairy across
  // siblings. Two rungs for one person is worse than a missed dedup.
  assert.equal(phoneticKey('Fatima Al Mehairi'), phoneticKey('Fatima Al Muhairy'));
});

test('different people do not collapse', () => {
  assert.notEqual(phoneticKey('Ahmed Al Mazrouei'), phoneticKey('Ahmed Al Suwaidi'));
  assert.notEqual(phoneticKey('Sara Al Marri'), phoneticKey('Mohammed Al Marri'));
});

// ---------------------------------------------------------------------------
// Salutation — CULTURE.md §10, §11, §12
// ---------------------------------------------------------------------------

const base = {
  gender: 'M' as const,
  nationalityBucket: 'emirati' as const,
  register: 'HIGH' as const,
  honorificDeclared: null,
};

test('an Emirati tribal family name is addressed as a surname', () => {
  const result = resolveSalutation({ ...base, name: parseName('Khalid Al Ketbi') });
  assert.equal(result.salutation, 'Dear Mr. Al Ketbi,');
});

test('an unresolved Arab chain falls back to the given name, per the Gulf convention', () => {
  const result = resolveSalutation({
    ...base,
    nationalityBucket: 'levant_egypt_arab',
    name: parseName('Ahmed Hassan Ibrahim'),
  });
  assert.equal(result.salutation, 'Dear Mr. Ahmed,');
});

test('unknown gender falls back to the full name, which is never wrong', () => {
  const result = resolveSalutation({
    ...base,
    gender: 'unknown',
    name: parseName('Noor Al Hammadi'),
  });
  assert.equal(result.salutation, 'Dear Noor Al Hammadi,');
});

test('a declared Dr. replaces Mr., never stacks with it', () => {
  const result = resolveSalutation({ ...base, name: parseName('Aisha Al Hosani'), gender: 'F', honorificDeclared: 'Dr.' });
  assert.equal(result.salutation, 'Dear Dr. Al Hosani,');
  assert.equal(result.salutation!.includes('Ms.'), false);
});

test('Sheikh halts the send for a human decision', () => {
  const result = resolveSalutation({ ...base, name: parseName('Mohammed Al Maktoum'), honorificDeclared: 'Sheikh' });
  assert.equal(result.salutation, null);
  assert.equal(result.halt, 'ruling_family');
});

test('an Al- family name alone never implies ruling-family status', () => {
  // Most Emirati family names are Al-prefixed. Inferring Sheikh from one is the
  // worst address error available.
  const result = resolveSalutation({ ...base, name: parseName('Mohammed Al Maktoum'), honorificDeclared: null });
  assert.equal(result.halt, null);
  assert.equal(result.salutation, 'Dear Mr. Al Maktoum,');
});

test('a Western recipient at a startup gets the first name', () => {
  const register = deriveRegister({
    seniorityTier: 3,
    orgType: 'startup',
    nationalityBucket: 'western',
    functionType: 'hiring_manager',
  });
  assert.equal(register, 'LOW');
  const result = resolveSalutation({
    ...base,
    register,
    nationalityBucket: 'western',
    name: parseName('James Whitfield'),
  });
  assert.equal(result.salutation, 'Hi James,');
});

test('HR is transactional whatever the seniority', () => {
  const register = deriveRegister({
    seniorityTier: 1,
    orgType: 'government',
    nationalityBucket: 'emirati',
    functionType: 'hr_ta',
  });
  assert.equal(register, 'MEDIUM', 'the HR override caps the register');
});

// ---------------------------------------------------------------------------
// Salutation lint — the five highest-risk mistakes
// ---------------------------------------------------------------------------

test('a greeting ending on a bare particle is blocked', () => {
  const findings = lintSalutation('Dear Mr. Al,', { honorificDeclared: null, orgType: null });
  assert.equal(findings.some((f) => f.rule === 'bare_particle' && f.severity === 'block'), true);
});

test('Eng. that was not copied from a source is blocked', () => {
  const findings = lintSalutation('Dear Eng. Priya,', { honorificDeclared: null, orgType: 'startup' });
  assert.equal(findings.some((f) => f.rule === 'derived_eng' && f.severity === 'block'), true);

  const declared = lintSalutation('Dear Eng. Marwan,', { honorificDeclared: 'Eng.', orgType: 'government' });
  assert.equal(declared.some((f) => f.rule === 'derived_eng'), false);
});

test('H.E. on a private-sector recipient is blocked', () => {
  const findings = lintSalutation('Dear H.E. Al Futtaim,', { honorificDeclared: 'H.E.', orgType: 'private_local' });
  assert.equal(findings.some((f) => f.rule === 'he_on_private_sector'), true);
});

test('Mrs. and Sir/Madam are both blocked', () => {
  assert.equal(lintSalutation('Dear Mrs. Al Suwaidi,', { honorificDeclared: null, orgType: null })[0].rule, 'mrs');
  assert.equal(lintSalutation('Dear Sir/Madam,', { honorificDeclared: null, orgType: null })[0].rule, 'sir_madam');
});

test('an unresolved merge token never reaches a greeting', () => {
  const findings = lintSalutation('Dear {{first_name}},', { honorificDeclared: null, orgType: null });
  assert.equal(findings.some((f) => f.rule === 'unresolved_token'), true);
});

// ---------------------------------------------------------------------------
// Anchor source and freshness
// ---------------------------------------------------------------------------

test('no anchor source means not draftable, whatever else is right', () => {
  const result = draftEligibility({
    anchorSourceUrl: null,
    corroboratingSourceCount: 4,
    freshnessDate: '2026-08-01',
    emailStatus: 'verified',
    now: new Date('2026-08-06T00:00:00Z'),
  });
  assert.equal(result.eligible, false);
  assert.equal(result.blockers[0].code, 'no_anchor');
});

test('one source older than 90 days is not enough', () => {
  const result = draftEligibility({
    anchorSourceUrl: 'https://example.ae/leadership',
    corroboratingSourceCount: 1,
    freshnessDate: '2026-01-01',
    emailStatus: 'verified',
    now: new Date('2026-08-06T00:00:00Z'),
  });
  assert.equal(result.eligible, false);
  assert.equal(result.blockers.some((b) => b.code === 'stale_single_source'), true);
});

test('one source, but fresh, is enough — and so is two stale ones', () => {
  const fresh = draftEligibility({
    anchorSourceUrl: 'https://example.ae/leadership',
    corroboratingSourceCount: 1,
    freshnessDate: '2026-07-20',
    emailStatus: 'verified',
    now: new Date('2026-08-06T00:00:00Z'),
  });
  assert.equal(fresh.eligible, true, JSON.stringify(fresh.blockers));

  const corroborated = draftEligibility({
    anchorSourceUrl: 'https://example.ae/leadership',
    corroboratingSourceCount: 2,
    freshnessDate: '2025-01-01',
    emailStatus: 'verified',
    now: new Date('2026-08-06T00:00:00Z'),
  });
  assert.equal(corroborated.eligible, true, JSON.stringify(corroborated.blockers));
});

test('an unverified address blocks the draft — hard rule 3', () => {
  const result = draftEligibility({
    anchorSourceUrl: 'https://example.ae/leadership',
    corroboratingSourceCount: 2,
    freshnessDate: '2026-08-01',
    emailStatus: 'guessed',
    now: new Date('2026-08-06T00:00:00Z'),
  });
  assert.equal(result.eligible, false);
  assert.equal(result.blockers.some((b) => b.code === 'email_unverified'), true);
});

// ---------------------------------------------------------------------------
// The planted namesake
// ---------------------------------------------------------------------------

test('a quote from a namesake is caught by entity resolution', () => {
  // A real Gulf News quote, a real link, and the wrong Ahmed Al Mansoori.
  const footballer = resolveIdentity(
    'Ahmed Al Mansoori scored twice in the second half at Al Nahyan Stadium.',
    null,
    {
      companyName: 'Abu Dhabi Commercial Bank',
      personName: 'Ahmed Al Mansoori',
      roleTitle: 'Head of Emiratisation',
      sourceUrl: 'https://gulfnews.com/sport/football/match-report',
    }
  );
  assert.equal(footballer.matched, false);

  const genuine = resolveIdentity(
    'Ahmed Al Mansoori, who leads Emiratisation at Abu Dhabi Commercial Bank, said the harder problem is retention.',
    null,
    {
      companyName: 'Abu Dhabi Commercial Bank',
      personName: 'Ahmed Al Mansoori',
      roleTitle: 'Head of Emiratisation',
      sourceUrl: 'https://zawya.com/press-release/adcb',
    }
  );
  assert.equal(genuine.matched, true);
  assert.equal(genuine.cue, 'mentions: Abu Dhabi Commercial Bank');
});

test('a quote on the same page as the anchor is the same person', () => {
  const result = resolveIdentity('We doubled the graduate intake this year.', null, {
    companyName: 'Some Company',
    personName: 'Khalid Al Ketbi',
    sourceUrl: 'https://example.ae/leadership/khalid',
    anchorUrl: 'https://example.ae/leadership/khalid',
  });
  assert.equal(result.matched, true);
});

// ---------------------------------------------------------------------------
// The sensitivity gate
// ---------------------------------------------------------------------------

test('a bereavement post is never an opener, however public', async () => {
  const verdict = await assessSensitivity(
    'Thank you all for the condolences on the passing of my father last week.'
  );
  assert.equal(verdict.usable, false);
  assert.ok(verdict.labels.includes('bereavement'));
});

test('ordinary professional content passes', async () => {
  const verdict = await assessSensitivity(
    'We hit our Emiratisation target ahead of the December checkpoint; keeping people past year two is the harder problem.'
  );
  assert.equal(verdict.usable, true);
});

test('the gate does not depend on Claude being reachable', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const verdict = await assessSensitivity('Recovering well after the surgery, back at work Monday.');
    assert.equal(verdict.usable, false, 'the pattern floor still catches it');
  } finally {
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// Email patterns — the planted catch-all and the single exemplar
// ---------------------------------------------------------------------------

test('both renderings of an Al- family name are produced as address parts', () => {
  const parts = addressParts('Ahmed Al Mazrouei');
  assert.deepEqual(parts.firsts, ['ahmed']);
  assert.ok(parts.lasts.includes('almazrouei'), 'the closed-up form');
  assert.ok(parts.lasts.includes('mazrouei'), 'and the bare form — organisations split on this');
});

test('a known pattern produces only its own candidates', () => {
  const candidates = candidateAddresses('Ahmed Al Mazrouei', 'example.ae', 'first.last');
  assert.ok(candidates.includes('ahmed.almazrouei@example.ae'));
  assert.ok(candidates.includes('ahmed.mazrouei@example.ae'));
  assert.equal(candidates.some((c) => c.startsWith('a.')), false, 'a different pattern is not guessed at');
});

test('an exemplar reveals which pattern a domain uses', () => {
  assert.equal(inferPatternFrom('ahmed.almazrouei@example.ae', 'Ahmed Al Mazrouei'), 'first.last');
  assert.equal(inferPatternFrom('aalmazrouei@example.ae', 'Ahmed Al Mazrouei'), 'flast');
  assert.equal(inferPatternFrom('random@example.ae', 'Ahmed Al Mazrouei'), null);
});

test('one exemplar is probable, two agreeing are confirmed, and only confirmed produces an address', async () => {
  const { recordExemplar } = await import('../lib/email-pattern');
  const { getDb } = await import('../lib/db/client');
  await getDb();

  const first = await recordExemplar({
    domain: 'planted.ae',
    address: 'ahmed.almazrouei@planted.ae',
    fullNameRaw: 'Ahmed Al Mazrouei',
    sourceUrl: 'https://planted.ae/press/one',
  });
  assert.equal(first.confidence, 'probable', 'one address is a coincidence, not a pattern');

  const second = await recordExemplar({
    domain: 'planted.ae',
    address: 'sara.almarri@planted.ae',
    fullNameRaw: 'Sara Al Marri',
    sourceUrl: 'https://planted.ae/press/two',
  });
  assert.equal(second.confidence, 'confirmed');
  assert.equal(second.pattern, 'first.last');
  assert.ok(second.provenance.includes('2 independent sources'));
});

test('a bounce on the sole exemplar reverts every sibling address to guessed', async () => {
  const { recordExemplar, markExemplarBounced, patternFor } = await import('../lib/email-pattern');

  await recordExemplar({
    domain: 'fragile.ae',
    address: 'ahmed.almazrouei@fragile.ae',
    fullNameRaw: 'Ahmed Al Mazrouei',
    sourceUrl: 'https://fragile.ae/press',
  });
  await markExemplarBounced('ahmed.almazrouei@fragile.ae');

  const after = await patternFor('fragile.ae');
  assert.equal(after?.confidence, 'insufficient');
  assert.equal(after?.pattern, null, 'a pattern whose only evidence just died is not a pattern');
});

test('generic mailboxes are recognised so sourcing can down-rank them', () => {
  for (const address of ['careers@x.ae', 'hr@x.ae', 'emiratisation@x.ae', 'info@x.ae']) {
    assert.equal(isRoleBasedAddress(address), true, address);
  }
  assert.equal(isRoleBasedAddress('ahmed.almazrouei@x.ae'), false);
});

// ---------------------------------------------------------------------------
// Tier 3 — the geography trap
// ---------------------------------------------------------------------------

test('the query is always restricted to the UAE LinkedIn subdomain', () => {
  const plan = buildSearchPlan({ companyName: 'First Abu Dhabi Bank', title: 'Head of Emiratisation' });
  assert.ok(plan.query.includes('site:ae.linkedin.com/in'));
  assert.ok(plan.query.includes('"First Abu Dhabi Bank"'));
  assert.equal(plan.precision, 'high');
});

test('a generic title is flagged as low precision before it wastes an hour', () => {
  const plan = buildSearchPlan({ companyName: 'Emirates NBD', title: 'Relationship Manager' });
  assert.equal(plan.precision, 'low');
  assert.ok(plan.advice.includes('job ads'));

  const qualified = buildSearchPlan({
    companyName: 'Emirates NBD',
    title: 'Relationship Manager',
    qualifier: 'Priority Banking',
  });
  assert.equal(qualified.precision, 'high');
});

test('the London trap is caught — the right person at the wrong office', () => {
  const london = checkGeography('Sarah Kent - Head of Human Resources at First Abu Dhabi Bank - London, United Kingdom');
  assert.equal(london.ok, false);
  assert.ok(london.note.includes('london'));

  const dubai = checkGeography('Khalid Al Ketbi - Head of Emiratisation at ADCB - Dubai, United Arab Emirates');
  assert.equal(dubai.ok, true);
});

test('a result that says nothing about location is not a pass', () => {
  const result = checkGeography('Khalid Al Ketbi - Head of Emiratisation at ADCB');
  assert.equal(result.ok, false, 'absence of a marker is not evidence of presence');
});

test('a LinkedIn result title splits into name and headline', () => {
  const parsed = parseResultTitle('Khalid Al Ketbi - Head of Emiratisation at ADCB | LinkedIn');
  assert.equal(parsed.personName, 'Khalid Al Ketbi');
  assert.equal(parsed.headline, 'Head of Emiratisation at ADCB');
});

test('a job ad yields a reporting line, which is what job ads are actually good for', () => {
  const titles = extractReportingLine(
    'The successful candidate will be reporting directly to the Head of Group Operations, based in Dubai.'
  );
  assert.ok(titles.some((t) => t.includes('Head of Group Operations')), titles.join(' | '));
});

// ---------------------------------------------------------------------------
// End to end: sourcing one company, with the gates firing
// ---------------------------------------------------------------------------

test('a company can be sourced end to end, and every planted trap is caught', async () => {
  const { getDb, execute } = await import('../lib/db/client');
  const { createPerson, personEligibility, suppress, checkSuppression } = await import('../lib/people');
  const { storeEvidence } = await import('../lib/evidence');

  await getDb();
  await execute(
    `INSERT INTO org_group (id, normalized_domain, created_at) VALUES ('org_e2e', 'e2e.ae', '2026-08-06T00:00:00Z')`
  );
  await execute(
    `INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
     VALUES ('cmp_e2e', 'org_e2e', 'End To End Bank', 'e2e.ae', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z')`
  );
  await execute(
    `INSERT INTO ladder_slot (id, company_id, rank, contact_type, created_at)
     VALUES ('slot_e2e', 'cmp_e2e', 1, 'emiratisation_lead', '2026-08-06T00:00:00Z')`
  );

  // No anchor source: saved, but excluded from the queue.
  const noAnchor = await createPerson({
    companyId: 'cmp_e2e',
    fullNameRaw: 'Mariam Al Suwaidi',
    contactType: 'emiratisation_lead',
    sourceTier: 3,
  });
  assert.equal(noAnchor.status, 'identity_unconfirmed');
  const noAnchorEligibility = await personEligibility(noAnchor.id);
  assert.equal(noAnchorEligibility.eligible, false);
  assert.equal(noAnchorEligibility.blockers[0].code, 'no_anchor');

  // The transliteration twin is refused as a second rung.
  const twin = await createPerson({
    companyId: 'cmp_e2e',
    fullNameRaw: 'Maryam AlSuweidi',
    contactType: 'hr',
    sourceTier: 3,
  });
  assert.ok(twin.duplicateOf, 'the twin is offered as a merge, not added as a second rung');
  assert.equal(twin.duplicateOf!.id, noAnchor.id);

  // An honorific found in the text is reported, never applied.
  const withTitle = await createPerson({
    companyId: 'cmp_e2e',
    fullNameRaw: 'Dr. Khalid Al Ketbi',
    contactType: 'hiring_manager',
    sourceTier: 2,
    anchorSourceUrl: 'https://e2e.ae/leadership/khalid',
    freshnessDate: '2026-08-01',
  });
  assert.ok(
    withTitle.warnings.some((w) => w.includes('copied, never derived')),
    withTitle.warnings.join(' | ')
  );

  // The planted namesake quote is stored unusable with the reason on it.
  const namesake = await storeEvidence(
    {
      companyId: 'cmp_e2e',
      personId: withTitle.id,
      tier: 1,
      quote: 'Khalid Al Ketbi took gold in the 400 metres at the national championships.',
      sourceUrl: 'https://sport.example/athletics',
    },
    { companyName: 'End To End Bank', personName: 'Khalid Al Ketbi', roleTitle: null }
  );
  assert.equal(namesake.usable, false);
  assert.ok(namesake.reason?.includes('Namesake risk'));

  // Suppression is checked at ingest, before a row exists.
  await suppress({ domain: 'e2e.ae', scope: 'domain', reason: 'complaint_escalation' });
  assert.equal((await checkSuppression(null, 'e2e.ae')).suppressed, true);
  await assert.rejects(
    () =>
      createPerson({
        companyId: 'cmp_e2e',
        fullNameRaw: 'Someone New',
        contactType: 'hr',
        sourceTier: 2,
        anchorSourceUrl: 'https://e2e.ae/team',
      }),
    /asked us to stop/
  );
});

test('an Arabic quote with no translation cannot become a hook', async () => {
  // The generator's PS line falls back to the original when there is no
  // translation, which would splice an Arabic sentence verbatim into an English
  // follow-up — past every lint, because none of them read Arabic.
  const { storeEvidence } = await import('../lib/evidence');
  const result = await storeEvidence({
    companyId: 'cmp_e2e',
    tier: 5,
    quote: 'أعلن البنك عن برنامج توطين جديد لخريجي الجامعات',
    language: 'ar',
    sourceUrl: 'https://example.ae/news',
  });
  assert.equal(result.usable, false);
  // Blocked with a reason, not dropped: this may be the best hook available,
  // and the founder can recover it by adding a translation.
  assert.match(result.reason ?? '', /translation/i);
});

test('the same quote with a translation is usable', async () => {
  const { storeEvidence } = await import('../lib/evidence');
  const result = await storeEvidence({
    companyId: 'cmp_e2e',
    tier: 5,
    quote: 'أعلن البنك عن برنامج توطين جديد لخريجي الجامعات',
    quoteTranslated: 'The bank announced a new Emiratisation programme for university graduates',
    language: 'ar',
    sourceUrl: 'https://example.ae/news2',
  });
  assert.equal(result.usable, true);
});

test('the link checker never makes a request to LinkedIn', async () => {
  // Hard rule 7 has no exception for a HEAD request: detection there operates
  // at the TLS layer, so low volume confers no safety.
  const { checkLinks, storeEvidence } = await import('../lib/evidence');
  await storeEvidence({
    companyId: 'cmp_e2e',
    tier: 3,
    quote: 'Leads the graduate hiring programme, in their own words',
    sourceUrl: 'https://ae.linkedin.com/in/someone',
  });

  const before = globalThis.fetch;
  let fetched: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    fetched.push(String(url));
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    const result = await checkLinks(50);
    assert.equal(result.skipped >= 1, true, 'the LinkedIn row is skipped, not fetched');
  } finally {
    globalThis.fetch = before;
  }
  assert.equal(
    fetched.some((u) => u.includes('linkedin.com')),
    false
  );
});
