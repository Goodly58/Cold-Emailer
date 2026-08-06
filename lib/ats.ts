// Public ATS board APIs. These power companies' own careers pages, so polling
// them is exactly what they're published for — no scraping, no ToS problem.
//
// Platform definitions live in ats-registry.ts; this module holds the slug
// derivation and discovery logic built on top of them.

import { mapWithConcurrency } from './http';
import {
  PLATFORM_DEFS,
  PLATFORMS,
  fetchJobsFor,
  getPlatform,
  isPlatform,
  validSlug,
  type AtsJob,
  type Platform,
  type PlatformDef,
} from './ats-registry';

export {
  PLATFORM_DEFS,
  PLATFORMS,
  fetchJobsFor,
  getPlatform,
  isPlatform,
  validSlug,
};
export type { AtsJob, Platform, PlatformDef };

/** Fetch a board identified by a single slug (the common case). */
export async function fetchJobs(
  platform: string,
  slug: string,
  config: Record<string, string> = {}
): Promise<AtsJob[]> {
  return fetchJobsFor(platform, { ...config, slug });
}

/** Plausible board slugs for a company name, most likely first. */
export function slugCandidates(companyName: string): string[] {
  const stopWords = new Set([
    'group', 'holding', 'holdings', 'company', 'co', 'corporation', 'corp', 'llc',
    'plc', 'pjsc', 'psc', 'limited', 'ltd', 'inc', 'the', 'uae', 'emirates',
    'middle', 'east', 'mena', 'international', 'national',
  ]);

  const base = companyName
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = base.split(' ').filter(Boolean);
  const meaningful = words.filter((w) => !stopWords.has(w));

  const out = new Set<string>();
  const add = (s: string) => {
    if (s && validSlug(s)) out.add(s);
  };

  add(meaningful.join(''));
  add(meaningful.join('-'));
  add(words.join(''));
  add(words.join('-'));
  if (meaningful[0] && meaningful[0].length > 2) add(meaningful[0]);
  if (meaningful.length > 1) add(meaningful.slice(0, 2).join(''));

  return [...out];
}

export interface DiscoveredBoard {
  platform: Platform;
  slug: string;
  jobCount: number;
}

/**
 * Work out which ATS a company uses by trying its name as a slug on each
 * discoverable platform. Bounded so a bulk sweep can't open hundreds of
 * sockets, and retries are off — a wrong guess should fail fast.
 *
 * Enterprise platforms (Workday, Oracle) are excluded: they need identifiers
 * that can't be guessed from a company name, so probing them would be pure
 * wasted requests.
 */
export async function discoverBoards(
  companyName: string,
  concurrency = 8
): Promise<DiscoveredBoard[]> {
  const candidates = slugCandidates(companyName);
  const discoverable = PLATFORM_DEFS.filter((p) => p.discoverable);

  const attempts: Array<{ platform: string; slug: string }> = [];
  for (const def of discoverable) {
    for (const slug of candidates) {
      attempts.push({ platform: def.id, slug });
    }
  }

  const results = await mapWithConcurrency(attempts, concurrency, async ({ platform, slug }) => {
    try {
      const jobs = await fetchJobsFor(platform, { slug }, { retries: 0, timeoutMs: 8000 });
      return jobs.length > 0 ? { platform, slug, jobCount: jobs.length } : null;
    } catch {
      return null;
    }
  });

  return results
    .filter((r): r is DiscoveredBoard => r !== null)
    .sort((a, b) => b.jobCount - a.jobCount);
}

/** Does this role match the source's keyword filter? Blank filter keeps all. */
export function matchesKeywords(job: AtsJob, keywords?: string): boolean {
  if (!keywords?.trim()) return true;
  const haystack = `${job.title} ${job.location} ${job.department || ''}`.toLowerCase();
  return keywords
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => haystack.includes(k));
}
