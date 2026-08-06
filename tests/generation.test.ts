/**
 * Week 3 acceptance tests, part 1 — what gets written.
 *
 * The milestone's bar: the lint rejects every banned phrase and any em dash
 * before the Review screen; a draft with fabricated user edits gets the soft
 * lint, not a block; and a thin-evidence contact gets a refusal card, never a
 * generic email and never an empty queue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANNED_PHRASES,
  CAPS,
  lintGenerated,
  lintUserEdit,
} from '../lib/template';
import { selectPremise } from '../lib/generator';
import type { EvidenceRow } from '../lib/evidence';

function evidence(over: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: 'evd_1',
    company_id: 'cmp_1',
    person_id: 'per_1',
    tier: 1,
    quote: 'Most of the cost in payments sits in reconciliation, not in the transfers.',
    quote_translated: null,
    language: 'en',
    source_url: 'https://example.ae/talk',
    context_snippet: null,
    captured_at: '2026-08-01T00:00:00.000Z',
    verified_on: null,
    link_dead: 0,
    usable: 1,
    unusable_reason: null,
    identity_match: 'mentions: Example',
    disputed: 0,
    used_for_person_id: null,
    ...over,
  } as EvidenceRow;
}

const GOOD_BODY = `Your talk at the Dubai Fintech Summit argued that most of the payments cost sits in reconciliation rather than in the transfers. I went back and read the note you linked afterwards.

I am a final year finance student at Zayed University. I spent last summer on the settlements team at a local bank, mostly working reconciliation exceptions.

In year one, is someone with that background more useful inside operations or closer to the product team?

Either way, thank you for putting the talk online.`;

// ---------------------------------------------------------------------------
// The blocklist
// ---------------------------------------------------------------------------

test('a clean draft passes', () => {
  const findings = lintGenerated(GOOD_BODY, { subject: 'Zayed University student' });
  assert.deepEqual(findings, [], JSON.stringify(findings));
});

test('every banned phrase is actually caught by the lint that ships', () => {
  // A blocklist nothing tests is a blocklist with a typo in it.
  const samples: Record<string, string> = {
    'hope this finds you well': 'I hope this email finds you well. One question below.',
    'happy [weekday]': 'Happy Tuesday. One question below.',
    "I know you're busy": "I know you're busy so I will keep this short.",
    'to see if we are a fit': 'Writing to see if we are a fit for your team.',
    "I'd love to": "I'd love to hear how your team works.",
    "I'll be brief": "I'll be brief. One question below.",
    'quick question': 'Quick question about your team.',
    'just checking in': 'Just checking in on my note below.',
    "we're the #1": "We're the #1 graduate in the cohort.",
    'if this is relevant to you': 'If this is relevant to you, let me know.',
    'did you get my last email': 'Did you get my last email about the role?',
    cheers: 'One question below. Cheers.',
    'pick your brain': 'Could I pick your brain about operations?',
    'virtual coffee': 'Would you be open to a virtual coffee?',
    "I don't want to waste your time": "I don't want to waste your time with this.",
    'impressed by your profile': 'I was really impressed by your profile.',
    'leaders like you': 'We work with leaders like you every day.',
    'quick call': 'Would you have time for a quick call?',
    "let's connect": "Let's connect about graduate roles.",
    ROI: 'The ROI on graduate hiring is strong.',
    "I'd love to network": "I'd love to network with your team.",
    'I came across': 'I came across your profile last week.',
    resonated: 'Your post resonated with me.',
    'excited to': 'I am excited to learn about your team.',
    delve: 'I would like to delve into your process.',
    leverage: 'I want to leverage my experience here.',
    'passionate about': 'I am passionate about payments.',
    'reaching out': 'I am reaching out about graduate roles.',
    "in today's landscape": "In today's banking landscape, reconciliation matters.",
    'help you meet your targets': 'I can help you meet your Emiratisation targets.',
  };

  for (const { label } of BANNED_PHRASES) {
    const sample = samples[label];
    assert.ok(sample, `no sample sentence for the banned phrase "${label}" — add one`);
    const findings = lintGenerated(sample);
    assert.ok(
      findings.some((f) => f.rule === `banned:${label}` && f.severity === 'block'),
      `"${label}" was not blocked by the lint that ships`
    );
  }
});

test('em dashes are blocked — the most reliable machine tell there is', () => {
  const findings = lintGenerated('Your talk argued one thing — the cost sits in reconciliation.');
  assert.ok(findings.some((f) => f.rule === 'em_dash' && f.severity === 'block'));
  // An en dash too: they read the same in an inbox.
  assert.ok(lintGenerated('One thing – another thing.').some((f) => f.rule === 'em_dash'));
});

test('length and shape are caps, not suggestions', () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ') + '.';
  assert.ok(lintGenerated(long).some((f) => f.rule === 'too_long'));

  const chatty = Array.from({ length: 9 }, (_, i) => `Sentence number ${i}.`).join(' ');
  assert.ok(lintGenerated(chatty).some((f) => f.rule === 'too_many_sentences'));

  const twoAsks = 'Is operations the better start? Or would product suit me more?';
  assert.ok(lintGenerated(twoAsks).some((f) => f.rule === 'multiple_asks'));
});

test('links and shorteners are deliverability decisions, not style ones', () => {
  const twoLinks = 'See https://a.example and https://b.example for context.';
  assert.ok(lintGenerated(twoLinks).some((f) => f.rule === 'too_many_links'));
  assert.ok(lintGenerated('See https://bit.ly/xyz').some((f) => f.rule === 'shortener'));
});

test('subject lines are short, never fake Re:, and never shout', () => {
  assert.ok(
    lintGenerated(GOOD_BODY, { subject: 'A question about graduate roles at your bank please' })
      .some((f) => f.rule === 'subject_long')
  );
  assert.ok(lintGenerated(GOOD_BODY, { subject: 'Re: our chat' }).some((f) => f.rule === 'fake_re'));
  assert.ok(lintGenerated(GOOD_BODY, { subject: 'Emirati grad!' }).some((f) => f.rule === 'subject_exclamation'));
});

// ---------------------------------------------------------------------------
// The register conflict, resolved
// ---------------------------------------------------------------------------

test('"hope this finds you well" is banned by default and allowed at high register', () => {
  const body = 'I hope this message finds you well. Your paper argued that reconciliation carries the cost. Thank you for putting it online.';

  assert.ok(
    lintGenerated(body, { register: 'MEDIUM' }).some((f) => f.rule === 'banned:hope this finds you well'),
    'to a mid-level or expat recipient it reads as a template'
  );
  assert.equal(
    lintGenerated(body, { register: 'HIGH' }).some((f) => f.rule === 'banned:hope this finds you well'),
    false,
    'to a senior traditional recipient its absence is what reads as disrespect'
  );
});

test('a high-register email without a line of thanks is blocked', () => {
  const bare = 'Your paper argued that reconciliation carries the cost. Is operations the better start?';
  assert.ok(lintGenerated(bare, { register: 'HIGH' }).some((f) => f.rule === 'high_register_no_thanks'));
  assert.equal(
    lintGenerated(bare, { register: 'LOW' }).some((f) => f.rule === 'high_register_no_thanks'),
    false
  );
});

// ---------------------------------------------------------------------------
// The user's own edits — warnings only
// ---------------------------------------------------------------------------

const BACKING = {
  evidenceQuotes: ['Most of the cost in payments sits in reconciliation, not in the transfers.'],
  profileValues: ['Zayed University, BSc Finance', 'settlements team at a local bank'],
};

test('nothing the user types is ever blocked', () => {
  const messy = `${GOOD_BODY}\n\nI have applied through your portal already. I led a team of twenty people.`;
  const findings = lintUserEdit(messy, GOOD_BODY, BACKING);
  assert.ok(findings.length > 0);
  assert.equal(findings.every((f) => f.severity === 'warn'), true, 'their name is on it');
});

test('an invented claim is flagged, in a sentence they can act on', () => {
  const edited = `${GOOD_BODY}\n\nI have applied through your portal already.`;
  const findings = lintUserEdit(edited, GOOD_BODY, BACKING);
  const claim = findings.find((f) => f.rule === 'unbacked_claim');
  assert.ok(claim, JSON.stringify(findings));
  assert.ok(claim!.excerpt?.includes('portal'));
  assert.ok(claim!.message.includes('stand behind it'));
});

test('deleting the opening line is called out, because it is why this gets a reply', () => {
  const gutted = 'I am a final year finance student at Zayed University. Are you hiring?';
  const findings = lintUserEdit(gutted, GOOD_BODY, BACKING);
  assert.ok(findings.some((f) => f.rule === 'hook_removed'));
});

test('a sentence the evidence already backs is not flagged', () => {
  const edited = GOOD_BODY.replace(
    'I went back and read the note you linked afterwards.',
    'I went back and read the reconciliation note you linked afterwards.'
  );
  const findings = lintUserEdit(edited, GOOD_BODY, BACKING);
  assert.equal(findings.some((f) => f.rule === 'unbacked_claim'), false, JSON.stringify(findings));
});

test('a long edit warns rather than blocks', () => {
  const long = `${GOOD_BODY} ${Array.from({ length: 120 }, (_, i) => `extra${i}`).join(' ')}`;
  const findings = lintUserEdit(long, GOOD_BODY, BACKING);
  const lengthWarning = findings.find((f) => f.rule === 'user_long');
  assert.ok(lengthWarning);
  assert.equal(lengthWarning!.severity, 'warn');
  assert.ok(lengthWarning!.message.includes('your call'));
});

// ---------------------------------------------------------------------------
// Premise selection
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-06T00:00:00Z');

test('the highest usable tier wins, and only one observable is ever chosen', () => {
  const { premise } = selectPremise(
    [
      evidence({ id: 'a', tier: 5 }),
      evidence({ id: 'b', tier: 1 }),
      evidence({ id: 'c', tier: 3 }),
    ],
    NOW
  );
  assert.equal(premise?.id, 'b');
});

test('a stale tier-1 is demoted, because it is no longer news', () => {
  const { premise } = selectPremise(
    [
      evidence({ id: 'old', tier: 1, captured_at: '2025-01-01T00:00:00.000Z' }),
      evidence({ id: 'fresh', tier: 2, captured_at: '2026-08-01T00:00:00.000Z' }),
    ],
    NOW
  );
  assert.equal(premise?.id, 'fresh', 'a year-old tier 1 drops below a fresh tier 2');
});

test('a promotion nobody mentioned for two months stops being a premise', () => {
  // Every tool congratulates promotions. A stale one is worse than nothing.
  const { premise } = selectPremise(
    [evidence({ id: 'promo', tier: 4, captured_at: '2026-05-01T00:00:00.000Z' })],
    NOW
  );
  assert.equal(premise, null);
});

test('junk drawer is never an opener', () => {
  const { premise } = selectPremise([evidence({ id: 'hobby', tier: 6 })], NOW);
  assert.equal(premise, null);
});

test('with nothing usable there is no premise, which is what produces a refusal', () => {
  assert.equal(selectPremise([], NOW).premise, null);
});

// ---------------------------------------------------------------------------
// Caps are structural
// ---------------------------------------------------------------------------

test('the touch cap is three and is not configurable upward', () => {
  assert.equal(CAPS.maxTouches, 3);
  assert.equal(CAPS.maxObservables, 1);
  assert.equal(CAPS.maxAsks, 1);
  assert.equal(CAPS.maxIntroSlots, 2);
});
