import { NextResponse } from 'next/server';
import { updateDb } from '@/lib/store';
import { missingById } from '@/lib/events';
import seedJson from '@/data/db.json';
import type { CareerEvent, Db, Template } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Brings reference data added to the starter set since this database was
 * first seeded — new events and email templates — into the live database.
 *
 * The store only seeds a database that's completely empty, so without this a
 * deployment that has been running for a while would never see them.
 * Matches on id and only ever adds; nothing the user has edited is touched,
 * and hidden events still exist, so they stay hidden.
 */
export async function POST() {
  const seed = seedJson as unknown as Db;

  const result = await updateDb((db) => {
    const events = missingById<CareerEvent>(db.events, seed.events || []);
    const templates = missingById<Template>(db.templates, seed.templates || []);
    db.events.push(...events);
    db.templates.push(...templates);
    return { events: events.length, templates: templates.length };
  });

  return NextResponse.json(result);
}
