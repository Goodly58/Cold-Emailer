import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readDb, updateDb } from '@/lib/store';
import { COLLECTIONS, type CollectionName } from '@/lib/types';

function validResource(resource: string): resource is CollectionName {
  return (COLLECTIONS as string[]).includes(resource);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const { resource } = await params;
  if (!validResource(resource)) {
    return NextResponse.json({ error: 'unknown resource' }, { status: 404 });
  }
  const db = await readDb();
  return NextResponse.json(db[resource]);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const { resource } = await params;
  if (!validResource(resource)) {
    return NextResponse.json({ error: 'unknown resource' }, { status: 404 });
  }
  const body = await req.json();
  const item = { ...body, id: randomUUID(), createdAt: new Date().toISOString() };
  await updateDb((db) => {
    (db[resource] as unknown[]).unshift(item);
  });
  return NextResponse.json(item, { status: 201 });
}
