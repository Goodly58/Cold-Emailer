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
| **Overview** | Stats, due follow-ups, queued emails, getting-started checklist |
| **Pipeline** | Kanban for applications (Found → … → Offer) + live job import from public Greenhouse/Lever board APIs |
| **Companies** | 28 seeded UAE employers where Emirati status is an advantage; tiers, careers links, quota notes |
| **Contacts** | Decision-makers per company, with one-click "draft email" into the composer |
| **Outreach** | Template composer with merge fields, "Open in Gmail" pre-filled compose, send/reply/follow-up log |
| **Templates** | Your profile (fills merge fields) + 6 editable email templates incl. Emiratisation-angle variants |
| **UAE Playbook** | How Emiratisation quotas and Nafis work, and how to use them in outreach |

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
