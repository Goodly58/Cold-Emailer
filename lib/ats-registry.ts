import { fetchJson } from './http';

/**
 * Platform registry.
 *
 * Every supported job board is one entry here: how to build the request, how
 * to read the response, and which identifiers it needs. Simple boards need a
 * single slug (`acme`); enterprise ones need several parts (Workday wants a
 * tenant, a data-centre number and a site name), so a source carries a
 * `config` map and each platform declares the fields it requires.
 */

export interface AtsJob {
  title: string;
  location: string;
  url: string;
  department?: string;
}

export interface PlatformField {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
}

export interface PlatformDef {
  id: string;
  label: string;
  /** Extra identifiers beyond `slug`, for platforms that need them. */
  fields: PlatformField[];
  /** How to find the identifiers from a public careers URL. */
  hint: string;
  /** Whether a plain company-name guess is worth trying during discovery. */
  discoverable: boolean;
  /**
   * Not confirmed against a live board. The endpoint shape is well
   * corroborated but nobody has seen it return data, so failures here are
   * expected rather than surprising — surfaced in the UI so a silent zero
   * isn't mistaken for "no open roles".
   */
  unverified?: boolean;
  /**
   * Page size when the board caps results per request. Set this and
   * fetchJobsFor will walk offsets until the board runs out.
   */
  pageSize?: number;
  build: (cfg: Record<string, string>, offset?: number) => {
    url: string;
    method?: 'GET' | 'POST';
    body?: string;
    headers?: Record<string, string>;
  };
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  parse: (data: any, cfg: Record<string, string>) => AtsJob[];
}

const SLUG_ONLY: PlatformField[] = [];

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function joinParts(...parts: Array<unknown>): string {
  return parts.map(str).filter(Boolean).join(', ');
}

export const PLATFORM_DEFS: PlatformDef[] = [
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    fields: SLUG_ONLY,
    hint: 'boards.greenhouse.io/<slug> or job-boards.greenhouse.io/<slug>',
    discoverable: true,
    build: ({ slug }) => ({ url: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs` }),
    parse: (d) =>
      (d?.jobs || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location?.name),
        url: str(j.absolute_url),
        department: str(j.departments?.[0]?.name),
      })),
  },
  {
    id: 'lever',
    label: 'Lever',
    fields: SLUG_ONLY,
    hint: 'jobs.lever.co/<slug>',
    discoverable: true,
    build: ({ slug }) => ({ url: `https://api.lever.co/v0/postings/${slug}?mode=json` }),
    parse: (d) =>
      (Array.isArray(d) ? d : []).map((j: Record<string, any>) => ({
        title: str(j.text),
        location: str(j.categories?.location),
        url: str(j.hostedUrl),
        department: str(j.categories?.team) || str(j.categories?.department),
      })),
  },
  {
    id: 'ashby',
    label: 'Ashby',
    fields: SLUG_ONLY,
    hint: 'jobs.ashbyhq.com/<slug>',
    discoverable: true,
    build: ({ slug }) => ({ url: `https://api.ashbyhq.com/posting-api/job-board/${slug}` }),
    parse: (d) =>
      (d?.jobs || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location),
        url: str(j.jobUrl) || str(j.applyUrl),
        department: str(j.department) || str(j.team),
      })),
  },
  {
    id: 'workable',
    label: 'Workable',
    fields: SLUG_ONLY,
    hint: 'apply.workable.com/<slug>',
    discoverable: true,
    build: ({ slug }) => ({ url: `https://apply.workable.com/api/v1/widget/accounts/${slug}` }),
    parse: (d) =>
      (d?.jobs || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: joinParts(j.city, j.country),
        url: str(j.url),
        department: str(j.department),
      })),
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    fields: SLUG_ONLY,
    hint: 'jobs.smartrecruiters.com/<slug> — used by FAB and other UAE corporates',
    discoverable: true,
    build: ({ slug }) => ({
      url: `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`,
    }),
    parse: (d, cfg) =>
      (d?.content || []).map((j: Record<string, any>) => ({
        title: str(j.name),
        location: joinParts(j.location?.city, j.location?.country),
        url: `https://jobs.smartrecruiters.com/${cfg.slug}/${str(j.id)}`,
        department: str(j.department?.label) || str(j.function?.label),
      })),
  },
  {
    id: 'recruitee',
    label: 'Recruitee',
    fields: SLUG_ONLY,
    hint: '<slug>.recruitee.com',
    discoverable: true,
    build: ({ slug }) => ({ url: `https://${slug}.recruitee.com/api/offers/` }),
    parse: (d) =>
      (d?.offers || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location),
        url: str(j.careers_url),
        department: str(j.department),
      })),
  },
  {
    id: 'personio',
    label: 'Personio',
    fields: SLUG_ONLY,
    hint: '<slug>.jobs.personio.com',
    discoverable: false,
    build: ({ slug }) => ({ url: `https://${slug}.jobs.personio.com/search.json?language=en` }),
    parse: (d) =>
      (Array.isArray(d) ? d : d?.jobs || []).map((j: Record<string, any>) => ({
        title: str(j.name) || str(j.title),
        location: joinParts(j.office, j.city),
        url: str(j.url) || str(j.jobUrl),
        department: str(j.department),
      })),
  },
  {
    id: 'breezy',
    label: 'Breezy HR',
    fields: SLUG_ONLY,
    hint: '<slug>.breezy.hr',
    discoverable: false,
    build: ({ slug }) => ({ url: `https://${slug}.breezy.hr/json` }),
    parse: (d) =>
      (Array.isArray(d) ? d : []).map((j: Record<string, any>) => ({
        title: str(j.name) || str(j.title),
        location: str(j.location?.name) || joinParts(j.location?.city?.name, j.location?.country?.name),
        url: str(j.url),
        department: str(j.department),
      })),
  },
  {
    id: 'pinpoint',
    label: 'Pinpoint',
    fields: SLUG_ONLY,
    hint: '<slug>.pinpointhq.com',
    discoverable: false,
    build: ({ slug }) => ({ url: `https://${slug}.pinpointhq.com/postings.json` }),
    parse: (d) =>
      (d?.data || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location?.name) || str(j.location),
        url: str(j.url) || str(j.absolute_url),
        department: str(j.department?.name) || str(j.department),
      })),
  },
  {
    id: 'teamtailor',
    label: 'Teamtailor',
    fields: SLUG_ONLY,
    hint: '<slug>.teamtailor.com',
    discoverable: false,
    build: ({ slug }) => ({ url: `https://${slug}.teamtailor.com/jobs.json` }),
    parse: (d) =>
      (d?.jobs || (Array.isArray(d) ? d : [])).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location) || str(j.locations?.[0]?.name),
        url: str(j.careersite_job_url) || str(j.url),
        department: str(j.department),
      })),
  },
  {
    id: 'workday',
    label: 'Workday',
    fields: [
      { key: 'dc', label: 'Data centre', placeholder: 'wd3', required: true },
      { key: 'site', label: 'Site name', placeholder: 'External_Careers', required: true },
    ],
    hint: 'From https://<tenant>.<dc>.myworkdayjobs.com/<site> — slug is the tenant',
    discoverable: false,
    unverified: true,
    // Workday caps limit at 20 server-side; asking for more returns an empty
    // array with HTTP 200, which reads as "no jobs" rather than an error.
    pageSize: 20,
    build: ({ slug, dc, site }, offset = 0) => ({
      url: `https://${slug}.${dc}.myworkdayjobs.com/wday/cxs/${slug}/${site}/jobs`,
      method: 'POST',
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      headers: { 'content-type': 'application/json' },
    }),
    parse: (d, cfg) =>
      (d?.jobPostings || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.locationsText),
        url: `https://${cfg.slug}.${cfg.dc}.myworkdayjobs.com/en-US/${cfg.site}${str(j.externalPath)}`,
        department: '',
      })),
  },
  {
    id: 'oracle',
    label: 'Oracle Cloud Recruiting',
    fields: [
      { key: 'host', label: 'Host', placeholder: 'ekjk.fa.em2.oraclecloud.com', required: true },
      { key: 'site', label: 'Site number', placeholder: 'CX_1', required: true },
    ],
    hint: 'From the careers URL host and its siteNumber query parameter',
    discoverable: false,
    unverified: true,
    // Kept minimal deliberately: an invalid `expand` target 400s the whole
    // request, so nothing optional is requested.
    build: ({ host, site }) => ({
      url:
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&finder=findReqs;siteNumber=${site},limit=200,sortBy=POSTING_DATES_DESC`,
    }),
    parse: (d, cfg) => {
      const list = d?.items?.[0]?.requisitionList || [];
      return list.map((j: Record<string, any>) => ({
        title: str(j.Title),
        location: str(j.PrimaryLocation),
        url: `https://${cfg.host}/hcmUI/CandidateExperience/en/sites/${cfg.site}/job/${str(j.Id)}`,
        department: '',
      }));
    },
  },
];

export const PLATFORMS = PLATFORM_DEFS.map((p) => p.id);
export type Platform = string;

const BY_ID = new Map(PLATFORM_DEFS.map((p) => [p.id, p]));

export function getPlatform(id: string): PlatformDef | undefined {
  return BY_ID.get(id);
}

export function isPlatform(id: string): boolean {
  return BY_ID.has(id);
}

export function validSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(slug);
}

/** Fetch every open role from one board. Throws with a readable message. */
export async function fetchJobsFor(
  platformId: string,
  config: Record<string, string>,
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<AtsJob[]> {
  const def = getPlatform(platformId);
  if (!def) throw new Error(`unknown platform "${platformId}"`);

  for (const field of def.fields) {
    if (field.required && !config[field.key]) {
      throw new Error(`${def.label} needs "${field.label}"`);
    }
  }

  const fetchPage = async (offset: number): Promise<AtsJob[]> => {
    const req = def.build(config, offset);
    const data = await fetchJson(req.url, {
      method: req.method,
      body: req.body,
      headers: req.headers,
      retries: opts.retries,
      timeoutMs: opts.timeoutMs,
    });
    return def.parse(data, config).filter((j) => j.title && j.url);
  };

  if (!def.pageSize) return fetchPage(0);

  // Paginated board: walk offsets until a short page comes back. Capped so a
  // board that keeps returning full pages can't loop forever.
  const all: AtsJob[] = [];
  const seen = new Set<string>();
  const maxPages = 40;

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(page * def.pageSize);

    let fresh = 0;
    for (const job of batch) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      all.push(job);
      fresh += 1;
    }

    // A short page is the end of the board. Zero fresh rows from a full page
    // means the board ignored our offset and is replaying page one — stop
    // rather than spin.
    if (batch.length < def.pageSize || fresh === 0) break;
  }

  return all;
}
