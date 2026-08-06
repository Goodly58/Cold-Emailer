# Emirati Cold-Outreach Engine

Lands job interviews for an Emirati candidate through personalized cold email,
using the structural advantage Emiratisation quotas and Nafis create: most large
UAE employers have hiring targets for Emiratis, salary subsidies for hiring
them, and often a named Emiratisation lead whose KPI is hiring people like the
user.

A human approves every single send. There is no auto-send path in this codebase,
and that is a schema-level fact, not a setting.

## The documents that govern this build

Read in this order. Where they conflict, the earlier one wins.

| Document | What it governs |
|---|---|
| `ULTRAPROMPT.md` | The build contract: mission, hard rules, the edge-case register, build order |
| `PLAN.md` | Product plan v3, with §14 indexing the research and §15 recording dated amendments |
| `CULTURE.md` | The register engine — salutation, honorifics, timing, the pre-send lint |
| `research/template-doctrine.md` | The canonical email spec |
| `research/company-universe.md` | How the target list is assembled |
| `research/people-discovery.md` | Contact-finding playbooks |
| `research/linkedin-access.md` | Why hard rule 7 exists and why it stays |
| `EDGE_CASES.md` | Living ledger of everything found while building |

## Running it

```bash
npm install
npm run db:migrate      # creates data/engine.db
npm run db:seed         # 50 target companies, their ladder plans, the UAE calendar
npm run dev             # http://localhost:3000
```

The database is created on first access, so `db:migrate` is really just a way to
see what happened. `npm run db:seed` is idempotent.

### Environment

| Variable | Needed for | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Connecting Gmail | Without these the connect step says so plainly instead of failing |
| `APP_BASE_URL` | The OAuth redirect | Defaults to `http://localhost:3000` |
| `TOKEN_ENCRYPTION_KEY` | Encrypting tokens at rest | 32 bytes hex. **Required in production** — the app refuses to start without it |
| `ANTHROPIC_API_KEY` | The interview follow-up, and generation from week 3 | Without it the interview falls back to fixed follow-up questions rather than stalling |
| `DB_PATH` | Moving the database | Defaults to `data/engine.db` |
| `APP_PASSWORD` | Password-gating a hosted copy | Unset means open, which is right locally |

## Checks

```bash
npm run check           # typecheck + date-arithmetic guard + tests
```

Three gates, each protecting something specific:

- **`npm run check:dates`** fails if any file outside `lib/calendar.ts` takes a
  `Date` apart. A UTC server doing its own date arithmetic anchors day 0 to the
  wrong day and the bug stays invisible until a follow-up lands on a Saturday.
- **`npm test`** runs under `TZ=America/New_York`, so a timezone assumption
  fails in CI rather than in a recipient's inbox.
- **`tests/schema.test.ts`** proves the hard rules are unreachable states rather
  than documented intentions — an honorific with no source URL, evidence with no
  source, a fourth touch, two live rows for one step.

## Where things are

```
lib/calendar.ts        the ONLY date module — nextDue() and the send window
lib/db/migrations/     the schema, with the hard rules as constraints
lib/gmail/             OAuth (two scopes) and the one API wrapper
lib/interview.ts       chip catalogue, thinness check, the profile gate
lib/profile.ts         answers → intro blocks and profile-claim evidence rows
lib/cv.ts              the one-page CV, generated from answered fields only
lib/derived-dates.ts   recomputing scheduled_date from the current calendar
app/onboarding/        screen 1 — connect, identity, interview, hygiene, CV
app/today/             screen 2 — Review & Send (shell; the queue lands week 3)
app/dashboard/         screen 3 — what is in play
app/calendar/          founder-only: confirm Eid dates, watch countdowns move
```

## Status

**Week 1 complete.** Next.js skeleton, the full global-keyed SQLite schema,
Gmail OAuth with the granted-scope check, the profile interview with its
minimum-viable gate, the CV step, and the UAE working-day calendar. 62 tests.

Weeks 2–4 — sourcing tooling, the clarify-and-refuse generator with the Review
screen, then the cadence engine — follow the build order in `ULTRAPROMPT.md` §6.
