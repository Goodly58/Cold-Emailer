# Job Search Engine

Personal dashboard for a high-conversion job search in the UAE: every open role ranked by what
it's worth to you, target companies and decision-makers, tailored cold outreach with follow-ups,
career events, and AI help grounded in your own CV.

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
| **Overview** | Next best actions, what's due today (follow-ups, event thank-yous, registrations), the best open roles right now, upcoming events, and an AI weekly review of your numbers |
| **Fields** (every page) | Pick the fields you want on your Profile: **Investing & markets**, **Banking & finance**, **Cybersecurity**, **AI & machine learning**. Roles, companies, contacts and events are tagged by field, every list below can be filtered to them, and roles in your fields rank higher |
| **Pipeline** | Every role **ranked** by an opportunity score (fit, pay with your Nafis top-up, freshness, employer), sortable by pay, pay + Nafis, newest, fit or employer, and filterable by field, minimum pay, posting age, remote/hybrid and stated pay. Each role opens to its full description, and with AI: a fit check against your CV, tailored CV bullets, a cover letter and an interview prep kit. A kanban board view too |
| **Sources** | Job boards polled daily; auto-discovery of which ATS a company uses (optionally only for companies in your fields); aggregator search with field presets |
| **Health** | Scraper run history (added, merged, descriptions saved, failures), broken-source alerts, backup/restore |
| **Companies** | UAE employers with tiers, fields, email domains/patterns, divisions, Emiratisation notes; filter by field |
| **Contacts** | Decision-makers with email finding, research links, and hook capture |
| **Events** | UAE career fairs and expos with countdowns and prep checklists; a weekly web search adds new events and fills in announced dates; log the people you meet and get reminded to thank them |
| **Outreach** | Composer with contact and role linking, pre-send checks, AI drafting (and Arabic versions), web research for a personal hook, pre-filled Gmail, a daily send cap, and two follow-ups scheduled on the UAE Monday–Friday week |
| **Templates** | Editable email templates with the reply rate each one gets |
| **Profile** | Your CV (PDF or pasted), details, what you're looking for, minimum pay, education (sets your Nafis top-up) |
| **UAE Playbook** | Emiratisation quotas, Nafis after the September 2026 changes, career fairs, and how to use them in outreach |

AI features need an Anthropic API key; everything else works without one. See
[DEPLOY.md](./DEPLOY.md#ai-features-anthropic-api-key).

## Tests

```bash
npm test          # unit + integration tests; the model is never called
npm run typecheck
```

CI runs these plus a build and a seed-database check on every push.

## The scraper

Polls public ATS board APIs — the same endpoints that power companies' own careers pages, so no
scraping and no ToS problem. Details in [SCRAPER.md](./SCRAPER.md).

- **Platforms**: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee (plus unverified
  Personio, Breezy, Pinpoint, Teamtailor, Workday and Oracle)
- **What it collects**: title, link, location, department, posting date, pay (from salary fields
  or the description), remote/hybrid, contract type, and the full description
- **Schedule**: daily via Vercel Cron (`vercel.json`), plus a manual "Refresh now"
- **Dedupe**: normalised links, and the same role reached through two sources is linked, not
  added twice
- **Lifecycle**: postings that vanish are marked closed and pruned after 30 days; roles you've
  applied to are never auto-closed; roles you dismiss aren't re-imported
- **Resilience**: retries with backoff on 429/5xx, fails fast on 4xx, bounded concurrency, a time
  budget, per-source failure counters

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
- **No invented facts** — AI output may use only what's in your CV, the job description and your
  research notes. Where a strong email or CV bullet needs a fact that isn't there, it leaves a
  [placeholder], and the pre-send checks block an email that still has one.
