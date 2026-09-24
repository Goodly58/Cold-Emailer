import { randomUUID } from 'crypto';
import type { AtsJob } from './ats-registry';
import { normalizeUrl } from './http';
import { canonical, findByName, indexByName } from './names';
import { scoreRole } from './scoring';
import { putBlobs, updateDb } from './store';
import type { Application, Company, Db } from './types';

/**
 * Turning a scraped job into a pipeline role, shared by the scheduled
 * refresh, the aggregator search and the manual board import so all three
 * dedupe, score and store the same way.
 */

/** Blob keys owned by one application: its job description and AI work on it. */
export const jdKey = (appId: string) => `jd:${appId}`;
export const applicationBlobKeys = (appId: string) => [jdKey(appId), `fit:${appId}`, `kit:${appId}`];

const UAE_RE = /uae|u\.a\.e|dubai|abu dhabi|sharjah|ajman|fujairah|ras al|umm al|emirat/i;

const CITIES = ['abu dhabi', 'al ain', 'dubai', 'sharjah', 'ajman', 'ras al khaimah', 'fujairah', 'umm al quwain'];

/** The city part of a location, so "Dubai" and "Dubai, United Arab Emirates" match. */
export function cityOf(location?: string): string {
  const l = (location || '').toLowerCase();
  for (const c of CITIES) if (l.includes(c)) return c;
  if (/\brak\b/.test(l)) return 'ras al khaimah';
  if (/\bremote\b/.test(l)) return 'remote';
  return l.split(/[,/|]/)[0].trim();
}

/** A title reduced to what identifies the role: "Sr. Data Analyst (Dubai)" -> "senior data analyst". */
export function titleKey(title: string): string {
  return ` ${title.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')} `
    .replace(/ (abu dhabi|al ain|dubai|sharjah|ajman|ras al khaimah|fujairah|umm al quwain|uae|remote|hybrid)(?= )/g, ' ')
    .replace(/ sr(?= )/g, ' senior')
    .replace(/ jr(?= )/g, ' junior')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lookup over the existing pipeline: by link (every link a role is known
 * under) and by role identity (employer + title + city), which is what
 * catches one opening reached through two sources.
 */
export class PipelineIndex {
  private byUrl = new Map<string, Application>();
  private byRole = new Map<string, Application>();
  private companies: Map<string, Company>;

  constructor(db: Db) {
    this.companies = indexByName(db.companies);
    for (const app of db.applications) this.add(app);
  }

  company(name: string): Company | undefined {
    return findByName(this.companies, name);
  }

  roleKey(companyName: string, title: string, location?: string): string | undefined {
    const t = titleKey(title);
    if (!t) return undefined;
    const c = this.company(companyName);
    return `${canonical(c?.name ?? companyName)}|${t}|${cityOf(location)}`;
  }

  add(app: Application): void {
    for (const u of [app.jobUrl, ...(app.altUrls || [])]) {
      if (u) this.byUrl.set(normalizeUrl(u), app);
    }
    const key = this.roleKey(app.companyName, app.roleTitle, app.location);
    if (key && !this.byRole.has(key)) this.byRole.set(key, app);
  }

  /** Re-index after an application's link changed. */
  addUrl(app: Application, url: string): void {
    this.byUrl.set(normalizeUrl(url), app);
  }

  findByUrl(url: string): Application | undefined {
    return this.byUrl.get(normalizeUrl(url));
  }

  findRole(companyName: string, title: string, location?: string): Application | undefined {
    const key = this.roleKey(companyName, title, location);
    return key ? this.byRole.get(key) : undefined;
  }
}

/** Remember another link a role is listed under, capped so it can't grow forever. */
export function addAltUrl(app: Application, url: string): boolean {
  if (!url || normalizeUrl(url) === normalizeUrl(app.jobUrl || '')) return false;
  const alts = app.altUrls || [];
  if (alts.some((u) => normalizeUrl(u) === normalizeUrl(url))) return false;
  app.altUrls = [...alts, url].slice(-5);
  return true;
}

/**
 * Copies what a board says about a role onto the application. Returns
 * whether anything changed. Pay you entered yourself is never overwritten,
 * and the posted date only moves earlier: boards that report "updated"
 * rather than "published" (or "30+ days ago") would otherwise make an old
 * role look new again.
 */
export function applyJobDetails(app: Application, job: AtsJob): boolean {
  let changed = false;
  const set = <K extends keyof Application>(key: K, value: Application[K] | undefined) => {
    if (value === undefined || value === '' || app[key] === value) return;
    app[key] = value;
    changed = true;
  };

  if (job.postedAt && (!app.postedAt || job.postedAt < app.postedAt)) set('postedAt', job.postedAt);
  set('employmentType', job.employmentType);
  set('workplace', job.workplace);
  if (!app.division && job.department) set('division', job.department);

  if (job.salary && app.salarySource !== 'manual') {
    set('salaryMin', job.salary.minMonthlyAed);
    set('salaryMax', job.salary.maxMonthlyAed);
    set('salarySource', job.salary.source);
    set('salaryText', job.salary.raw);
  }
  return changed;
}

export interface NewRoleMeta {
  companyName: string;
  /** Platform or aggregator id, or 'manual'. */
  source: string;
  /** Set for roles from a polled board, so closures can be tracked. */
  sourceId?: string;
  nowIso: string;
}

export function newApplication(job: AtsJob, meta: NewRoleMeta, db: Db, index: PipelineIndex): Application {
  const company = index.company(meta.companyName);
  const { score, reasons } = scoreRole(
    { roleTitle: job.title, companyName: meta.companyName, location: job.location, division: job.department },
    db.profile,
    company
  );
  const app: Application = {
    id: randomUUID(),
    companyName: meta.companyName,
    roleTitle: job.title,
    jobUrl: job.url,
    location: job.location,
    division: job.department || undefined,
    source: meta.source,
    sourceId: meta.sourceId,
    stage: 'found',
    score,
    scoreReasons: reasons,
    emiratiAngle: UAE_RE.test(job.location || ''),
    isNew: true,
    lastSeenAt: meta.nowIso.slice(0, 10),
    createdAt: meta.nowIso,
  };
  applyJobDetails(app, job);
  return app;
}

/**
 * A job description for the blob store, if the role doesn't have one yet.
 * Returns the write to queue, and marks the application.
 */
export function takeDescription(app: Application, job: AtsJob): [string, string] | undefined {
  if (app.hasDescription || !job.description || job.description.length < 200) return undefined;
  app.hasDescription = true;
  return [jdKey(app.id), job.description];
}

/**
 * Writes queued descriptions to the blob store. This runs after the main
 * database write, so a slow blob write never holds it open; if it fails, the
 * roles are un-flagged so the next refresh tries again. Returns how many were
 * saved.
 */
export async function saveDescriptions(writes: Array<[string, string]>): Promise<number> {
  if (writes.length === 0) return 0;
  try {
    await putBlobs(writes);
    return writes.length;
  } catch (e) {
    console.error('saving job descriptions failed', e);
    const ids = new Set(writes.map(([key]) => key.slice('jd:'.length)));
    await updateDb((db) => {
      for (const a of db.applications) if (ids.has(a.id)) a.hasDescription = false;
    }).catch(() => undefined);
    return 0;
  }
}
