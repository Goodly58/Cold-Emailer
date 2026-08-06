/**
 * Week 4 acceptance tests — the cadence engine.
 *
 * The milestone's bar, verbatim from ULTRAPROMPT §6: every transition in §5's
 * Scheduler and Reply sections has a test — reply-vs-queued-follow-up race
 * (send gate wins), unsent-predecessor invariant, reply_conflict resolution
 * both ways, OOO reschedule past the breakup, rejection killing the ladder,
 * referral pausing the company, late reply un-dormanting, `user_took_over`
 * detection, superseded atomicity. Running the sweep twice, and after a
 * simulated 3-day outage, converges to identical state.
 *
 * No Gmail and no Claude. What is under test is the state machine, which is
 * where the damage a real recipient would see actually comes from.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ClassificationResult } from '../lib/classifier';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-cadence-'));
  process.env.DB_PATH = join(dir, 'test.db');
});

after(async () => {
  const { closeDb } = await import('../lib/db/client');
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AT = '2026-08-06T06:00:00.000Z';
/** 6 August 2026 is a Thursday in Dubai — a working day and a send-window day. */
const NOW = new Date(AT);

async function db() {
  const { getDb } = await import('../lib/db/client');
  return getDb();
}

/** A clean world: one user, one org group, one company. */
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

/** One contact at Alpha Bank, verified and ready. */
async function person(id: string, overrides: Partial<Record<string, string | number>> = {}) {
  const d = await db();
  await d.execute({
    sql: `INSERT INTO person (id, company_id, ladder_rank, full_name_raw, phonetic_key, contact_type,
                              source_tier, email, email_status, status, created_at, updated_at)
          VALUES (?, 'cmp_c', ?, ?, ?, ?, 2, ?, 'verified', ?, ?, ?)`,
    args: [
      id,
      (overrides.ladder_rank as number) ?? 1,
      (overrides.full_name_raw as string) ?? `Person ${id}`,
      `key ${id}`,
      (overrides.contact_type as string) ?? 'hr',
      (overrides.email as string) ?? `${id}@bank.ae`,
      (overrides.status as string) ?? 'ready',
      AT,
      AT,
    ],
  });
  return id;
}

interface OutreachSeed {
  id: string;
  personId: string;
  step: number;
  status: string;
  sentDate?: string | null;
  scheduled?: string | null;
  threadId?: string | null;
  subject?: string | null;
  dueWorkingDays?: number | null;
}

async function outreach(seed: OutreachSeed) {
  const d = await db();
  await d.execute({
    sql: `INSERT INTO outreach (id, person_id, user_id, step, status, subject, body,
                                sent_date_uae, sent_at, scheduled_date, due_working_days,
                                gmail_thread_id, gmail_message_id, references_chain,
                                created_at, updated_at)
          VALUES (?, ?, 'usr_c', ?, ?, ?, 'body', ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
    args: [
      seed.id,
      seed.personId,
      seed.step,
      seed.status,
      seed.subject ?? 'Zayed University student',
      seed.sentDate ?? null,
      seed.sentDate ? `${seed.sentDate}T06:00:00.000Z` : null,
      seed.scheduled ?? null,
      seed.dueWorkingDays ?? null,
      seed.threadId ?? null,
      seed.threadId ? `msg_${seed.id}` : null,
      AT,
      AT,
    ],
  });
  return seed.id;
}

function classification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    classification: 'human_positive',
    via: 'claude',
    confidence: 'high',
    language: 'en',
    extracted: {},
    note: 'test',
    ...overrides,
  };
}

async function apply(result: ClassificationResult, personId: string) {
  const { applyClassification } = await import('../lib/state-machine');
  return applyClassification(result, {
    userId: 'usr_c',
    personId,
    companyId: 'cmp_c',
    inboundId: 'inb_test',
    now: NOW,
  });
}

async function statusOf(outreachId: string): Promise<string> {
  const { queryOne } = await import('../lib/db/client');
  const row = await queryOne<{ status: string }>('SELECT status FROM outreach WHERE id = ?', [outreachId]);
  return row!.status;
}

async function personStatus(id: string): Promise<string> {
  const { queryOne } = await import('../lib/db/client');
  const row = await queryOne<{ status: string }>('SELECT status FROM person WHERE id = ?', [id]);
  return row!.status;
}

async function companyState(): Promise<{ status: string; dormant_until: string | null } | null> {
  const { queryOne } = await import('../lib/db/client');
  return queryOne('SELECT status, dormant_until FROM user_company_state WHERE company_id = ?', ['cmp_c']);
}

async function user() {
  const { getUser } = await import('../lib/user');
  return (await getUser('usr_c'))!;
}

beforeEach(async () => {
  await world();
});

// ---------------------------------------------------------------------------
// Supersede atomicity
// ---------------------------------------------------------------------------

test('a reply supersedes every queued, drafted and approved step at once', async () => {
  await person('per_a');
  await outreach({ id: 'out_a1', personId: 'per_a', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_a2', personId: 'per_a', step: 2, status: 'approved', scheduled: '2026-08-06' });
  await outreach({ id: 'out_a3', personId: 'per_a', step: 3, status: 'queued', scheduled: '2026-08-20' });

  const result = await apply(classification(), 'per_a');

  assert.equal(await statusOf('out_a2'), 'superseded_by_reply');
  assert.equal(await statusOf('out_a3'), 'superseded_by_reply');
  // The sent one is history, not a draft. It stays sent.
  assert.equal(await statusOf('out_a1'), 'sent');
  assert.equal(result.superseded, 2);
  assert.equal(await personStatus('per_a'), 'replied');
});

test('a positive reply freezes the whole company, not just the person', async () => {
  // No calendar integration exists in v1, so an interview being arranged in
  // Gmail is invisible to us — and a cold email to a colleague mid-arrangement
  // cannot be taken back.
  await person('per_b1');
  await person('per_b2', { ladder_rank: 2, status: 'ready' });
  await outreach({ id: 'out_b1', personId: 'per_b1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_b2', personId: 'per_b2', step: 1, status: 'drafted', scheduled: '2026-08-06' });

  await apply(classification(), 'per_b1');

  assert.equal(await statusOf('out_b2'), 'paused_pending_reply');
  assert.equal((await companyState())!.status, 'in_conversation');
});

test('a reply while a colleague is mid-sequence is a decision, not a freeze', async () => {
  // The company now has two live threads. Which one to keep is the user's call:
  // "person 1 was a dead end" is a real outcome, and only email 1 ever went out
  // to person 2, so there is nothing to retract either way.
  await person('per_cf1');
  await person('per_cf2', { ladder_rank: 2, status: 'in_sequence' });
  await outreach({ id: 'out_cf1', personId: 'per_cf1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_cf2', personId: 'per_cf2', step: 1, status: 'sent', sentDate: '2026-08-04', threadId: 't2' });
  await outreach({ id: 'out_cf2b', personId: 'per_cf2', step: 2, status: 'drafted', scheduled: '2026-08-06' });

  const result = await apply(classification(), 'per_cf1');

  assert.equal((await companyState())!.status, 'reply_conflict');
  assert.equal(await statusOf('out_cf2b'), 'paused_pending_reply');
  assert.match(result.summary, /choose/i);
});

test('a mere question raises the same conflict a yes would', async () => {
  // Two live threads into one office is the thing being prevented, not two
  // enthusiastic ones. Only `human_positive` used to reach this.
  await person('per_cq1');
  await person('per_cq2', { ladder_rank: 2, status: 'in_sequence' });
  await outreach({ id: 'out_cq1', personId: 'per_cq1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_cq2', personId: 'per_cq2', step: 2, status: 'drafted', scheduled: '2026-08-06' });

  await apply(classification({ classification: 'neutral_question' }), 'per_cq1');

  assert.equal((await companyState())!.status, 'reply_conflict');
  assert.equal(await statusOf('out_cq2'), 'paused_pending_reply');
});

test('a question with nobody else in play changes no company state', async () => {
  await person('per_cs1');
  await outreach({ id: 'out_cs1', personId: 'per_cs1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });

  const result = await apply(classification({ classification: 'neutral_question' }), 'per_cs1');
  assert.equal(result.companyStatus, undefined);
  assert.equal(await companyState(), null, 'the ordinary case writes nothing');
});

// ---------------------------------------------------------------------------
// The send gate
// ---------------------------------------------------------------------------

test('the send gate wins the race the poller can lose', async () => {
  // The contact says "happy to chat" at 08:40; the user opens the pre-drafted
  // bump at 09:05 before the poller has run. The gate is inside the
  // compare-and-swap, so it cannot lose.
  const { sendOutreach } = await import('../lib/send');
  const { execute } = await import('../lib/db/client');

  await person('per_g');
  await outreach({ id: 'out_g1', personId: 'per_g', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_g2', personId: 'per_g', step: 2, status: 'approved', scheduled: '2026-08-06' });

  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          classification, received_at, created_at)
     VALUES ('inb_g', 'per_g', 't1', 'gm_1', 'them@bank.ae', 'human_positive', ?, ?)`,
    [AT, AT]
  );

  const result = await sendOutreach('out_g2', await user(), NOW);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'reply_arrived');
  assert.match(result.message, /replied/i);
  assert.equal(await statusOf('out_g2'), 'superseded_by_reply');
});

test('an out-of-office does not trip the send gate', async () => {
  // It is not a reply. Blocking on one would stop every sequence during Eid.
  const { sendOutreach } = await import('../lib/send');
  const { execute, queryOne } = await import('../lib/db/client');

  await person('per_ooo_gate');
  await outreach({ id: 'out_og1', personId: 'per_ooo_gate', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_og2', personId: 'per_ooo_gate', step: 2, status: 'approved' });

  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          classification, received_at, created_at)
     VALUES ('inb_og', 'per_ooo_gate', 't1', 'gm_2', 'them@bank.ae', 'auto_reply_ooo', ?, ?)`,
    [AT, AT]
  );

  const result = await sendOutreach('out_og2', await user(), NOW);

  // It gets past the gate and fails at the Gmail call instead, which is the
  // point: the reason is never `reply_arrived`.
  assert.notEqual(result.reason, 'reply_arrived');
  const row = await queryOne<{ status: string }>('SELECT status FROM outreach WHERE id = ?', ['out_og2']);
  assert.notEqual(row!.status, 'superseded_by_reply');
});

// ---------------------------------------------------------------------------
// No
// ---------------------------------------------------------------------------

test('a rejection kills the whole ladder and rests the company for 90 days', async () => {
  // "Our quota is met this year" recorded against one person means the HR lead
  // gets emailed after cooldown and walks over: didn't you already tell this
  // guy no?
  await person('per_r1', { status: 'in_sequence' });
  await person('per_r2', { ladder_rank: 2 });
  await outreach({ id: 'out_r1', personId: 'per_r1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_r2', personId: 'per_r2', step: 1, status: 'drafted' });

  await apply(classification({ classification: 'rejection_hard' }), 'per_r1');

  const state = (await companyState())!;
  assert.equal(state.status, 'dormant');
  assert.equal(state.dormant_until, '2026-11-04', '90 calendar days out');
  assert.equal(await statusOf('out_r2'), 'paused_pending_reply');
  assert.equal(await personStatus('per_r2'), 'closed_silent');
});

test('a soft rejection honours the timeframe they actually stated', async () => {
  await person('per_s1');
  await outreach({ id: 'out_s1', personId: 'per_s1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });

  const result = await apply(
    classification({ classification: 'rejection_soft', extracted: { date: '2026-10-01' } }),
    'per_s1'
  );

  assert.equal((await companyState())!.dormant_until, '2026-10-01');
  assert.match(result.summary, /2026-10-01/);
});

test('the ladder never rotates past a rejection, however long the silence', async () => {
  const { sweep } = await import('../lib/scheduler');
  await person('per_rr1', { status: 'in_sequence' });
  await person('per_rr2', { ladder_rank: 2 });
  await outreach({ id: 'out_rr1', personId: 'per_rr1', step: 1, status: 'sent', sentDate: '2026-05-01', threadId: 't1' });
  await outreach({ id: 'out_rr3', personId: 'per_rr1', step: 3, status: 'sent', sentDate: '2026-05-20', threadId: 't1' });

  await apply(classification({ classification: 'rejection_hard' }), 'per_rr1');
  const result = await sweep(await user(), { now: NOW, poll: false, predraft: false });

  assert.equal(result.rotated, 0);
  const { queryOne } = await import('../lib/db/client');
  const row = await queryOne('SELECT id FROM outreach WHERE person_id = ?', ['per_rr2']);
  assert.equal(row, null, 'person 2 never gets a sequence at a company that said no');
});

// ---------------------------------------------------------------------------
// Removal and complaints
// ---------------------------------------------------------------------------

test('"remove me" suppresses the person and the company', async () => {
  const { checkSuppression } = await import('../lib/people');
  await person('per_x1');
  await outreach({ id: 'out_x1', personId: 'per_x1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });

  await apply(classification({ classification: 'removal_request' }), 'per_x1');

  assert.equal((await checkSuppression('per_x1@bank.ae')).suppressed, true);
  assert.equal((await companyState())!.status, 'suppressed_by_request');
});

test('a complaint suppresses the domain at poll time, not at the next sweep', async () => {
  const { checkSuppression } = await import('../lib/people');
  await person('per_x2');
  await outreach({ id: 'out_x2', personId: 'per_x2', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });

  await apply(classification({ classification: 'complaint_escalation' }), 'per_x2');

  // Anyone at the domain, including addresses we have never seen.
  const hit = await checkSuppression('someone.else@bank.ae', 'bank.ae');
  assert.equal(hit.suppressed, true);
});

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

test('a referral pauses the company and marks everyone on the thread warm', async () => {
  // The person CC'd into a referral is frequently already rank 2 on the ladder,
  // which is exactly how they get a cold email days after a warm introduction.
  const { execute, queryOne } = await import('../lib/db/client');
  await person('per_f1');
  await person('per_f2', { ladder_rank: 2, email: 'sara.nafis@bank.ae' });
  await outreach({ id: 'out_f1', personId: 'per_f1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });

  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          to_addresses, cc_addresses, classification, received_at, created_at)
     VALUES ('inb_f', 'per_f1', 't1', 'gm_f', 'per_f1@bank.ae', '["sara@example.com"]',
             '["Sara.Nafis@bank.ae"]', 'referral', ?, ?)`,
    [AT, AT]
  );

  await apply(
    classification({ classification: 'referral', extracted: { successor: 'Sara Al Nuaimi' } }),
    'per_f1'
  );

  const warm = await queryOne<{ in_warm_thread: number }>(
    'SELECT in_warm_thread FROM person WHERE id = ?',
    ['per_f2']
  );
  assert.equal(warm!.in_warm_thread, 1, 'a CC on the referral is warm, case-insensitively');
  assert.equal((await companyState())!.status, 'paused_referral');
});

test('a warm contact is never picked up by ladder rotation', async () => {
  const { execute } = await import('../lib/db/client');
  const { sweep } = await import('../lib/scheduler');

  await person('per_w1', { status: 'closed_silent' });
  await person('per_w2', { ladder_rank: 2 });
  await execute('UPDATE person SET in_warm_thread = 1 WHERE id = ?', ['per_w2']);
  await outreach({ id: 'out_w1', personId: 'per_w1', step: 1, status: 'sent', sentDate: '2026-05-01', threadId: 't1' });

  const result = await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(result.rotated, 0);
});

// ---------------------------------------------------------------------------
// Out of office
// ---------------------------------------------------------------------------

test('an out-of-office is not a reply, not a touch, and survives the recompute', async () => {
  // The failure this prevents happens in bulk around every Eid: a vacation
  // responder stops the sequence forever and shows a celebratory "Replied".
  const { queryOne } = await import('../lib/db/client');
  const { recomputeDerivedDates } = await import('../lib/derived-dates');

  await person('per_o1', { status: 'in_sequence' });
  await outreach({ id: 'out_o1', personId: 'per_o1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({
    id: 'out_o2',
    personId: 'per_o1',
    step: 2,
    status: 'drafted',
    scheduled: '2026-08-06',
    dueWorkingDays: 4,
  });

  const result = await apply(
    classification({ classification: 'auto_reply_ooo', extracted: { date: '2026-08-18' } }),
    'per_o1'
  );

  assert.equal(result.superseded, 0, 'not a reply');
  assert.equal(await personStatus('per_o1'), 'in_sequence', 'and not a "Replied" badge');

  const after = await queryOne<{ scheduled_date: string; regenerate_at_send: number; hold_until: string }>(
    'SELECT scheduled_date, regenerate_at_send, hold_until FROM outreach WHERE id = ?',
    ['out_o2']
  );
  assert.equal(after!.scheduled_date, '2026-08-20', 'return + 2 working days');
  assert.equal(after!.regenerate_at_send, 1, '"following up on my note" is wrong across a two-week gap');

  // The nightly recompute derives from the calendar and would otherwise put it
  // straight back to the 6th, firing into the empty office anyway.
  await recomputeDerivedDates({ now: NOW });
  const recomputed = await queryOne<{ scheduled_date: string }>(
    'SELECT scheduled_date FROM outreach WHERE id = ?',
    ['out_o2']
  );
  assert.equal(recomputed!.scheduled_date, '2026-08-20');
});

test('an out-of-office past the break-up stretches the cadence rather than closing it', async () => {
  const { queryOne } = await import('../lib/db/client');
  await person('per_o2', { status: 'in_sequence' });
  await outreach({ id: 'out_p1', personId: 'per_o2', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_p3', personId: 'per_o2', step: 3, status: 'queued', scheduled: '2026-08-24', dueWorkingDays: 15 });

  await apply(
    classification({ classification: 'auto_reply_ooo', extracted: { date: '2026-09-15' } }),
    'per_o2'
  );

  const row = await queryOne<{ status: string; scheduled_date: string }>(
    'SELECT status, scheduled_date FROM outreach WHERE id = ?',
    ['out_p3']
  );
  assert.notEqual(row!.status, 'closed', 'a sequence is never closed for the recipient being away');
  assert.equal(row!.scheduled_date, '2026-09-17');
});

test('an out-of-office with no readable date pauses five working days', async () => {
  const { queryOne } = await import('../lib/db/client');
  await person('per_o3', { status: 'in_sequence' });
  await outreach({ id: 'out_q1', personId: 'per_o3', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_q2', personId: 'per_o3', step: 2, status: 'drafted', scheduled: '2026-08-06', dueWorkingDays: 4 });

  await apply(classification({ classification: 'auto_reply_ooo' }), 'per_o3');

  const row = await queryOne<{ scheduled_date: string }>('SELECT scheduled_date FROM outreach WHERE id = ?', [
    'out_q2',
  ]);
  // Thu 6 Aug + 5 working days = Thu 13 Aug. A guessed date is worse than none.
  assert.equal(row!.scheduled_date, '2026-08-13');
});

// ---------------------------------------------------------------------------
// Gateways, bounces, dead ends
// ---------------------------------------------------------------------------

test('a gateway challenge stops the clock instead of moving it', async () => {
  const { queryOne } = await import('../lib/db/client');
  const { recomputeDerivedDates } = await import('../lib/derived-dates');

  await person('per_gw', { status: 'in_sequence' });
  await outreach({ id: 'out_gw1', personId: 'per_gw', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_gw2', personId: 'per_gw', step: 2, status: 'queued', scheduled: '2026-08-06', dueWorkingDays: 4 });

  await apply(
    classification({ classification: 'gateway_challenge', extracted: { url: 'https://gw.example/verify' } }),
    'per_gw'
  );

  const row = await queryOne<{ scheduled_date: string | null; countdown_paused: number }>(
    'SELECT scheduled_date, countdown_paused FROM outreach WHERE id = ?',
    ['out_gw2']
  );
  assert.equal(row!.scheduled_date, null);
  assert.equal(row!.countdown_paused, 1);

  const company = await queryOne<{ gateway: number }>('SELECT gateway FROM company WHERE id = ?', ['cmp_c']);
  assert.equal(company!.gateway, 1);

  // The clock stays stopped through the recompute; there is no honest date to
  // count from when the recipient never received the email.
  await recomputeDerivedDates({ now: NOW });
  const after = await queryOne<{ scheduled_date: string | null }>(
    'SELECT scheduled_date FROM outreach WHERE id = ?',
    ['out_gw2']
  );
  assert.equal(after!.scheduled_date, null);
});

test('a quarantined step is never offered in the queue', async () => {
  const { buildQueue } = await import('../lib/queue');
  await person('per_gq', { status: 'in_sequence' });
  await outreach({ id: 'out_gq1', personId: 'per_gq', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_gq2', personId: 'per_gq', step: 2, status: 'drafted', scheduled: '2026-08-06' });

  await apply(classification({ classification: 'gateway_challenge' }), 'per_gq');

  const queue = await buildQueue(await user(), NOW);
  assert.equal(queue.followUps.length, 0, 'no date must never read as "due now"');
});

test('a gateway challenge nobody completed becomes a rotation after a week', async () => {
  const { execute, queryOne } = await import('../lib/db/client');
  const { sweep } = await import('../lib/scheduler');

  await person('per_gt', { status: 'in_sequence' });
  await person('per_gt2', { ladder_rank: 2 });
  await outreach({ id: 'out_gt1', personId: 'per_gt', step: 1, status: 'sent', sentDate: '2026-07-01', threadId: 't1' });
  await outreach({ id: 'out_gt2', personId: 'per_gt', step: 2, status: 'queued', scheduled: '2026-07-08' });
  await apply(classification({ classification: 'gateway_challenge' }), 'per_gt');

  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          classification, received_at, created_at)
     VALUES ('inb_gt', 'per_gt', 't1', 'gm_gt', 'gateway@bank.ae', 'gateway_challenge', ?, ?)`,
    ['2026-07-02T06:00:00.000Z', AT]
  );

  const result = await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(result.gatewayTimedOut, 1);
  assert.equal(await personStatus('per_gt'), 'closed_silent');

  const next = await queryOne('SELECT id FROM outreach WHERE person_id = ?', ['per_gt2']);
  assert.notEqual(next, null, 'the best contact is not frozen forever behind a quarantine');
});

test('a hard bounce closes the person and never blames the user', async () => {
  const { queryOne } = await import('../lib/db/client');
  await person('per_bh', { status: 'in_sequence' });
  await outreach({ id: 'out_bh1', personId: 'per_bh', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_bh2', personId: 'per_bh', step: 2, status: 'queued', scheduled: '2026-08-06' });

  const result = await apply(classification({ classification: 'bounce', note: 'DSN 5.1.1' }), 'per_bh');

  const row = await queryOne<{ email_status: string; status: string }>(
    'SELECT email_status, status FROM person WHERE id = ?',
    ['per_bh']
  );
  assert.equal(row!.email_status, 'bounced');
  assert.equal(row!.status, 'closed_silent');
  assert.equal(await statusOf('out_bh2'), 'bounced');
  // Calm framing, never an SMTP code.
  assert.equal(/5\.1\.1|SMTP|DSN/i.test(result.summary), false);
  assert.match(result.summary, /changed jobs/i);
});

test('a soft bounce retries in a working day instead of burning the contact', async () => {
  const { queryOne } = await import('../lib/db/client');
  await person('per_bs', { status: 'in_sequence' });
  await outreach({ id: 'out_bs1', personId: 'per_bs', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_bs2', personId: 'per_bs', step: 2, status: 'approved', scheduled: '2026-08-06' });

  await apply(classification({ classification: 'bounce', note: 'soft 4.2.2 mailbox full' }), 'per_bs');

  const row = await queryOne<{ scheduled_date: string }>('SELECT scheduled_date FROM outreach WHERE id = ?', [
    'out_bs2',
  ]);
  // Thursday + 1 working day is Friday. Working days are Mon-Fri; the Mon-Thu
  // send window is a separate, narrower rule applied at send time, and
  // conflating the two is exactly the mistake `nextDue` exists to prevent.
  assert.equal(row!.scheduled_date, '2026-08-07');
  assert.equal(await personStatus('per_bs'), 'in_sequence', 'a full mailbox is not a departure');
});

test('an unmonitored mailbox is a dead end, not a reply', async () => {
  await person('per_am', { status: 'in_sequence' });
  await outreach({ id: 'out_am1', personId: 'per_am', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_am2', personId: 'per_am', step: 2, status: 'queued' });

  const result = await apply(
    classification({ classification: 'auto_ack_unmonitored', extracted: { url: 'https://careers.bank.ae' } }),
    'per_am'
  );

  assert.equal(await personStatus('per_am'), 'dead_end_mailbox');
  assert.equal(await statusOf('out_am2'), 'closed');
  assert.equal(result.action?.url, 'https://careers.bank.ae');
});

// ---------------------------------------------------------------------------
// reply_conflict
// ---------------------------------------------------------------------------

test('reply_conflict resolved toward the reply closes the other sequence quietly', async () => {
  const { resolveReplyConflict } = await import('../lib/state-machine');
  await person('per_c1', { status: 'replied' });
  await person('per_c2', { ladder_rank: 2, status: 'in_sequence' });
  await outreach({ id: 'out_c2a', personId: 'per_c2', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't2' });
  await outreach({ id: 'out_c2b', personId: 'per_c2', step: 2, status: 'paused_pending_reply' });

  const result = await resolveReplyConflict('usr_c', 'cmp_c', 'per_c1', 'going_with_reply', NOW);

  assert.equal(await personStatus('per_c2'), 'closed_silent');
  assert.equal(await statusOf('out_c2b'), 'closed');
  // Only email 1 ever went out to person 2. There is no retraction to send.
  assert.equal(await statusOf('out_c2a'), 'sent');
  assert.equal((await companyState())!.status, 'in_conversation');
  assert.match(result.summary, /quietly/);
});

test('reply_conflict resolved the other way resumes through the stale rule', async () => {
  const { resolveReplyConflict } = await import('../lib/state-machine');
  await person('per_d1', { status: 'replied' });
  await person('per_d2', { ladder_rank: 2, status: 'in_sequence' });
  await outreach({ id: 'out_d2b', personId: 'per_d2', step: 2, status: 'paused_pending_reply' });

  await resolveReplyConflict('usr_c', 'cmp_c', 'per_d1', 'reply_was_dead_end', NOW);

  // `stale`, not `drafted` — the dates and the wording are both recomputed
  // rather than picked up mid-sentence weeks later.
  assert.equal(await statusOf('out_d2b'), 'stale');
  assert.equal((await companyState())!.status, 'active');
});

// ---------------------------------------------------------------------------
// Late replies and manual takeover
// ---------------------------------------------------------------------------

test('a late reply reopens the person and un-dormants the company', async () => {
  const { reopenForLateReply } = await import('../lib/state-machine');
  const { execute } = await import('../lib/db/client');

  await person('per_l1', { status: 'closed_silent' });
  await person('per_l2', { ladder_rank: 2, status: 'in_sequence' });
  await outreach({ id: 'out_l2', personId: 'per_l2', step: 2, status: 'drafted', scheduled: '2026-08-06' });
  await execute(
    `INSERT INTO user_company_state (user_id, company_id, status, dormant_until, created_at, updated_at)
     VALUES ('usr_c', 'cmp_c', 'dormant', '2026-11-04', ?, ?)`,
    [AT, AT]
  );

  const result = await reopenForLateReply('usr_c', 'per_l1', 'cmp_c', NOW);

  assert.equal(await personStatus('per_l1'), 'replied');
  assert.equal((await companyState())!.status, 'paused_late_reply');
  assert.equal(await statusOf('out_l2'), 'paused_pending_reply', 'person 2 freezes rather than closing');
  assert.match(result.action!.message, /today/i);
});

test('replying from Gmail by hand cancels the queued follow-ups', async () => {
  const { markUserTookOver } = await import('../lib/state-machine');
  await person('per_u1', { status: 'in_sequence' });
  await outreach({ id: 'out_u1', personId: 'per_u1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_u2', personId: 'per_u1', step: 2, status: 'approved', scheduled: '2026-08-06' });

  const result = await markUserTookOver('per_u1', NOW);

  assert.equal(await personStatus('per_u1'), 'user_took_over');
  assert.equal(await statusOf('out_u2'), 'closed');
  assert.equal(result.superseded, 1);
  assert.equal(result.action?.kind, 'resume_offer');
});

// ---------------------------------------------------------------------------
// Scheduler invariants
// ---------------------------------------------------------------------------

test('a follow-up whose predecessor never sent cannot exist', async () => {
  // The user disappears for ten days; follow-up 2 comes due while follow-up 1
  // sits unsent, producing "following up on my note" for a note that was never
  // written.
  const { sweep } = await import('../lib/scheduler');
  await person('per_i1', { status: 'ready' });
  await outreach({ id: 'out_i1', personId: 'per_i1', step: 1, status: 'drafted' });
  await outreach({ id: 'out_i2', personId: 'per_i1', step: 2, status: 'approved', scheduled: '2026-08-06' });

  await sweep(await user(), { now: NOW, poll: false, predraft: false });

  assert.equal(await statusOf('out_i2'), 'closed');
  assert.equal(await statusOf('out_i1'), 'drafted', 'the first email is untouched');
});

test('two live sequences at one org group collapse to the oldest', async () => {
  const { sweep } = await import('../lib/scheduler');
  await person('per_v1', { status: 'in_sequence' });
  await person('per_v2', { ladder_rank: 2, status: 'in_sequence' });
  await outreach({ id: 'out_v1', personId: 'per_v1', step: 1, status: 'sent', sentDate: '2026-08-01', threadId: 't1' });
  await outreach({ id: 'out_v2', personId: 'per_v2', step: 1, status: 'sent', sentDate: '2026-08-04', threadId: 't2' });
  await outreach({ id: 'out_v2b', personId: 'per_v2', step: 2, status: 'drafted', scheduled: '2026-08-06' });

  await sweep(await user(), { now: NOW, poll: false, predraft: false });

  assert.equal(await statusOf('out_v2b'), 'paused_pending_reply');
});

test('a suppressed person cannot have a live draft after a sweep', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute } = await import('../lib/db/client');
  await person('per_sp', { status: 'ready' });
  await outreach({ id: 'out_sp', personId: 'per_sp', step: 1, status: 'approved' });
  await execute(`UPDATE person SET status = 'suppressed' WHERE id = ?`, ['per_sp']);

  await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(await statusOf('out_sp'), 'closed');
});

// ---------------------------------------------------------------------------
// Advancing and rotating
// ---------------------------------------------------------------------------

test('the sweep creates step 2 on the same thread and step 3 on a new one', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { queryOne, execute } = await import('../lib/db/client');

  await person('per_n1', { status: 'in_sequence' });
  await outreach({
    id: 'out_n1',
    personId: 'per_n1',
    step: 1,
    status: 'sent',
    sentDate: '2026-08-03',
    threadId: 'thread_abc',
    subject: 'Zayed University student',
  });

  await sweep(await user(), { now: NOW, poll: false, predraft: false });

  const step2 = await queryOne<{
    gmail_thread_id: string | null;
    subject: string | null;
    scheduled_date: string;
    due_working_days: number;
  }>('SELECT gmail_thread_id, subject, scheduled_date, due_working_days FROM outreach WHERE person_id = ? AND step = 2', [
    'per_n1',
  ]);
  assert.equal(step2!.gmail_thread_id, 'thread_abc', 'touch 2 is a reply on the same thread');
  assert.equal(step2!.subject, 'Re: Zayed University student', 'the subject is the original verbatim');
  assert.equal(step2!.due_working_days, 4);
  // Mon 3 Aug + 4 working days = Fri 7 Aug in Dubai (Sat/Sun are the weekend).
  assert.equal(step2!.scheduled_date, '2026-08-07');

  // Now send step 2 and let the sweep create the break-up.
  await execute(
    `UPDATE outreach SET status = 'sent', sent_date_uae = '2026-08-07', sent_at = ?, gmail_message_id = 'm2'
      WHERE person_id = ? AND step = 2`,
    [AT, 'per_n1']
  );
  await sweep(await user(), { now: new Date('2026-08-07T06:00:00.000Z'), poll: false, predraft: false });

  const step3 = await queryOne<{ gmail_thread_id: string | null; subject: string | null; scheduled_date: string }>(
    'SELECT gmail_thread_id, subject, scheduled_date FROM outreach WHERE person_id = ? AND step = 3',
    ['per_n1']
  );
  assert.equal(step3!.gmail_thread_id, null, 'the break-up is a new email with a new subject');
  assert.equal(step3!.subject, null);
  // +15 working days from touch 1 (Mon 3 Aug), not from touch 2.
  assert.equal(step3!.scheduled_date, '2026-08-24');
});

test('a late touch 2 pushes the break-up out rather than stacking it', async () => {
  // The doctrine counts from day 0, which is right when the sequence runs on
  // time and wrong when the user disappears: touch 2 on day 13 followed by
  // touch 3 two days later reads as pestering.
  const { recomputeDerivedDates } = await import('../lib/derived-dates');
  const { queryOne } = await import('../lib/db/client');

  await person('per_n2', { status: 'in_sequence' });
  await outreach({ id: 'out_m1', personId: 'per_n2', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_m2', personId: 'per_n2', step: 2, status: 'sent', sentDate: '2026-08-21', threadId: 't1' });
  await outreach({ id: 'out_m3', personId: 'per_n2', step: 3, status: 'queued', dueWorkingDays: 15 });

  await recomputeDerivedDates({ now: new Date('2026-08-21T06:00:00.000Z') });

  const row = await queryOne<{ scheduled_date: string }>('SELECT scheduled_date FROM outreach WHERE id = ?', [
    'out_m3',
  ]);
  // Not 24 August (day 0 + 15) — at least four working days after what they
  // actually last received.
  assert.equal(row!.scheduled_date, '2026-08-27');
});

test('the ladder advances after silence and a cooldown, once', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { query } = await import('../lib/db/client');

  await person('per_k1', { status: 'in_sequence' });
  await person('per_k2', { ladder_rank: 2 });
  await outreach({ id: 'out_k1', personId: 'per_k1', step: 1, status: 'sent', sentDate: '2026-07-01', threadId: 't1' });
  await outreach({ id: 'out_k3', personId: 'per_k1', step: 3, status: 'sent', sentDate: '2026-07-22', threadId: null });

  const first = await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(first.rotated, 1);
  assert.equal(await personStatus('per_k1'), 'closed_silent');
  assert.equal(await personStatus('per_k2'), 'queued');

  // Running it again must not create a second sequence for the same person.
  const second = await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(second.rotated, 0);
  const rows = await query('SELECT id FROM outreach WHERE person_id = ?', ['per_k2']);
  assert.equal(rows.length, 1);
});

test('the ladder waits out the cooldown', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { queryOne } = await import('../lib/db/client');

  await person('per_j1', { status: 'in_sequence' });
  await person('per_j2', { ladder_rank: 2 });
  await outreach({ id: 'out_j1', personId: 'per_j1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_j3', personId: 'per_j1', step: 3, status: 'sent', sentDate: '2026-08-05', threadId: null });

  await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(await queryOne('SELECT id FROM outreach WHERE person_id = ?', ['per_j2']), null);
});

test('a bounce waives the cooldown, because nobody saw anything', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute, queryOne } = await import('../lib/db/client');

  await person('per_y1', { status: 'in_sequence' });
  await person('per_y2', { ladder_rank: 2 });
  await outreach({ id: 'out_y1', personId: 'per_y1', step: 1, status: 'bounced', sentDate: '2026-08-05', threadId: 't1' });
  await execute(`UPDATE person SET email_status = 'bounced', status = 'closed_silent' WHERE id = ?`, ['per_y1']);

  await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.notEqual(await queryOne('SELECT id FROM outreach WHERE person_id = ?', ['per_y2']), null);
});

test('dormancy expires by date and never undoes a suppression', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute, query } = await import('../lib/db/client');

  await execute(
    `INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
     VALUES ('cmp_c2', 'org_c', 'Beta Bank', 'beta.ae', ?, ?)`,
    [AT, AT]
  );
  await execute(
    `INSERT INTO user_company_state (user_id, company_id, status, dormant_until, created_at, updated_at)
     VALUES ('usr_c', 'cmp_c', 'dormant', '2026-08-01', ?, ?),
            ('usr_c', 'cmp_c2', 'suppressed_by_request', NULL, ?, ?)`,
    [AT, AT, AT, AT]
  );

  const result = await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(result.woken, 1);

  const states = await query<{ company_id: string; status: string }>(
    'SELECT company_id, status FROM user_company_state ORDER BY company_id'
  );
  assert.equal(states[0].status, 'active');
  assert.equal(states[1].status, 'suppressed_by_request', 'a removal request has no expiry');
});

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

/**
 * Everything the sweep is allowed to touch, as one comparable string.
 *
 * Row ids are deliberately excluded: they are random, and what convergence
 * means here is that the same *sequence state* exists, not that the same UUIDs
 * were minted. Keying on (person, step) is the identity that matters.
 */
async function snapshot(): Promise<string> {
  const { query } = await import('../lib/db/client');
  const outreachRows = await query<Record<string, unknown>>(
    `SELECT person_id, step, status, scheduled_date, due_working_days, hold_until,
            countdown_paused, regenerate_at_send, gmail_thread_id
       FROM outreach ORDER BY person_id, step`
  );
  const people = await query<Record<string, unknown>>('SELECT id, status, ladder_rank FROM person ORDER BY id');
  const states = await query<Record<string, unknown>>(
    'SELECT company_id, status, dormant_until FROM user_company_state ORDER BY company_id'
  );
  return JSON.stringify({ outreachRows, people, states });
}

test('running the sweep twice is a no-op', async () => {
  const { sweep } = await import('../lib/scheduler');

  await person('per_z1', { status: 'in_sequence' });
  await person('per_z2', { ladder_rank: 2 });
  await person('per_z3', { ladder_rank: 3, status: 'in_sequence' });
  await outreach({ id: 'out_z1', personId: 'per_z1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_z3', personId: 'per_z3', step: 1, status: 'sent', sentDate: '2026-07-01', threadId: 't3' });

  await sweep(await user(), { now: NOW, poll: false, predraft: false });
  const once = await snapshot();

  await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(await snapshot(), once, 'the second run changes nothing');
});

test('a three-day outage converges to the same state as three daily sweeps', async () => {
  // The whole reason the scheduler is a sweep and not a tick: an outage must
  // not silently drop every follow-up whose fire-moment fell inside it.
  const { sweep } = await import('../lib/scheduler');
  const u = await user();

  const days = ['2026-08-04', '2026-08-05', '2026-08-06'].map((d) => new Date(`${d}T06:00:00.000Z`));

  await person('per_out1', { status: 'in_sequence' });
  await outreach({ id: 'out_o_a', personId: 'per_out1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  for (const day of days) await sweep(u, { now: day, poll: false, predraft: false });
  const daily = await snapshot();

  // Same world, but the server was down for the first two days.
  await world();
  await person('per_out1', { status: 'in_sequence' });
  await outreach({ id: 'out_o_a', personId: 'per_out1', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await sweep(await user(), { now: days[2], poll: false, predraft: false });

  assert.equal(await snapshot(), daily, 'catching up late produces the rows an on-time run would have');
});

test('a paused user gets no new rows at all', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute } = await import('../lib/db/client');

  await person('per_pa', { status: 'in_sequence' });
  await outreach({ id: 'out_pa', personId: 'per_pa', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await execute('UPDATE app_user SET paused = 1 WHERE id = ?', ['usr_c']);

  const result = await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(result.skipped, 'paused');
  assert.equal(result.advanced, 0);

  const { queryOne } = await import('../lib/db/client');
  assert.equal(await queryOne('SELECT id FROM outreach WHERE person_id = ? AND step = 2', ['per_pa']), null);
});

test('"I got the job" stops the sweep the same way', async () => {
  const { sweep } = await import('../lib/scheduler');
  const { execute } = await import('../lib/db/client');
  await execute(`UPDATE app_user SET placed_date = '2026-08-05' WHERE id = ?`, ['usr_c']);

  const result = await sweep(await user(), { now: NOW, poll: false, predraft: false });
  assert.equal(result.skipped, 'placed');
});

// ---------------------------------------------------------------------------
// The send window (CULTURE.md §9)
// ---------------------------------------------------------------------------

/** 2026-08-06 is a Thursday, 08-07 a Friday, 08-08 a Saturday, 08-09 a Sunday. */
const FRIDAY = new Date('2026-08-07T06:00:00.000Z');
const SUNDAY = new Date('2026-08-09T06:00:00.000Z');

test('nothing may be sent on a Friday, a Saturday or a Sunday', async () => {
  const { sendPermission } = await import('../lib/queue');
  await person('per_sw', { status: 'in_sequence' });
  await outreach({ id: 'out_sw', personId: 'per_sw', step: 1, status: 'approved' });

  const thursday = await sendPermission(await user(), 'out_sw', NOW);
  assert.equal(thursday.allowed, true);

  for (const day of [FRIDAY, SUNDAY]) {
    const blocked = await sendPermission(await user(), 'out_sw', day);
    assert.equal(blocked.allowed, false);
    // Friday prayers, a government week ending at midday, and a weekend that is
    // Sat-Sun for essentially everyone. Monday is the honest answer.
    assert.match(blocked.message!, /2026-08-10/);
  }
});

test('a weekend queue shows what is waiting rather than an empty screen', async () => {
  const { buildQueue } = await import('../lib/queue');
  await person('per_sq', { status: 'in_sequence' });
  await outreach({ id: 'out_sq1', personId: 'per_sq', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_sq2', personId: 'per_sq', step: 2, status: 'drafted', scheduled: '2026-08-07' });

  const queue = await buildQueue(await user(), FRIDAY);

  assert.equal(queue.followUps.length, 1, 'an empty Saturday screen reads as broken');
  assert.equal(queue.followUps[0].sendable, false, 'but the button is off');
  assert.match(queue.headline, /held until 2026-08-10/);
});

// ---------------------------------------------------------------------------
// Next Actions
// ---------------------------------------------------------------------------

test('a reply becomes a warm action that outranks everything cold', async () => {
  const { openActions, recordAction } = await import('../lib/poller');
  await person('per_na');

  const transition = await apply(classification(), 'per_na');
  await recordAction('usr_c', 'per_na', 'cmp_c', transition, null, NOW);
  // Idempotent: the sweep runs every fifteen minutes and must not stack cards.
  await recordAction('usr_c', 'per_na', 'cmp_c', transition, null, NOW);

  const actions = await openActions('usr_c');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'reply_assist');
  assert.equal(actions[0].companyName, 'Alpha Bank');
});

test('a resolved action does not come back, and a later one can be raised', async () => {
  const { openActions, recordAction, resolveAction } = await import('../lib/poller');
  await person('per_nb');

  const transition = await apply(classification(), 'per_nb');
  await recordAction('usr_c', 'per_nb', 'cmp_c', transition, null, NOW);
  const [action] = await openActions('usr_c');

  assert.equal(await resolveAction(action.id), true);
  assert.equal(await resolveAction(action.id), false, 'resolving twice is not an error state');
  assert.equal((await openActions('usr_c')).length, 0);

  await recordAction('usr_c', 'per_nb', 'cmp_c', transition, null, NOW);
  assert.equal((await openActions('usr_c')).length, 1, 'they can reply again');
});

// ---------------------------------------------------------------------------
// Classification without a model
// ---------------------------------------------------------------------------

test('a referral is caught by pattern, with no model available', async () => {
  // This is the classification whose failure cannot be undone: miss it and the
  // person who was warmly introduced receives a cold email from a stranger four
  // days later. It must not depend on an API key being set.
  const { classifyByPattern } = await import('../lib/classifier');
  const cases = [
    'Thanks for writing. Looping in Fatima who runs our Emiratisation programme.',
    'Please contact Sara Al Nuaimi about this, she handles our graduate intake.',
    'I have copied you in to Ahmed, he is the right person for this.',
    'Forwarding your note on to my colleague in Talent.',
  ];
  for (const body of cases) {
    const result = classifyByPattern({ from: 'x@y.ae', to: [], cc: [], subject: 'Re: hello', body, headers: {} });
    assert.equal(result?.classification, 'referral', body);
  }
});

test('a CV request is caught by pattern too, in either language', async () => {
  const { classifyByPattern } = await import('../lib/classifier');
  for (const body of [
    'Interesting. Please send your CV.',
    'Could you share a copy of your resume?',
    'أرسل لي السيرة الذاتية من فضلك',
  ]) {
    const result = classifyByPattern({ from: 'x@y.ae', to: [], cc: [], subject: 'Re: hello', body, headers: {} });
    assert.equal(result?.classification, 'document_request', body);
  }
});

test('an ordinary reply is not force-fitted into a pattern', async () => {
  // A false referral pauses a company for a day. The patterns are deliberately
  // conservative, and the model catches the rest when it is available.
  const { classifyByPattern } = await import('../lib/classifier');
  for (const body of [
    'Thanks, that is an interesting point about reconciliation costs.',
    'Which university are you at?',
    'We are not hiring at the moment.',
  ]) {
    const result = classifyByPattern({ from: 'x@y.ae', to: [], cc: [], subject: 'Re: hello', body, headers: {} });
    assert.equal(result, null, body);
  }
});

test('a departure still beats a referral when both could match', async () => {
  // "No longer with us, please contact X" is a departure: the person is gone,
  // and their evidence is stale. Ordering matters here.
  const { classifyByPattern } = await import('../lib/classifier');
  const result = classifyByPattern({
    from: 'x@y.ae',
    to: [],
    cc: [],
    subject: 'Re: hello',
    body: 'Khalid is no longer with the bank. Please contact Fatima Al Marri instead.',
    headers: {},
  });
  assert.equal(result?.classification, 'departed');
});

// ---------------------------------------------------------------------------
// Introductions
// ---------------------------------------------------------------------------

test('the person CC’d into a referral becomes a contact of their own', async () => {
  // "Looping in Sara who runs our Nafis programme" is the warmest contact this
  // user will ever have, and reducing it to an address throws away the half
  // that makes it usable.
  const { execute, queryOne } = await import('../lib/db/client');
  await person('per_ri');
  await outreach({ id: 'out_ri', personId: 'per_ri', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });

  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          to_addresses, cc_addresses, participants, classification, received_at, created_at)
     VALUES ('inb_ri', 'per_ri', 't1', 'gm_ri', 'per_ri@bank.ae', '["sara@example.com"]',
             '["s.alnuaimi@bank.ae"]',
             '[{"name":"Sara Al Nuaimi","email":"s.alnuaimi@bank.ae"},
               {"name":null,"email":"noreply@mailer.io"}]',
             'referral', ?, ?)`,
    [AT, AT]
  );

  const result = await apply(classification({ classification: 'referral' }), 'per_ri');

  const created = await queryOne<{
    full_name_raw: string;
    in_warm_thread: number;
    discovered_via: string;
    status: string;
  }>('SELECT full_name_raw, in_warm_thread, discovered_via, status FROM person WHERE email = ?', [
    's.alnuaimi@bank.ae',
  ]);

  assert.equal(created!.full_name_raw, 'Sara Al Nuaimi', 'the name exactly as the header rendered it');
  assert.equal(created!.discovered_via, 'referral');
  // Warm is a hard block on any cold sequence: this is a person to write to by
  // hand, in the thread they were introduced in.
  assert.equal(created!.in_warm_thread, 1);
  assert.match(result.summary, /Sara Al Nuaimi/);
});

test('a nameless address on a referral thread never becomes a contact', async () => {
  // "s.alnuaimi" is not what anybody is called, and a fabricated name would end
  // up in a salutation.
  const { execute, queryOne } = await import('../lib/db/client');
  await person('per_rn');
  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          participants, classification, received_at, created_at)
     VALUES ('inb_rn', 'per_rn', 't1', 'gm_rn', 'per_rn@bank.ae',
             '[{"name":null,"email":"someone@bank.ae"}]', 'referral', ?, ?)`,
    [AT, AT]
  );

  await apply(classification({ classification: 'referral' }), 'per_rn');
  assert.equal(await queryOne('SELECT id FROM person WHERE email = ?', ['someone@bank.ae']), null);
});

test('an address outside the company domain is left alone', async () => {
  // The user's own address is on every thread. Creating a contact row for the
  // person job-hunting would be absurd, and a personal Gmail on the CC line is
  // not a colleague.
  const { execute, queryOne } = await import('../lib/db/client');
  await person('per_ro');
  await execute(
    `INSERT INTO inbound (id, person_id, gmail_thread_id, gmail_message_id, from_address,
                          participants, classification, received_at, created_at)
     VALUES ('inb_ro', 'per_ro', 't1', 'gm_ro', 'per_ro@bank.ae',
             '[{"name":"Sara Al Marzooqi","email":"sara@example.com"}]', 'referral', ?, ?)`,
    [AT, AT]
  );

  await apply(classification({ classification: 'referral' }), 'per_ro');
  assert.equal(await queryOne('SELECT id FROM person WHERE email = ?', ['sara@example.com']), null);
});

// ---------------------------------------------------------------------------
// Confirming holiday windows
// ---------------------------------------------------------------------------

test('an unconfirmed window three days out raises exactly one task, ever', async () => {
  const { confirmationTasks, sweep } = await import('../lib/scheduler');
  const { execute, query } = await import('../lib/db/client');

  await execute(
    `INSERT INTO calendar_window (id, name, kind, start_date, end_date, confirmed, created_at, updated_at)
     VALUES ('cal_eid', 'Eid Al Adha', 'public_holiday', '2026-08-09', '2026-08-11', 0, ?, ?),
            ('cal_far', 'Eid Al Fitr', 'public_holiday', '2027-03-20', '2027-03-22', 0, ?, ?),
            ('cal_ok',  'National Day', 'public_holiday', '2026-08-09', '2026-08-10', 1, ?, ?)`,
    [AT, AT, AT, AT, AT, AT]
  );

  const tasks = await confirmationTasks('usr_c', NOW);
  assert.equal(tasks.length, 1, 'only the one about to arrive, and only if unconfirmed');
  assert.equal(tasks[0].name, 'Eid Al Adha');

  // The sweep runs every fifteen minutes. Four cards an hour is how a list
  // stops being read.
  await sweep(await user(), { now: NOW, poll: false, predraft: false });
  await sweep(await user(), { now: NOW, poll: false, predraft: false });
  await sweep(await user(), { now: NOW, poll: false, predraft: false });

  const rows = await query<{ kind: string; warm: number }>(
    'SELECT kind, warm FROM next_action WHERE resolved_at IS NULL'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].warm, 0, 'a calendar chore never sorts above someone who wrote to you');
});

test('a window that has already passed is nobody’s problem', async () => {
  const { confirmationTasks } = await import('../lib/scheduler');
  const { execute } = await import('../lib/db/client');
  await execute(
    `INSERT INTO calendar_window (id, name, kind, start_date, end_date, confirmed, created_at, updated_at)
     VALUES ('cal_past', 'Ramadan', 'ramadan_pause', '2026-03-01', '2026-03-20', 0, ?, ?)`,
    [AT, AT]
  );
  assert.equal((await confirmationTasks('usr_c', NOW)).length, 0);
});

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

test('a plain-text reply is read out of the Gmail payload', async () => {
  const { extractBody } = await import('../lib/poller');
  const body = extractBody({
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Happy to chat next week.').toString('base64url') } },
      { mimeType: 'text/html', body: { data: Buffer.from('<p>Happy to chat</p>').toString('base64url') } },
    ],
  });
  assert.equal(body, 'Happy to chat next week.');
});

test('an HTML-only auto-reply still yields its return date', async () => {
  // Vacation responders are frequently HTML tables. No body means the default
  // classification, which stops a sequence for no reason.
  const { extractBody } = await import('../lib/poller');
  const { extractReturnDate } = await import('../lib/classifier');
  const html = '<html><body><table><tr><td>I am back on 18 August.</td></tr></table></body></html>';
  const body = extractBody({
    mimeType: 'text/html',
    body: { data: Buffer.from(html).toString('base64url') },
  });
  assert.match(body, /back on 18 August/);
  assert.equal(extractReturnDate(body, '2026-08-06'), '2026-08-18');
});

test('an attachment is never mistaken for the message', async () => {
  const { extractBody } = await import('../lib/poller');
  const body = extractBody({
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('See attached.').toString('base64url') } },
      { mimeType: 'text/plain', filename: 'jd.txt', body: { data: Buffer.from('THE ENTIRE JOB DESCRIPTION').toString('base64url') } },
    ],
  });
  assert.equal(body, 'See attached.');
});

test('"back on 5 January" read in December means next January', async () => {
  const { extractReturnDate } = await import('../lib/classifier');
  assert.equal(extractReturnDate('I am back on 5 January.', '2026-12-28'), '2027-01-05');
  assert.equal(extractReturnDate('I am back on 5 January.', '2026-01-02'), '2026-01-05');
});

test('a display name containing a comma is one recipient, not two', async () => {
  const { addressList, addressOf } = await import('../lib/poller');
  assert.deepEqual(addressList('"Al Ketbi, Khalid" <k@bank.ae>, sara@example.com'), [
    'k@bank.ae',
    'sara@example.com',
  ]);
  assert.equal(addressOf('Fatima Al Marri <F.AlMarri@Bank.AE>'), 'f.almarri@bank.ae');
});

test('display names are kept, and a bare address never becomes one', async () => {
  const { addressEntries } = await import('../lib/poller');
  assert.deepEqual(addressEntries('"Sara Al Nuaimi" <s.alnuaimi@bank.ae>, plain@bank.ae'), [
    { name: 'Sara Al Nuaimi', email: 's.alnuaimi@bank.ae' },
    // `plain` as a "name" would end up in a salutation.
    { name: null, email: 'plain@bank.ae' },
  ]);
});

// ---------------------------------------------------------------------------
// The poller cannot blind itself
// ---------------------------------------------------------------------------

test('a thread that failed five times is retried daily, not retired forever', async () => {
  // `failures` is only reset by a successful fetch, so excluding failed threads
  // outright meant they could never succeed again. An hour of Gmail 500s across
  // five sweeps would have blinded the poller to every thread it had — silently,
  // permanently — while the countdowns kept running.
  const { execute, query } = await import('../lib/db/client');
  const at = '2026-08-04T06:00:00.000Z';
  await execute(
    `INSERT INTO thread_poll (gmail_thread_id, user_id, failures, active, last_polled_at, created_at, updated_at)
     VALUES ('t_dead', 'usr_c', 9, 1, ?, ?, ?)`,
    [at, at, at]
  );

  const { pollReplies } = await import('../lib/poller');
  const result = await pollReplies(await user(), NOW);
  assert.equal(result.threadsExamined, 1, 'yesterday it failed; today it gets another try');

  // And after a try today, it waits a day rather than being hammered.
  const same = await pollReplies(await user(), NOW);
  assert.equal(same.threadsExamined, 0);
  assert.equal((await query('SELECT 1 FROM thread_poll WHERE gmail_thread_id = ?', ['t_dead'])).length, 1);
});

test('a live thread nobody has read in six hours means blind, not healthy', async () => {
  // Hard rule 10 has no exception for "technically nothing failed". A thread
  // that has been erroring all morning is one we cannot see, whether or not
  // this particular pass happened to try it — and reporting healthy would
  // refresh the poll timestamp and unblock sending.
  const { execute } = await import('../lib/db/client');
  const { pollReplies } = await import('../lib/poller');
  const at = '2026-08-06T06:00:00.000Z';

  await person('per_blind', { status: 'in_sequence' });
  await outreach({
    id: 'out_blind',
    personId: 'per_blind',
    step: 1,
    status: 'sent',
    sentDate: '2026-08-03',
    threadId: 't_blind',
  });
  await execute(
    `INSERT INTO thread_poll (gmail_thread_id, user_id, failures, active, last_polled_at, created_at, updated_at)
     VALUES ('t_blind', 'usr_c', 99, 1, ?, ?, ?)`,
    [at, at, at]
  );

  // Eight hours later, still nothing readable from it.
  const result = await pollReplies(await user(), new Date('2026-08-06T14:00:00.000Z'));
  assert.equal(result.healthy, false, 'blind is blind');
});

test('a genuinely empty watch list is healthy', async () => {
  // A brand-new user has sent nothing. There is nothing to be blind about.
  const { pollReplies } = await import('../lib/poller');
  const result = await pollReplies(await user(), NOW);
  assert.equal(result.threadsExamined, 0);
  assert.equal(result.healthy, true);
});

// ---------------------------------------------------------------------------
// The gateway promise
// ---------------------------------------------------------------------------

test('clearing a gateway challenge restarts the sequence from today', async () => {
  // The card promises "one click, and the sequence restarts from day zero".
  // Nothing cleared `countdown_paused`, so the best contact at the company was
  // frozen until the five-day timeout dropped them.
  const { gatewayCleared } = await import('../lib/state-machine');
  const { queryOne } = await import('../lib/db/client');
  const { recordAction } = await import('../lib/poller');

  await person('per_gc', { status: 'in_sequence' });
  await outreach({ id: 'out_gc1', personId: 'per_gc', step: 1, status: 'sent', sentDate: '2026-08-03', threadId: 't1' });
  await outreach({ id: 'out_gc2', personId: 'per_gc', step: 2, status: 'queued', scheduled: '2026-08-06' });

  const transition = await apply(classification({ classification: 'gateway_challenge' }), 'per_gc');
  await recordAction('usr_c', 'per_gc', 'cmp_c', transition, null, NOW);

  await gatewayCleared('usr_c', 'per_gc', NOW);

  const row = await queryOne<{ countdown_paused: number; scheduled_date: string; regenerate_at_send: number }>(
    'SELECT countdown_paused, scheduled_date, regenerate_at_send FROM outreach WHERE id = ?',
    ['out_gc2']
  );
  assert.equal(row!.countdown_paused, 0, 'the clock starts again');
  // Day zero is today, not the original send: the recipient has only just been
  // handed the email.
  assert.equal(row!.scheduled_date, '2026-08-12');
  assert.equal(row!.regenerate_at_send, 1);

  const open = await queryOne('SELECT id FROM next_action WHERE person_id = ? AND resolved_at IS NULL', [
    'per_gc',
  ]);
  assert.equal(open, null, 'and the card is gone');
});

// ---------------------------------------------------------------------------
// The sweep respects the same gates the UI does
// ---------------------------------------------------------------------------

test('the sweep will not draft for someone the Review screen would refuse', async () => {
  // `personEligibility` is time-dependent — evidence goes stale at ninety days
  // — so a person who was eligible when sourced may not be when their turn
  // comes round, which is exactly the case a nightly sweep creates.
  const { execute, queryOne } = await import('../lib/db/client');
  const { sweep } = await import('../lib/scheduler');

  await person('per_el', { status: 'ready' });
  // No anchor source: the most fundamental blocker there is.
  await execute('UPDATE person SET anchor_source_url = NULL WHERE id = ?', ['per_el']);
  await outreach({ id: 'out_el', personId: 'per_el', step: 1, status: 'queued' });

  const result = await sweep(await user(), { now: NOW, poll: false });
  assert.equal(result.refused >= 1, true);

  const row = await queryOne<{ status: string; body: string }>(
    'SELECT status, body FROM outreach WHERE id = ?',
    ['out_el']
  );
  assert.equal(row!.status, 'needs_fact');
  assert.ok(row!.body.length > 0, 'and it says what would unblock it');
});
