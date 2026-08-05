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

## Notes

- **Always set `APP_PASSWORD`** on a public deployment — this tracker holds names, emails, and
  notes about real people. Without it the app runs open (fine locally, not online).
- The password unlocks the site for 90 days per browser via a cookie.
- Backup: Turso dashboard can export your database; locally, copy `data/db.json`.
