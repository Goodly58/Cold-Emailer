// Public ATS board APIs. These power companies' own careers pages, so polling
// them is exactly what they're published for — no scraping, no ToS problem.

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
    })),
  lever: (d) =>
    (Array.isArray(d) ? d : []).map((j: any) => ({
      title: j.text,
      location: j.categories?.location || '',
      url: j.hostedUrl,
    })),
  ashby: (d) =>
    (d?.jobs || []).map((j: any) => ({
      title: j.title,
      location: j.location || '',
      url: j.jobUrl || j.applyUrl || '',
    })),
  workable: (d) =>
    (d?.jobs || []).map((j: any) => ({
      title: j.title,
      location: [j.city, j.country].filter(Boolean).join(', '),
      url: j.url,
    })),
  smartrecruiters: (d, slug) =>
    (d?.content || []).map((j: any) => ({
      title: j.name,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
    })),
  recruitee: (d) =>
    (d?.offers || []).map((j: any) => ({
      title: j.title,
      location: j.location || '',
      url: j.careers_url || '',
    })),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Fetch every open role from one company's board. Throws on a bad slug. */
export async function fetchJobs(platform: Platform, slug: string): Promise<AtsJob[]> {
  const res = await fetch(ENDPOINTS[platform](slug), {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${platform} returned ${res.status}`);
  const data = await res.json();
  return PARSERS[platform](data, slug).filter((j) => j.title && j.url);
}

/**
 * Work out which ATS a company uses by trying its name as a slug on each
 * platform. Cheap (six parallel requests) and saves hunting through careers
 * pages by hand.
 */
export async function discoverBoards(companyName: string): Promise<
  Array<{ platform: Platform; slug: string; jobCount: number }>
> {
  const base = companyName
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();

  const candidates = new Set<string>();
  candidates.add(base.replace(/\s+/g, ''));
  candidates.add(base.replace(/\s+/g, '-'));
  const firstWord = base.split(/\s+/)[0];
  if (firstWord && firstWord.length > 2) candidates.add(firstWord);

  const attempts: Array<Promise<{ platform: Platform; slug: string; jobCount: number } | null>> = [];
  for (const platform of PLATFORMS) {
    for (const slug of candidates) {
      if (!validSlug(slug)) continue;
      attempts.push(
        fetchJobs(platform, slug)
          .then((jobs) => (jobs.length > 0 ? { platform, slug, jobCount: jobs.length } : null))
          .catch(() => null)
      );
    }
  }

  const results = await Promise.all(attempts);
  return results.filter((r): r is { platform: Platform; slug: string; jobCount: number } => r !== null);
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
