import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { addWorkdays, lintEmail, nextFollowUp, sendTimeHint, sentToday, statsByTemplate, wentQuiet } from '../lib/outreach';
import { setAiClientForTests, type AiClient } from '../lib/ai';
import type { Outreach } from '../lib/types';

/* ------------------------------------------------------------ schedule */

test('follow-ups land on UAE working days (Mon–Fri)', () => {
  // Thu 24 Sep 2026 + 3 working days = Tue 29 Sep (skipping Sat and Sun).
  assert.equal(addWorkdays('2026-09-24', 3), '2026-09-29');
  // Fri + 1 = Mon.
  assert.equal(addWorkdays('2026-09-25', 1), '2026-09-28');
  assert.equal(nextFollowUp('2026-09-24', 0), '2026-09-29');
  assert.equal(nextFollowUp('2026-09-29', 1), '2026-10-06');
  assert.equal(nextFollowUp('2026-10-06', 2), undefined, 'two follow-ups, then stop');
});

test('a thread goes quiet a week after the last follow-up', () => {
  const o = { status: 'sent', followUps: 2, lastFollowUpAt: '2026-09-01', sentAt: '2026-08-20' } as Outreach;
  assert.equal(wentQuiet(o, '2026-09-10'), true);
  assert.equal(wentQuiet({ ...o, lastFollowUpAt: '2026-09-09' }, '2026-09-10'), false);
  assert.equal(wentQuiet({ ...o, followUps: 1, nextFollowUpAt: '2026-09-12' }, '2026-09-20'), false);
});

test('send-time hints follow UAE hours', () => {
  // Saturday 10:00 GST = 06:00 UTC.
  assert.match(sendTimeHint(new Date('2026-09-26T06:00:00Z'))!, /weekend/);
  // Tuesday 09:00 GST: a good time, no hint.
  assert.equal(sendTimeHint(new Date('2026-09-29T05:00:00Z')), undefined);
  // Tuesday 23:00 GST.
  assert.match(sendTimeHint(new Date('2026-09-29T19:00:00Z'))!, /outside UAE working hours/);
});

/* --------------------------------------------------------------- checks */

const good = {
  toEmail: 'sara.almansoori@acme.ae',
  toName: 'Sara Al Mansoori',
  companyName: 'Acme',
  subject: 'Data analyst — a note from an Emirati candidate',
  body: 'Hi Sara,\n\nI saw Acme is expanding its data team in Abu Dhabi after the ADGM licence, and wanted to reach out directly. At my last role I built the dashboards our risk team used every day, cutting reporting time by a third. I am a UAE National with three years in analytics, SQL and Python.\n\nWould you have 15 minutes next week, or could you point me to the right person?\n\nBest,\nAhmed',
};

test('a clean, specific email passes', () => {
  assert.deepEqual(lintEmail(good), []);
});

test('unfilled placeholders and a missing address block sending', () => {
  const issues = lintEmail({ ...good, toEmail: '', body: good.body.replace('Sara', '[first name]') + '\n{{hook}}' });
  const errors = issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | ');
  assert.match(errors, /\[first name\]/);
  assert.match(errors, /\{\{hook\}\}/);
  assert.match(errors, /No recipient/);
});

test('warnings catch the generic and the risky', () => {
  const msgs = lintEmail({
    ...good,
    subject: 'URGENT OPPORTUNITY!!',
    body: 'To whom it may concern, please find my CV attached. Act now! Great! Thanks! https://a.co https://b.co https://c.co',
    contact: { emailStatus: 'guessed' },
  }).map((i) => i.message).join(' | ');
  assert.match(msgs, /shouting/);
  assert.match(msgs, /Exclamation/);
  assert.match(msgs, /spam filters/);
  assert.match(msgs, /attach your CV/);
  assert.match(msgs, /3 links/);
  assert.match(msgs, /pattern guess/);
  assert.match(msgs, /never mentions Acme/);
  assert.match(msgs, /doesn't use their name/);
});

test('a second first-email to the same address is flagged', () => {
  const history = [{ toEmail: 'SARA.almansoori@acme.ae', status: 'sent', sentAt: '2026-09-01' } as Outreach];
  const msgs = lintEmail({ ...good, history }).map((i) => i.message).join(' ');
  assert.match(msgs, /already emailed/);
  assert.equal(lintEmail({ ...good, history, isFollowUp: true }).length, 0, 'a follow-up is expected');
});

test('reply rate per template counts only sent email', () => {
  const o = (templateId: string, status: Outreach['status']) => ({ templateId, status }) as Outreach;
  const s = statsByTemplate([o('t1', 'sent'), o('t1', 'replied'), o('t1', 'draft'), o('t2', 'no-reply')]);
  assert.deepEqual(s.get('t1'), { sent: 2, replied: 1, rate: 50 });
  assert.deepEqual(s.get('t2'), { sent: 1, replied: 0, rate: 0 });
  assert.equal(sentToday([{ sentAt: '2026-09-24' } as Outreach, { sentAt: '2026-09-20', lastFollowUpAt: '2026-09-24' } as Outreach], '2026-09-24'), 2);
});

/* ------------------------------------------------------------ the route */

async function freshDb() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'outreach-'));
  const file = path.join(dir, 'db.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      profile: { name: 'Ahmed', headline: 'Data analyst', phone: '', linkedinUrl: '' },
      companies: [{ id: 'c1', name: 'Acme', sector: 'Technology', location: 'Dubai', tier: 'target', emiratisation: true, createdAt: '' }],
      contacts: [{ id: 'k1', companyName: 'Acme', name: 'Sara Al Mansoori', role: 'Head of Data', status: 'identified', createdAt: '' }],
      applications: [], outreach: [], templates: [], jobSources: [], runs: [], events: [],
    })
  );
  process.env.DB_PATH = file;
}

const post = (body: unknown) =>
  new Request('http://x/api/outreach-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;

test('logging a send schedules the follow-up and marks the contact emailed; a reply stops it', async () => {
  await freshDb();
  const { POST } = await import('../app/api/outreach-log/route');
  const { readDb } = await import('../lib/store');

  const res = await POST(post({ action: 'send', today: new Date().toISOString().slice(0, 10), toName: 'Sara', subject: 'Hi', body: 'x', contactId: 'k1', templateId: 't1' }));
  assert.equal(res.status, 201);
  const sent = await res.json();
  assert.equal(sent.status, 'sent');
  assert.equal(sent.nextFollowUpAt, addWorkdays(sent.sentAt, 3));
  assert.equal((await readDb()).contacts[0].status, 'emailed');

  const fu = await (await POST(post({ action: 'followup', id: sent.id, today: sent.sentAt }))).json();
  assert.equal(fu.followUps, 1);
  assert.equal(fu.nextFollowUpAt, addWorkdays(sent.sentAt, 5));

  const replied = await (await POST(post({ action: 'status', id: sent.id, status: 'replied' }))).json();
  assert.equal(replied.status, 'replied');
  assert.equal(replied.nextFollowUpAt, undefined);
  assert.equal((await readDb()).contacts[0].status, 'replied');

  // A later status change never walks the contact backwards.
  await POST(post({ action: 'status', id: sent.id, status: 'sent' }));
  assert.equal((await readDb()).contacts[0].status, 'replied');

  assert.equal((await POST(post({ action: 'status', id: sent.id, status: 'bogus' }))).status, 400);
  assert.equal((await POST(post({ action: 'followup', id: 'missing' }))).status, 404);
});

test('a date far from the server clock is not trusted', async () => {
  await freshDb();
  const { POST } = await import('../app/api/outreach-log/route');
  const r = await (await POST(post({ action: 'send', today: '2020-01-01', toName: 'Sara', subject: 'Hi' }))).json();
  assert.notEqual(r.sentAt, '2020-01-01');
});

/* ------------------------------------------------------------- AI draft */

test('AI drafting sends the CV, company and contact research as tagged context', async () => {
  await freshDb();
  const { putBlob } = await import('../lib/store');
  await putBlob('cv:text', 'Ahmed. Data analyst at Emirates NBD, 2023–2026. Built risk dashboards.');

  const calls: Array<Record<string, unknown>> = [];
  setAiClientForTests({
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            stop_reason: 'end_turn',
            model: 'claude-opus-5',
            usage: { input_tokens: 2000, output_tokens: 400 },
            parsed_output: { subject: 'Data at Acme', body: 'Hi Sara, …', missing: [], rationale: 'Led with her team.' },
          };
        },
      },
    },
  } as unknown as AiClient);

  try {
    const { POST } = await import('../app/api/ai/draft/route');
    const res = await POST(
      new Request('http://x/api/ai/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'draft', contactId: 'k1', companyName: 'Acme', role: 'Data Analyst' }),
      }) as never
    );
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.subject, 'Data at Acme');
    assert.equal(out.usedCv, true);

    const content = String((calls[0].messages as Array<{ content: string }>)[0].content);
    assert.match(content, /<cv>[\s\S]*Emirates NBD/);
    assert.match(content, /<recipient>[\s\S]*Head of Data/);
    assert.match(content, /<company>[\s\S]*Emiratisation-liable: yes/);
    assert.match(String(calls[0].system), /Never invent/);

    const bad = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ mode: 'nope' }) }) as never);
    assert.equal(bad.status, 400);
  } finally {
    setAiClientForTests(null);
  }
});
