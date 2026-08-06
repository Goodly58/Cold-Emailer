import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { updateDb } from '@/lib/store';
import { getPlatform, validSlug } from '@/lib/ats';
import type { JobSource } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Registers job sources for every company whose ATS is already known from the
 * seeded data — no network probing needed. Run this before the discovery
 * sweep so the sweep only has to work on the unknowns.
 */
export async function POST() {
  const result = await updateDb((db) => {
    const taken = new Set(
      db.jobSources.map((s) => `${s.platform}:${s.slug}`.toLowerCase())
    );
    const byCompany = new Set(db.jobSources.map((s) => s.companyName.trim().toLowerCase()));

    let added = 0;
    const skipped: string[] = [];

    for (const company of db.companies) {
      if (!company.ats || !company.atsSlug) continue;
      if (byCompany.has(company.name.trim().toLowerCase())) continue;

      const platform = company.ats.toLowerCase();
      const slug = company.atsSlug.trim().toLowerCase();
      const def = getPlatform(platform);

      // Register only what will actually poll. A platform we support but whose
      // extra identifiers we don't have (Workday needs a data centre and site
      // name) would produce a source that fails on every run — worse than not
      // creating it, because it looks like coverage.
      if (!def || !validSlug(slug) || def.fields.some((f) => f.required)) {
        skipped.push(`${company.name} (${company.ats})`);
        continue;
      }
      if (taken.has(`${platform}:${slug}`)) continue;

      const source: JobSource = {
        id: randomUUID(),
        companyName: company.name,
        platform,
        slug,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      db.jobSources.push(source);
      taken.add(`${platform}:${slug}`);
      byCompany.add(company.name.trim().toLowerCase());
      added += 1;
    }

    return { added, unsupported: skipped };
  });

  return NextResponse.json(result);
}
