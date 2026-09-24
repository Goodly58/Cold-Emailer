import { randomUUID } from 'crypto';
import { deleteBlobs, readDb, updateDb } from './store';
import { fetchJobs, isPlatform, matchesKeywords, type AtsJob } from './ats';
import { mapWithConcurrency, normalizeUrl } from './http';
import {
  PipelineIndex,
  addAltUrl,
  applicationBlobKeys,
  applyJobDetails,
  newApplication,
  saveDescriptions,
  takeDescription,
} from './importer';
import type { JobSource, RefreshRun } from './types';

/** How many boards to poll at once. Keeps us polite and within socket limits. */
const CONCURRENCY = 6;

/** Runs older than this are pruned so the log doesn't grow without bound. */
const MAX_RUNS = 50;

/** Closed postings are deleted after this long — keeps the pipeline readable. */
const PRUNE_CLOSED_AFTER_DAYS = 30;

/**
 * Job descriptions saved per run. New roles always get theirs; roles found
 * before descriptions were collected are backfilled this many at a time, so
 * the first run after an upgrade can't blow the time budget on writes.
 */
const MAX_DESCRIPTION_WRITES = 400;

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
  /** Same role already in the pipeline from another source — linked, not re-added. */
  merged: number;
  /** Job descriptions saved this run. */
  descriptions: number;
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
 * Wall-clock budget for one invocation, leaving time to write results before
 * the platform kills the function. The daily cron gets most of Vercel's
 * 300-second limit (fluid compute, the default for new projects) so one run
 * can cover hundreds of boards; a click on "Refresh now" gets less, because
 * someone is waiting on it.
 */
export const CRON_BUDGET_MS = 240_000;
export const MANUAL_BUDGET_MS = 50_000;

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
  const { onlyId, trigger = 'manual' } = opts;
  const budgetMs = opts.budgetMs ?? (trigger === 'cron' ? CRON_BUDGET_MS : MANUAL_BUDGET_MS);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const deadline = startMs + budgetMs;
  const today = startedAt.slice(0, 10);

  // A plain read — the write happens once at the end, after all the network
  // work, so a slow board never holds a write open.
  const { jobSources } = await readDb();
  const all = jobSources.filter((s) => s.enabled && (!onlyId || s.id === onlyId));

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
      const jobs = await fetchJobs(source.platform, source.slug, source.config || {});
      return { source, jobs: jobs.filter((j) => matchesKeywords(j, source.keywords)) };
    } catch (e) {
      return { source, jobs: [], error: e instanceof Error ? e.message : 'fetch failed' };
    }
  });

  const descriptionWrites: Array<[string, string]> = [];
  const prunedIds: string[] = [];

  const report = await updateDb((db) => {
    const report: RefreshReport = {
      runId: randomUUID(),
      checked: fetched.length - skipped,
      skipped,
      added: 0,
      updated: 0,
      closed: 0,
      pruned: 0,
      failed: 0,
      merged: 0,
      descriptions: 0,
      durationMs: 0,
      details: [],
      ranAt: startedAt,
    };
    const errors: Array<{ company: string; error: string }> = [];

    // Links are normalised so the same posting reached via a different query
    // string isn't imported twice; role identity catches the same opening
    // reached through two different sources.
    const index = new PipelineIndex(db);
    // Only takes (and flags) a description while there's room this run, so a
    // role left over for the backfill isn't wrongly marked as having one.
    const queueDescription = (take: () => [string, string] | undefined) => {
      if (descriptionWrites.length >= MAX_DESCRIPTION_WRITES) return;
      const write = take();
      if (write) descriptionWrites.push(write);
    };

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

        const existing = index.findByUrl(job.url);
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
          applyJobDetails(existing, job);
          // Only the source that owns a role stores its description, and
          // only while it's still worth reading.
          if (existing.sourceId === source.id && !existing.dismissed) {
            queueDescription(() => takeDescription(existing, job));
          }
          continue;
        }

        // Not this link — but maybe this role, found earlier through an
        // aggregator, a manual add or another of the company's boards.
        const twin = index.findRole(source.companyName, job.title, job.location);
        if (twin && twin.sourceId !== source.id) {
          if (!twin.sourceId && !twin.dismissed) {
            // A role with no board behind it adopts this one: a direct apply
            // link, and closure tracking from now on.
            const previous = twin.jobUrl;
            twin.jobUrl = job.url;
            if (previous) addAltUrl(twin, previous);
            twin.sourceId = source.id;
            twin.source = source.platform;
            twin.lastSeenAt = today;
            applyJobDetails(twin, job);
            queueDescription(() => takeDescription(twin, job));
          } else {
            addAltUrl(twin, job.url);
          }
          index.addUrl(twin, job.url);
          report.merged += 1;
          continue;
        }

        const app = newApplication(
          job,
          { companyName: source.companyName, source: source.platform, sourceId: source.id, nowIso: startedAt },
          db,
          index
        );
        queueDescription(() => takeDescription(app, job));
        db.applications.unshift(app);
        index.add(app);
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
      if (daysBetween(last, startedAt) < PRUNE_CLOSED_AFTER_DAYS) return true;
      prunedIds.push(a.id);
      return false;
    });
    report.pruned = before - db.applications.length;
    report.descriptions = descriptionWrites.length;

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
      skipped: report.skipped || undefined,
      merged: report.merged || undefined,
      descriptions: report.descriptions || undefined,
      errors: errors.length ? errors : undefined,
    };
    db.runs.unshift(run);
    if (db.runs.length > MAX_RUNS) db.runs.length = MAX_RUNS;

    return report;
  });

  report.descriptions = await saveDescriptions(descriptionWrites);
  await deleteBlobs(prunedIds.flatMap(applicationBlobKeys)).catch((e) =>
    console.error('removing pruned descriptions failed', e)
  );

  return report;
}

/** Sources not checked in over a day (or ever). */
export function isStale(source: JobSource, hours = 26): boolean {
  if (!source.lastCheckedAt) return true;
  return Date.now() - new Date(source.lastCheckedAt).getTime() > hours * 3600_000;
}
