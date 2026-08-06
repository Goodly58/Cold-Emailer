/** Scratch audit repro — not part of the suite. */
import { test, before, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-audit-'));
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
    DELETE FROM calendar_window; DELETE FROM reply_draft;
    DELETE FROM next_action; DELETE FROM thread_poll; DELETE FROM inbound;
    DELETE FROM contact_ledger; DELETE FROM outreach; DELETE FROM person_source;
    DELETE FROM ladder_slot; DELETE FROM person; DELETE FROM user_company_state;
    DELETE FROM suppression; DELETE FROM company; DELETE FROM org_group;
    DELETE FROM app_user; DELETE FROM event_log;
    INSERT INTO app_user (id, name, connection_state, last_successful_poll_at,
                          gmail_address, send_as_email, onboarding_step, created_at, updated_at)
      VALUES ('usr_c', 'Sara', 'connected', '${AT}', 'sara@example.com', 'sara@example.com', 'done', '${AT}', '${AT}');
    INSERT INTO org_group (id, normalized_domain, created_at) VALUES ('org_c', 'bank.ae', '${AT}');
    INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
      VALUES ('cmp_c', 'org_c', 'Alpha Bank', 'bank.ae', '${AT}', '${AT}');
  `);
  return d;
}

async function person(id: string, o: Record<string, string | number> = {}) {
  const d = await db();
  await d.execute({
    sql: `INSERT INTO person (id, company_id, ladder_rank, full_name_raw, phonetic_key, contact_type,
                              source_tier, email, email_status, status, created_at, updated_at)
          VALUES (?, 'cmp_c', ?, ?, ?, ?, 2, ?, 'verified', ?, ?, ?)`,
    args: [id, (o.ladder_rank as number) ?? 1, `Person ${id}`, `key ${id}`,
      (o.contact_type as string) ?? 'hr', `${id}@bank.ae`, (o.status as string) ?? 'ready', AT, AT],
  });
}

async function outreach(seed: any) {
  const d = await db();
  await d.execute({
    sql: `INSERT INTO outreach (id, person_id, user_id, step, status, subject, body,
                                sent_date_uae, sent_at, scheduled_date, due_working_days,
                                gmail_thread_id, references_chain, created_at, updated_at)
          VALUES (?, ?, 'usr_c', ?, ?, 'Subj', 'body', ?, ?, ?, ?, ?, '[]', ?, ?)`,
    args: [seed.id, seed.personId, seed.step, seed.status, seed.sentDate ?? null,
      seed.sentDate ? `${seed.sentDate}T06:00:00.000Z` : null, seed.scheduled ?? null,
      seed.dueWorkingDays ?? null, seed.threadId ?? null, AT, AT],
  });
}

async function user() {
  const { currentUser } = await import('../lib/user');
  return currentUser();
}

test('A: overdue follow-up after an outage — does it ever become due?', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { queryOne } = await import('../lib/db/client');
  const { buildQueue } = await import('../lib/queue');
  await world();
  await person('per_a', { status: 'in_sequence' });
  // touch 1 sent 3 Aug; step 2 due 7 Aug (+4 working days). User disappears.
  await outreach({ id: 'o_a1', personId: 'per_a', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'o_a2', personId: 'per_a', step: 2, status: 'drafted', scheduled: '2026-08-07', dueWorkingDays: 4, threadId: 't1' });

  // Comes back 20 August. Sweep runs (as it does on every queue open).
  for (const d of ['2026-08-20', '2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26']) {
    await sweep(await user(), { now: new Date(`${d}T06:00:00.000Z`), poll: false, predraft: false });
    const row = await queryOne<{ scheduled_date: string; status: string }>(
      'SELECT scheduled_date, status FROM outreach WHERE id = ?', ['o_a2']);
    const q = await buildQueue(await user(), new Date(`${d}T06:00:00.000Z`));
    console.log(`today=${d} scheduled=${row!.scheduled_date} status=${row!.status} followUpsOffered=${q.followUps.length}`);
  }
});

test('B: a halted step-3 draft stalls the person and the ladder forever', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { query } = await import('../lib/db/client');
  await world();
  await person('per_b1', { status: 'in_sequence' });
  await person('per_b2', { ladder_rank: 2 });
  await outreach({ id: 'o_b1', personId: 'per_b1', step: 1, status: 'sent', sentDate: '2026-07-01', threadId: 't1' });
  await outreach({ id: 'o_b2', personId: 'per_b1', step: 2, status: 'sent', sentDate: '2026-07-08', threadId: 't1' });
  // step 3 was created then the generator halted -> closed
  await outreach({ id: 'o_b3', personId: 'per_b1', step: 3, status: 'closed' });

  const r = await sweep(await user(), { now: new Date('2026-09-30T06:00:00.000Z'), poll: false, predraft: false });
  console.log('rotated', r.rotated, 'advanced', r.advanced);
  console.log(await query('SELECT id, status FROM person ORDER BY id'));
  console.log(await query('SELECT person_id, step, status FROM outreach ORDER BY person_id, step'));
});

test('C: gateway pause does not stop the sweep creating the next touch', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute, query } = await import('../lib/db/client');
  await world();
  await person('per_c1', { status: 'in_sequence' });
  await outreach({ id: 'o_c1', personId: 'per_c1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await execute(`UPDATE outreach SET countdown_paused = 1 WHERE id = 'o_c1'`);
  await execute(
    `INSERT INTO inbound (id, outreach_id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          classification, received_at, created_at)
     VALUES ('in_c', 'o_c1', 'per_c1', 't1', 'm_c', 'gw@bank.ae', 'gateway_challenge', ?, ?)`,
    ['2026-08-03T09:00:00.000Z', AT]
  );
  await sweep(await user(), { now: new Date('2026-08-06T06:00:00.000Z'), poll: false, predraft: false });
  console.log(await query('SELECT person_id, step, status, countdown_paused, scheduled_date FROM outreach ORDER BY step'));
});

test('D: org_group pause is never released', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute, query } = await import('../lib/db/client');
  await world();
  await execute(`INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
                 VALUES ('cmp_c2', 'org_c', 'Alpha Capital', 'alphacap.ae', ?, ?)`, [AT, AT]);
  await person('per_d1', { status: 'in_sequence' });
  await person('per_d2', { status: 'in_sequence' });
  await execute(`UPDATE person SET company_id = 'cmp_c2' WHERE id = 'per_d2'`);
  await person('per_d3', { ladder_rank: 2 });
  await outreach({ id: 'o_d1', personId: 'per_d1', step: 1, status: 'sent', sentDate: '2026-07-01', threadId: 't1' });
  await outreach({ id: 'o_d2', personId: 'per_d2', step: 1, status: 'drafted' });

  await sweep(await user(), { now: new Date('2026-08-06T06:00:00.000Z'), poll: false, predraft: false });
  console.log(await query('SELECT id, status FROM person ORDER BY id'));
  console.log(await query('SELECT person_id, step, status FROM outreach ORDER BY person_id'));
  // many sweeps later
  await sweep(await user(), { now: new Date('2026-10-06T06:00:00.000Z'), poll: false, predraft: false });
  console.log('after months:', await query('SELECT person_id, step, status FROM outreach ORDER BY person_id'));
  console.log('people:', await query('SELECT id, status FROM person ORDER BY id'));
});
