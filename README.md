# Job Search Engine

Personal dashboard for a high-conversion job search: application pipeline, target-company and
decision-maker tracking, template-driven cold outreach, and a UAE Emiratisation playbook.

See [PLAN.md](./PLAN.md) for the full strategy and roadmap.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## What's inside

| Page | What it does |
|---|---|
| **Overview** | Stats, due follow-ups, queued emails, setup checklist |
| **Pipeline** | Kanban (Found → … → Offer) with search, filters, relevance scores, and manual import |
| **Sources** | Job boards polled on a schedule; auto-discovery of which ATS a company uses |
| **Companies** | Seeded UAE employers with tiers, email domains/patterns, divisions, Emiratisation notes |
| **Contacts** | Decision-makers with email finding, research links, and hook capture |
| **Outreach** | Template composer with merge fields, pre-filled Gmail compose, follow-up log |
| **Templates** | Profile + job preferences (drive scoring) + editable email templates |
| **Health** | Scraper run history, broken-source alerts, backup/restore |
| **UAE Playbook** | Emiratisation quotas, Nafis, career fairs, and how to use them in outreach |

## The scraper

Polls public ATS board APIs — the same endpoints that power companies' own careers pages, so no
scraping and no ToS problem.

- **Platforms**: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee
- **Schedule**: daily via Vercel Cron (`vercel.json`), plus a manual "Refresh now"
- **Discovery**: probes all platforms with derived slugs to find a company's board
- **Resilience**: retries with exponential backoff on 429/5xx, fails fast on 4xx, bounded
  concurrency, per-source failure counters
- **Dedupe**: job URLs are normalized (tracking params stripped) before comparison
- **Lifecycle**: postings that vanish are marked closed and pruned after 30 days; roles you've
  already applied to are never auto-closed
- **Scoring**: every imported role is ranked 0–100 against your job preferences

Big UAE corporates (ADNOC, FAB, Emirates NBD…) run Oracle/SAP career portals with no public feed —
those stay manual via their careers links on the Companies page.

## Data

Two backends, picked automatically:

- **Locally**: plain JSON at `data/db.json` (set `DB_PATH` to store it elsewhere) — zero setup,
  easy to back up or edit by hand. Using the app mutates this file, so live data shows up as git
  changes; commit it (private repo) or point `DB_PATH` outside the repo.
- **Hosted**: set `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`) and everything is stored in a free
  [Turso](https://turso.tech) cloud database instead. Seeds itself on first load.

To put it online for $0/month (Vercel + Turso), follow [DEPLOY.md](./DEPLOY.md).

## Deliberate non-goals

- **No auto-apply bots** — they violate LinkedIn/Indeed ToS and produce weak applications. The
  pipeline + import flow gets you to one-click-ready instead.
- **No mass sending** — emails open pre-filled in Gmail for review. Job outreach converts on
  personalization, not volume.
