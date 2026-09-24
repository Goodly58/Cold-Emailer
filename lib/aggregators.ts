import { fetchJson } from './http';
import { enrichJob, isoDate, normEmployment, type AtsJob } from './ats-registry';
import { parseSalaryText } from './salary';
import { htmlToText } from './text';

/**
 * Job aggregators covering the whole UAE market, rather than one company's
 * board. Each needs a free API key, so they're opt-in: configure the key and
 * the source becomes available, otherwise it stays hidden.
 *
 * These complement the ATS pollers — aggregators find roles at companies you
 * haven't thought to track, which is exactly the gap company-by-company
 * polling leaves.
 *
 * Adzuna was dropped: its API serves a fixed list of countries, and the UAE
 * ("ae") doesn't appear to be one of them, so a UAE search could only return
 * an error or nothing. Worth re-adding if that changes.
 */

export interface AggregatorDef {
  id: string;
  label: string;
  /** Env vars that must be set for this aggregator to work. */
  envKeys: string[];
  signupUrl: string;
  freeTier: string;
  fetch: (query: string, location: string) => Promise<AtsJob[]>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export const AGGREGATORS: AggregatorDef[] = [
  {
    id: 'jooble',
    label: 'Jooble',
    envKeys: ['JOOBLE_API_KEY'],
    signupUrl: 'https://jooble.org/api/about',
    freeTier: 'free key on request',
    async fetch(query, location) {
      const key = process.env.JOOBLE_API_KEY;
      if (!key) throw new Error('Jooble key not configured');

      const data = await fetchJson<any>(`https://jooble.org/api/${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords: query || 'analyst', location: location || 'United Arab Emirates' }),
      });
      return (data?.jobs || []).map((j: Record<string, any>) =>
        enrichJob({
          title: str(j.title),
          location: str(j.location),
          url: str(j.link),
          department: '',
          company: str(j.company),
          postedAt: isoDate(j.updated),
          employmentType: normEmployment(j.type),
          // Jooble's salary is free text ("AED 10,000 - 15,000 per month").
          salary: parseSalaryText(str(j.salary), { labelled: true }),
          description: j.snippet ? htmlToText(str(j.snippet)) : undefined,
        })
      );
    },
  },
  {
    id: 'themuse',
    label: 'The Muse',
    envKeys: [],
    signupUrl: 'https://www.themuse.com/developers/api/v2',
    freeTier: 'open, no key needed',
    async fetch(query, location) {
      const params = new URLSearchParams({ page: '0' });
      if (location) params.set('location', location);
      const data = await fetchJson<any>(`https://www.themuse.com/api/public/jobs?${params}`);
      const q = query.trim().toLowerCase();
      return (data?.results || [])
        .map((j: Record<string, any>) =>
          enrichJob({
            title: str(j.name),
            location: (j.locations || []).map((l: any) => str(l.name)).join(', '),
            url: str(j.refs?.landing_page),
            department: str(j.categories?.[0]?.name),
            company: str(j.company?.name),
            postedAt: isoDate(j.publication_date),
            description: j.contents ? htmlToText(str(j.contents)) : undefined,
          })
        )
        .filter((j: AtsJob) => !q || j.title.toLowerCase().includes(q));
    },
  },
];

/* eslint-enable @typescript-eslint/no-explicit-any */

export function getAggregator(id: string): AggregatorDef | undefined {
  return AGGREGATORS.find((a) => a.id === id);
}

/** Which aggregators actually have their keys configured. */
export function availableAggregators(): Array<AggregatorDef & { configured: boolean }> {
  return AGGREGATORS.map((a) => ({
    ...a,
    configured: a.envKeys.every((k) => Boolean(process.env[k])),
  }));
}
