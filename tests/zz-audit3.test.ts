/** Scratch audit repro 3: a follow-up due on a Friday. */
import { test, before, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-audit3-'));
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

test('G: touch 2 due on Friday 7 Aug — is it ever sendable?', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { buildQueue } = await import('../lib/queue');
  const { execute, queryOne, query } = await import('../lib/db/client');
  const { currentUser } = await import('../lib/user');
  await world();
  await execute(
    `INSERT INTO person (id, company_id, ladder_rank, full_name_raw, phonetic_key, contact_type,
                         source_tier, email, email_status, status, created_at, updated_at)
     VALUES ('per_g','cmp_c',1,'Person G','key g','hr',2,'g@bank.ae','verified','in_sequence',?,?)`,
    [AT, AT]
  );
  // Touch 1 sent Monday 3 Aug 2026. Sweep will create touch 2 due Fri 7 Aug.
  await execute(
    `INSERT INTO outreach (id, person_id, user_id, step, status, subject, body, sent_date_uae, sent_at,
                           gmail_thread_id, references_chain, created_at, updated_at)
     VALUES ('o_g1','per_g','usr_c',1,'sent','Subj','body','2026-08-03','2026-08-03T06:00:00.000Z','t1','[]',?,?)`,
    [AT, AT]
  );

  const days = [
    '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', // Tue..Fri
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', // Mon..Thu
    '2026-08-17', '2026-08-18',
  ];
  for (const d of days) {
    const now = new Date(`${d}T06:00:00.000Z`);
    await sweep(await currentUser(), { now, poll: false, predraft: false });
    // pretend the cron pre-drafted it once it exists
    await execute(
      `UPDATE outreach SET status = 'drafted', body = 'since my note on Monday'
        WHERE person_id='per_g' AND step=2 AND status='queued'`
    );
    const row = await queryOne<{ scheduled_date: string; status: string }>(
      `SELECT scheduled_date, status FROM outreach WHERE person_id='per_g' AND step=2`
    );
    const q = await buildQueue(await currentUser(), now);
    console.log(
      `${d}  scheduled=${row?.scheduled_date ?? '-'} status=${row?.status ?? '-'}  offered=${q.followUps.length} sendable=${q.followUps.map((f) => f.sendable).join(',')}`
    );
  }
  console.log(await query(`SELECT id, step, status, scheduled_date FROM outreach`));
});
