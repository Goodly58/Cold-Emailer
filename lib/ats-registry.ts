import { fetchJson } from './http';
import { fromPosted, parseSalaryText, type SalaryRange } from './salary';
import { htmlToText } from './text';
import type { EmploymentType, Workplace } from './types';

/**
 * Platform registry.
 *
 * Every supported job board is one entry here: how to build the request, how
 * to read the response, and which identifiers it needs. Simple boards need a
 * single slug (`acme`); enterprise ones need several parts (Workday wants a
 * tenant, a data-centre number and a site name), so a source carries a
 * `config` map and each platform declares the fields it requires.
 *
 * Beyond title and link, parsers read whatever else a board publishes —
 * posting date, pay, remote/hybrid, contract type and the description — using
 * the field names each vendor documents. Every one of those is optional: a
 * board that omits a field just leaves it blank.
 */

export type { EmploymentType, Workplace };

export interface AtsJob {
  title: string;
  location: string;
  url: string;
  department?: string;
  /** YYYY-MM-DD the board says the role was published. */
  postedAt?: string;
  employmentType?: EmploymentType;
  workplace?: Workplace;
  salary?: SalaryRange;
  /** Plain text, capped at JD_MAX_CHARS. Stored in the blob store, not the main db. */
  description?: string;
  /** Set by aggregators, whose results span many employers. */
  company?: string;
}

/** Long enough for any real job description; short enough to keep storage sane. */
export const JD_MAX_CHARS = 20_000;

export interface PlatformField {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
}

export interface BuildOptions {
  /**
   * Discovery only needs to know a board exists and how many roles it has, so
   * it asks for the lightweight listing rather than every full description.
   */
  lite?: boolean;
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
  build: (cfg: Record<string, string>, offset?: number, opts?: BuildOptions) => {
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
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function joinParts(...parts: Array<unknown>): string {
  return parts.map(str).filter(Boolean).join(', ');
}

/* ---------------------------------------------------------- field helpers */

const DAY_MS = 86_400_000;

/**
 * A board date to YYYY-MM-DD. Accepts ISO strings, plain dates and epoch
 * seconds or milliseconds. Anything before 2000 or in the future is a
 * placeholder or a parsing accident, so it's dropped rather than trusted.
 */
export function isoDate(v: unknown, now = Date.now()): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  let t: number;
  if (typeof v === 'number') t = v < 1e12 ? v * 1000 : v;
  else if (typeof v === 'string') t = /^\d{9,13}$/.test(v) ? Number(v) * (v.length <= 10 ? 1000 : 1) : Date.parse(v);
  else return undefined;
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now + 2 * DAY_MS) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

/** Workday says "Posted Today", "Posted Yesterday", "Posted 30+ Days Ago". */
export function relativePosted(text: unknown, now = Date.now()): string | undefined {
  const s = str(text).toLowerCase();
  if (!s) return undefined;
  let days: number | undefined;
  if (/today|just posted|hours? ago|minutes? ago/.test(s)) days = 0;
  else if (/yesterday/.test(s)) days = 1;
  else {
    const m = s.match(/(\d+)\+?\s*(day|week|month)s?\s+ago/);
    if (m) days = Number(m[1]) * (m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1);
  }
  return days === undefined ? undefined : new Date(now - days * DAY_MS).toISOString().slice(0, 10);
}

/** Vendor contract-type labels ("FullTime", "fulltime", "Full-time", "Permanent") to one set. */
export function normEmployment(raw: unknown): EmploymentType | undefined {
  const s = str(raw).toLowerCase().replace(/[\s_-]/g, '');
  if (!s) return undefined;
  if (/intern|trainee|apprentice/.test(s)) return 'internship';
  if (/parttime/.test(s)) return 'part-time';
  if (/contract|freelance|fixedterm/.test(s)) return 'contract';
  if (/temp/.test(s)) return 'temporary';
  if (/fulltime|permanent|regular/.test(s)) return 'full-time';
  return undefined;
}

/** "on-site", "OnSite", "Onsite", "remote", "Hybrid", "unspecified"… */
export function normWorkplace(raw: unknown): Workplace | undefined {
  const s = str(raw).toLowerCase().replace(/[\s_-]/g, '');
  if (!s) return undefined;
  if (s.includes('hybrid')) return 'hybrid';
  if (s.includes('remote') || s.includes('telecommut')) return 'remote';
  if (s.includes('onsite') || s.includes('office')) return 'onsite';
  return undefined;
}

/** Last resort: "Remote - UAE" in a location, "(Hybrid)" in a title. */
function inferWorkplace(text: string): Workplace | undefined {
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\bremote\b/i.test(text)) return 'remote';
  return undefined;
}

function inferEmployment(title: string): EmploymentType | undefined {
  if (/\b(intern|internship|trainee|apprentice)\b/i.test(title)) return 'internship';
  if (/\b(part[- ]time)\b/i.test(title)) return 'part-time';
  if (/\b(contract|contractor|freelance|fixed[- ]term)\b/i.test(title)) return 'contract';
  if (/\b(temporary|temp)\b/i.test(title)) return 'temporary';
  return undefined;
}

function joinText(...parts: Array<string | undefined>): string | undefined {
  const out = parts.map((p) => (p || '').trim()).filter(Boolean).join('\n\n');
  return out || undefined;
}

/**
 * Fills what a board left blank from what it did say: pay mentioned in the
 * description, "Remote" in the location, "Intern" in the title. Shared by the
 * ATS parsers and the aggregators so every import is enriched the same way.
 */
export function enrichJob(job: AtsJob): AtsJob {
  const description = job.description ? job.description.slice(0, JD_MAX_CHARS) : undefined;
  return {
    ...job,
    description,
    salary: job.salary ?? parseSalaryText(description),
    workplace: job.workplace ?? inferWorkplace(`${job.title} ${job.location}`),
    employmentType: job.employmentType ?? inferEmployment(job.title),
  };
}

/* ---------------------------------------------------------------- boards */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PLATFORM_DEFS: PlatformDef[] = [
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    fields: SLUG_ONLY,
    hint: 'boards.greenhouse.io/<slug> or job-boards.greenhouse.io/<slug>',
    discoverable: true,
    // content=true adds the (entity-escaped) description, departments and offices.
    build: ({ slug }, _offset, opts) => ({
      url: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs${opts?.lite ? '' : '?content=true'}`,
    }),
    parse: (d) =>
      (d?.jobs || []).map((j: Record<string, any>) => {
        // Pay transparency ranges, in cents, when the board has them set up.
        const pay = Array.isArray(j.pay_input_ranges) ? j.pay_input_ranges[0] : undefined;
        return {
          title: str(j.title),
          location: str(j.location?.name),
          url: str(j.absolute_url),
          department: str(j.departments?.[0]?.name),
          postedAt: isoDate(j.first_published) ?? isoDate(j.updated_at),
          description: j.content ? htmlToText(str(j.content)) : undefined,
          salary: pay
            ? fromPosted({
                min: Number(pay.min_cents) / 100,
                max: Number(pay.max_cents) / 100,
                currency: str(pay.currency_type),
                period: str(pay.title) || str(pay.blurb) || 'year',
                raw: str(pay.title),
              })
            : undefined,
        };
      }),
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
        postedAt: isoDate(j.createdAt),
        employmentType: normEmployment(j.categories?.commitment),
        workplace: normWorkplace(j.workplaceType),
        salary: j.salaryRange
          ? fromPosted({
              min: j.salaryRange.min,
              max: j.salaryRange.max,
              currency: str(j.salaryRange.currency),
              period: str(j.salaryRange.interval),
              raw: str(j.salaryDescriptionPlain) || undefined,
            })
          : undefined,
        description: joinText(
          str(j.descriptionPlain) || htmlToText(str(j.description)),
          ...(Array.isArray(j.lists)
            ? j.lists.map((l: Record<string, any>) =>
                [str(l?.text), htmlToText(str(l?.content))].filter(Boolean).join('\n')
              )
            : []),
          str(j.additionalPlain),
          str(j.salaryDescriptionPlain)
        ),
      })),
  },
  {
    id: 'ashby',
    label: 'Ashby',
    fields: SLUG_ONLY,
    hint: 'jobs.ashbyhq.com/<slug>',
    discoverable: true,
    // Compensation is only included when asked for.
    build: ({ slug }) => ({
      url: `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
    }),
    parse: (d) =>
      (d?.jobs || [])
        .filter((j: Record<string, any>) => j?.isListed !== false)
        .map((j: Record<string, any>) => {
          const components: Array<Record<string, any>> = j.compensation?.summaryComponents || [];
          const base = components.find((c) => /salary/i.test(str(c?.compensationType)));
          return {
            title: str(j.title),
            location: str(j.location),
            url: str(j.jobUrl) || str(j.applyUrl),
            department: str(j.department) || str(j.team),
            postedAt: isoDate(j.publishedAt),
            employmentType: normEmployment(j.employmentType),
            workplace: normWorkplace(j.workplaceType) ?? (j.isRemote === true ? 'remote' : undefined),
            salary: base
              ? fromPosted({
                  min: base.minValue,
                  max: base.maxValue,
                  currency: str(base.currencyCode),
                  period: str(base.interval),
                  raw: str(j.compensation?.compensationTierSummary) || undefined,
                })
              : undefined,
            description: str(j.descriptionPlain) || htmlToText(str(j.descriptionHtml)) || undefined,
          };
        }),
  },
  {
    id: 'workable',
    label: 'Workable',
    fields: SLUG_ONLY,
    hint: 'apply.workable.com/<slug>',
    discoverable: true,
    // details=true adds each role's description.
    build: ({ slug }, _offset, opts) => ({
      url: `https://apply.workable.com/api/v1/widget/accounts/${slug}${opts?.lite ? '' : '?details=true'}`,
    }),
    parse: (d) =>
      (d?.jobs || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: joinParts(j.city, j.country),
        url: str(j.url),
        department: str(j.department),
        postedAt: isoDate(j.published_on) ?? isoDate(j.created_at),
        employmentType: normEmployment(j.employment_type),
        workplace: j.telecommuting === true ? 'remote' : undefined,
        description: j.description ? htmlToText(str(j.description)) : undefined,
      })),
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    fields: SLUG_ONLY,
    hint: 'jobs.smartrecruiters.com/<slug> — used by FAB and other UAE corporates',
    discoverable: true,
    // Large employers list more than one page; the API takes offset + limit.
    pageSize: 100,
    build: ({ slug }, offset = 0) => ({
      url: `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}`,
    }),
    parse: (d, cfg) =>
      (d?.content || []).map((j: Record<string, any>) => ({
        title: str(j.name),
        location: joinParts(j.location?.city, j.location?.country),
        url: `https://jobs.smartrecruiters.com/${cfg.slug}/${str(j.id)}`,
        department: str(j.department?.label) || str(j.function?.label),
        postedAt: isoDate(j.releasedDate),
        employmentType: normEmployment(j.typeOfEmployment?.label ?? j.typeOfEmployment?.id),
        workplace: j.location?.hybrid === true ? 'hybrid' : j.location?.remote === true ? 'remote' : undefined,
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
        postedAt: isoDate(j.published_at) ?? isoDate(j.created_at),
        employmentType: normEmployment(j.employment_type_code),
        workplace: j.hybrid === true ? 'hybrid' : j.remote === true ? 'remote' : j.on_site === true ? 'onsite' : undefined,
        salary: j.salary
          ? fromPosted({
              min: j.salary.min,
              max: j.salary.max,
              currency: str(j.salary.currency),
              // Recruitee often omits the period; annual is the documented default.
              period: str(j.salary.period) || 'year',
            })
          : undefined,
        description: joinText(htmlToText(str(j.description)), htmlToText(str(j.requirements))),
      })),
  },
  {
    id: 'personio',
    label: 'Personio',
    fields: SLUG_ONLY,
    hint: '<slug>.jobs.personio.com',
    discoverable: false,
    unverified: true,
    build: ({ slug }) => ({ url: `https://${slug}.jobs.personio.com/search.json?language=en` }),
    parse: (d) =>
      (Array.isArray(d) ? d : d?.jobs || []).map((j: Record<string, any>) => ({
        title: str(j.name) || str(j.title),
        location: joinParts(j.office, j.city),
        url: str(j.url) || str(j.jobUrl),
        department: str(j.department),
        employmentType: normEmployment(j.schedule ?? j.employment_type),
      })),
  },
  {
    id: 'breezy',
    label: 'Breezy HR',
    fields: SLUG_ONLY,
    hint: '<slug>.breezy.hr',
    discoverable: false,
    unverified: true,
    build: ({ slug }) => ({ url: `https://${slug}.breezy.hr/json` }),
    parse: (d) =>
      (Array.isArray(d) ? d : []).map((j: Record<string, any>) => ({
        title: str(j.name) || str(j.title),
        location: str(j.location?.name) || joinParts(j.location?.city?.name, j.location?.country?.name),
        url: str(j.url),
        department: str(j.department),
        postedAt: isoDate(j.published_date),
        employmentType: normEmployment(j.type?.name ?? j.type?.id),
        workplace: j.location?.is_remote === true ? 'remote' : undefined,
      })),
  },
  {
    id: 'pinpoint',
    label: 'Pinpoint',
    fields: SLUG_ONLY,
    hint: '<slug>.pinpointhq.com',
    discoverable: false,
    unverified: true,
    build: ({ slug }) => ({ url: `https://${slug}.pinpointhq.com/postings.json` }),
    parse: (d) =>
      (d?.data || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location?.name) || str(j.location),
        url: str(j.url) || str(j.absolute_url),
        department: str(j.department?.name) || str(j.department),
        employmentType: normEmployment(j.employment_type),
        workplace: normWorkplace(j.workplace_type),
      })),
  },
  {
    id: 'teamtailor',
    label: 'Teamtailor',
    fields: SLUG_ONLY,
    hint: '<slug>.teamtailor.com',
    discoverable: false,
    unverified: true,
    build: ({ slug }) => ({ url: `https://${slug}.teamtailor.com/jobs.json` }),
    parse: (d) =>
      (d?.jobs || (Array.isArray(d) ? d : [])).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location) || str(j.locations?.[0]?.name),
        url: str(j.careersite_job_url) || str(j.url),
        department: str(j.department),
        workplace: normWorkplace(j.remote_status),
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
        postedAt: relativePosted(j.postedOn),
        workplace: normWorkplace(j.remoteType),
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
        postedAt: isoDate(j.PostedDate),
        workplace: normWorkplace(j.WorkplaceType ?? j.WorkplaceTypeCode),
        description: str(j.ShortDescriptionStr) ? htmlToText(str(j.ShortDescriptionStr)) : undefined,
      }));
    },
  },
];

/* eslint-enable @typescript-eslint/no-explicit-any */

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
  opts: { retries?: number; timeoutMs?: number; lite?: boolean } = {}
): Promise<AtsJob[]> {
  const def = getPlatform(platformId);
  if (!def) throw new Error(`unknown platform "${platformId}"`);

  for (const field of def.fields) {
    if (field.required && !config[field.key]) {
      throw new Error(`${def.label} needs "${field.label}"`);
    }
  }

  const fetchPage = async (offset: number): Promise<AtsJob[]> => {
    const req = def.build(config, offset, { lite: opts.lite });
    const data = await fetchJson(req.url, {
      method: req.method,
      body: req.body,
      headers: req.headers,
      retries: opts.retries,
      timeoutMs: opts.timeoutMs,
    });
    return def
      .parse(data, config)
      .filter((j) => j.title && j.url)
      .map(enrichJob);
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
