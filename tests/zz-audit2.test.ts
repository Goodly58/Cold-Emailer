/** Scratch audit repro 2. */
import { test, before, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-audit2-'));
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
      VALUES ('cmp_c', 'org_c', 'Emirates NBD', 'bank.ae', '${AT}', '${AT}'),
             ('cmp_c2', 'org_c', 'Emirates NBD Capital', 'nbdcap.ae', '${AT}', '${AT}');
  `);
  return d;
}

async function person(id: string, companyId: string, o: Record<string, string | number> = {}) {
  const d = await db();
  await d.execute({
    sql: `INSERT INTO person (id, company_id, ladder_rank, full_name_raw, phonetic_key, contact_type,
                              source_tier, email, email_status, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 2, ?, 'verified', ?, ?, ?)`,
    args: [id, companyId, (o.ladder_rank as number) ?? 1, `Person ${id}`, `key ${id}`,
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

test('E: gateway challenge arriving before the step-2 row exists pauses nothing', async () => {
  const { applyClassification } = await import('../lib/state-machine');
  const { sweep } = await import('../lib/scheduler');
  const { query, execute } = await import('../lib/db/client');
  await world();
  await person('per_e1', 'cmp_c', { status: 'in_sequence' });
  // Step 1 went out at 10:00 on Mon 3 Aug. No sweep has run since.
  await outreach({ id: 'o_e1', personId: 'per_e1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await execute(
    `INSERT INTO inbound (id, outreach_id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          classification, received_at, created_at)
     VALUES ('in_e', 'o_e1', 'per_e1', 't1', 'm_e', 'gw@bank.ae', 'gateway_challenge', ?, ?)`,
    ['2026-08-03T06:05:00.000Z', AT]
  );
  // The challenge classification lands (as the poller does inside the sweep).
  await applyClassification(
    { classification: 'gateway_challenge', note: 'quarantine', extracted: {} } as any,
    { userId: 'usr_c', personId: 'per_e1', companyId: 'cmp_c', outreachId: 'o_e1', inboundId: 'in_e',
      now: new Date('2026-08-03T06:05:00.000Z') } as any
  );
  console.log('after classification:', await query('SELECT id, step, status, countdown_paused, scheduled_date FROM outreach'));

  // ...then the same sweep advances.
  const r = await sweep(await user(), { now: new Date('2026-08-03T06:10:00.000Z'), poll: false, predraft: false });
  console.log('advanced', r.advanced, 'gatewayTimedOut', r.gatewayTimedOut);
  console.log('after sweep:', await query('SELECT id, step, status, countdown_paused, scheduled_date FROM outreach'));

  // Two weeks later: does the timeout ever fire?
  const r2 = await sweep(await user(), { now: new Date('2026-08-20T06:00:00.000Z'), poll: false, predraft: false });
  console.log('two weeks later gatewayTimedOut =', r2.gatewayTimedOut);
  console.log(await query('SELECT id, step, status, countdown_paused, scheduled_date FROM outreach'));
  console.log(await query('SELECT id, status FROM person'));
});

test('F: a positive reply at one company does not stop the sibling at the same org_group', async () => {
  const { applyClassification } = await import('../lib/state-machine');
  const { sweep } = await import('../lib/scheduler');
  const { buildQueue } = await import('../lib/queue');
  const { query } = await import('../lib/db/client');
  await world();
  await person('per_f1', 'cmp_c', { status: 'in_sequence' });   // Emirates NBD
  await person('per_f2', 'cmp_c2', { status: 'in_sequence' });  // Emirates NBD Capital
  await outreach({ id: 'o_f1', personId: 'per_f1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'o_f2', personId: 'per_f2', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't2' });
  await outreach({ id: 'o_f2b', personId: 'per_f2', step: 2, status: 'drafted', scheduled: '2026-08-07',
                   dueWorkingDays: 4, threadId: 't2' });

  // per_f1 replies positively: "come in Tuesday".
  await applyClassification(
    { classification: 'human_positive', note: 'yes', extracted: {} } as any,
    { userId: 'usr_c', personId: 'per_f1', companyId: 'cmp_c', outreachId: 'o_f1', inboundId: null,
      now: new Date('2026-08-06T06:00:00.000Z') } as any
  );
  console.log('company states:', await query('SELECT company_id, status FROM user_company_state'));
  console.log('outreach:', await query('SELECT id, person_id, status FROM outreach ORDER BY id'));

  await sweep(await user(), { now: new Date('2026-08-07T06:00:00.000Z'), poll: false, predraft: false });
  console.log('after sweep:', await query('SELECT id, person_id, status, scheduled_date FROM outreach ORDER BY id'));

  const q = await buildQueue(await user(), new Date('2026-08-10T06:00:00.000Z'));
  console.log('queue followUps:', q.followUps.map((f) => ({ id: f.outreachId, company: f.companyName, sendable: f.sendable, reason: f.blockedReason })));
  console.log('queue firstEmails:', q.firstEmails.length);
});
