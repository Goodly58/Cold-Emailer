import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { nextActions, type ActionState } from '../lib/next-actions';
import { opportunity } from '../lib/pay';
import { setAiClientForTests, type AiClient } from '../lib/ai';
import type { Application, Profile } from '../lib/types';

const profile: Profile = { name: 'A', headline: '', phone: '', linkedinUrl: '', targetTitles: 'data analyst', educationLevel: 'bachelor', cvWords: 500 };
const base = (over: Partial<ActionState> = {}): ActionState => ({
  profile,
  hasCv: true,
  applications: [],
  companies: [],
  contacts: [],
  outreach: [],
  jobSources: [{ id: 's', companyName: 'Acme', platform: 'greenhouse', slug: 'acme', enabled: true, createdAt: '' }],
  events: [],
  today: '2026-09-24',
  ...over,
});
const role = (over: Partial<Application>): Application => ({
  id: 'a1', companyName: 'Acme', roleTitle: 'Data Analyst', stage: 'found', score: 90, createdAt: '2026-09-22T00:00:00Z', postedAt: '2026-09-22', ...over,
});

test('foundations come first when missing', () => {
  const ids = nextActions(base({ hasCv: false, jobSources: [], profile: { ...profile, targetTitles: '' } })).map((a) => a.id);
  assert.deepEqual(ids.slice(0, 3), ['cv', 'targets', 'sources']);
});

test('a fresh strong role and an interview get surfaced', () => {
  const actions = nextActions(
    base({
      companies: [{ id: 'c', name: 'Acme', sector: 'Technology', location: 'Dubai', tier: 'dream', emiratisation: true, createdAt: '' }],
      applications: [role({}), role({ id: 'a2', stage: 'interview', roleTitle: 'BI Analyst' })],
    })
  );
  const ids = actions.map((a) => a.id);
  assert.ok(ids.includes('apply-a1'));
  assert.equal(ids[0], 'prep-a2', 'an interview outranks everything else that is set up');
  assert.match(actions.find((a) => a.id === 'apply-a1')!.href, /\/pipeline\?open=a1/);
});

test('applied without outreach suggests emailing someone there, with the contact prefilled', () => {
  const actions = nextActions(
    base({
      applications: [role({ stage: 'applied' })],
      contacts: [{ id: 'k', companyName: 'Acme', name: 'Sara', role: 'TA Lead', email: 'sara@acme.ae', status: 'identified', createdAt: '' }],
    })
  );
  const nudge = actions.find((a) => a.id === 'nudge-a1')!;
  assert.match(nudge.href, /contactId=k/);
  assert.match(nudge.href, /applicationId=a1/);

  const after = nextActions(
    base({
      applications: [role({ stage: 'applied' })],
      outreach: [{ id: 'o', toName: 'Sara', companyName: 'Acme', subject: 's', body: 'b', status: 'sent', followUps: 0, createdAt: '' }],
    })
  );
  assert.equal(after.some((a) => a.id === 'nudge-a1'), false, 'gone once you have emailed them');
});

test('an AI fit check moves the ranking', () => {
  const r = role({ score: 50 });
  const before = opportunity(r, profile, undefined, '2026-09-24');
  const good = opportunity({ ...r, aiFit: 95 }, profile, undefined, '2026-09-24');
  const poor = opportunity({ ...r, aiFit: 10 }, profile, undefined, '2026-09-24');
  assert.ok(good.score > before.score && before.score > poor.score);
  assert.match(good.parts[0].label, /CV/);
});

test('the fit route saves its result and the score onto the role', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fit-'));
  const file = path.join(dir, 'db.json');
  await fs.writeFile(file, JSON.stringify({
    profile, companies: [], contacts: [], outreach: [], templates: [], jobSources: [], runs: [], events: [],
    applications: [role({ hasDescription: true })],
  }));
  process.env.DB_PATH = file;
  const { putBlob } = await import('../lib/store');
  await putBlob('jd:a1', 'We need SQL, Python and stakeholder reporting.');
  await putBlob('cv:text', 'Data analyst. SQL, Python.');

  let sent = '';
  setAiClientForTests({
    beta: {
      messages: {
        parse: async (p: { messages: Array<{ content: string }> }) => {
          sent = p.messages[0].content;
          return {
            stop_reason: 'end_turn',
            model: 'claude-opus-5',
            usage: { input_tokens: 3000, output_tokens: 1500 },
            parsed_output: {
              fitScore: 140, verdict: 'strong', summary: 's', matches: [], gaps: [],
              tailoredBullets: ['Built SQL reports'], keywords: ['SQL'], coverLetter: 'c', applyAdvice: 'a',
            },
          };
        },
      },
    },
  } as unknown as AiClient);

  try {
    const { POST, GET } = await import('../app/api/ai/role/route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ applicationId: 'a1', kind: 'fit' }) }) as never);
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.result.fitScore, 100, 'scores are clamped to 0-100');
    assert.equal(out.application.aiFit, 100);
    assert.match(sent, /<job_description>[\s\S]*stakeholder reporting/);
    assert.match(sent, /<cv>[\s\S]*SQL, Python/);

    const { NextRequest } = await import('next/server');
    const cached = await (await GET(new NextRequest('http://x/api/ai/role?applicationId=a1&kind=fit'))).json();
    assert.deepEqual(cached.result.tailoredBullets, ['Built SQL reports']);

    const missing = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ applicationId: 'nope', kind: 'fit' }) }) as never);
    assert.equal(missing.status, 404);
  } finally {
    setAiClientForTests(null);
  }
});
