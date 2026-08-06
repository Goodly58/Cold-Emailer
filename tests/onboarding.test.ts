/**
 * Week 1 acceptance tests (ULTRAPROMPT §6).
 *
 * These check the three things the milestone is defined by, in the terms the
 * contract uses:
 *   - unchecking the send scope produces a plain-language re-launch, not a
 *     completed onboarding;
 *   - the minimum-viable-profile gate rejects one-word answers with exactly one
 *     concrete follow-up per thin field;
 *   - the CV exists before the reply that asks for it does.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assessText,
  evaluateGate,
  generateFollowup,
  INTERVIEW_FIELDS,
  type StoredAnswer,
} from '../lib/interview';
import { missingScopes, REQUIRED_SCOPES, SCOPE_EXPLANATIONS } from '../lib/gmail/oauth';
import { splitCompanyList } from '../lib/blocklist';
import { unencodableCharacters } from '../lib/cv';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-onboarding-'));
  process.env.DB_PATH = join(dir, 'test.db');
});

after(async () => {
  const { closeDb } = await import('../lib/db/client');
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// OAuth scopes
// ---------------------------------------------------------------------------

test('exactly two scopes are requested, and gmail.compose is not one of them', () => {
  assert.deepEqual([...REQUIRED_SCOPES], [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ]);
  assert.equal(
    REQUIRED_SCOPES.some((s) => s.includes('compose')),
    false,
    'SQLite is the only draft store, so compose has nothing to do and only widens the audit surface'
  );
});

test('unticking the send box is detected rather than discovered days later', () => {
  // Google's granular consent: the authorization succeeds, the scope does not.
  const granted = ['https://www.googleapis.com/auth/gmail.readonly'];
  assert.deepEqual(missingScopes(granted), ['https://www.googleapis.com/auth/gmail.send']);
  assert.deepEqual(missingScopes([...REQUIRED_SCOPES]), []);
  assert.deepEqual(missingScopes([]).length, 2);
});

test('the pre-consent explainer quotes Google and then translates it', () => {
  assert.equal(SCOPE_EXPLANATIONS.length, REQUIRED_SCOPES.length);
  for (const entry of SCOPE_EXPLANATIONS) {
    assert.ok(entry.googleWording.length > 0, 'the alarming wording is shown, not hidden');
    assert.ok(entry.whatItMeans.length > 20, 'and explained in plain words');
    assert.ok(REQUIRED_SCOPES.includes(entry.scope as (typeof REQUIRED_SCOPES)[number]));
  }
});

// ---------------------------------------------------------------------------
// Thinness
// ---------------------------------------------------------------------------

test('the answers that produce a generic email are caught', () => {
  for (const thin of ['anything', 'business', 'im hardworking', 'hard working', 'idk', 'na']) {
    assert.equal(assessText(thin), 'thin', `"${thin}" should read as thin`);
  }
});

test('a real answer is not second-guessed', () => {
  for (const concrete of [
    'Zayed University, BSc Finance, graduating June 2027',
    'I spent last summer on the settlements team at a local bank working reconciliation exceptions',
    'Built the stock model our team used for the 2026 case competition, placed second',
  ]) {
    assert.equal(assessText(concrete), 'concrete', `"${concrete}" should read as concrete`);
  }
});

test('an empty answer is not thin, it is unanswered', () => {
  // The difference matters: unanswered gets the question again, thin gets a
  // follow-up. Conflating them nags a user who simply has not typed yet.
  assert.equal(assessText(''), 'unknown');
  assert.equal(assessText('   '), 'unknown');
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function answer(field: string, over: Partial<StoredAnswer> = {}): StoredAnswer {
  return {
    field,
    value: 'Zayed University, BSc Finance, graduating June 2027',
    specificity: 'concrete',
    followupQuestion: null,
    followupAnswer: null,
    verificationFraming: null,
    ...over,
  };
}

const REQUIRED = INTERVIEW_FIELDS.filter((f) => f.required).map((f) => f.key);

test('a blank profile names the fields that are blank, never "incomplete"', () => {
  const gate = evaluateGate([]);
  assert.equal(gate.complete, false);
  assert.deepEqual(gate.missing, REQUIRED);
  assert.deepEqual(gate.thin, []);
});

test('a fully answered profile completes', () => {
  const gate = evaluateGate(REQUIRED.map((f) => answer(f)));
  assert.equal(gate.complete, true, JSON.stringify(gate));
});

test('one thin field blocks completion and is named', () => {
  const answers = REQUIRED.map((f) =>
    f === 'credibility_marker'
      ? answer(f, { value: 'im hardworking', specificity: 'thin', followupQuestion: 'What did you do, and where?' })
      : answer(f)
  );
  const gate = evaluateGate(answers);
  assert.equal(gate.complete, false);
  assert.deepEqual(gate.thin, ['credibility_marker']);
  assert.deepEqual(gate.missing, []);
});

test('answering the one follow-up concretely unblocks it — we ask once, we do not nag', () => {
  const answers = REQUIRED.map((f) =>
    f === 'credibility_marker'
      ? answer(f, {
          value: 'im hardworking',
          specificity: 'thin',
          followupQuestion: 'What did you do, and where?',
          followupAnswer: 'Two months on the operations desk at Emirates NBD over summer 2026',
        })
      : answer(f)
  );
  assert.equal(evaluateGate(answers).complete, true);
});

test('a follow-up answered just as vaguely does not unblock it', () => {
  const answers = REQUIRED.map((f) =>
    f === 'credibility_marker'
      ? answer(f, {
          value: 'im hardworking',
          specificity: 'thin',
          followupQuestion: 'What did you do, and where?',
          followupAnswer: 'lots of things',
        })
      : answer(f)
  );
  assert.equal(evaluateGate(answers).complete, false);
});

test('the optional field never blocks anyone', () => {
  const optional = INTERVIEW_FIELDS.filter((f) => !f.required);
  assert.ok(optional.length > 0, 'at least one question is skippable');
  assert.equal(evaluateGate(REQUIRED.map((f) => answer(f))).complete, true);
});

// ---------------------------------------------------------------------------
// The follow-up itself
// ---------------------------------------------------------------------------

test('a missing Claude key still produces exactly one usable question', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const question = await generateFollowup('credibility_marker', 'im hardworking');
    assert.ok(question.length > 0);
    assert.ok(question.endsWith('?'), 'it reads as a question');
    assert.equal(question.split('?').length, 2, 'exactly one question, never a list');
    assert.ok(question.length < 160, 'short enough to answer on a phone');
  } finally {
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('every field with free text has a fallback follow-up worth asking', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    for (const field of INTERVIEW_FIELDS.filter((f) => f.kind === 'text')) {
      const question = await generateFollowup(field.key, 'anything');
      assert.equal(question.split('?').length, 2, `${field.key}: exactly one question`);
    }
  } finally {
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// Hygiene answers
// ---------------------------------------------------------------------------

test('a list of companies is split however the user happened to type it', () => {
  assert.deepEqual(splitCompanyList('FAB, ADCB and Emaar'), ['FAB', 'ADCB', 'Emaar']);
  assert.deepEqual(splitCompanyList('Emirates NBD; du\nEtihad'), ['Emirates NBD', 'du', 'Etihad']);
  assert.deepEqual(splitCompanyList(''), []);
  assert.deepEqual(splitCompanyList('   '), []);
});

// ---------------------------------------------------------------------------
// The CV
// ---------------------------------------------------------------------------

test('characters the built-in font cannot draw are reported, not silently dropped', () => {
  // An Emirati user may well type their name in Arabic. Producing a PDF full of
  // blanks and calling it their CV is worse than saying so.
  assert.deepEqual(unencodableCharacters('Mohammed Al Shamsi'), []);
  assert.ok(unencodableCharacters('محمد الشامسي').length > 0);
});

test('the generated CV is a real PDF built only from answered fields', async () => {
  const { getDb } = await import('../lib/db/client');
  const { currentUser } = await import('../lib/user');
  const { saveAnswer } = await import('../lib/profile');
  const { generateCv } = await import('../lib/cv');

  await getDb();
  const user = await currentUser();
  await saveAnswer(user.id, 'education', 'Zayed University, BSc Finance, graduating June 2027');
  await saveAnswer(
    user.id,
    'credibility_marker',
    'Two months on the operations desk at Emirates NBD over summer 2026'
  );

  const cv = await generateCv(user.id, 'Sara Al Marzooqi');
  const header = cv.pdf.subarray(0, 8).toString('latin1');
  assert.ok(header.startsWith('%PDF-'), `expected a PDF header, got ${header}`);
  assert.ok(cv.pdf.subarray(-8).toString('latin1').includes('%%EOF'));
  assert.ok(cv.plainText.includes('Sara Al Marzooqi'));
  assert.ok(cv.plainText.includes('Zayed University'));
  assert.equal(cv.unencodable.length, 0);

  // Nothing invented: a section the user never answered does not appear.
  assert.equal(cv.plainText.includes('Looking for'), false);
});

test('a thin answer never reaches the CV as a claim', async () => {
  const { currentUser } = await import('../lib/user');
  const { saveAnswer } = await import('../lib/profile');
  const { generateCv } = await import('../lib/cv');

  const user = await currentUser();
  await saveAnswer(user.id, 'credibility_marker', 'im hardworking');
  const cv = await generateCv(user.id, 'Sara Al Marzooqi');
  assert.equal(
    cv.plainText.includes('hardworking'),
    false,
    'a claim we could not confirm is left out rather than printed'
  );
});
