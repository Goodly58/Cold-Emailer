# Emirati Cold-Outreach Engine

A single-user web tool that lands job interviews by cold email, built for one
Emirati candidate and the structural advantage that UAE Emiratisation quotas and
the Nafis programme create for them.

It is not a mail-merge. It writes one email at a time, from evidence it can point
at, and it will refuse to write rather than write something generic.

## What it does

1. **Onboarding** — a short interview that captures who the user is in their own
   words, connects Gmail (two scopes: send and read), and produces a CV.
2. **Sourcing** — a founder bench for finding real people at real companies:
   evidence with source URLs, name normalisation, email-pattern inference and
   verification. Every gate fires here, where a human is looking at the source.
3. **Today** — the daily loop. Replies first, then follow-ups, then the safest new
   email. Review the evidence behind every claim, edit anything, send.
4. **Dashboard** — what the user did this week, and one honest sentence about
   where it stands. Warm above cold, always.
5. **The numbers** — the founder's screen: unit economics and Experiment 1.

## The eight hard rules

They are enforced in code and in database constraints, never in comments.

| # | Rule | Where it lives |
|---|---|---|
| 1 | No auto-send. Every email is approved by a human. | `lib/send.ts` — the CAS starts from `approved`, which only a human action sets |
| 2 | No fabricated personalization. Every claim traces to an evidence row with a source URL. | `evidence.source_url NOT NULL`; the generator contract; `lintGenerated` |
| 3 | Verified emails only. `accept_all` is never collapsed into `verified`. | `person.email_status` CHECK; re-checked inside `sendOutreach` |
| 4 | Volume ceiling, ramped 3 → 5 → 10 → 15. | `lib/queue.ts` `budgetFor`, `sendPermission` |
| 5 | One live sequence per organisation, keyed on `org_group`. | `enforceInvariants`, `buildQueue`, `rotateLadders` |
| 6 | UAE working-day countdowns. | `lib/calendar.ts` — the only date module, enforced by a CI grep |
| 7 | No LinkedIn automation, ever. Tier 3 is SERP over `ae.linkedin.com`. | `lib/tier3.ts` |
| 8 | Honorifics are copied from a source, never derived. | `person` CHECK constraints — `Dear Eng. Priya,` is an unreachable state |

Plus: no send while blind (`last_successful_poll_at` older than six hours blocks
everything), and suppression checked before any draft is generated.

## Running it

```bash
npm install
npm run db:migrate       # migrations also run automatically on first access
npm run dev
```

Environment:

| Variable | Needed for |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail connect |
| `TOKEN_ENCRYPTION_KEY` | Encrypting refresh tokens at rest. Required in production |
| `ANTHROPIC_API_KEY` | Drafting and classification. Without it the app still runs — it degrades to refusals and coaching rather than to nothing |
| `CRON_SECRET` | The scheduled sweep. Required in production |
| `APP_PASSWORD` | Optional password gate for a hosted deployment |
| `DB_PATH` | Defaults to `data/engine.db` |

The sweep runs every 10–15 minutes, never per-minute:

```
*/15 * * * * curl -sX POST -H "authorization: Bearer $CRON_SECRET" https://your-host/api/cron
```

Missing a run is harmless. The sweep is stateless and idempotent by
construction: running it twice changes nothing, and running it three days late
produces exactly the rows an on-time run would have.

## Checks

```bash
npm run check    # typecheck + date-arithmetic guard + tests
```

`npm run check:dates` is the unusual one. It greps for date arithmetic outside
`lib/calendar.ts` and fails the build if it finds any — because Asia/Dubai
calendar dates and UTC instants are different things, and confusing them puts a
follow-up on the wrong day for the recipient. It has caught real defects twice.

Tests run under `TZ=America/New_York` on purpose.

## The documents

- **`ULTRAPROMPT.md`** — the build contract. Where it conflicts with anything
  else, it wins.
- **`PLAN.md`** — the plan, with §15 recording every place the build diverged
  from it and why.
- **`EDGE_CASES.md`** — the living register. Every edge case found while
  building, with its solution or an explicit deferral.
- **`CULTURE.md`** — the register engine: honorifics, Arabic names, the send
  window, what a Gulf recipient actually reads.
- **`research/`** — template doctrine, company universe, people discovery,
  LinkedIn access.
