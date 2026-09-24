import { NextRequest, NextResponse } from 'next/server';
import { getBlob, getBlobs, putBlob, putBlobs, readDb, writeDb } from '@/lib/store';
import { CV_BLOB_KEY } from '@/lib/cv';
import { jdKey } from '@/lib/importer';
import { COLLECTIONS, type Db } from '@/lib/types';

export const runtime = 'nodejs';

/** Download the whole database as JSON. */
export async function GET() {
  const db = await readDb();
  // The CV and job descriptions live outside the main database. The CV is
  // included, and so are descriptions for roles you've acted on or added by
  // hand; the rest can be fetched again from the boards.
  const cvText = await getBlob(CV_BLOB_KEY);
  const keep = db.applications.filter((a) => a.hasDescription && (!a.sourceId || a.stage !== 'found'));
  const jds = await getBlobs(keep.map((a) => jdKey(a.id)));
  const descriptions = Object.fromEntries(keep.filter((a) => jds.has(jdKey(a.id))).map((a) => [a.id, jds.get(jdKey(a.id))]));
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify({ ...db, cvText: cvText ?? undefined, descriptions }, null, 2), {
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

  const { cvText, descriptions } = incoming as { cvText?: unknown; descriptions?: unknown };
  delete (restored as unknown as Record<string, unknown>).cvText;
  delete (restored as unknown as Record<string, unknown>).descriptions;

  // Descriptions that came with the backup are restored; any other role is
  // un-flagged so the next refresh fetches its description again.
  const jdWrites: Array<[string, string]> = [];
  const jdMap = descriptions && typeof descriptions === 'object' ? (descriptions as Record<string, unknown>) : {};
  for (const app of restored.applications) {
    const text = jdMap[app.id];
    if (typeof text === 'string' && text.trim()) jdWrites.push([jdKey(app.id), text.slice(0, 20_000)]);
    else if (app.hasDescription) app.hasDescription = false;
  }

  await writeDb(restored);
  if (typeof cvText === 'string' && cvText.trim()) await putBlob(CV_BLOB_KEY, cvText);
  await putBlobs(jdWrites);

  return NextResponse.json({
    ok: true,
    counts: Object.fromEntries(COLLECTIONS.map((k) => [k, (restored[k] as unknown[]).length])),
  });
}
