import { randomUUID } from 'crypto';
import { updateDb } from './store';
import { fetchJobs, isPlatform, matchesKeywords, type AtsJob } from './ats';
import type { Application, JobSource } from './types';

export interface RefreshReport {
  checked: number;
  added: number;
  closed: number;
  failed: number;
  details: Array<{ company: string; added: number; total: number; error?: string }>;
  ranAt: string;
}

/**
 * Polls every enabled job source, adds roles we haven't seen, and marks
 * postings that have disappeared from the board as closed.
 *
 * Sources are fetched in parallel first (network-bound), then the database is
 * updated once — so a slow board can't hold a write transaction open.
 */
export async function refreshAllSources(onlyId?: string): Promise<RefreshReport> {
  const ranAt = new Date().toISOString();
  const today = ranAt.slice(0, 10);

  // Read current sources without holding a write.
  const sources = await updateDb((db) =>
    db.jobSources.filter((s) => s.enabled && (!onlyId || s.id === onlyId))
  );

  const fetched = await Promise.all(
    sources.map(async (source) => {
      if (!isPlatform(source.platform)) {
        return { source, jobs: [] as AtsJob[], error: `unknown platform "${source.platform}"` };
      }
      try {
        const jobs = await fetchJobs(source.platform, source.slug);
        return { source, jobs: jobs.filter((j) => matchesKeywords(j, source.keywords)) };
      } catch (e) {
        return {
          source,
          jobs: [] as AtsJob[],
          error: e instanceof Error ? e.message : 'fetch failed',
        };
      }
    })
  );

  return updateDb((db) => {
    const report: RefreshReport = {
      checked: fetched.length,
      added: 0,
      closed: 0,
      failed: 0,
      details: [],
      ranAt,
    };

    const byUrl = new Map(db.applications.filter((a) => a.jobUrl).map((a) => [a.jobUrl!, a]));

    for (const { source, jobs, error } of fetched) {
      const live = db.jobSources.find((s) => s.id === source.id);

      if (error) {
        report.failed += 1;
        report.details.push({ company: source.companyName, added: 0, total: 0, error });
        if (live) {
          live.lastCheckedAt = ranAt;
          live.lastError = error;
          live.lastResult = 'failed';
        }
        continue;
      }

      let added = 0;
      const seenUrls = new Set<string>();

      for (const job of jobs) {
        seenUrls.add(job.url);
        const existing = byUrl.get(job.url);
        if (existing) {
          existing.lastSeenAt = today;
          // It's back on the board — un-close it.
          if (existing.closed) existing.closed = false;
          continue;
        }
        const app: Application = {
          id: randomUUID(),
          companyName: source.companyName,
          roleTitle: job.title,
          jobUrl: job.url,
          location: job.location,
          source: source.platform,
          sourceId: source.id,
          stage: 'found',
          emiratiAngle: /uae|dubai|abu dhabi|sharjah|emirat/i.test(job.location),
          isNew: true,
          lastSeenAt: today,
          createdAt: ranAt,
        };
        db.applications.unshift(app);
        byUrl.set(job.url, app);
        added += 1;
      }

      // Anything from this source that wasn't on the board this time is gone.
      for (const app of db.applications) {
        if (
          app.sourceId === source.id &&
          app.jobUrl &&
          !seenUrls.has(app.jobUrl) &&
          !app.closed &&
          app.stage === 'found'
        ) {
          app.closed = true;
          report.closed += 1;
        }
      }

      report.added += added;
      report.details.push({ company: source.companyName, added, total: jobs.length });

      if (live) {
        live.lastCheckedAt = ranAt;
        live.lastError = undefined;
        live.lastResult = `${jobs.length} open, ${added} new`;
        live.totalFound = (live.totalFound || 0) + added;
      }
    }

    return report;
  });
}

/** Sources not checked in over a day (or ever) — surfaced as staleness warnings. */
export function isStale(source: JobSource, hours = 26): boolean {
  if (!source.lastCheckedAt) return true;
  return Date.now() - new Date(source.lastCheckedAt).getTime() > hours * 3600_000;
}
