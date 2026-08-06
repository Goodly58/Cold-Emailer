/**
 * Reply assist — the product's climax, and its most likely point of failure.
 *
 * The register's framing: the interview invite arrives, the user panics, does
 * it "properly tomorrow" for four days, and the lead moves on. These tests are
 * about the mechanisms that stop that — the countdown in hours, the draft
 * already written, and the refusal to invent a commitment the user has to live
 * with.
 *
 * Claude is not configured in the test environment, which is itself one of the
 * cases under test: a missing key must degrade to a card with a countdown, not
 * to nothing at all.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildMime, buildReplyMime, toGmailRaw } from '../lib/mime';
import { countdownLabel, hoursUntilEndOf } from '../lib/reply-assist';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-reply-'));
  process.env.DB_PATH = join(dir, 'test.db');
});

after(async () => {
  const { closeDb } = await import('../lib/db/client');
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The countdown
// ---------------------------------------------------------------------------

test('the countdown is in hours, because "tomorrow" is what gets postponed', () => {
  // 17:00 Gulf is 13:00 UTC on the due date. Dubai is a fixed UTC+4 with no
  // daylight saving, so this cannot drift twice a year.
  assert.equal(hoursUntilEndOf('2026-08-06', new Date('2026-08-06T04:00:00Z')), 9);
  assert.equal(hoursUntilEndOf('2026-08-06', new Date('2026-08-06T11:00:00Z')), 2);
  assert.ok(hoursUntilEndOf('2026-08-06', new Date('2026-08-07T09:00:00Z')) < 0);
});

test('the deadline is today whenever today still has hours in it', async () => {
  // "Within one working day" read literally means the NEXT working day, which
  // on a Friday is 88 hours. 88 hours is not a deadline, it is a shrug, and the
  // pressure of a number in hours is the entire mechanism.
  const { replyDeadline } = await import('../lib/reply-assist');
  const { EMPTY_CALENDAR } = await import('../lib/calendar');

  // Thursday 06:00 UTC is 10:00 in Dubai — most of the day is left.
  assert.equal(replyDeadline(EMPTY_CALENDAR, new Date('2026-08-06T06:00:00Z')), '2026-08-06');
  // Thursday 12:00 UTC is 16:00 in Dubai. A deadline nobody could meet teaches
  // the user to ignore deadlines.
  assert.equal(replyDeadline(EMPTY_CALENDAR, new Date('2026-08-06T12:00:00Z')), '2026-08-07');
  // Saturday rolls to Monday, because there is no working day in between.
  assert.equal(replyDeadline(EMPTY_CALENDAR, new Date('2026-08-08T06:00:00Z')), '2026-08-10');
});

test('an overdue reply is never framed as a failure', () => {
  // The user who missed it by a day is the user most likely to give up. The
  // only useful thing to tell them is that sending it now still works.
  assert.match(countdownLabel(-6), /still worth sending/i);
  assert.match(countdownLabel(2), /2 hours left today/);
  assert.match(countdownLabel(9), /9 hours left/);
  assert.match(countdownLabel(40), /Today is better/);
  assert.equal(countdownLabel(null), '');
});

// ---------------------------------------------------------------------------
// The attachment path
// ---------------------------------------------------------------------------

const PARTS = {
  fromName: 'Sara Al Marzooqi',
  fromEmail: 'sara@example.com',
  toName: 'Khalid Al Ketbi',
  toEmail: 'khalid@bank.ae',
  subject: 'Re: Zayed University student',
  body: 'My CV is attached. I can start after graduation in June.',
  messageId: '<reply@outreach.local>',
  inReplyTo: '<theirs@mail.gmail.com>',
  references: ['<theirs@mail.gmail.com>'],
};

test('a reply with a CV is multipart, and the CV survives the round trip', () => {
  const pdf = Buffer.from('%PDF-1.4 fake cv bytes');
  const mime = buildReplyMime({
    ...PARTS,
    attachment: { filename: 'Sara Al Marzooqi CV.pdf', mimeType: 'application/pdf', content: pdf },
  });

  assert.ok(mime.includes('Content-Type: multipart/mixed'));
  assert.ok(mime.includes('Content-Disposition: attachment; filename="Sara Al Marzooqi CV.pdf"'));
  assert.ok(mime.includes('In-Reply-To: <theirs@mail.gmail.com>'), 'still threads');

  // The attachment part, from the last blank line before it to the closing
  // boundary.
  const attachmentPart = mime.split(/--b_[0-9a-f]+/)[2];
  const encoded = attachmentPart.split('\r\n\r\n')[1];
  assert.deepEqual(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64'), pdf);

  // The body is still readable text, not swallowed by the encoding.
  assert.ok(mime.includes('My CV is attached.'));
  // And the whole thing survives Gmail's transport encoding.
  const decoded = Buffer.from(toGmailRaw(mime), 'base64url').toString('utf8');
  assert.equal(decoded, mime);
});

test('a reply with no attachment is the same plain single part as always', () => {
  const withNone = buildReplyMime({ ...PARTS, attachment: null });
  assert.equal(withNone, buildMime(PARTS));
  assert.equal(withNone.includes('multipart/'), false);
});

test('the cold path still has no way to attach anything', () => {
  // A CV on a cold email is a top gateway-quarantine trigger, and the break-up
  // is the last shot. Two builders means the cold one cannot grow an
  // attachment however a future caller is written.
  const cold = buildMime(PARTS);
  assert.equal(cold.includes('multipart/'), false);
  assert.equal(cold.includes('Content-Disposition'), false);
});

test('base64 lines stay inside the RFC limit', () => {
  // Some gateways reject longer lines outright, and a rejected CV is
  // indistinguishable from being ignored.
  const mime = buildReplyMime({
    ...PARTS,
    attachment: {
      filename: 'cv.pdf',
      mimeType: 'application/pdf',
      content: Buffer.alloc(5000, 0x41),
    },
  });
  const longest = Math.max(...mime.split('\r\n').map((l) => l.length));
  assert.ok(longest <= 76, `longest line was ${longest}`);
});

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

const AT = '2026-08-06T06:00:00.000Z';
const NOW = new Date(AT);

async function world() {
  const { getDb } = await import('../lib/db/client');
  const d = await getDb();
  await d.executeMultiple(`
    DELETE FROM reply_draft; DELETE FROM inbound; DELETE FROM outreach;
    DELETE FROM person; DELETE FROM company; DELETE FROM org_group;
    DELETE FROM profile_answer; DELETE FROM app_user;

    INSERT INTO app_user (id, name, connection_state, gmail_address, send_as_email,
                          onboarding_step, created_at, updated_at)
      VALUES ('usr_r', 'Sara', 'connected', 'sara@example.com', 'sara@example.com', 'done', '${AT}', '${AT}');
    INSERT INTO org_group (id, normalized_domain, created_at) VALUES ('org_r', 'bank.ae', '${AT}');
    INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
      VALUES ('cmp_r', 'org_r', 'Alpha Bank', 'bank.ae', '${AT}', '${AT}');
    INSERT INTO person (id, company_id, full_name_raw, phonetic_key, contact_type, source_tier,
                        anchor_source_url, email, email_status, status, created_at, updated_at)
      VALUES ('per_r', 'cmp_r', 'Khalid Al Ketbi', 'ketbi khalid', 'hr', 2,
              'https://bank.ae/leadership', 'k@bank.ae', 'verified', 'replied', '${AT}', '${AT}');
  `);
  return d;
}

async function inbound(id: string, classification: string, body: string) {
  const { execute } = await import('../lib/db/client');
  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          subject, body_text, language, classification, received_at, created_at)
     VALUES (?, 'per_r', 'thread_r', ?, 'k@bank.ae', 'Zayed University student', ?, 'en', ?, ?, ?)`,
    [id, `gm_${id}`, body, classification, AT, AT]
  );
  return id;
}

beforeEach(async () => {
  await world();
});

test('a positive reply becomes a card with a countdown even with no drafting service', async () => {
  // ANTHROPIC_API_KEY is unset here. The coaching and the deadline are most of
  // the value; the written draft is the convenience. Degrading to nothing would
  // lose the part that actually stops the user freezing.
  const { draftReply, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_p', 'human_positive', 'Happy to chat. What is your availability next week?');

  const result = await draftReply('inb_p', 'usr_r', NOW);
  // `write_yourself`, not `needs_fact`: there is no question the user could
  // answer that would unblock drafting, so asking one would loop forever.
  assert.equal(result.kind, 'write_yourself');

  const [card] = await openReplies('usr_r', NOW);
  assert.equal(card.personName, 'Khalid Al Ketbi');
  assert.equal(card.companyName, 'Alpha Bank');
  assert.ok(card.dueDateUae, 'a deadline exists regardless');
  assert.match(card.inboundBody, /Happy to chat/);
});

test('the reply threads on their message, not on our last send', async () => {
  // They may have replied from a different address, and their client threads on
  // In-Reply-To. Chaining to our own last Message-ID would orphan the reply in
  // the inbox it is meant to land in.
  const { draftReply } = await import('../lib/reply-assist');
  const { queryOne } = await import('../lib/db/client');
  await inbound('inb_t', 'neutral_question', 'Which university are you at?');

  await draftReply('inb_t', 'usr_r', NOW);
  const row = await queryOne<{ in_reply_to: string; references_chain: string; gmail_thread_id: string }>(
    'SELECT in_reply_to, references_chain, gmail_thread_id FROM reply_draft WHERE inbound_id = ?',
    ['inb_t']
  );
  assert.match(row!.in_reply_to, /gm_inb_t/);
  assert.equal(row!.gmail_thread_id, 'thread_r');
  assert.deepEqual(JSON.parse(row!.references_chain), [row!.in_reply_to]);
});

test('the subject is theirs verbatim after Re:, never doubled', async () => {
  const { draftReply, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_s', 'neutral_question', 'One question.');
  await draftReply('inb_s', 'usr_r', NOW);

  const [card] = await openReplies('usr_r', NOW);
  assert.equal(card.subject, 'Re: Zayed University student');
});

test('drafting the same inbound twice does not stack cards', async () => {
  // The sweep runs every fifteen minutes. Five near-identical answers to one
  // email is how a user stops trusting the queue.
  const { draftReply, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_i', 'human_positive', 'Yes, lets talk.');

  await draftReply('inb_i', 'usr_r', NOW);
  await draftReply('inb_i', 'usr_r', NOW);
  await draftReply('inb_i', 'usr_r', NOW);

  assert.equal((await openReplies('usr_r', NOW)).length, 1);
});

test('an out-of-office never becomes a reply card', async () => {
  const { draftReply, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_o', 'auto_reply_ooo', 'I am out of the office until 18 August.');

  const result = await draftReply('inb_o', 'usr_r', NOW);
  assert.equal(result.kind, 'skipped');
  assert.equal((await openReplies('usr_r', NOW)).length, 0);
});

test('a request for the CV is marked as carrying one', async () => {
  const { draftReply, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_c', 'document_request', 'Please send your CV.');
  await draftReply('inb_c', 'usr_r', NOW);

  const [card] = await openReplies('usr_r', NOW);
  assert.equal(card.attachCv, true);
});

test('a removal request still gets a reply drafted', async () => {
  // The address is suppressed the moment this lands, and the one email that
  // request requires is the confirmation. Refusing to send it because of our
  // own suppression would be the tool defeating itself.
  const { draftReply, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_x', 'removal_request', 'Please remove me from your list.');

  await draftReply('inb_x', 'usr_r', NOW);
  const [card] = await openReplies('usr_r', NOW);
  assert.equal(card.classification, 'removal_request');
});

test('an answered question is stored on the profile, not used once', async () => {
  // "When could you start?" is asked by every second positive reply. Asking the
  // user the same thing four times is how a tool stops being trusted.
  const { draftReply, answerQuestion } = await import('../lib/reply-assist');
  const { query } = await import('../lib/db/client');
  await inbound('inb_q', 'human_positive', 'Great — when could you start?');
  const drafted = await draftReply('inb_q', 'usr_r', NOW);

  await answerQuestion(drafted.id!, 'usr_r', 'Right after finals, mid-June', NOW);

  const answers = await query<{ field: string; value: string }>(
    "SELECT field, value FROM profile_answer WHERE field LIKE 'asked:%'"
  );
  assert.equal(answers.length, 1);
  assert.match(answers[0].value, /mid-June/);
});

test('a dismissed reply leaves the queue and stays gone', async () => {
  const { draftReply, dismissReply, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_d', 'human_positive', 'Call me.');
  const drafted = await draftReply('inb_d', 'usr_r', NOW);

  assert.equal(await dismissReply(drafted.id!, 'usr_r'), true);
  assert.equal((await openReplies('usr_r', NOW)).length, 0);

  // And the sweep does not resurrect it, because a draft row still exists.
  const { draftPendingReplies } = await import('../lib/reply-assist');
  await draftPendingReplies('usr_r', NOW);
  assert.equal((await openReplies('usr_r', NOW)).length, 0);
});

test('an unapproved reply cannot be claimed for sending', async () => {
  const { draftReply, claimReplyForSend, approveReply } = await import('../lib/reply-assist');
  const { execute } = await import('../lib/db/client');
  await inbound('inb_a', 'human_positive', 'Yes please.');
  const drafted = await draftReply('inb_a', 'usr_r', NOW);

  assert.equal(await claimReplyForSend(drafted.id!, 'usr_r'), null, 'an unapproved draft claims nothing');

  await execute(`UPDATE reply_draft SET body = 'Thank you, I can start in June.' WHERE id = ?`, [
    drafted.id!,
  ]);
  assert.equal(await approveReply(drafted.id!, 'usr_r'), true);

  const first = await claimReplyForSend(drafted.id!, 'usr_r');
  assert.ok(first, 'the approved one claims');
  assert.equal(await claimReplyForSend(drafted.id!, 'usr_r'), null, 'a second tap claims nothing');
});

test('a reply is never rationed by the daily ceiling or the send window', async () => {
  // Answering somebody who wrote to you is not outreach. A person waiting on a
  // reply does not care that it is Friday or that fifteen cold emails went out.
  const { sendReply } = await import('../lib/send');
  const { draftReply, approveReply } = await import('../lib/reply-assist');
  const { execute } = await import('../lib/db/client');
  const { getUser } = await import('../lib/user');

  await inbound('inb_w', 'human_positive', 'Yes.');
  const drafted = await draftReply('inb_w', 'usr_r', NOW);
  await execute(`UPDATE reply_draft SET body = 'Thank you.' WHERE id = ?`, [drafted.id!]);
  await approveReply(drafted.id!, 'usr_r');

  // A Saturday, with the daily ceiling long since spent.
  const saturday = new Date('2026-08-08T06:00:00.000Z');
  const result = await sendReply(drafted.id!, (await getUser('usr_r'))!, saturday);

  // It fails at Gmail, which is not stubbed — but it is never refused for a
  // budget or a calendar reason.
  assert.notEqual(result.reason, 'blocked');
  assert.notEqual(result.reason, 'not_approved');
});

test('the card exists before any drafting happens', async () => {
  // The countdown and their own words are what stop the user freezing. Waiting
  // for a model call before showing anything would leave a reply that arrived
  // at 09:00 invisible until the sweep ran at 09:15 — on the one screen where
  // minutes matter.
  const { ensureReplyDraft, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_shell', 'human_positive', 'Yes, lets find a time.');

  const id = await ensureReplyDraft('inb_shell', 'usr_r', NOW);
  assert.ok(id);

  const [card] = await openReplies('usr_r', NOW);
  assert.equal(card.personName, 'Khalid Al Ketbi');
  assert.equal(card.body, null, 'no draft yet');
  assert.match(card.inboundBody, /find a time/);
  assert.ok(card.hoursLeft !== null, 'but the clock is already running');
});

test('the shell is upgraded rather than duplicated', async () => {
  const { ensureReplyDraft, draftPendingReplies, openReplies } = await import('../lib/reply-assist');
  await inbound('inb_up', 'human_positive', 'Happy to talk.');

  const first = await ensureReplyDraft('inb_up', 'usr_r', NOW);
  await draftPendingReplies('usr_r', NOW);
  const second = await ensureReplyDraft('inb_up', 'usr_r', NOW);

  assert.equal(first, second, 'the same row throughout');
  assert.equal((await openReplies('usr_r', NOW)).length, 1);
});

test('an approved reply is never overwritten by a later sweep', async () => {
  const { ensureReplyDraft, approveReply, draftPendingReplies, openReplies } = await import(
    '../lib/reply-assist'
  );
  const { execute } = await import('../lib/db/client');
  await inbound('inb_keep', 'human_positive', 'Send me a time.');

  const id = await ensureReplyDraft('inb_keep', 'usr_r', NOW);
  await execute(`UPDATE reply_draft SET body = 'Tuesday morning suits me.' WHERE id = ?`, [id!]);
  await approveReply(id!, 'usr_r');

  await draftPendingReplies('usr_r', NOW);

  const [card] = await openReplies('usr_r', NOW);
  assert.equal(card.body, 'Tuesday morning suits me.', 'what the user approved is what stays');
  assert.equal(card.status, 'approved');
});
