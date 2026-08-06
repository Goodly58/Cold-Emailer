import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Integration tests for the scraper's refresh cycle, against the file
 * backend with a stubbed job board. These cover the behaviours that would
 * silently corrupt the pipeline if they regressed: duplicate imports,
 * losing an application you'd already made, and failures going unrecorded.
 */

interface GhJob {
  title: string;
  location: { name: string };
  absolute_url: string;
  departments?: Array<{ name: string }>;
}

const realFetch = globalThis.fetch;
let board: GhJob[] = [];
let failWith: number | null = null;

function stubBoard() {
  globalThis.fetch = (async () => {
    if (failWith) return new Response('', { status: failWith });
    return new Response(JSON.stringify({ jobs: board }), { status: 200 });
  }) as typeof fetch;
}

async function freshDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobsearch-test-'));
  const file = path.join(dir, 'db.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      profile: { name: '', headline: '', phone: '', linkedinUrl: '' },
      companies: [],
      contacts: [],
      applications: [],
      outreach: [],
      templates: [],
      jobSources: [
        {
          id: 's1',
          companyName: 'Acme',
          platform: 'greenhouse',
          slug: 'acme',
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      runs: [],
    })
  );
  process.env.DB_PATH = file;
  return file;
}

/**
 * A single module instance shared with the code under test — refresh.ts
 * imports store.ts directly, so re-importing under a cache-busting query
 * would give the test a *different* store than the one being exercised.
 * Isolation comes from a fresh DB_PATH per test instead.
 */
async function load() {
  const { refreshAllSources } = await import('../lib/refresh');
  const { readDb } = await import('../lib/store');
  return { refreshAllSources, readDb };
}

test.beforeEach(async () => {
  board = [
    { title: 'Data Analyst', location: { name: 'Dubai, UAE' }, absolute_url: 'https://x.co/1', departments: [{ name: 'Technology' }] },
    { title: 'Risk Manager', location: { name: 'London, UK' }, absolute_url: 'https://x.co/2' },
  ];
  failWith = null;
  stubBoard();
  await freshDb();
});

test.after(() => {
  globalThis.fetch = realFetch;
});

test('imports open roles and tags UAE ones', async () => {
  const { refreshAllSources, readDb } = await load();
  const report = await refreshAllSources({ trigger: 'cron' });

  assert.equal(report.added, 2);
  assert.equal(report.failed, 0);

  const db = await readDb();
  const dubai = db.applications.find((a: { jobUrl?: string }) => a.jobUrl === 'https://x.co/1');
  const london = db.applications.find((a: { jobUrl?: string }) => a.jobUrl === 'https://x.co/2');

  assert.equal(dubai.emiratiAngle, true, 'a Dubai role should carry the Emirati angle');
  assert.equal(london.emiratiAngle, false);
  assert.equal(dubai.division, 'Technology', 'department should become the division');
  assert.equal(dubai.isNew, true);
  assert.equal(typeof dubai.score, 'number');
});

test('re-running does not duplicate, even when URLs gain tracking params', async () => {
  const { refreshAllSources, readDb } = await load();
  await refreshAllSources();

  board = [
    { title: 'Data Analyst', location: { name: 'Dubai, UAE' }, absolute_url: 'https://x.co/1?utm_source=twitter' },
    { title: 'Risk Manager', location: { name: 'London, UK' }, absolute_url: 'https://x.co/2/' },
  ];
  const second = await refreshAllSources();

  assert.equal(second.added, 0, 'the same postings must not be imported twice');
  const db = await readDb();
  assert.equal(db.applications.length, 2);
});

test('propagates a title edited upstream', async () => {
  const { refreshAllSources, readDb } = await load();
  await refreshAllSources();

  board[0].title = 'Senior Data Analyst';
  const report = await refreshAllSources();

  assert.equal(report.added, 0);
  assert.ok(report.updated >= 1);
  const db = await readDb();
  const role = db.applications.find((a: { jobUrl?: string }) => a.jobUrl === 'https://x.co/1');
  assert.equal(role.roleTitle, 'Senior Data Analyst');
});

test('marks vanished postings closed and reopens them if they return', async () => {
  const { refreshAllSources, readDb } = await load();
  await refreshAllSources();

  const removed = board[1];
  board = [board[0]];
  const closedRun = await refreshAllSources();
  assert.equal(closedRun.closed, 1);

  let db = await readDb();
  assert.equal(db.applications.find((a: { jobUrl?: string }) => a.jobUrl === 'https://x.co/2').closed, true);

  board = [board[0], removed];
  await refreshAllSources();
  db = await readDb();
  assert.equal(db.applications.find((a: { jobUrl?: string }) => a.jobUrl === 'https://x.co/2').closed, false);
});

test('never auto-closes a role you have already applied to', async () => {
  // The costly regression: losing track of a live application because the
  // company took the public posting down after you applied.
  const { refreshAllSources, readDb } = await load();
  await refreshAllSources();

  const file = process.env.DB_PATH!;
  const db = JSON.parse(await fs.readFile(file, 'utf8'));
  const target = db.applications.find((a: { jobUrl?: string }) => a.jobUrl === 'https://x.co/2');
  target.stage = 'applied';
  await fs.writeFile(file, JSON.stringify(db));

  board = [board[0]];
  await refreshAllSources();

  const after = await readDb();
  const applied = after.applications.find((a: { jobUrl?: string }) => a.jobUrl === 'https://x.co/2');
  assert.equal(applied.stage, 'applied');
  assert.ok(!applied.closed, 'an applied role must survive disappearing from the board');
});

test('records a source failure instead of throwing', async () => {
  const { refreshAllSources, readDb } = await load();
  failWith = 404;

  const report = await refreshAllSources();
  assert.equal(report.failed, 1);
  assert.equal(report.added, 0);

  const db = await readDb();
  assert.equal(db.jobSources[0].consecutiveFailures, 1);
  assert.match(db.jobSources[0].lastError, /404/);
});

test('clears the failure counter once a source recovers', async () => {
  const { refreshAllSources, readDb } = await load();
  failWith = 500;
  await refreshAllSources();
  failWith = null;
  await refreshAllSources();

  const db = await readDb();
  assert.equal(db.jobSources[0].consecutiveFailures, 0);
  assert.equal(db.jobSources[0].lastError, undefined);
});

test('writes a run-history entry per execution', async () => {
  const { refreshAllSources, readDb } = await load();
  await refreshAllSources({ trigger: 'cron' });
  await refreshAllSources({ trigger: 'manual' });

  const db = await readDb();
  assert.equal(db.runs.length, 2);
  assert.equal(db.runs[0].trigger, 'manual', 'newest run first');
  assert.equal(typeof db.runs[0].durationMs, 'number');
});

test('applies a per-source keyword filter', async () => {
  const file = process.env.DB_PATH!;
  const db = JSON.parse(await fs.readFile(file, 'utf8'));
  db.jobSources[0].keywords = 'dubai';
  await fs.writeFile(file, JSON.stringify(db));

  const { refreshAllSources } = await load();
  const report = await refreshAllSources();
  assert.equal(report.added, 1, 'only the Dubai role should pass the filter');
});

test('respects the time budget and leaves stale sources for the next run', async () => {
  // Two sources, a budget of zero: nothing should be fetched, and crucially
  // no source state should be touched, so the next run still sees them stale.
  const file = process.env.DB_PATH!;
  const db = JSON.parse(await fs.readFile(file, 'utf8'));
  db.jobSources.push({
    id: 's2',
    companyName: 'Beta',
    platform: 'greenhouse',
    slug: 'beta',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
  });
  await fs.writeFile(file, JSON.stringify(db));

  const { refreshAllSources, readDb } = await load();
  const report = await refreshAllSources({ budgetMs: 0 });

  assert.equal(report.skipped, 2);
  assert.equal(report.checked, 0);
  assert.equal(report.added, 0);

  const after = await readDb();
  for (const s of after.jobSources) {
    assert.equal(s.lastCheckedAt, undefined, 'a skipped source must stay unchecked');
  }
});

test('checks the stalest source first when the budget is tight', async () => {
  const file = process.env.DB_PATH!;
  const db = JSON.parse(await fs.readFile(file, 'utf8'));
  db.jobSources[0].lastCheckedAt = '2026-08-01T00:00:00Z'; // recently checked
  db.jobSources.push({
    id: 's2',
    companyName: 'Beta',
    platform: 'greenhouse',
    slug: 'beta',
    enabled: true,
    lastCheckedAt: '2026-01-01T00:00:00Z', // long overdue
    createdAt: '2026-01-01T00:00:00Z',
  });
  await fs.writeFile(file, JSON.stringify(db));

  const { refreshAllSources, readDb } = await load();
  await refreshAllSources();

  const after = await readDb();
  const beta = after.jobSources.find((s: { id: string }) => s.id === 's2');
  assert.notEqual(beta.lastCheckedAt, '2026-01-01T00:00:00Z', 'the overdue source should have run');
});
