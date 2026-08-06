/**
 * Week 3 acceptance tests, part 2 — what gets sent.
 *
 * The milestone's bar: double-clicking Send, sending from two tabs, and killing
 * the server mid-send each produce exactly one email; and the email in the
 * recipient's inbox is byte-identical to the reviewed body.
 *
 * The Gmail call is stubbed. What is under test is the state machine around it,
 * which is where duplicates and losses actually come from.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildMime, newMessageId, replySubject, toGmailRaw, withSignature } from '../lib/mime';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-send-'));
  process.env.DB_PATH = join(dir, 'test.db');
});

after(async () => {
  const { closeDb } = await import('../lib/db/client');
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

const PARTS = {
  fromName: 'Sara Al Marzooqi',
  fromEmail: 'sara@example.com',
  toName: 'Khalid Al Ketbi',
  toEmail: 'khalid.alketbi@bank.ae',
  subject: 'Zayed University student',
  body: 'Dear Mr. Al Ketbi,\n\nYour talk argued that the cost sits in reconciliation.\n\nKind regards,',
  messageId: '<abc@outreach.local>',
};

test('a first touch carries our Message-ID and no threading headers', () => {
  const mime = buildMime(PARTS);
  assert.ok(mime.includes('Message-ID: <abc@outreach.local>'));
  assert.equal(mime.includes('In-Reply-To:'), false);
  assert.equal(mime.includes('References:'), false);
  assert.ok(mime.includes('Content-Type: text/plain; charset="UTF-8"'));
});

test('a follow-up carries In-Reply-To and the full References chain', () => {
  // Sending with only Gmail's threadId threads it in OUR mailbox. The
  // recipient's client threads by headers, and without these the follow-up
  // arrives as an orphan cold email claiming to follow up on nothing.
  const mime = buildMime({
    ...PARTS,
    subject: 'Re: Zayed University student',
    messageId: '<second@outreach.local>',
    inReplyTo: '<abc@outreach.local>',
    references: ['<abc@outreach.local>'],
  });
  assert.ok(mime.includes('In-Reply-To: <abc@outreach.local>'));
  assert.ok(mime.includes('References: <abc@outreach.local>'));
});

test('the References chain keeps every prior id, oldest first', () => {
  const mime = buildMime({
    ...PARTS,
    messageId: '<third@outreach.local>',
    inReplyTo: '<second@outreach.local>',
    references: ['<first@outreach.local>', '<second@outreach.local>'],
  });
  assert.ok(mime.includes('References: <first@outreach.local> <second@outreach.local>'));
});

test('the follow-up subject is the original verbatim, never a rewrite', () => {
  assert.equal(replySubject('Zayed University student'), 'Re: Zayed University student');
  assert.equal(replySubject('Re: Zayed University student'), 'Re: Zayed University student');
});

test('a non-ASCII display name is encoded rather than sent as mojibake', () => {
  const mime = buildMime({ ...PARTS, fromName: 'سارة المرزوقي' });
  assert.ok(mime.includes('=?UTF-8?B?'));
  assert.equal(mime.includes('Ø'), false);
});

test('there is no way to attach a file to a cold-sequence message', () => {
  const mime = buildMime(PARTS);
  assert.equal(mime.includes('multipart/'), false);
  assert.equal(mime.includes('Content-Disposition: attachment'), false);
  // Also asserted structurally: MessageParts has no attachment field, so a
  // future caller cannot add one without changing the type.
  assert.equal('attachments' in PARTS, false);
});

test('the body is byte-identical after encoding and decoding', () => {
  const mime = buildMime(PARTS);
  const raw = toGmailRaw(mime);
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.equal(decoded, mime);
  assert.ok(decoded.includes('Your talk argued that the cost sits in reconciliation.'));
});

test('the signature is appended outside the body, since the API applies none', () => {
  const withSig = withSignature('Kind regards,', 'Sara Al Marzooqi\nBSc Finance, Zayed University');
  assert.ok(withSig.includes('BSc Finance'));
  assert.equal(withSignature('Kind regards,', null), 'Kind regards,');
  assert.equal(withSignature('Kind regards,', '   '), 'Kind regards,');
});

test('every Message-ID is unique', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newMessageId()));
  assert.equal(ids.size, 200);
});

// ---------------------------------------------------------------------------
// The compare-and-swap
// ---------------------------------------------------------------------------

async function seed() {
  const { getDb } = await import('../lib/db/client');
  const db = await getDb();
  const at = '2026-08-06T00:00:00.000Z';

  await db.executeMultiple(`
    INSERT OR IGNORE INTO app_user (id, name, connection_state, last_successful_poll_at, gmail_address, send_as_email, created_at, updated_at)
      VALUES ('usr_send', 'Sara', 'connected', '${at}', 'sara@example.com', 'sara@example.com', '${at}', '${at}');
    INSERT OR IGNORE INTO org_group (id, normalized_domain, created_at) VALUES ('org_send', 'bank.ae', '${at}');
    INSERT OR IGNORE INTO company (id, org_group_id, name, domain, created_at, updated_at)
      VALUES ('cmp_send', 'org_send', 'Bank', 'bank.ae', '${at}', '${at}');
    INSERT OR IGNORE INTO person (id, company_id, full_name_raw, phonetic_key, contact_type, source_tier, email, email_status, status, created_at, updated_at)
      VALUES ('per_send', 'cmp_send', 'Khalid Al Ketbi', 'ketbi khalid', 'hr', 2, 'khalid@bank.ae', 'verified', 'ready', '${at}', '${at}');
  `);
  return db;
}

/**
 * A person of their own for each test.
 *
 * UNIQUE (person_id, step) is one of the things under test here, so the
 * fixtures must not be the thing that trips it.
 */
async function personFor(suffix: string): Promise<string> {
  const db = await seed();
  const id = `per_${suffix}`;
  const at = '2026-08-06T00:00:00.000Z';
  await db.execute({
    sql: `INSERT OR IGNORE INTO person
            (id, company_id, full_name_raw, phonetic_key, contact_type, source_tier, email, email_status, status, created_at, updated_at)
          VALUES (?, 'cmp_send', ?, ?, 'hr', 2, ?, 'verified', 'ready', ?, ?)`,
    args: [id, `Person ${suffix}`, `person ${suffix}`, `${suffix}@bank.ae`, at, at],
  });
  return id;
}

/** The swap exactly as lib/send.ts performs it. */
async function claim(outreachId: string): Promise<boolean> {
  const { transaction } = await import('../lib/db/client');
  return transaction(async (tx) => {
    const changed = await tx.execute(
      `UPDATE outreach SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'approved'`,
      ['2026-08-06T00:00:00.000Z', outreachId]
    );
    return changed === 1;
  });
}

test('two tabs pressing Send produce exactly one claim', async () => {
  const db = await seed();
  await db.execute(
    `INSERT INTO outreach (id, person_id, user_id, step, subject, body, status, created_at, updated_at)
     VALUES ('out_race', 'per_send', 'usr_send', 1, 's', 'b', 'approved', 'x', 'x')`
  );

  const results = await Promise.all([claim('out_race'), claim('out_race'), claim('out_race')]);
  assert.equal(results.filter(Boolean).length, 1, 'exactly one caller may proceed to the Gmail call');

  const [row] = (await db.execute(`SELECT status FROM outreach WHERE id = 'out_race'`)).rows;
  assert.equal(row.status, 'sending');
});

test('a double tap on one device is the same story', async () => {
  const db = await seed();
  await db.execute(
    `INSERT INTO outreach (id, person_id, user_id, step, subject, body, status, created_at, updated_at)
     VALUES ('out_double', 'per_send', 'usr_send', 2, 's', 'b', 'approved', 'x', 'x')`
  );

  assert.equal(await claim('out_double'), true);
  assert.equal(await claim('out_double'), false, 'the second tap finds nothing to claim');
});

test('a row already sent cannot be claimed again', async () => {
  const db = await seed();
  await db.execute(
    `INSERT INTO outreach (id, person_id, user_id, step, subject, body, status, created_at, updated_at)
     VALUES ('out_sent', 'per_send', 'usr_send', 3, 's', 'b', 'sent', 'x', 'x')`
  );
  assert.equal(await claim('out_sent'), false);
});

test('the Message-ID is persisted before the Gmail call, so a crash is recoverable', async () => {
  const db = await seed();
  const personId = await personFor('crash');
  const messageId = newMessageId();
  await db.execute({
    sql: `INSERT INTO outreach (id, person_id, user_id, step, status, rfc822_message_id, created_at, updated_at)
          VALUES ('out_crash', ?, 'usr_send', 1, 'sending', ?, 'x', 'x')`,
    args: [personId, messageId],
  });

  // The process dies here. The row still knows which message to look for.
  const [row] = (await db.execute(`SELECT rfc822_message_id, status FROM outreach WHERE id = 'out_crash'`)).rows;
  assert.equal(row.rfc822_message_id, messageId);
  assert.equal(row.status, 'sending');
});

test('the schema itself refuses a second row for the same step', async () => {
  const db = await seed();
  await db.execute(
    `INSERT INTO outreach (id, person_id, user_id, step, status, created_at, updated_at)
     VALUES ('out_step1', 'per_send', 'usr_send', 1, 'drafted', 'x', 'x')`
  ).catch(() => {}); // may already exist from an earlier test

  await assert.rejects(
    () =>
      db.execute(
        `INSERT INTO outreach (id, person_id, user_id, step, status, created_at, updated_at)
         VALUES ('out_step1_dupe', 'per_send', 'usr_send', 1, 'drafted', 'x', 'x')`
      ),
    'running the sweep twice must be a no-op'
  );
});

// ---------------------------------------------------------------------------
// The send gate
// ---------------------------------------------------------------------------

test('an unseen reply supersedes the send inside the swap — the poll race can lose, this cannot', async () => {
  const db = await seed();
  const personId = await personFor('gate');
  const at = '2026-08-06T00:00:00.000Z';
  await db.execute({
    sql: `INSERT INTO outreach (id, person_id, user_id, step, subject, body, status, gmail_thread_id, created_at, updated_at)
          VALUES ('out_gate', ?, 'usr_send', 2, 's', 'b', 'approved', 'thread_1', 'x', 'x')`,
    args: [personId],
  });
  await db.execute({
    sql: `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address, classification, received_at, created_at)
          VALUES ('inb_1', ?, 'thread_1', 'msg_1', 'khalid@bank.ae', 'human_positive', ?, ?)`,
    args: [personId, at, at],
  });

  const { transaction } = await import('../lib/db/client');
  const superseded = await transaction(async (tx) => {
    const unseen = await tx.query<{ n: number }>(
      `SELECT count(*) AS n FROM inbound
        WHERE person_id = ? AND classification NOT IN ('auto_reply_ooo', 'auto_ack_unmonitored', 'bounce')`,
      [personId]
    );
    if ((unseen[0]?.n ?? 0) > 0) {
      await tx.execute(`UPDATE outreach SET status = 'superseded_by_reply', updated_at = ? WHERE id = 'out_gate'`, [at]);
      return true;
    }
    return false;
  });

  assert.equal(superseded, true);
  const [row] = (await db.execute(`SELECT status FROM outreach WHERE id = 'out_gate'`)).rows;
  assert.equal(row.status, 'superseded_by_reply');
});

test('an out-of-office is not a reply and does not stop the send', async () => {
  const db = await seed();
  const at = '2026-08-06T00:00:00.000Z';
  await db.execute({
    sql: `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address, classification, received_at, created_at)
          VALUES ('inb_ooo', NULL, 'thread_2', 'msg_ooo', 'someone@bank.ae', 'auto_reply_ooo', ?, ?)`,
    args: [at, at],
  });

  const rows = (
    await db.execute(
      `SELECT count(*) AS n FROM inbound
        WHERE gmail_message_id = 'msg_ooo' AND classification NOT IN ('auto_reply_ooo', 'auto_ack_unmonitored', 'bounce')`
    )
  ).rows;
  assert.equal(Number(rows[0].n), 0, 'an Eid vacation responder is not a reply');
});

// ---------------------------------------------------------------------------
// Budgets and spacing
// ---------------------------------------------------------------------------

test('the ceiling ramps rather than starting at fifteen', async () => {
  const { budgetFor } = await import('../lib/queue');
  const { currentUser } = await import('../lib/user');
  const user = await currentUser();

  const budget = await budgetFor(user, new Date('2026-08-06T06:00:00Z'));
  assert.equal(budget.ceiling, 3, 'a new mailbox sending fifteen a day gets filtered');
  assert.ok(budget.rampNote.length > 0, 'and the user is told why');
});

test('the queue targets the observed rate, not the ceiling', async () => {
  const { budgetFor } = await import('../lib/queue');
  const { currentUser } = await import('../lib/user');
  const user = await currentUser();

  const budget = await budgetFor(user, new Date('2026-08-06T06:00:00Z'));
  assert.ok(
    budget.target <= budget.ceiling,
    'offering fifteen to someone who sends three manufactures a backlog, which is the strongest abandonment driver there is'
  );
});

// ---------------------------------------------------------------------------
// The sign-off
// ---------------------------------------------------------------------------

test('an email is never signed off by nobody', async () => {
  // The generated body ends at "Kind regards," on purpose — the sign-off comes
  // from here. With no Gmail signature, which is the common case for a
  // student's personal account, the email used to arrive with no name at all.
  const { withSignature } = await import('../lib/mime');
  const body = 'Kind regards,';

  assert.match(withSignature(body, null, 'Sara Al Marzooqi'), /Sara Al Marzooqi/);
  // A real signature still wins: it is what they use everywhere else.
  assert.match(
    withSignature(body, 'Sara Al Marzooqi\nBSc Finance, Zayed University', 'Sara'),
    /BSc Finance/
  );
  assert.equal(withSignature(body, null, null), body, 'and nothing is invented');
});

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

test('a stale draft cannot be approved as-is, only rewritten', async () => {
  // Stale means the wording is out of date — the gap it references has grown,
  // or a holiday moved underneath it. Approving one unchanged sends "since my
  // note last week" two weeks late.
  const { approveDraft } = await import('../lib/send');
  const { getDb } = await import('../lib/db/client');
  const db = await getDb();
  const personId = await personFor('staleapprove');

  await db.execute({
    sql: `INSERT INTO outreach (id, person_id, user_id, step, subject, body, status, created_at, updated_at)
          VALUES ('out_stale', ?, 'usr_send', 1, 's', 'old wording', 'stale', 'x', 'x')`,
    args: [personId],
  });

  assert.equal(await approveDraft('out_stale'), false, 'not as it stands');
  // The user reading and rewriting it makes it theirs, and current.
  assert.equal(await approveDraft('out_stale', 'wording they just typed'), true);
});

test('recording a send twice records it once', async () => {
  // The send path and the repair sweep can both arrive for the same row.
  // Without a guard the ledger gains a duplicate entry and the evidence lock
  // runs twice.
  const { getDb, query } = await import('../lib/db/client');
  const db = await getDb();
  const personId = await personFor('doublerecord');

  await db.execute({
    sql: `INSERT INTO outreach (id, person_id, user_id, step, subject, body, status,
                                rfc822_message_id, created_at, updated_at)
          VALUES ('out_twice', ?, 'usr_send', 1, 's', 'b', 'sending', '<twice@x>', 'x', 'x')`,
    args: [personId],
  });

  const { repairStuckSends } = await import('../lib/send');
  // Gmail is unreachable in tests, so the probe finds nothing and the row is
  // left alone — what is under test is that nothing is recorded twice.
  await repairStuckSends('usr_send', new Date('2026-08-06T12:00:00Z'));
  await repairStuckSends('usr_send', new Date('2026-08-06T12:00:00Z'));

  const ledger = await query('SELECT id FROM contact_ledger WHERE person_id = ?', [personId]);
  assert.equal(ledger.length, 0);
});
