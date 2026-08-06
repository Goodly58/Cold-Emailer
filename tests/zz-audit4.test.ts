/** Scratch audit repro 4. */
import { test, before, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-audit4-'));
  process.env.DB_PATH = join(dir, 'test.db');
});
after(async () => {
  const { closeDb } = await import('../lib/db/client');
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const AT = '2026-08-06T06:00:00.000Z';

async function db() {
  const { getDb } = await import('../lib/db/client');
  return getDb();
}

async function world() {
  const d = await db();
  await d.executeMultiple(`
    DELETE FROM calendar_window; DELETE FROM reply_draft; DELETE FROM org_group_link;
    DELETE FROM next_action; DELETE FROM thread_poll; DELETE FROM inbound;
    DELETE FROM contact_ledger; DELETE FROM outreach; DELETE FROM person_source;
    DELETE FROM ladder_slot; DELETE FROM person; DELETE FROM user_company_state;
    DELETE FROM suppression; DELETE FROM company; DELETE FROM org_group;
    DELETE FROM app_user; DELETE FROM event_log;
    INSERT INTO app_user (id, name, connection_state, last_successful_poll_at,
                          gmail_address, send_as_email, onboarding_step, created_at, updated_at)
      VALUES ('usr_c', 'Sara', 'connected', '${AT}', 'sara@example.com', 'sara@example.com', 'done', '${AT}', '${AT}');
    INSERT INTO org_group (id, normalized_domain, created_at)
      VALUES ('org_a', 'emiratesnbd.com', '${AT}'), ('org_b', 'endbcapital.com', '${AT}');
    INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
      VALUES ('cmp_a', 'org_a', 'Emirates NBD', 'emiratesnbd.com', '${AT}', '${AT}'),
             ('cmp_b', 'org_b', 'Emirates NBD Capital', 'endbcapital.com', '${AT}', '${AT}');
  `);
  return d;
}

async function person(id: string, companyId: string, o: Record<string, string | number | null> = {}) {
  const d = await db();
  await d.execute({
    sql: `INSERT INTO person (id, company_id, ladder_rank, full_name_raw, phonetic_key, contact_type,
                              source_tier, anchor_source_url, corroborating_source_count, freshness_date,
                              email, email_status, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'hr', 2, ?, ?, ?, ?, 'verified', ?, ?, ?)`,
    args: [id, companyId, (o.ladder_rank as number) ?? 1, `Person ${id}`, `key ${id}`,
      (o.anchor as string) ?? 'https://x/anchor', (o.sources as number) ?? 2,
      (o.freshness as string) ?? '2026-08-01',
      `${id}@x.ae`, (o.status as string) ?? 'ready', AT, AT],
  });
}

async function user() {
  const { currentUser } = await import('../lib/user');
  return currentUser();
}

test('H: linked org groups are never detected as a live-sequence conflict', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { linkOrgGroups } = await import('../lib/org');
  const { execute, query } = await import('../lib/db/client');
  await world();
  await linkOrgGroups('org_a', 'org_b', 'same employer');
  await person('per_h1', 'cmp_a', { status: 'in_sequence' });
  await person('per_h2', 'cmp_b', { status: 'in_sequence' });
  await execute(
    `INSERT INTO outreach (id, person_id, user_id, step, status, sent_date_uae, sent_at, references_chain, created_at, updated_at)
     VALUES ('o_h1','per_h1','usr_c',1,'sent','2026-08-03','2026-08-03T06:00:00.000Z','[]',?,?),
            ('o_h2','per_h2','usr_c',1,'sent','2026-08-04','2026-08-04T06:00:00.000Z','[]',?,?)`,
    [AT, AT, AT, AT]
  );
  const r = await sweep(await user(), { now: new Date('2026-08-06T06:00:00.000Z'), poll: false, predraft: false });
  console.log('invariantsFixed =', r.invariantsFixed, 'advanced =', r.advanced);
  console.log(await query('SELECT person_id, step, status, scheduled_date FROM outreach ORDER BY person_id, step'));
});

test('I: a follow-up is turned into an unanswerable needs_fact card and stalls everything', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute, query } = await import('../lib/db/client');
  await world();
  // Sourced with a single source dated 2026-04-01. Fresh when touch 1 went out
  // (2026-06-25, day 85); stale by the time touch 3 comes due.
  await person('per_i1', 'cmp_a', { status: 'in_sequence', sources: 1, freshness: '2026-04-01' });
  await person('per_i2', 'cmp_a', { ladder_rank: 2 });
  await execute(
    `INSERT INTO outreach (id, person_id, user_id, step, status, sent_date_uae, sent_at, references_chain, created_at, updated_at)
     VALUES ('o_i1','per_i1','usr_c',1,'sent','2026-06-25','2026-06-25T06:00:00.000Z','[]',?,?),
            ('o_i2','per_i1','usr_c',2,'sent','2026-07-01','2026-07-01T06:00:00.000Z','[]',?,?)`,
    [AT, AT, AT, AT]
  );
  // Touch 3 comes due; the sweep pre-drafts it.
  const now = new Date('2026-07-16T06:00:00.000Z');
  const r = await sweep(await user(), { now, poll: false, predraft: true });
  console.log('advanced', r.advanced, 'refused', r.refused, 'predrafted', r.predrafted);
  console.log(await query('SELECT person_id, step, status, substr(body,1,70) AS body FROM outreach ORDER BY step'));

  // Months later: does anything ever recover it, or rotate the ladder?
  for (const d of ['2026-08-06', '2026-09-06', '2026-10-06']) {
    await sweep(await user(), { now: new Date(`${d}T06:00:00.000Z`), poll: false, predraft: true });
  }
  console.log('final outreach:', await query('SELECT person_id, step, status FROM outreach ORDER BY person_id, step'));
  console.log('final people:', await query('SELECT id, status FROM person ORDER BY id'));
});
