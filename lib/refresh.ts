import { randomUUID } from 'crypto';
import { updateDb } from './store';
import { fetchJobs, isPlatform, matchesKeywords, type AtsJob } from './ats';
import { mapWithConcurrency, normalizeUrl } from './http';
import { scoreRole } from './scoring';
import type { Application, JobSource, RefreshRun } from './types';

/** How many boards to poll at once. Keeps us polite and within socket limits. */
const CONCURRENCY = 6;

/** Runs older than this are pruned so the log doesn't grow without bound. */
const MAX_RUNS = 50;

/** Closed postings are deleted after this long — keeps the pipeline readable. */
const PRUNE_CLOSED_AFTER_DAYS = 30;

export interface RefreshReport {
  runId: string;
  checked: number;
  /** Sources left for the next run because the time budget ran out. */
  skipped: number;
  added: number;
  updated: number;
  closed: number;
  pruned: number;
  failed: number;
  durationMs: number;
  details: Array<{ company: string; added: number; total: number; error?: string }>;
  ranAt: string;
}

interface FetchOutcome {
  source: JobSource;
  jobs: AtsJob[];
  error?: string;
  /** Ran out of time budget — left untouched for the next run. */
  skipped?: boolean;
}

/**
 * Wall-clock budget for one invocation. Vercel's Hobby tier caps serverless
 * functions at 60s, so we stop fetching in time to still write results
 * instead of being killed mid-run with nothing saved.
 */
const DEFAULT_BUDGET_MS = 45_000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

/**
 * Polls every enabled job source, adds roles we haven't seen, and marks
 * postings that have disappeared from a board as closed.
 *
 * Network work happens first, in parallel and bounded; the database is then
 * updated in a single pass so a slow board can't hold a write open.
 */
export async function refreshAllSources(
  opts: { onlyId?: string; trigger?: 'cron' | 'manual'; budgetMs?: number } = {}
): Promise<RefreshReport> {
  const { onlyId, trigger = 'manual', budgetMs = DEFAULT_BUDGET_MS } = opts;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const deadline = startMs + budgetMs;
  const today = startedAt.slice(0, 10);

  const all = await updateDb((db) =>
    db.jobSources.filter((s) => s.enabled && (!onlyId || s.id === onlyId))
  );

  // Stalest first: if the budget runs out, the sources that have gone longest
  // without a check are the ones that got done. Over successive runs every
  // source is covered even when there are more than fit in one invocation.
  const sources = [...all].sort((a, b) =>
    String(a.lastCheckedAt || '').localeCompare(String(b.lastCheckedAt || ''))
  );

  let skipped = 0;

  const fetched: FetchOutcome[] = await mapWithConcurrency(sources, CONCURRENCY, async (source) => {
    if (Date.now() > deadline) {
      skipped += 1;
      return { source, jobs: [], skipped: true };
    }
    if (!isPlatform(source.platform)) {
      return { source, jobs: [], error: `unknown platform "${source.platform}"` };
    }
    try {
      const jobs = await fetchJobs(source.platform, source.slug);
      return { source, jobs: jobs.filter((j) => matchesKeywords(j, source.keywords)) };
    } catch (e) {
      return { source, jobs: [], error: e instanceof Error ? e.message : 'fetch failed' };
    }
  });

  return updateDb((db) => {
    const report: RefreshReport = {
      runId: randomUUID(),
      checked: fetched.length - skipped,
      skipped,
      added: 0,
      updated: 0,
      closed: 0,
      pruned: 0,
      failed: 0,
      durationMs: 0,
      details: [],
      ranAt: startedAt,
    };
    const errors: Array<{ company: string; error: string }> = [];

    // Index by normalized URL so the same posting reached via a different
    // query string doesn't get imported twice.
    const byUrl = new Map<string, Application>();
    for (const app of db.applications) {
      if (app.jobUrl) byUrl.set(normalizeUrl(app.jobUrl), app);
    }

    const companyByName = new Map(db.companies.map((c) => [c.name.trim().toLowerCase(), c]));

    for (const { source, jobs, error, skipped: wasSkipped } of fetched) {
      const live = db.jobSources.find((s) => s.id === source.id);

      // Left for the next run — don't touch its state, so it stays at the
      // front of the stalest-first queue.
      if (wasSkipped) continue;

      if (error) {
        report.failed += 1;
        report.details.push({ company: source.companyName, added: 0, total: 0, error });
        errors.push({ company: source.companyName, error });
        if (live) {
          live.lastCheckedAt = startedAt;
          live.lastError = error;
          live.lastResult = 'failed';
          live.consecutiveFailures = (live.consecutiveFailures || 0) + 1;
        }
        continue;
      }

      let added = 0;
      const seen = new Set<string>();

      for (const job of jobs) {
        const key = normalizeUrl(job.url);
        seen.add(key);

        const existing = byUrl.get(key);
        if (existing) {
          existing.lastSeenAt = today;
          if (existing.closed) {
            existing.closed = false; // reappeared on the board
            report.updated += 1;
          }
          // Boards edit titles and locations after posting.
          if (job.title && existing.roleTitle !== job.title) {
            existing.roleTitle = job.title;
            report.updated += 1;
          }
          if (job.location && existing.location !== job.location) {
            existing.location = job.location;
          }
          continue;
        }

        const company = companyByName.get(source.companyName.trim().toLowerCase());
        const { score, reasons } = scoreRole(
          {
            roleTitle: job.title,
            companyName: source.companyName,
            location: job.location,
            division: job.department,
          },
          db.profile,
          company
        );

        const app: Application = {
          id: randomUUID(),
          companyName: source.companyName,
          roleTitle: job.title,
          jobUrl: job.url,
          location: job.location,
          division: job.department || undefined,
          source: source.platform,
          sourceId: source.id,
          stage: 'found',
          score,
          scoreReasons: reasons,
          emiratiAngle: /uae|u\.a\.e|dubai|abu dhabi|sharjah|ajman|fujairah|ras al|umm al|emirat/i.test(
            job.location || ''
          ),
          isNew: true,
          lastSeenAt: today,
          createdAt: startedAt,
        };
        db.applications.unshift(app);
        byUrl.set(key, app);
        added += 1;
      }

      // Anything from this source missing from the board is gone. Only touch
      // roles still sitting in 'found' — once you've applied, the record stays.
      for (const app of db.applications) {
        if (
          app.sourceId === source.id &&
          app.jobUrl &&
          !seen.has(normalizeUrl(app.jobUrl)) &&
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
        live.lastCheckedAt = startedAt;
        live.lastError = undefined;
        live.lastResult = `${jobs.length} open, ${added} new`;
        live.totalFound = (live.totalFound || 0) + added;
        live.consecutiveFailures = 0;
      }
    }

    // Drop long-closed roles nobody acted on, so the board stays readable.
    const before = db.applications.length;
    db.applications = db.applications.filter((a) => {
      if (!a.closed || a.stage !== 'found') return true;
      const last = a.lastSeenAt || a.createdAt;
      return daysBetween(last, startedAt) < PRUNE_CLOSED_AFTER_DAYS;
    });
    report.pruned = before - db.applications.length;

    report.durationMs = Date.now() - startMs;

    const run: RefreshRun = {
      id: report.runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: report.durationMs,
      trigger,
      checked: report.checked,
      added: report.added,
      updated: report.updated,
      closed: report.closed,
      failed: report.failed,
      errors: errors.length ? errors : undefined,
    };
    db.runs.unshift(run);
    if (db.runs.length > MAX_RUNS) db.runs.length = MAX_RUNS;

    return report;
  });
}

/** Sources not checked in over a day (or ever). */
export function isStale(source: JobSource, hours = 26): boolean {
  if (!source.lastCheckedAt) return true;
  return Date.now() - new Date(source.lastCheckedAt).getTime() > hours * 3600_000;
}
