# The scraper

How job data gets into the pipeline, and the failure modes the design guards against.

## What it talks to

Only **public, documented endpoints** — the same JSON APIs that render companies' own careers
pages. Nothing here scrapes HTML, impersonates a browser, or automates a logged-in account. That
is a deliberate constraint: LinkedIn-style scraping gets accounts banned, and a job search is a bad
time to lose your LinkedIn.

**Company boards** (`lib/ats-registry.ts`) — one entry per platform, declaring how to build the
request, how to parse the response, which identifiers it needs, and whether a board can be found by
guessing a slug:

| Platform | Identifiers | Discoverable |
|---|---|---|
| Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee | slug | yes |
| Personio, Breezy, Pinpoint, Teamtailor | slug | no |
| Workday | tenant + data centre + site | no |
| Oracle Cloud Recruiting | host + site number | no |

"Discoverable" means a company name can plausibly be turned into the identifier. Workday needs a
data-centre number that no amount of guessing will produce, so discovery skips it rather than
burning requests.

**Aggregators** (`lib/aggregators.ts`) — cover the whole UAE market rather than one employer, which
is how you find roles at companies you never thought to track. The Muse needs no key; Adzuna and
Jooble activate when their free API keys are set.

## The refresh cycle

`lib/refresh.ts`, triggered daily by Vercel Cron or on demand from the Sources page.

1. **Read** the enabled sources, ordered **least-recently-checked first**.
2. **Fetch** boards, 6 at a time, each with retries and a timeout.
3. **Reconcile** in a single database pass:
   - new postings are added, scored, and flagged `NEW`
   - postings already known have their title and location refreshed
   - postings that vanished from the board are marked `closed`
   - postings that reappear are un-closed
4. **Prune** roles closed more than 30 days ago.
5. **Record** the run — duration, counts, and per-source errors.

## What each design decision prevents

**URL normalization before comparison.** Boards append tracking parameters that change between
requests. Comparing raw URLs would re-import the same posting every single day. `normalizeUrl`
strips tracking params, lowercases the host, drops `www.` and trailing slashes, and sorts the
remaining query string.

**Applied roles are never auto-closed.** Only postings still sitting in `found` can be closed. A
company routinely pulls a posting once they have enough applicants — including yours. Closing it
would quietly erase a live application from your pipeline.

**Retry only what's worth retrying.** 429 and 5xx get exponential backoff with jitter; 4xx fails
immediately, because a 404 means the slug is wrong and retrying it three times just wastes the run.
An HTML response where JSON was expected is treated as a hard failure — it usually means a redirect
to a marketing page.

**A 45-second wall-clock budget.** Vercel's free tier kills functions at 60s. Without a budget, a
large sweep would be killed mid-run having written nothing. Sources past the deadline are skipped
with their state untouched, so they stay at the front of the stalest-first queue and get picked up
next run. Coverage rotates instead of always favouring the same boards.

**Bounded concurrency.** Six boards at a time keeps us polite and inside serverless socket limits.

**Failures are recorded, never thrown.** One dead source must not abort the whole run. Each records
its error and a consecutive-failure counter; three strikes and the Health page flags it.

## Relevance scoring

`lib/scoring.ts` ranks every imported role 0–100 against your job preferences. Once the scraper is
pulling hundreds of postings a week, an unranked list is noise.

Signals: title match (strongest), bonus keywords, UAE location, company tier, Emiratisation
liability, seniority fit. Two guards matter:

- An **excluded keyword zeroes** a role outright.
- A role with **no title or keyword relevance is capped at 25**, however prestigious the employer.
  Without this, a nurse vacancy at a dream-tier bank in Dubai collects enough location and tier
  points to look worth reading.

## Storage

`lib/store.ts` writes **one row per record**, not one blob per collection, and diffs against a
snapshot taken at read time so only genuinely changed rows are written. Measured at 24ms for a
single edit against 2,126 rows; the previous blob-per-collection layout rewrote everything on every
edit.

## Known limits

- **Vercel's free tier runs cron once a day.** Fine for job hunting — postings don't turn over
  hourly. On Pro, change the schedule in `vercel.json` to `0 * * * *`.
- **Some large UAE corporates can't be polled.** Those on Phenom, Taleo, SuccessFactors or iCIMS
  have no supported public feed yet; their careers links are one click away on the Companies page,
  and the cold-email side of the system matters more for them anyway.
- **Discovery guesses slugs.** It finds boards for companies whose name maps cleanly to their
  slug; the rest need adding by hand, which the Sources page supports with a per-platform hint.

## Tests

`npm test` — 50 tests. The integration suite drives the whole refresh cycle against a stubbed
board: import, dedupe across changed tracking params, upstream edits, close/reopen, failure
recording and recovery, keyword filters, time budget, and the applied-role protection above.
