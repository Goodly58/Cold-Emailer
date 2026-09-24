import { NextRequest, NextResponse } from 'next/server';
import { readDb, updateDb } from '@/lib/store';
import { ValidationError, sanitize } from '@/lib/validate';
import { isInterestId } from '@/lib/interests';
import { RANKING_FIELDS, rescoreAll } from '@/lib/rescore';

export const runtime = 'nodejs';

export async function GET() {
  const db = await readDb();
  return NextResponse.json(db.profile);
}

/** Fields the CV endpoint owns; editing them by hand would desync the text. */
const CV_BOOKKEEPING = ['cvUpdatedAt', 'cvWords', 'cvSource'];

export async function PATCH(req: NextRequest) {
  let patch: Record<string, unknown>;
  try {
    patch = sanitize(await req.json());
  } catch (e) {
    const message = e instanceof ValidationError ? e.message : 'body was not valid JSON';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  for (const key of CV_BOOKKEEPING) delete patch[key];
  if ('interests' in patch) {
    patch.interests = Array.isArray(patch.interests) ? [...new Set(patch.interests.filter(isInterestId))] : [];
  }

  const profile = await updateDb((db) => {
    const before = JSON.stringify(RANKING_FIELDS.map((k) => db.profile[k] ?? null));
    Object.assign(db.profile, patch);
    // Changing what you're looking for re-ranks what's already in the pipeline.
    if (JSON.stringify(RANKING_FIELDS.map((k) => db.profile[k] ?? null)) !== before) rescoreAll(db);
    return db.profile;
  });
  return NextResponse.json(profile);
}
