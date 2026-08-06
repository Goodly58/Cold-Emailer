import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { updateDb } from '@/lib/store';
import seedJson from '@/data/db.json';
import type { Company, Db } from '@/lib/types';

// Merges the repo's starter company list into the live database, adding only
// names that aren't already there. Idempotent — safe to run any time, and the
// way new starter companies reach an already-seeded Turso database.
export async function POST() {
  const seedCompanies = (seedJson as unknown as Db).companies;

  const result = await updateDb((db) => {
    const byName = new Map(db.companies.map((c) => [c.name.trim().toLowerCase(), c]));

    // Backfill fields added to the starter list since this database was seeded,
    // without touching anything the user has already filled in themselves.
    let enriched = 0;
    for (const seed of seedCompanies) {
      const live = byName.get(seed.name.trim().toLowerCase());
      if (!live) continue;
      let touched = false;
      if (!live.domain && seed.domain) {
        live.domain = seed.domain;
        touched = true;
      }
      if (!live.emailPattern && seed.emailPattern) {
        live.emailPattern = seed.emailPattern;
        touched = true;
      }
      if (!live.careersUrl && seed.careersUrl) {
        live.careersUrl = seed.careersUrl;
        touched = true;
      }
      if (!live.emiratisationNotes && seed.emiratisationNotes) {
        live.emiratisationNotes = seed.emiratisationNotes;
        touched = true;
      }
      if (touched) enriched += 1;
    }

    const missing = seedCompanies.filter((c) => !byName.has(c.name.trim().toLowerCase()));
    const fresh: Company[] = missing.map((c) => ({ ...c, id: randomUUID() }));
    db.companies.push(...fresh);
    return { added: fresh.length, enriched };
  });

  return NextResponse.json(result);
}
