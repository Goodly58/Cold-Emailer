import { NextRequest, NextResponse } from 'next/server';
import { updateDb } from '@/lib/store';
import { COLLECTIONS, type CollectionName } from '@/lib/types';

function validResource(resource: string): resource is CollectionName {
  return (COLLECTIONS as string[]).includes(resource);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const { resource, id } = await params;
  if (!validResource(resource)) {
    return NextResponse.json({ error: 'unknown resource' }, { status: 404 });
  }
  const patch = await req.json();
  const updated = await updateDb((db) => {
    const list = db[resource] as Array<{ id: string }>;
    const item = list.find((x) => x.id === id);
    if (!item) return null;
    Object.assign(item, patch, { id: item.id });
    return item;
  });
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ resource: string; id: string }> }
) {
  const { resource, id } = await params;
  if (!validResource(resource)) {
    return NextResponse.json({ error: 'unknown resource' }, { status: 404 });
  }
  const removed = await updateDb((db) => {
    const list = db[resource] as Array<{ id: string }>;
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  });
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
