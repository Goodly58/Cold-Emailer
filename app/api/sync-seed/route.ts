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
/**
 * Starter template bodies that have since been corrected. A template still
 * reading exactly like one of these was never edited, so it's safe to bring
 * up to date; one you've changed is left alone.
 */
const SUPERSEDED_BODIES: Record<string, string[]> = {
  // Nafis stopped covering the employer's pension share in September 2026.
  t2: ["Dear {{firstName}},\n\nI'm an Emirati professional ({{headline}}) exploring {{role}} opportunities at {{company}}.\n\nBeyond the fit for the role itself, I understand hiring UAE Nationals is a priority — my hire counts toward your MoHRE Emiratisation targets, and Nafis support (salary top-up and employer pension contribution) applies.\n\n{{hook}}\n\nWould you be open to a short call this week, or could you point me to the right hiring manager?\n\nWith thanks,\n{{myName}}\n{{linkedin}} | {{phone}}"],
};

export async function POST() {
  const seed = seedJson as unknown as Db;

  const result = await updateDb((db) => {
    const events = missingById<CareerEvent>(db.events, seed.events || []);
    const templates = missingById<Template>(db.templates, seed.templates || []);
    db.events.push(...events);
    db.templates.push(...templates);

    let updated = 0;
    for (const t of db.templates) {
      const current = seed.templates.find((x) => x.id === t.id);
      if (current && SUPERSEDED_BODIES[t.id]?.includes(t.body)) {
        t.body = current.body;
        updated += 1;
      }
    }
    return { events: events.length, templates: templates.length, templatesUpdated: updated };
  });

  return NextResponse.json(result);
}
