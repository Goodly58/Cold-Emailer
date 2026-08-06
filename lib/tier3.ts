/**
 * Tier 3 — search-engine-indexed LinkedIn.
 *
 * **This module never touches linkedin.com.** It builds queries, reads search
 * results, and hands them to a human. Hard rule 7 has no exception and no
 * volume threshold: detection operates at the TLS handshake, before rate limits
 * apply, so "we only do thirty a day" confers no safety. The asymmetry decides
 * it — a ban costs the account the product sends from, plus the user's
 * professional identity, to save a few hours of clicking.
 *
 * Two things research/people-discovery.md §7 proved matter more than the query:
 *
 *   - **Geography.** `"First Abu Dhabi Bank" "Head of Human Resources"` returned
 *     a real person at the right company, based in London. Every hit gets a
 *     geography check before it can become a contact.
 *   - **Precision by shape.** A multinational plus a distinctive internal title
 *     is near-unique; a bank plus a generic title drowns in job ads. The query
 *     builder says which shape it produced so the founder knows what to expect.
 */
import { execute, queryOne } from './db/client';

export type SerpProvider = 'google_cse' | 'serper' | 'dataforseo' | 'none';

export interface SerpHit {
  title: string;
  url: string;
  snippet: string;
  /** Parsed from the result title, which LinkedIn renders as "Name - Headline". */
  personName: string | null;
  headline: string | null;
  /** Fails when nothing in the result places them in the UAE. */
  geographyOk: boolean;
  geographyNote: string;
}

export interface SearchPlan {
  query: string;
  /** 'high' for a distinctive internal title; 'low' for a generic one. */
  precision: 'high' | 'low';
  advice: string;
  /** Pasteable into a browser when no API is configured. */
  manualUrl: string;
}

/** Titles so generic that the query drowns in job listings and other banks. */
const GENERIC_TITLES = [
  'relationship manager', 'account manager', 'analyst', 'associate', 'consultant',
  'manager', 'senior manager', 'officer', 'executive', 'specialist', 'coordinator',
  'engineer', 'developer', 'advisor', 'representative',
];

/**
 * Builds the query.
 *
 * Always restricted to `ae.linkedin.com` — the country subdomain is a free
 * geography filter that unrestricted linkedin.com does not give, and it is what
 * keeps London and Karachi out of the results.
 */
export function buildSearchPlan(input: {
  companyName: string;
  title: string;
  qualifier?: string | null;
}): SearchPlan {
  const title = input.title.trim();
  const generic = GENERIC_TITLES.some((g) => title.toLowerCase() === g || title.toLowerCase().endsWith(` ${g}`));
  const parts = [`"${input.companyName}"`, `"${title}"`];
  if (input.qualifier?.trim()) parts.push(`"${input.qualifier.trim()}"`);
  parts.push('site:ae.linkedin.com/in');

  const query = parts.join(' ');

  return {
    query,
    precision: generic && !input.qualifier ? 'low' : 'high',
    advice:
      generic && !input.qualifier
        ? 'That title is common enough that this will fill with job ads and people at other banks. Add a product, desk or segment, or aim higher — "Head of X" resolves cleanly.'
        : 'A company-specific title behaves like a near-unique key. Expect the right person on the first page.',
    manualUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  };
}

/**
 * Extracts a job-ad title so it can be resolved to a name.
 *
 * Job ads are a strong source of roles and reporting lines and a weak source of
 * names — no UAE portal names the hiring manager. The correct shape is
 * title-extraction here, then SERP resolution above.
 */
export function extractReportingLine(jobAdText: string): string[] {
  // "of" must not end the match: "Head of Group Operations" is the shape these
  // titles almost always take, and stopping at the first "of" yields "Head".
  const patterns = [
    /report(?:ing|s)?\s+(?:directly\s+)?to\s+(?:the\s+)?([A-Z][\w\s&/-]{3,60}?)(?:[.,;()]|\s+(?:based|who|which|located|and\s+will)\b|$)/g,
    /\bwithin\s+the\s+([A-Z][\w\s&/-]{3,50}?)\s+team\b/g,
    /\bpart\s+of\s+the\s+([A-Z][\w\s&/-]{3,50}?)\s+(?:team|function|department)\b/g,
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of jobAdText.matchAll(pattern)) {
      const title = match[1].trim().replace(/\s+/g, ' ');
      if (title.length > 3) found.push(title);
    }
  }
  return [...new Set(found)];
}

/** UAE geography markers, in the forms LinkedIn actually renders. */
const UAE_MARKERS = [
  'united arab emirates', 'uae', 'dubai', 'abu dhabi', 'sharjah', 'ajman',
  'ras al khaimah', 'fujairah', 'umm al quwain', 'difc', 'adgm', 'jebel ali',
];

/** Places that look plausible for a Gulf search and are not the UAE. */
const ELSEWHERE_MARKERS = [
  'london', 'united kingdom', 'singapore', 'new york', 'mumbai', 'karachi',
  'cairo', 'riyadh', 'doha', 'kuwait', 'manama', 'bahrain', 'muscat', 'amman',
  'beirut', 'istanbul', 'hong kong', 'paris', 'frankfurt', 'zurich',
];

/**
 * Whether a result actually places this person in the UAE.
 *
 * Absence of a UAE marker is not a pass. The FAB Head of HR based in London was
 * a correct result for a correct query, and drafting to them would have been a
 * personalized email about the wrong office.
 */
export function checkGeography(text: string): { ok: boolean; note: string } {
  const haystack = text.toLowerCase();

  const elsewhere = ELSEWHERE_MARKERS.find((m) => haystack.includes(m));
  const uae = UAE_MARKERS.find((m) => haystack.includes(m));

  if (elsewhere && !uae) {
    return { ok: false, note: `This result places them in ${elsewhere}, not the UAE.` };
  }
  if (elsewhere && uae) {
    return { ok: false, note: `This result mentions both ${elsewhere} and the UAE. Check which office before writing.` };
  }
  if (uae) return { ok: true, note: `UAE-based (${uae}).` };

  return { ok: false, note: 'Nothing here says where they are based. Confirm before writing.' };
}

/** "Name - Headline | LinkedIn" is the shape LinkedIn renders result titles in. */
export function parseResultTitle(title: string): { personName: string | null; headline: string | null } {
  const cleaned = title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length < 2) return { personName: cleaned || null, headline: null };
  return { personName: parts[0].trim() || null, headline: parts.slice(1).join(' - ').trim() || null };
}

export function serpProvider(): SerpProvider {
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) return 'google_cse';
  if (process.env.SERPER_API_KEY) return 'serper';
  if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) return 'dataforseo';
  return 'none';
}

/**
 * Runs the query against whichever SERP API is configured.
 *
 * Bing's Web Search API was retired in August 2025 and Google CSE is closed to
 * new customers, so the fallbacks matter. SerpApi is deliberately absent: it is
 * under a live DMCA suit from Google, and an injunction would remove the vendor
 * mid-build.
 *
 * With nothing configured this returns the query for the founder to paste into
 * a browser. That is the Tier-4 path and it is a legitimate answer at this
 * volume, not a failure.
 */
export async function runSearch(plan: SearchPlan, limit = 10): Promise<{ provider: SerpProvider; hits: SerpHit[]; note: string }> {
  const provider = serpProvider();

  if (provider === 'none') {
    return {
      provider,
      hits: [],
      note: 'No search API configured. Open the query yourself and paste what you find — at a few hundred lookups that is genuinely competitive on cost, and it carries no account risk at all.',
    };
  }

  try {
    const raw = await fetchResults(provider, plan.query, limit);
    const hits = raw.map((r) => {
      const { personName, headline } = parseResultTitle(r.title);
      const geography = checkGeography(`${r.title} ${r.snippet}`);
      return {
        ...r,
        personName,
        headline,
        geographyOk: geography.ok,
        geographyNote: geography.note,
      };
    });

    return {
      provider,
      hits,
      note:
        hits.length === 0
          ? 'Nothing came back. Try a different title, or aim one level higher.'
          : `${hits.filter((h) => h.geographyOk).length} of ${hits.length} results place the person in the UAE.`,
    };
  } catch (e) {
    return {
      provider,
      hits: [],
      note: `Search failed (${e instanceof Error ? e.message : 'network error'}). The query is above — running it by hand works just as well.`,
    };
  }
}

async function fetchResults(
  provider: SerpProvider,
  query: string,
  limit: number
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  if (provider === 'google_cse') {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', process.env.GOOGLE_CSE_KEY!);
    url.searchParams.set('cx', process.env.GOOGLE_CSE_CX!);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(Math.min(limit, 10)));
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { items?: Array<{ title: string; link: string; snippet: string }> };
    return (body.items ?? []).map((i) => ({ title: i.title, url: i.link, snippet: i.snippet ?? '' }));
  }

  if (provider === 'serper') {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, num: limit }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { organic?: Array<{ title: string; link: string; snippet: string }> };
    return (body.organic ?? []).map((i) => ({ title: i.title, url: i.link, snippet: i.snippet ?? '' }));
  }

  const auth = Buffer.from(
    `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`
  ).toString('base64');
  const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify([{ keyword: query, language_code: 'en', location_code: 2784, depth: limit }]),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as {
    tasks?: Array<{ result?: Array<{ items?: Array<{ title?: string; url?: string; description?: string }> }> }>;
  };
  const items = body.tasks?.[0]?.result?.[0]?.items ?? [];
  return items
    .filter((i) => i.url)
    .map((i) => ({ title: i.title ?? '', url: i.url!, snippet: i.description ?? '' }));
}

/**
 * The Tier-2 check that comes before any of this.
 *
 * A company's own Emiratisation or "meet our people" page is the highest-value
 * source in the whole pyramid: it names junior and mid Emirati employees, on
 * the company's own domain, published deliberately for recruitment. It is
 * simultaneously a contact source, a warm-intro source, and an evidence source,
 * and it self-selects for exactly the companies this product targets.
 */
export const EMIRATISATION_PAGE_PATHS = [
  '/careers/emiratisation',
  '/careers/emiratization',
  '/en/careers/emiratisation',
  '/careers/uae-nationals',
  '/careers/join-us/meet-our-people',
  '/meet-our-people',
  '/emiratisation-strategy',
  '/about-us/emiratisation',
  '/careers/graduate-programme',
] as const;

export function emiratisationPageCandidates(domain: string): string[] {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return EMIRATISATION_PAGE_PATHS.map((path) => `https://www.${host}${path}`);
}

/** Records that a company has such a page, so it is checked first next time. */
export async function noteEmiratisationPage(companyId: string, url: string): Promise<void> {
  await queryOne('SELECT 1');
  await execute(
    `UPDATE company SET careers_url = COALESCE(careers_url, ?), updated_at = ? WHERE id = ?`,
    [url, new Date().toISOString(), companyId]
  );
}
