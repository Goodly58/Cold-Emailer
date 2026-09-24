# Deploying online

The app supports two storage backends, picked automatically:

- **Turso** (cloud SQLite) when `TURSO_DATABASE_URL` is set — use this for hosted deployments.
- **JSON file** at `data/db.json` otherwise — zero-setup local dev, and Docker hosts with a volume.

## Option A — Vercel + Turso (recommended, $0/month)

**1. Create the free database (turso.tech):**

1. Sign up at [turso.tech](https://turso.tech) (GitHub login works, no credit card).
2. Create a database (any name, pick a nearby region).
3. Copy the **database URL** (looks like `libsql://yourdb-yourname.turso.io`).
4. Create an **auth token** for the database and copy it.

**2. Deploy the app (vercel.com):**

1. Sign up at [vercel.com](https://vercel.com) with your GitHub account.
2. **Add New → Project** → import `Goodly58/Cold-Emailer`.
3. Before hitting Deploy, expand **Environment Variables** and add:
   - `TURSO_DATABASE_URL` = the URL from step 1.3
   - `TURSO_AUTH_TOKEN` = the token from step 1.4
   - `APP_PASSWORD` = a password of your choosing (locks the site)
4. Click **Deploy**. You'll get a URL like `cold-emailer.vercel.app`.

Vercel deploys the repo's default branch for production. If your code is on a feature branch,
either merge it to `main`, or set **Project Settings → Git → Production Branch** to that branch.

On first load the database seeds itself with the starter companies and templates. Every push to
the production branch auto-redeploys; your data lives in Turso, untouched by deploys.

## Option B — Railway (~$5/mo, uses the Dockerfile + a volume)

1. [railway.com](https://railway.com) → **New Project → Deploy from GitHub repo**.
2. Settings → Volumes → mount path `/data`.
3. Variables → `APP_PASSWORD`. (No Turso vars → it uses the JSON file on the volume.)
4. Settings → Networking → Generate Domain.

## Option C — Any VM (e.g. Oracle Cloud always-free)

Run the Dockerfile anywhere with a persistent disk mounted at `/data`, or just
`npm install && npm run build && npm start` behind a reverse proxy.

## Keeping job data fresh (scheduled jobs)

`vercel.json` registers two cron jobs:

- **`/api/cron/refresh`**, daily at 04:00 UTC (08:00 UAE), polls every enabled source on the
  **Sources** page: new roles land in the pipeline tagged **NEW**, and postings that vanish from a
  board get marked **closed**.
- **`/api/cron/events`**, Mondays at 04:30 UTC, searches the web for new UAE career fairs and newly
  announced dates. It needs `ANTHROPIC_API_KEY` (below) and skips quietly without it.

To enable it:

1. In Vercel → Settings → Environment Variables, add **`CRON_SECRET`** = any long random string.
   Vercel sends it as `Authorization: Bearer …` so only the scheduler can trigger a run.
2. Redeploy. Vercel picks up `vercel.json` and the job appears under Settings → Cron Jobs.

Notes:

- Vercel's Hobby (free) tier runs each cron job **at most once a day**, at some point within the
  scheduled hour; both schedules fit that. On Pro you can tighten the refresh to hourly by changing
  its schedule to `0 * * * *`.
- The daily refresh runs for up to four minutes and the AI routes can take a minute or two, so
  they set `maxDuration = 300`. That's within the limit for projects on Vercel's fluid compute,
  which is the default for new projects. If a deploy complains about the duration, turn on fluid
  compute under Project Settings → Functions.
- The **Refresh all now** button on the Sources page runs the exact same job on demand, so you're
  never waiting on the schedule.
### AI features (Anthropic API key)

Add **`ANTHROPIC_API_KEY`** to switch on everything marked ✨ in the app: reading your CV from a
PDF, drafting and improving emails (and Arabic versions), researching a company for a hook, fit
analysis and tailored CV bullets per role, interview prep kits, the weekly review and the weekly
event search.

1. Create a key at [console.anthropic.com](https://console.anthropic.com) → API Keys. The API is
   pay-as-you-go, separate from a Claude.ai subscription; add a little credit and set a monthly
   spend limit there.
2. In Vercel → Settings → Environment Variables, add `ANTHROPIC_API_KEY` = the key, then redeploy.

The default model is `claude-opus-5`. Set **`ANTHROPIC_MODEL`** to use another one (a cheaper
model such as `claude-sonnet-5` cuts costs by more than half). Each action shows its approximate
cost at list prices when it finishes. Roughly: a few US cents to draft an email, tens of cents
for a fit analysis, and more for anything that searches the web (hook research, interview prep,
the weekly event search), which pays per search and for the pages it reads, up to a dollar or so.
Nothing runs without you clicking, except the weekly event search.

Requests opt into Anthropic's server-side fallback: if the model declines a request on policy
grounds, the API retries it on its recommended substitute model instead of failing.

### Optional API keys

All optional — the app works without them, and each unlocks one feature.

| Variable | Unlocks | Free tier | Get it |
|---|---|---|---|
| `HUNTER_API_KEY` | Mailbox-level email confirmation on Contacts | 25 lookups/month | [hunter.io](https://hunter.io) |
| `JOOBLE_API_KEY` | Jooble aggregator search | free key on request | [jooble.org/api/about](https://jooble.org/api/about) |

Without keys: email finding still works via pattern generation + MX verification, and The Muse
aggregator works with no key at all.

## Notes

- **Always set `APP_PASSWORD`** on a public deployment — this tracker holds names, emails, and
  notes about real people. Without it the app runs open (fine locally, not online).
- The password unlocks the site for 90 days per browser via a cookie.
- Backup: Turso dashboard can export your database; locally, copy `data/db.json`.
