import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { updateDb } from '@/lib/store';
import seedJson from '@/data/db.json';
import { findByName, indexByName, nameKeys } from '@/lib/names';
import type { Company, Db } from '@/lib/types';

// Merges the repo's starter company list into the live database, adding only
// names that aren't already there. Idempotent — safe to run any time, and the
// way new starter companies reach an already-seeded Turso database.
export async function POST() {
  const seedCompanies = (seedJson as unknown as Db).companies;

  const result = await updateDb((db) => {
    // Name variants count as the same company: "Darktrace" you added yourself
    // and the starter list's "Darktrace (Dubai)" aren't two employers.
    const index = indexByName(db.companies);

    // Backfill fields added to the starter list since this database was seeded,
    // without touching anything the user has already filled in themselves.
    let enriched = 0;
    for (const seed of seedCompanies) {
      const live = findByName(index, seed.name);
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
      // Field tags: only where you haven't set them yourself.
      if (!live.interests && seed.interests) {
        live.interests = seed.interests;
        touched = true;
      }
      if (touched) enriched += 1;
    }

    const fresh: Company[] = [];
    for (const seed of seedCompanies) {
      if (findByName(index, seed.name)) continue;
      const row = { ...seed, id: randomUUID() };
      fresh.push(row);
      for (const key of nameKeys(row.name)) if (!index.has(key)) index.set(key, row);
    }
    db.companies.push(...fresh);
    return { added: fresh.length, enriched };
  });

  return NextResponse.json(result);
}
