-- ---------------------------------------------------------------------------
-- Week 4: the cadence engine's bookkeeping.
--
-- Two tables, both of which exist because of a specific register item.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Two columns that make a pause survive the nightly recompute.
--
-- `scheduled_date` is derived, never authoritative — it is recomputed every
-- sweep from (touch-1 send date, working-day count, current calendar). That is
-- correct, and it is also why an out-of-office reschedule written straight into
-- `scheduled_date` would silently vanish at the next sweep and fire the
-- follow-up into an empty office anyway. A hold has to be a stored fact the
-- recomputation reads, not an adjustment to its output.
-- ---------------------------------------------------------------------------

-- A floor on the derived date, as a UAE calendar date. Set by the out-of-office
-- reschedule ("back on the 18th") and the soft-bounce retry. The derivation
-- still runs; it just may not land earlier than this.
ALTER TABLE outreach ADD COLUMN hold_until TEXT;

-- The countdown is stopped entirely, not moved. A secure-gateway challenge
-- means the recipient has not seen the email at all, so there is no honest date
-- to count from — deriving one would rotate off the best contact at the company
-- for a silence that never happened.
ALTER TABLE outreach ADD COLUMN countdown_paused INTEGER NOT NULL DEFAULT 0
  CHECK (countdown_paused IN (0, 1));

-- Register: "Late reply lands after the sequence closed and the company went
-- dormant" — we poll the thread IDs of every message ever sent, forever. The
-- set is small, but it only grows, so each thread carries its own cadence:
-- live sequences every sweep, closed ones once a day. Without this the poller
-- would either re-fetch hundreds of dead threads every fifteen minutes (quota
-- storm) or stop watching them (and miss the best email of the month).
CREATE TABLE thread_poll (
  gmail_thread_id  TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- Gmail's own change counter for the thread. Unchanged means nothing new,
  -- which lets a full poll skip parsing entirely.
  last_history_id  TEXT,
  last_polled_at   TEXT,
  message_count    INTEGER NOT NULL DEFAULT 0,
  -- 1 while any outreach on this thread is still live. Set by the sweep, not
  -- by hand.
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- Register: "Genuine reply lands in the user's SPAM folder". A SPAM-labelled
  -- reply still stops the sequence; the flag drives the "mark Not Spam"
  -- prompt, which also trains Gmail.
  in_spam          INTEGER NOT NULL DEFAULT 0 CHECK (in_spam IN (0, 1)),
  failures         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX thread_poll_due ON thread_poll(user_id, active, last_polled_at);

-- The dashboard's Next Actions. A transition that needs a human produces a row
-- here rather than a toast nobody was looking at: the user is on their phone,
-- once a day, and "they asked for your CV" must survive until it is done.
--
-- `warm` is the sort key that matters. A reply outranks every cold draft in the
-- queue, always — answering a warm thread is worth more than ten new sends and
-- the screen must never let a cold list bury one.
CREATE TABLE next_action (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  message      TEXT NOT NULL,
  url          TEXT,
  person_id    TEXT REFERENCES person(id) ON DELETE CASCADE,
  company_id   TEXT REFERENCES company(id) ON DELETE CASCADE,
  inbound_id   TEXT REFERENCES inbound(id) ON DELETE SET NULL,
  warm         INTEGER NOT NULL DEFAULT 1 CHECK (warm IN (0, 1)),
  resolved_at  TEXT,
  created_at   TEXT NOT NULL
);
-- One OPEN action per person per kind. The poller is idempotent; re-running it
-- must not stack five identical "reply to this" cards. A partial index, because
-- SQLite treats NULLs as distinct in a plain UNIQUE — which would defeat the
-- whole point here, `resolved_at IS NULL` being exactly the rows we are
-- deduplicating.
CREATE UNIQUE INDEX next_action_one_open
  ON next_action(user_id, person_id, kind) WHERE resolved_at IS NULL;
CREATE INDEX next_action_open ON next_action(user_id, resolved_at, warm, created_at);
