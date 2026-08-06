-- ---------------------------------------------------------------------------
-- Reply assist.
--
-- Register, critical: "A real reply is the product's climax and the user
-- freezes." The interview invite arrives, the user panics, does it tomorrow for
-- four days, and the lead moves on. Every other feature in this product exists
-- to produce this moment, and the moment itself is where it is lost.
--
-- So a reply is a queue item, not an exit. It gets its own draft, written under
-- the same clarify-and-refuse contract as a cold email, and a one-working-day
-- countdown shown in hours.
--
-- Deliberately not a row in `outreach`: outreach is the cold sequence, capped at
-- three touches by `step IN (1,2,3)` and counted against the daily ceiling. A
-- reply is neither. Answering someone who wrote to you is not outreach and must
-- never be rationed by a deliverability budget.
-- ---------------------------------------------------------------------------

CREATE TABLE reply_draft (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  person_id       TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  inbound_id      TEXT NOT NULL REFERENCES inbound(id) ON DELETE CASCADE,

  -- What they said, and what it means. Kept alongside the draft so the Review
  -- card can show the user what they are answering without another fetch.
  classification  TEXT NOT NULL,
  subject         TEXT,
  body            TEXT,
  -- The user reads Arabic inbound in Arabic; this is for understanding what
  -- they are approving, never for sending.
  inbound_translated TEXT,

  -- `needs_fact` and `write_yourself` are deliberately different states.
  -- `needs_fact` means the draft is blocked on one thing only the user knows —
  -- a notice period, a start date — and the card asks for it. `write_yourself`
  -- means we could not draft anything at all (no API key, or the call failed),
  -- and the card must hand the user an empty box instead of a question they
  -- cannot answer. Collapsing the two traps them in a loop: answer the
  -- question, drafting fails again, answer it again.
  status          TEXT NOT NULL DEFAULT 'drafted'
                    CHECK (status IN ('drafted', 'needs_fact', 'write_yourself', 'approved',
                                      'sending', 'sent', 'closed')),
  -- A missing fact is a one-tap question to the user, never an invention.
  question        TEXT,

  -- Threading. A reply is always in the thread it answers, never a new email.
  gmail_thread_id   TEXT,
  in_reply_to       TEXT,
  references_chain  TEXT NOT NULL DEFAULT '[]',
  rfc822_message_id TEXT UNIQUE,
  gmail_message_id  TEXT,

  -- One working day, in UAE dates. Shown in hours, because "due tomorrow" is
  -- easy to postpone and "9 hours left" is not.
  due_date_uae    TEXT,
  sent_body_verbatim TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,

  -- One live draft per inbound message. The sweep runs every fifteen minutes
  -- and must not produce a stack of near-identical replies.
  UNIQUE (inbound_id)
);
CREATE INDEX reply_draft_open ON reply_draft(user_id, status, due_date_uae);
