import { NextRequest, NextResponse } from 'next/server';
import { readDb, updateDb } from '@/lib/store';

export async function GET() {
  const db = await readDb();
  return NextResponse.json(db.profile);
}

export async function PATCH(req: NextRequest) {
  const patch = await req.json();
  const profile = await updateDb((db) => {
    Object.assign(db.profile, patch);
    return db.profile;
  });
  return NextResponse.json(profile);
}
