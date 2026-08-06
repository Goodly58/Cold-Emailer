import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { updateDb } from '@/lib/store';
import { COLLECTION_LIMITS } from '@/lib/validate';
import type { Company, Tier } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TIERS = new Set<Tier>(['dream', 'target', 'backup']);

/** Same canonicalisation the seed merge uses, so imports dedupe consistently. */
const NOISE =
  /\b(the|group|holding|holdings|company|co|corporation|corp|llc|plc|pjsc|psc|limited|ltd|inc|uae)\b/gi;

function canonical(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, '');
}

function cleanDomain(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) ? d : undefined;
}

/**
 * Bulk-add companies from pasted JSON or CSV. Deduplicates against what's
 * already stored and enriches existing rows rather than overwriting them, so
 * re-importing an updated list is safe.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = Array.isArray(body?.companies) ? body.companies : null;

  if (!rows) {
    return NextResponse.json(
      { error: 'send { "companies": [ { "name": "...", ... } ] }' },
      { status: 400 }
    );
  }
  if (rows.length > 2000) {
    return NextResponse.json({ error: 'at most 2000 companies per import' }, { status: 400 });
  }

  const result = await updateDb((db) => {
    const byKey = new Map(db.companies.map((c) => [canonical(c.name), c]));
    let added = 0;
    let enriched = 0;
    let skipped = 0;

    for (const raw of rows) {
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      if (!name || name.length > 120) {
        skipped += 1;
        continue;
      }
      const key = canonical(name);
      if (!key) {
        skipped += 1;
        continue;
      }

      const domain = cleanDomain(raw.domain);
      const careersUrl =
        typeof raw.careersUrl === 'string' && raw.careersUrl.startsWith('http')
          ? raw.careersUrl.trim()
          : undefined;

      const existing = byKey.get(key);
      if (existing) {
        let touched = false;
        if (domain && !existing.domain) {
          existing.domain = domain;
          existing.emailPattern = existing.emailPattern || 'first.last';
          touched = true;
        }
        if (careersUrl && !existing.careersUrl) {
          existing.careersUrl = careersUrl;
          touched = true;
        }
        if (touched) enriched += 1;
        continue;
      }

      if (db.companies.length >= COLLECTION_LIMITS.companies) {
        skipped += 1;
        continue;
      }

      const company: Company = {
        id: randomUUID(),
        name,
        sector: typeof raw.sector === 'string' ? raw.sector.trim().slice(0, 60) : 'Other',
        location: typeof raw.location === 'string' ? raw.location.trim().slice(0, 60) : 'UAE',
        tier: TIERS.has(raw.tier) ? raw.tier : 'target',
        emiratisation: raw.emiratisation !== false,
        createdAt: new Date().toISOString(),
      };
      if (domain) {
        company.domain = domain;
        company.emailPattern = 'first.last';
      }
      if (careersUrl) company.careersUrl = careersUrl;
      if (typeof raw.emiratisationNotes === 'string') {
        company.emiratisationNotes = raw.emiratisationNotes.slice(0, 500);
      }

      db.companies.push(company);
      byKey.set(key, company);
      added += 1;
    }

    return { added, enriched, skipped, total: db.companies.length };
  });

  return NextResponse.json(result);
}
