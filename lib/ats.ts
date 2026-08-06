// Public ATS board APIs. These power companies' own careers pages, so polling
// them is exactly what they're published for — no scraping, no ToS problem.

import { fetchJson, mapWithConcurrency } from './http';

export const PLATFORMS = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'smartrecruiters',
  'recruitee',
] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface AtsJob {
  title: string;
  location: string;
  url: string;
  /** Team/department when the board exposes it — becomes the division. */
  department?: string;
}

export function isPlatform(x: string): x is Platform {
  return (PLATFORMS as readonly string[]).includes(x);
}

export function validSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(slug);
}

const ENDPOINTS: Record<Platform, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  workable: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`,
  smartrecruiters: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings`,
  recruitee: (s) => `https://${s}.recruitee.com/api/offers/`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const PARSERS: Record<Platform, (data: any, slug: string) => AtsJob[]> = {
  greenhouse: (d) =>
    (d?.jobs || []).map((j: any) => ({
      title: j.title,
      location: j.location?.name || '',
      url: j.absolute_url,
      department: j.departments?.[0]?.name || j.metadata?.department || '',
    })),
  lever: (d) =>
    (Array.isArray(d) ? d : []).map((j: any) => ({
      title: j.text,
      location: j.categories?.location || '',
      url: j.hostedUrl,
      department: j.categories?.team || j.categories?.department || '',
    })),
  ashby: (d) =>
    (d?.jobs || []).map((j: any) => ({
      title: j.title,
      location: j.location || '',
      url: j.jobUrl || j.applyUrl || '',
      department: j.department || j.team || '',
    })),
  workable: (d) =>
    (d?.jobs || []).map((j: any) => ({
      title: j.title,
      location: [j.city, j.country].filter(Boolean).join(', '),
      url: j.url,
      department: j.department || '',
    })),
  smartrecruiters: (d, slug) =>
    (d?.content || []).map((j: any) => ({
      title: j.name,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
      department: j.department?.label || j.function?.label || '',
    })),
  recruitee: (d) =>
    (d?.offers || []).map((j: any) => ({
      title: j.title,
      location: j.location || '',
      url: j.careers_url || '',
      department: j.department || '',
    })),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Fetch every open role from one company's board. Throws on a bad slug. */
export async function fetchJobs(platform: Platform, slug: string): Promise<AtsJob[]> {
  const data = await fetchJson(ENDPOINTS[platform](slug));
  return PARSERS[platform](data, slug).filter((j) => j.title && j.url);
}

export interface DiscoveredBoard {
  platform: Platform;
  slug: string;
  jobCount: number;
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

/**
 * Work out which ATS a company uses by trying its name as a slug on each
 * platform. Bounded so a bulk sweep can't open hundreds of sockets, and
 * retries are disabled — a wrong guess should fail fast, not back off.
 */
export async function discoverBoards(
  companyName: string,
  concurrency = 8
): Promise<DiscoveredBoard[]> {
  const candidates = slugCandidates(companyName);

  const attempts: Array<{ platform: Platform; slug: string }> = [];
  for (const platform of PLATFORMS) {
    for (const slug of candidates) {
      attempts.push({ platform, slug });
    }
  }

  const results = await mapWithConcurrency(attempts, concurrency, async ({ platform, slug }) => {
    try {
      const jobs = await fetchJson(ENDPOINTS[platform](slug), { retries: 0, timeoutMs: 8000 });
      const parsed = PARSERS[platform](jobs, slug).filter((j) => j.title && j.url);
      return parsed.length > 0 ? { platform, slug, jobCount: parsed.length } : null;
    } catch {
      return null;
    }
  });

  const found = results.filter((r): r is DiscoveredBoard => r !== null);
  // Prefer the board with the most roles when a company matches twice.
  return found.sort((a, b) => b.jobCount - a.jobCount);
}

/** Does this role look relevant / UAE-based? Used for optional filtering. */
export function matchesKeywords(job: AtsJob, keywords?: string): boolean {
  if (!keywords?.trim()) return true;
  const haystack = `${job.title} ${job.location}`.toLowerCase();
  return keywords
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => haystack.includes(k));
}
