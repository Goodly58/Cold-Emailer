# Deploying online

The app is a Next.js server with a JSON file database, so it needs a host that gives you a
**persistent disk** (a "volume"). Serverless hosts like Vercel won't persist the file — use one of
these instead.

## Option A — Railway (recommended, ~$5/mo, easiest)

1. Go to [railway.com](https://railway.com) and sign in with your GitHub account.
2. **New Project → Deploy from GitHub repo** → pick `Goodly58/Cold-Emailer`.
3. In the service **Settings → Source**, set the branch you deployed (or merge to `main` first).
   Railway auto-detects the `Dockerfile`.
4. In the service **Settings → Volumes → Add Volume**, set the mount path to `/data`.
   This is what keeps your data across redeploys — don't skip it.
5. In **Variables**, add `APP_PASSWORD` = a password of your choosing (this locks the site).
6. In **Settings → Networking → Generate Domain**. Open the URL, enter your password, done.

Every `git push` to the deployed branch auto-redeploys, and your data survives because it lives on
the volume.

## Option B — Fly.io (free-ish, needs their CLI)

```bash
fly launch --no-deploy       # accepts the Dockerfile
fly volumes create data --size 1
# add to fly.toml:  [mounts]  source = "data"  destination = "/data"
fly secrets set APP_PASSWORD=yourpassword
fly deploy
```

## Option C — Render

Works the same way (New Web Service → connect repo → Docker), but persistent disks require the
paid tier; the free tier wipes your data on every restart, so don't use free Render for this.

## Notes

- **Always set `APP_PASSWORD`** on a public deployment — this tracker holds names, emails, and
  notes about real people. Without the variable set, the app runs open (fine locally, not online).
- The password unlocks the site for 90 days per browser via a cookie.
- To back up your data, download `/data/db.json` (Railway: service → Volume → or just add an
  export button later). Locally the same file is `data/db.json`.
