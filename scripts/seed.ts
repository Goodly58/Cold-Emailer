/**
 * Seeds the working set: the UAE calendar, ~50 target companies, and a ranked
 * ladder plan per company. `npm run db:seed`.
 *
 * What this deliberately does NOT seed:
 *
 *   - People. A person row with an invented name would be a fabricated contact,
 *     and hard rule 2 exists precisely to make that impossible. Ladder slots
 *     are created with `person_id = NULL` — each one is a sourcing to-do for
 *     week 2, not a placeholder human.
 *   - The user's profile. It comes from the real interview; a seeded profile
 *     would put unverified claims into the evidence table.
 *
 * Idempotent: companies are matched on their canonical domain, so re-running
 * adds what is new and touches nothing else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureCalendarSeeded } from '../lib/calendar-store';
import { execute, queryOne } from '../lib/db/client';
import { newId, nowIso } from '../lib/ids';
import { logEvent } from '../lib/log';

interface SeedCompany {
  name: string;
  domain: string;
  sector: string | null;
  location: string | null;
  segment: 'private' | 'government' | 'semi_gov' | 'free_zone_only';
  emiratisation_notes: string | null;
  careers_url: string | null;
  email_pattern_hint: string | null;
  propensity: number;
}

/**
 * PLAN §4 and §11 Experiment 1. Arm A opens on the Emiratisation/HR lead —
 * cheap to source, and the Emirati signal is itself the relevance. Arm B opens
 * on the hiring manager and pays for full personalization. Both walk the same
 * three rungs; only the order differs, so the comparison is clean.
 */
const LADDERS = {
  A_hr_first: ['emiratisation_lead', 'hr', 'hiring_manager'],
  B_manager_first: ['hiring_manager', 'emiratisation_lead', 'hr'],
} as const;

/** Normalized domain — the key every per-company invariant is enforced on. */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

async function orgGroupFor(domain: string): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM org_group WHERE normalized_domain = ?',
    [domain]
  );
  if (existing) return existing.id;

  const id = newId('orgGroup');
  await execute('INSERT INTO org_group (id, normalized_domain, created_at) VALUES (?, ?, ?)', [
    id,
    domain,
    nowIso(),
  ]);
  return id;
}

async function main() {
  const calendar = await ensureCalendarSeeded();
  console.log(`calendar: ${calendar.added} window(s) added`);

  const companies: SeedCompany[] = JSON.parse(
    readFileSync(join(process.cwd(), 'seed', 'companies.json'), 'utf8')
  );

  let added = 0;
  let skipped = 0;

  // Alternate arms down the propensity-sorted list so the two arms are matched
  // on the signal we actually have, rather than randomly split and then
  // explained away later.
  const ordered = [...companies].sort((a, b) => b.propensity - a.propensity);

  for (const [index, c] of ordered.entries()) {
    const domain = normalizeDomain(c.domain);
    const existing = await queryOne<{ id: string }>('SELECT id FROM company WHERE domain = ?', [
      domain,
    ]);
    if (existing) {
      skipped++;
      continue;
    }

    const arm = index % 2 === 0 ? 'A_hr_first' : 'B_manager_first';
    const companyId = newId('company');
    const at = nowIso();

    await execute(
      `INSERT INTO company
         (id, org_group_id, name, domain, sector, location, segment,
          emiratisation_notes, careers_url, email_pattern_hint, propensity,
          experiment_arm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        await orgGroupFor(domain),
        c.name,
        domain,
        c.sector,
        c.location,
        c.segment,
        c.emiratisation_notes,
        c.careers_url,
        c.email_pattern_hint,
        c.propensity,
        arm,
        at,
        at,
      ]
    );

    for (const [i, contactType] of LADDERS[arm].entries()) {
      await execute(
        `INSERT INTO ladder_slot (id, company_id, rank, contact_type, person_id, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [newId('ladderSlot'), companyId, i + 1, contactType, at]
      );
    }

    await logEvent({
      event: 'company_seeded',
      entityType: 'company',
      entityId: companyId,
      detail: { name: c.name, domain, arm },
    });
    added++;
  }

  console.log(`companies: ${added} added, ${skipped} already present`);
  console.log(
    'ladder slots are empty on purpose — week 2 sourcing fills them with real people.'
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
