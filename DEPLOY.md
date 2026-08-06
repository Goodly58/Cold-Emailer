# Deploying

The database is a single SQLite file. Anywhere with a persistent disk works;
anywhere without one does not, because the file *is* the system of record —
drafts, tokens, threads, the calendar and the log all live in it.

## Before user #1 — the Google work

This is the longest-lead item in the whole build, and it is not code. Start it
before it blocks anything.

**1. Move the OAuth app to production publishing status.** While the app is in
testing status, Google expires refresh tokens after **seven days**. On day 8
polling fails silently, sends 401, and follow-ups vanish during the exact week
they come due. Production status removes that expiry even before verification
completes.

**2. Start Google verification.** The two scopes this app uses —
`gmail.send` and `gmail.readonly` — are restricted. Verification requires a
security assessment (CASA) with **two to three months of lead time** and real
money. Unverified, the app caps at 100 users behind a warning screen. That is
enough for the friend and not enough for user #2, so the clock starts now.

The build already minimizes what the assessment has to cover, and it is worth
being able to say so:

- Two scopes. `gmail.compose` is deliberately absent — SQLite is the only draft
  store, so there is nothing for it to do.
- Polling only ever touches threads this tool created, by stored thread id.
  There is no broad inbox query anywhere in the codebase.
- Only reply content on tool-created threads is persisted.
- Refresh tokens are encrypted at rest (AES-256-GCM, `lib/crypto.ts`).

**3. Configure the OAuth client.** Authorized redirect URI must be
`<APP_BASE_URL>/api/gmail/callback`, exactly.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | to connect Gmail | From the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | to connect Gmail | |
| `APP_BASE_URL` | yes in production | The public origin. The redirect URI is derived from it |
| `TOKEN_ENCRYPTION_KEY` | **yes in production** | 32 bytes hex. The app refuses to start without it rather than storing refresh tokens in the clear |
| `ANTHROPIC_API_KEY` | for generation | Without it the interview uses fixed follow-up questions instead of stalling |
| `APP_PASSWORD` | yes on anything public | This database holds names and email addresses of real people who did not opt in |
| `DB_PATH` | no | Defaults to `data/engine.db`. Point it at your mounted volume |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Hosting

**A VM or container with a mounted disk** is the right shape. The Dockerfile in
this repo builds it; mount a volume and set `DB_PATH` to a path inside it.

```bash
npm ci && npm run build && npm start
```

**Serverless is the wrong shape for v1.** A single-file SQLite database on
ephemeral function storage loses everything between invocations, and the
scheduler that lands in week 4 assumes a process that can be woken on a
schedule and read the same file.

## Backups

Copy the database file. It is one file, and it is everything:

```bash
sqlite3 data/engine.db ".backup /backups/engine-$(date +%F).db"
```

Worth doing before any migration, and worth automating before the first real
send — the contact history and the threads it maps to cannot be reconstructed
from Gmail alone.

## What the database holds

Names, business email addresses, and quoted public statements of people who did
not opt in, which is personal-data processing under UAE PDPL (Federal
Decree-Law 45/2021). The v1 posture, per the register:

- Public business-contact data only. Never phone numbers, photographs, or
  nationality guesses.
- Every evidence row carries the source URL it came from — that provenance is
  the compliance artefact, not a nicety.
- Suppression is permanent and keyed on an email hash, so honouring a removal
  request does not require keeping the address.
- Retention: purge N months after a company reaches `exhausted`. **Not yet
  implemented** — tracked in `EDGE_CASES.md`.

The commercial-phase items — a privacy notice, a legitimate-interest analysis, a
DSR workflow, and UAE counsel on whether TDRA's unsolicited-communications rules
reach one-to-one job-seeking email — are budgeted, not built. See
`research/people-discovery.md` §11 and `CULTURE.md` §14.
