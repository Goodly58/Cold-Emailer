/**
 * The hard rules are enforced in code, not comments (ULTRAPROMPT §3). These
 * tests prove the database itself refuses the states the register says must be
 * unreachable — a constraint the founder cannot write around at 11pm is worth
 * more than any amount of documentation.
 *
 * Each test runs against a fresh temporary database.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-schema-'));
  process.env.DB_PATH = join(dir, 'test.db');
});

after(async () => {
  const { closeDb } = await import('../lib/db/client');
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function db() {
  return (await import('../lib/db/client')).getDb();
}

/** Runs a statement and reports whether the database refused it. */
async function refuses(sql: string, args: unknown[] = []): Promise<boolean> {
  const client = await db();
  try {
    await client.execute({ sql, args: args as never });
    return false;
  } catch {
    return true;
  }
}

async function seedCompany(suffix = ''): Promise<string> {
  const client = await db();
  const org = `org_test${suffix}`;
  const cmp = `cmp_test${suffix}`;
  await client.execute({
    sql: 'INSERT INTO org_group (id, normalized_domain, created_at) VALUES (?, ?, ?)',
    args: [org, `example${suffix}.ae`, '2026-08-06T00:00:00.000Z'],
  });
  await client.execute({
    sql: `INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [cmp, org, `Example${suffix}`, `example${suffix}.ae`, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'],
  });
  return cmp;
}

async function seedUser(id = 'usr_test'): Promise<string> {
  const client = await db();
  await client.execute({
    sql: 'INSERT INTO app_user (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    args: [id, 'Test User', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'],
  });
  return id;
}

function personSql(overrides: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    id: 'per_x',
    company_id: 'cmp_test',
    full_name_raw: 'Ahmed Al Mansoori',
    phonetic_key: 'ahmed almansoori',
    contact_type: 'hr',
    source_tier: 2,
    created_at: '2026-08-06T00:00:00.000Z',
    updated_at: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
  const cols = Object.keys(base);
  return {
    sql: `INSERT INTO person (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    args: Object.values(base),
  };
}

test('migrations apply cleanly and record themselves', async () => {
  const client = await db();
  const applied = await client.execute('SELECT name FROM _migration');
  assert.ok(applied.rows.length >= 1, 'at least one migration recorded');
});

// ---------------------------------------------------------------------------
// CULTURE.md §10: honorifics are copied from a source, never derived
// ---------------------------------------------------------------------------

test('an honorific with no source is unreachable, not merely discouraged', async () => {
  await seedCompany();
  const derived = personSql({ honorific_declared: 'Dr.' }); // honorific_source defaults to 'none'
  assert.equal(await refuses(derived.sql, derived.args), true);

  const noUrl = personSql({ honorific_declared: 'Eng.', honorific_source: 'email_signature' });
  assert.equal(
    await refuses(noUrl.sql, noUrl.args),
    true,
    'a source without the URL that proves it is still derivation'
  );

  const copied = personSql({
    id: 'per_ok',
    honorific_declared: 'Dr.',
    honorific_source: 'org_leadership_page',
    honorific_source_url: 'https://example.ae/leadership',
  });
  assert.equal(await refuses(copied.sql, copied.args), false, 'a copied honorific is accepted');
});

test('an invented honorific is not even a valid value', async () => {
  const bogus = personSql({ id: 'per_bogus', honorific_declared: 'Ustadh', honorific_source: 'press_release', honorific_source_url: 'https://x' });
  assert.equal(await refuses(bogus.sql, bogus.args), true);
});

// ---------------------------------------------------------------------------
// Transliteration twins (register: "Transliteration variants create duplicate
// people and twin sequences")
// ---------------------------------------------------------------------------

test('one company cannot hold two rungs for the same transliterated name', async () => {
  const twin = personSql({ id: 'per_twin', phonetic_key: 'ahmed almansoori', full_name_raw: 'Ahmad AlMansouri' });
  assert.equal(await refuses(twin.sql, twin.args), true);
});

// ---------------------------------------------------------------------------
// HARD RULE 2: every claim traces to an evidence row with a source URL
// ---------------------------------------------------------------------------

test('evidence without a source URL cannot be stored', async () => {
  assert.equal(
    await refuses(
      `INSERT INTO evidence (id, company_id, tier, quote, captured_at, created_at, updated_at)
       VALUES ('evd_nourl', 'cmp_test', 3, 'they said a thing', 'x', 'x', 'x')`
    ),
    true
  );
});

test('an unusable evidence row must say why it is unusable', async () => {
  // The Review panel greys blocked rows and shows the reason, so the user
  // understands why the hook is the second-best fact rather than distrusting it.
  assert.equal(
    await refuses(
      `INSERT INTO evidence (id, company_id, tier, quote, source_url, captured_at, usable, created_at, updated_at)
       VALUES ('evd_noreason', 'cmp_test', 1, 'q', 'https://x', 'x', 0, 'x', 'x')`
    ),
    true
  );
  assert.equal(
    await refuses(
      `INSERT INTO evidence (id, company_id, tier, quote, source_url, captured_at, usable, unusable_reason, created_at, updated_at)
       VALUES ('evd_reason', 'cmp_test', 1, 'q', 'https://x', 'x', 0, 'bereavement', 'x', 'x')`
    ),
    false
  );
});

test('a profile claim is an evidence row too, so self-claims obey the same rule', async () => {
  await seedUser();
  assert.equal(
    await refuses(
      `INSERT INTO evidence (id, kind, user_id, tier, quote, source_url, captured_at, created_at, updated_at)
       VALUES ('evd_self', 'profile_claim', 'usr_test', 3, 'led a team of 20', 'interview://ans_1', 'x', 'x', 'x')`
    ),
    false
  );
  // …and an external row still needs a company.
  assert.equal(
    await refuses(
      `INSERT INTO evidence (id, kind, tier, quote, source_url, captured_at, created_at, updated_at)
       VALUES ('evd_orphan', 'external', 3, 'q', 'https://x', 'x', 'x', 'x')`
    ),
    true
  );
});

// ---------------------------------------------------------------------------
// HARD RULE 8: idempotent sends
// ---------------------------------------------------------------------------

test('a person cannot hold two rows for the same step, so a double sweep is a no-op', async () => {
  const client = await db();
  await client.execute(
    `INSERT INTO outreach (id, person_id, user_id, step, created_at, updated_at)
     VALUES ('out_1', 'per_ok', 'usr_test', 1, 'x', 'x')`
  );
  assert.equal(
    await refuses(
      `INSERT INTO outreach (id, person_id, user_id, step, created_at, updated_at)
       VALUES ('out_2', 'per_ok', 'usr_test', 1, 'x', 'x')`
    ),
    true
  );
});

test('there is no fourth touch — the cap is structural, not configurable', async () => {
  assert.equal(
    await refuses(
      `INSERT INTO outreach (id, person_id, user_id, step, created_at, updated_at)
       VALUES ('out_4', 'per_ok', 'usr_test', 4, 'x', 'x')`
    ),
    true
  );
});

test('two rows cannot claim the same RFC822 Message-ID', async () => {
  const client = await db();
  await client.execute(
    `UPDATE outreach SET rfc822_message_id = '<a@engine>' WHERE id = 'out_1'`
  );
  await client.execute(
    `INSERT INTO outreach (id, person_id, user_id, step, created_at, updated_at)
     VALUES ('out_3', 'per_ok', 'usr_test', 2, 'x', 'x')`
  );
  assert.equal(
    await refuses(`UPDATE outreach SET rfc822_message_id = '<a@engine>' WHERE id = 'out_3'`),
    true
  );
});

// ---------------------------------------------------------------------------
// HARD RULE 11: suppression is permanent and global
// ---------------------------------------------------------------------------

test('suppression rows are unique per person and per domain', async () => {
  const client = await db();
  await client.execute(
    `INSERT INTO suppression (id, email_hash, scope, reason, created_at)
     VALUES ('sup_1', 'deadbeef', 'person', 'removal_request', 'x')`
  );
  assert.equal(
    await refuses(
      `INSERT INTO suppression (id, email_hash, scope, reason, created_at)
       VALUES ('sup_2', 'deadbeef', 'person', 'removal_request', 'x')`
    ),
    true
  );

  await client.execute(
    `INSERT INTO suppression (id, domain, scope, reason, created_at)
     VALUES ('sup_3', 'example.ae', 'domain', 'complaint_escalation', 'x')`
  );
  assert.equal(
    await refuses(
      `INSERT INTO suppression (id, domain, scope, reason, created_at)
       VALUES ('sup_4', 'example.ae', 'domain', 'complaint_escalation', 'x')`
    ),
    true
  );
});

test('a suppression row must carry the key its scope is enforced on', async () => {
  assert.equal(
    await refuses(
      `INSERT INTO suppression (id, scope, reason, created_at) VALUES ('sup_5', 'person', 'manual', 'x')`
    ),
    true
  );
});

// ---------------------------------------------------------------------------
// Global keying (register: "The schema must be global-keyed or the
// collision-moat ledger can never exist")
// ---------------------------------------------------------------------------

test('company domain and person email are unique across all users', async () => {
  const client = await db();
  await client.execute(
    `INSERT INTO org_group (id, normalized_domain, created_at) VALUES ('org_dupe', 'other.ae', 'x')`
  );
  assert.equal(
    await refuses(
      `INSERT INTO company (id, org_group_id, name, domain, created_at, updated_at)
       VALUES ('cmp_dupe', 'org_dupe', 'Example again', 'example.ae', 'x', 'x')`
    ),
    true,
    'two company rows cannot claim one canonical domain'
  );

  await client.execute(
    `UPDATE person SET email = 'ahmed@example.ae' WHERE id = 'per_ok'`
  );
  const other = await seedCompany('2');
  const dupEmail = personSql({
    id: 'per_other',
    company_id: other,
    phonetic_key: 'someone else',
    full_name_raw: 'Someone Else',
    email: 'ahmed@example.ae',
  });
  assert.equal(await refuses(dupEmail.sql, dupEmail.args), true);
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

test('editing a calendar window bumps the version stamp', async () => {
  const { ensureCalendarSeeded, addWindow, updateWindow, currentCalendarVersion } = await import(
    '../lib/calendar-store'
  );
  await ensureCalendarSeeded();

  const before = await currentCalendarVersion();
  const id = await addWindow({
    name: 'Test Eid',
    kind: 'public_holiday',
    start: '2026-09-01',
    end: '2026-09-03',
    confirmed: false,
  });
  const afterAdd = await currentCalendarVersion();
  assert.ok(afterAdd > before, 'adding a window bumps the version');

  await updateWindow(id, {
    name: 'Test Eid',
    kind: 'public_holiday',
    start: '2026-09-02',
    end: '2026-09-04',
    confirmed: true,
  });
  assert.ok(
    (await currentCalendarVersion()) > afterAdd,
    'confirming the dates bumps it again, so stale derived dates are detectable'
  );
});

test('a window that ends before it starts is refused', async () => {
  const { addWindow } = await import('../lib/calendar-store');
  await assert.rejects(() =>
    addWindow({ name: 'Backwards', kind: 'public_holiday', start: '2026-09-05', end: '2026-09-01', confirmed: true })
  );
});

test('the seed round-trips into the shape nextDue() consumes', async () => {
  const { loadCalendar } = await import('../lib/calendar-store');
  const { nextDue } = await import('../lib/calendar');
  const calendar = await loadCalendar();

  assert.ok(calendar.windows.length > 0);
  assert.ok(calendar.version >= 1);
  // National Day week: a send on Mon 30 Nov 2026 with a +4 countdown has to
  // step over the confirmed 1-3 Dec window.
  const due = nextDue('2026-11-30', 4, calendar);
  assert.ok(due > '2026-12-03', `expected the countdown to clear National Day, got ${due}`);
});

test('every Islamic window ships unconfirmed, so nothing warm fires on a guessed date', async () => {
  const { SEED_WINDOWS } = await import('../lib/calendar-store');
  for (const w of SEED_WINDOWS) {
    if (/estimated/i.test(w.name)) {
      assert.equal(w.confirmed, false, `${w.name} must ship unconfirmed`);
      assert.ok(w.note && w.note.length > 0, `${w.name} must say why`);
    }
  }
});
