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

  const added = await updateDb((db) => {
    const existing = new Set(db.companies.map((c) => c.name.trim().toLowerCase()));
    const missing = seedCompanies.filter((c) => !existing.has(c.name.trim().toLowerCase()));
    const fresh: Company[] = missing.map((c) => ({ ...c, id: randomUUID() }));
    db.companies.push(...fresh);
    return fresh.length;
  });

  return NextResponse.json({ added });
}
