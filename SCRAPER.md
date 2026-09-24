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

| Platform | Identifiers | Discoverable | Status |
|---|---|---|---|
| Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee | slug | yes | vendor-documented public API |
| Personio, Breezy, Pinpoint, Teamtailor | slug | no | **unverified** |
| Workday | tenant + data centre + site | no | **unverified** |
| Oracle Cloud Recruiting | host + site number | no | **unverified** |

**Nothing has been tested against a live board yet.** The environment this was built in blocks
outbound requests to every job-board host, so every platform — including the vendor-documented ones
— has only been exercised against stubbed responses in the test suite. The first real test is your
deployed app: run "Refresh all now" once and check the Health page.

"Vendor-documented" means the vendor publishes the endpoint for exactly this use, so confidence is
high. "Unverified" means the endpoint comes from research into how the vendor's own careers pages
work, with no official documentation — plausible, but a first failure there is expected rather than
surprising. Those platforms carry an "(unverified)" label in the UI for that reason.

"Discoverable" means a company name can plausibly be turned into the identifier. Workday needs a
data-centre number that no amount of guessing will produce, so discovery skips it rather than
burning requests.

**On Workday and Oracle specifically.** Research found strong corroboration of the request shape
(independent implementations across many codebases agree on every field name), and two risks:

- Workday fronts these hosts with bot protection that rejects non-browser user agents. This tool
  sends an honest identifying user agent rather than impersonating a browser, so a 403 here is the
  likely first failure.
- Oracle 400s the whole request if an `expand` target is invalid, so nothing optional is requested.

The Health page will show the real error either way.

**Aggregators** (`lib/aggregators.ts`) cover the whole market rather than one employer, which is
how you find roles at companies you never thought to track. The Muse needs no key; Jooble
activates when its free API key is set. Adzuna was removed: its API serves a fixed list of
countries and the UAE doesn't appear to be one of them.

## What each posting carries

Beyond title, link, location and department, each parser reads what its vendor publishes. Every
field is optional; a board that doesn't publish one just leaves it blank.

| Platform | Posted date | Pay | Remote / hybrid | Contract type | Full description |
|---|---|---|---|---|---|
| Greenhouse | `first_published` (else `updated_at`) | `pay_input_ranges`, if the list endpoint includes them (unconfirmed) | from the location text | from the title | `content=true` (entity-escaped HTML) |
| Lever | `createdAt` (epoch ms) | `salaryRange` | `workplaceType` | `categories.commitment` | `descriptionPlain` + `lists` + `additionalPlain` |
| Ashby | `publishedAt` | `includeCompensation=true` → `summaryComponents` | `workplaceType`, `isRemote` | `employmentType` | `descriptionPlain` |
| Workable | `published_on` | — | `telecommuting` | `employment_type` | `details=true` |
| SmartRecruiters | `releasedDate` | — | `location.remote` / `hybrid` | `typeOfEmployment` | — (needs a call per posting) |
| Recruitee | `published_at` | `salary` (values may be strings) | `remote` / `hybrid` / `on_site` | `employment_type_code` | `description` + `requirements` |
| Workday | "Posted 3 Days Ago", converted to a date | — | `remoteType` when present | — | — |

Most UAE postings state no pay in a field at all, but a fair number write it in the description
("AED 18,000 – 22,000 per month"). `lib/salary.ts` parses that conservatively: a number needs a
currency next to it, salary wording nearby, and a plausible monthly value once converted, so
"AED 2 billion fund" or "5,000 employees" is never read as pay. Everything is normalised to AED
a month; the Gulf currencies and the dollar are pegged, the rest use approximate rates.

These field names come from vendor docs where they exist and from open-source clients otherwise.
Like the endpoints themselves, they have only been tested against fixtures (`tests/scraper.test.ts`).

**Descriptions** go to a separate blob store (a `blobs` table in Turso, or `data/db.blobs.json`
locally) rather than the main database, because every page load reads the whole main database.
They're saved for new roles and backfilled 400 a run for roles imported earlier, and deleted when
a role is pruned or deleted. Discovery asks for the lightweight listing without descriptions.

## The refresh cycle

`lib/refresh.ts`, triggered daily by Vercel Cron or on demand from the Sources page.

1. **Read** the enabled sources, ordered **least-recently-checked first**.
2. **Fetch** boards, 6 at a time, each with retries and a timeout.
3. **Reconcile** in a single database pass:
   - new postings are added, scored, and flagged `NEW`
   - postings already known have their title, location, pay, dates and type refreshed
   - the same role reached through a different source is linked, not added twice (below)
   - postings that vanished from the board are marked `closed`
   - postings that reappear are un-closed
4. **Prune** roles closed more than 30 days ago.
5. **Record** the run: duration, counts, and per-source errors.
6. **Save descriptions** to the blob store, after the main write so a slow blob write never holds
   the database. If that fails, the roles are un-flagged and the next run tries again.

## What each design decision prevents

**URL normalization before comparison.** Boards append tracking parameters that change between
requests. Comparing raw URLs would re-import the same posting every single day. `normalizeUrl`
strips tracking params, lowercases the host, drops `www.` and trailing slashes, and sorts the
remaining query string.

**One role, one card.** The same opening often turns up twice: on a company's board and through an
aggregator, or on two of a company's boards. Roles are matched on employer (with name variants
and acronyms resolved), a normalised title ("Sr. Data Analyst (Dubai)" = "Senior Data Analyst")
and city. A role found earlier through an aggregator or by hand adopts the company board's link
when it appears there, which gives it a direct apply link and closure tracking; the old link is
kept under "also listed at". Two postings with the same title in the same city on the *same*
board are kept apart, because those are usually genuinely separate requisitions.

**Dismissed roles stay dismissed.** Removing a scraped role hides it rather than deleting it, so the
next refresh doesn't import it again.

**Applied roles are never auto-closed.** Only postings still sitting in `found` can be closed. A
company routinely pulls a posting once they have enough applicants — including yours. Closing it
would quietly erase a live application from your pipeline.

**Retry only what's worth retrying.** 429 and 5xx get exponential backoff with jitter; 4xx fails
immediately, because a 404 means the slug is wrong and retrying it three times just wastes the run.
An HTML response where JSON was expected is treated as a hard failure — it usually means a redirect
to a marketing page.

**A wall-clock budget.** The daily cron gets 240 seconds of fetching inside Vercel's 300-second
function limit (fluid compute, the default for new projects); "Refresh now" gets 50 seconds,
because someone is waiting on it. Without a budget, a large sweep would be killed mid-run having
written nothing. Sources past the deadline are skipped with their state untouched, so they stay at
the front of the stalest-first queue and get picked up next run. Coverage rotates instead of
always favouring the same boards.

**Pagination.** Workday caps pages at 20 and SmartRecruiters at 100, so both are walked until a
short page, stopping early if a board ignores the offset and replays page one.

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

## Pay and ranking

`lib/pay.ts` gives every role a monthly pay figure: the posted or stated one when there is one,
otherwise a benchmark for its job family (17 families, keyword-matched on the title) and level
(intern to director), adjusted for the employer's sector (government, banking and energy +15%,
top-tier tech +20%, hospitality and retail −25%) and never below the AED 6,000 Emirati minimum
wage. The benchmark table is drawn from 2025–26 salary-guide press coverage and aggregator data,
medium-to-low confidence, and every estimate is labelled as one.

For private-sector roles paying AED 6,000–20,000 it adds the Nafis top-up for your education
under the framework for new enrolments from September 2026 (up to 6,000 with a degree, 5,000 with
a diploma, 4,000 with secondary school).

The Pipeline's opportunity score combines fit (45 points: keyword relevance, or your AI fit check
once you've run it), pay against your minimum (25), freshness (15) and employer tier and
Emiratisation (15). Each part is shown on hover.

## Storage

`lib/store.ts` writes **one row per record**, not one blob per collection, and diffs against a
snapshot taken at read time so only genuinely changed rows are written. The previous
blob-per-collection layout rewrote an entire collection on every edit.

Measured with 555 companies and 1,500 scraped roles (2,061 rows, an 800KB database):

| Operation | Latency |
|---|---|
| Load company list | ~110ms |
| Load application list | ~90ms |
| Single record edit | ~110ms |

Reads still load the full dataset, so latency grows with total rows — fine at the scale a personal
job search reaches, and the 30-day pruning of closed postings keeps it bounded.

## Known limits

- **Vercel's free tier runs each cron job at most once a day.** Fine for job hunting; postings don't
  turn over hourly. On Pro, change the schedule in `vercel.json` to `0 * * * *`.
- **Pay estimates are rough.** They rank roles sensibly against each other; they aren't a
  valuation of any one offer.
- **Some large UAE corporates can't be polled.** Those on Phenom, Taleo, SuccessFactors or iCIMS
  have no supported public feed yet; their careers links are one click away on the Companies page,
  and the cold-email side of the system matters more for them anyway.
- **Discovery guesses slugs.** It finds boards for companies whose name maps cleanly to their
  slug; the rest need adding by hand, which the Sources page supports with a per-platform hint.

## Tests

`npm test` runs the whole suite. The refresh integration tests drive the cycle against a stubbed
board: import, dedupe across changed tracking params, upstream edits, close/reopen, failure
recording and recovery, keyword filters, the time budget, the applied-role protection, description
storage and backfill, cross-source merging, dismissal and pruning. Parser fixtures for each
platform's extra fields are in `tests/scraper.test.ts`, and the salary parser's cases in
`tests/salary.test.ts`.
