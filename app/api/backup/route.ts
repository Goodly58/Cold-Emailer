import { NextRequest, NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/store';
import { COLLECTIONS, type Db } from '@/lib/types';

export const runtime = 'nodejs';

/** Download the whole database as JSON. */
export async function GET() {
  const db = await readDb();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(db, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="job-search-backup-${stamp}.json"`,
    },
  });
}

/** Restore from a backup file. Replaces everything — destructive by design. */
export async function POST(req: NextRequest) {
  let incoming: unknown;
  try {
    incoming = await req.json();
  } catch {
    return NextResponse.json({ error: 'not valid JSON' }, { status: 400 });
  }

  if (!incoming || typeof incoming !== 'object') {
    return NextResponse.json({ error: 'backup must be a JSON object' }, { status: 400 });
  }

  const candidate = incoming as Partial<Db>;
  if (!candidate.profile || typeof candidate.profile !== 'object') {
    return NextResponse.json({ error: 'backup is missing a profile — is this the right file?' }, { status: 400 });
  }
  for (const key of COLLECTIONS) {
    if (candidate[key] !== undefined && !Array.isArray(candidate[key])) {
      return NextResponse.json({ error: `"${key}" should be an array` }, { status: 400 });
    }
  }

  const current = await readDb();
  const restored = { ...current, ...candidate } as Db;
  // Any collection missing from the backup keeps its current contents rather
  // than becoming undefined.
  for (const key of COLLECTIONS) {
    if (!Array.isArray(restored[key])) {
      (restored[key] as unknown[]) = [];
    }
  }

  await writeDb(restored);

  return NextResponse.json({
    ok: true,
    counts: Object.fromEntries(COLLECTIONS.map((k) => [k, (restored[k] as unknown[]).length])),
  });
}
