import { fetchJson } from './http';
import type { AtsJob } from './ats-registry';

/**
 * Job aggregators covering the whole UAE market, rather than one company's
 * board. Each needs a free API key, so they're opt-in: configure the key and
 * the source becomes available, otherwise it stays hidden.
 *
 * These complement the ATS pollers — aggregators find roles at companies you
 * haven't thought to track, which is exactly the gap company-by-company
 * polling leaves.
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
    id: 'adzuna',
    label: 'Adzuna',
    envKeys: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
    signupUrl: 'https://developer.adzuna.com/signup',
    freeTier: '250 calls/day',
    async fetch(query, location) {
      const id = process.env.ADZUNA_APP_ID;
      const key = process.env.ADZUNA_APP_KEY;
      if (!id || !key) throw new Error('Adzuna keys not configured');

      const params = new URLSearchParams({
        app_id: id,
        app_key: key,
        results_per_page: '50',
        'content-type': 'application/json',
      });
      if (query) params.set('what', query);
      if (location) params.set('where', location);

      const data = await fetchJson<any>(`https://api.adzuna.com/v1/api/jobs/ae/search/1?${params}`);
      return (data?.results || []).map((j: Record<string, any>) => ({
        title: str(j.title).replace(/<\/?[^>]+>/g, ''),
        location: str(j.location?.display_name),
        url: str(j.redirect_url),
        department: str(j.category?.label),
        company: str(j.company?.display_name),
      }));
    },
  },
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
      return (data?.jobs || []).map((j: Record<string, any>) => ({
        title: str(j.title),
        location: str(j.location),
        url: str(j.link),
        department: '',
        company: str(j.company),
      }));
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
        .map((j: Record<string, any>) => ({
          title: str(j.name),
          location: (j.locations || []).map((l: any) => str(l.name)).join(', '),
          url: str(j.refs?.landing_page),
          department: str(j.categories?.[0]?.name),
          company: str(j.company?.name),
        }))
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
