import { NextRequest, NextResponse } from 'next/server';
import { readDb, updateDb } from '@/lib/store';
import { ValidationError, sanitize } from '@/lib/validate';

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

  const profile = await updateDb((db) => {
    Object.assign(db.profile, patch);
    return db.profile;
  });
  return NextResponse.json(profile);
}
