-- Emirati Cold-Outreach Engine — initial schema (ULTRAPROMPT §4).
--
-- Two things this file is doing beyond storing data:
--
-- 1. GLOBAL KEYING FROM DAY ONE. `company` (unique canonical domain) and
--    `person` (unique normalized email) are user-agnostic. Per-user state lives
--    in `user_company_state` and `outreach`, and every send writes
--    `contact_ledger`. With one user that is redundant — which is the point:
--    the cross-client collision moat cannot be retrofitted onto a single-user
--    namespace later (register §Business & Compliance).
--
-- 2. HARD RULES AS CONSTRAINTS, NOT COMMENTS. Each one is marked HARD RULE n
--    below. A constraint the founder cannot accidentally write around at 11pm
--    is worth more than any amount of documentation.
--
-- Conventions:
--   - `*_at`      : UTC instant, ISO 8601 ("2026-08-06T09:00:00.000Z")
--   - `*_date`    : UAE calendar date, "YYYY-MM-DD" (see lib/calendar.ts)
--   - booleans    : INTEGER 0/1 with a CHECK
--   - JSON arrays : TEXT holding a JSON array, defaulting to '[]'

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- User, connection, identity
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,

  -- The address Google reported at first connect. Reconnecting with a
  -- different account is refused against this value, because every stored
  -- thread id belongs to this mailbox (register: "Reconnect with the wrong
  -- Google account corrupts all state").
  gmail_address            TEXT,

  connection_state         TEXT NOT NULL DEFAULT 'disconnected'
                             CHECK (connection_state IN
                               ('disconnected', 'connected', 'expired', 'revoked')),

  -- HARD RULE 10: no send while blind. The send gate refuses when this is
  -- older than 6 hours.
  last_successful_poll_at  TEXT,

  -- Identity block: only a verified sendAs address may be chosen, and the
  -- signature is a fixed block outside the 120-word budget.
  send_as_email            TEXT,
  signature_block          TEXT,
  signature_fetched_at     TEXT,
  canonical_name           TEXT,

  paused                   INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  placed_date              TEXT,

  -- Deliverability ramp (register: "Recipient-side spam placement"). Starts at
  -- 3 and steps 3 → 5 → 10 → 15 over two weeks; never above the ceiling.
  daily_ceiling            INTEGER NOT NULL DEFAULT 3
                             CHECK (daily_ceiling BETWEEN 1 AND 15),

  onboarding_step          TEXT NOT NULL DEFAULT 'welcome',
  onboarding_completed_at  TEXT,

  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

-- Tokens are encrypted at rest and live in their own table so no query that
-- reads a user accidentally selects them (register: "Restricted Gmail scopes
-- are a commercialisation time-bomb" — minimize the audit surface).
CREATE TABLE oauth_token (
  user_id                  TEXT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  refresh_token_encrypted  TEXT NOT NULL,
  access_token_encrypted   TEXT,
  access_token_expires_at  TEXT,
  -- Exactly what Google granted, space-separated and verbatim. The callback
  -- refuses onboarding when gmail.send or gmail.readonly is missing.
  granted_scopes           TEXT NOT NULL,
  token_issued_at          TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Profile interview
-- ---------------------------------------------------------------------------

CREATE TABLE profile_answer (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  field                TEXT NOT NULL,
  -- JSON: a string for free text, an array for chip selections.
  value                TEXT NOT NULL,
  -- The minimum-viable-profile gate reads this. 'thin' blocks completion until
  -- exactly one concrete follow-up is answered.
  specificity          TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (specificity IN ('unknown', 'thin', 'concrete')),
  followup_question    TEXT,
  followup_answer      TEXT,
  -- "If they ask about this in a reply, what would you say?" — the answer that
  -- keeps the generator from phrasing a claim above its confirmed specificity.
  verification_framing TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (user_id, field)
);

-- Intro slots per research/template-doctrine.md §(b). At most two per email.
CREATE TABLE intro_block (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  slot             TEXT NOT NULL
                     CHECK (slot IN ('A_identity', 'B_credibility', 'C_status', 'D_affinity')),
  text             TEXT NOT NULL,
  source_answer_id TEXT REFERENCES profile_answer(id) ON DELETE SET NULL,
  confirmed        INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE cv_version (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  origin     TEXT NOT NULL CHECK (origin IN ('generated', 'uploaded')),
  filename   TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  content    BLOB NOT NULL,
  -- Glance-approved by the user. Only an approved CV is ever attached.
  approved   INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX cv_version_user ON cv_version(user_id, is_current);

-- ---------------------------------------------------------------------------
-- Companies (user-agnostic) and per-user state
-- ---------------------------------------------------------------------------

-- Every per-company invariant — one live sequence, same-day spacing, cooldown,
-- dormancy — enforces here, not on `company`. "Emirates NBD" and "Emirates NBD
-- Capital" are two company rows and one org_group.
CREATE TABLE org_group (
  id                TEXT PRIMARY KEY,
  normalized_domain TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL
);

-- Subsidiaries that mail from a different domain than their parent get a
-- manual link, since normalized-domain grouping cannot see them.
CREATE TABLE org_group_link (
  parent_org_group_id TEXT NOT NULL REFERENCES org_group(id) ON DELETE CASCADE,
  child_org_group_id  TEXT NOT NULL REFERENCES org_group(id) ON DELETE CASCADE,
  note                TEXT,
  created_at          TEXT NOT NULL,
  PRIMARY KEY (parent_org_group_id, child_org_group_id),
  CHECK (parent_org_group_id <> child_org_group_id)
);

CREATE TABLE company (
  id                  TEXT PRIMARY KEY,
  org_group_id        TEXT NOT NULL REFERENCES org_group(id),
  name                TEXT NOT NULL,
  domain              TEXT NOT NULL UNIQUE,
  candidate_domains   TEXT NOT NULL DEFAULT '[]',
  sector              TEXT,
  location            TEXT,

  -- research/company-universe.md: free-zone-only entities are outside MoHRE's
  -- remit and government entities are not quota-subject. Both are segmented
  -- out of the private-sector queue rather than silently mixed in.
  segment             TEXT NOT NULL DEFAULT 'private'
                        CHECK (segment IN ('private', 'government', 'semi_gov', 'free_zone_only')),

  -- CULTURE.md §10: drives honorific strictness and weekend shape.
  org_type            TEXT CHECK (org_type IN
                        ('government', 'semi_gov', 'private_local', 'mnc', 'startup')),

  emiratisation_notes TEXT,
  careers_url         TEXT,
  email_pattern_hint  TEXT,

  -- Mimecast/Proofpoint seen on a prior send; later sends expect a challenge.
  gateway             INTEGER NOT NULL DEFAULT 0 CHECK (gateway IN (0, 1)),

  -- Propensity to hire, not pressure to hire (company-universe.md §5.1).
  propensity          INTEGER NOT NULL DEFAULT 0,

  -- PLAN §11 Experiment 1.
  experiment_arm      TEXT CHECK (experiment_arm IN ('A_hr_first', 'B_manager_first')),

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX company_org_group ON company(org_group_id);

CREATE TABLE user_company_state (
  user_id        TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN (
                     'active', 'dormant', 'exhausted', 'suppressed_by_request',
                     'in_conversation', 'paused_referral', 'paused_late_reply',
                     'reply_conflict', 'blocked')),
  dormant_until  TEXT,
  -- Set from the onboarding hygiene questions and from "Skip this company".
  blocked_reason TEXT CHECK (blocked_reason IN (
                     'current_employer', 'recent_employer', 'recent_application',
                     'rejection', 'never_contact', 'user_skip', 'know_someone')),
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, company_id)
);

-- Domain-level blocks from the hygiene questions. Kept separate from
-- user_company_state because it must match companies added *later*, at
-- queue-build time, by domain family.
CREATE TABLE blocked_domain (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  domain     TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN (
               'current_employer', 'recent_employer', 'recent_application',
               'rejection', 'never_contact', 'user_skip', 'know_someone')),
  note       TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, domain)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE person (
  id                         TEXT PRIMARY KEY,
  company_id                 TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  ladder_rank                INTEGER,

  -- CULTURE.md §3: exactly as they render it. Never normalised, never
  -- "corrected" to a more standard transliteration.
  full_name_raw              TEXT NOT NULL,
  given_name                 TEXT,
  family_name                TEXT,
  family_name_detected       INTEGER NOT NULL DEFAULT 0
                               CHECK (family_name_detected IN (0, 1)),
  -- Transliteration family key: Mohammed/Mohamed/Muhammad/Mohd collapse here so
  -- one person cannot become two ladder rungs with two live sequences.
  phonetic_key               TEXT NOT NULL,

  -- CULTURE.md §12, risk #2, and the single highest-leverage constraint in
  -- this file: an honorific is COPIED, never derived. Enforced below.
  honorific_declared         TEXT CHECK (honorific_declared IN
                               ('H.E.', 'Dr.', 'Eng.', 'Sheikh', 'Sheikha', 'H.H.')),
  honorific_source           TEXT NOT NULL DEFAULT 'none'
                               CHECK (honorific_source IN (
                                 'none', 'org_leadership_page', 'email_signature',
                                 'linkedin_headline', 'press_release')),
  honorific_source_url       TEXT,

  gender                     TEXT NOT NULL DEFAULT 'unknown'
                               CHECK (gender IN ('M', 'F', 'unknown')),
  nationality_bucket         TEXT NOT NULL DEFAULT 'unknown'
                               CHECK (nationality_bucket IN (
                                 'emirati', 'gcc_arab', 'levant_egypt_arab', 'south_asian',
                                 'filipino', 'western', 'east_asian', 'unknown')),
  likely_muslim              TEXT NOT NULL DEFAULT 'unknown'
                               CHECK (likely_muslim IN ('high', 'low', 'unknown')),
  seniority_tier             INTEGER CHECK (seniority_tier BETWEEN 1 AND 4),

  -- Targeting metadata only. The generator is contract-forbidden from
  -- asserting this in body text (register: "Role titles are targeting
  -- metadata, not claims").
  role_title                 TEXT,
  contact_type               TEXT NOT NULL CHECK (contact_type IN
                               ('hiring_manager', 'emiratisation_lead', 'hr', 'exec')),

  source_tier                INTEGER NOT NULL CHECK (source_tier BETWEEN 1 AND 4),
  -- A URL naming this person AND the company/role together. No anchor, no
  -- draft — the person stays `identity_unconfirmed`.
  anchor_source_url          TEXT,
  freshness_date             TEXT,
  corroborating_source_count INTEGER NOT NULL DEFAULT 0,

  -- Global key: one row per real mailbox, across all users, forever.
  email                      TEXT UNIQUE,
  -- HARD RULE 3 + register: `accept_all` is never collapsed into `verified`.
  email_status               TEXT NOT NULL DEFAULT 'guessed'
                               CHECK (email_status IN
                                 ('guessed', 'verified', 'accept_all', 'bounced', 'invalid')),
  role_based                 INTEGER NOT NULL DEFAULT 0 CHECK (role_based IN (0, 1)),
  -- Anyone seen on an inbound From/To/CC. A hard block on starting a cold
  -- sequence — you do not cold-email someone you were just introduced to.
  in_warm_thread             INTEGER NOT NULL DEFAULT 0 CHECK (in_warm_thread IN (0, 1)),

  status                     TEXT NOT NULL DEFAULT 'identity_unconfirmed'
                               CHECK (status IN (
                                 'identity_unconfirmed', 'ready', 'queued', 'in_sequence',
                                 'replied', 'replied_external', 'departed', 'dead_end_mailbox',
                                 'user_took_over', 'closed_silent', 'closed_won_silent',
                                 'suppressed')),

  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,

  -- HARD: honorifics are copied from a source, never derived from a job title
  -- or a family name. `Dear Eng. Priya,` and `Dear Sheikh Al Mazrouei,` are
  -- both unreachable states, not lint failures.
  CHECK (honorific_declared IS NULL OR honorific_source <> 'none'),
  CHECK (honorific_declared IS NULL OR honorific_source_url IS NOT NULL),

  -- One person per company per transliteration family.
  UNIQUE (company_id, phonetic_key)
);
CREATE INDEX person_company_rank ON person(company_id, ladder_rank);
CREATE INDEX person_status ON person(status);

CREATE TABLE person_source (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  tier       INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
  captured_at TEXT NOT NULL,
  UNIQUE (person_id, url)
);

-- The ladder is planned per company before any person is found: which contact
-- types to walk, in which order (PLAN §4, and Experiment 1's two arms). A slot
-- with no person_id is a sourcing to-do, not a fabricated contact.
CREATE TABLE ladder_slot (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  rank         INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 4),
  contact_type TEXT NOT NULL CHECK (contact_type IN
                 ('hiring_manager', 'emiratisation_lead', 'hr', 'exec')),
  person_id    TEXT REFERENCES person(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (company_id, rank)
);

CREATE TABLE email_pattern (
  id                 TEXT PRIMARY KEY,
  domain             TEXT NOT NULL UNIQUE,
  pattern            TEXT,
  -- JSON array of {address, status, seen_at}. Confidence needs >= 2
  -- independent exemplars from public sources before any address leaves
  -- `guessed`.
  exemplar_addresses TEXT NOT NULL DEFAULT '[]',
  confidence         TEXT NOT NULL DEFAULT 'insufficient'
                       CHECK (confidence IN ('insufficient', 'probable', 'confirmed')),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

CREATE TABLE evidence (
  id                TEXT PRIMARY KEY,
  -- 'external' = collected from a source; 'profile_claim' = something the user
  -- said in the interview. Self-claims are evidence rows too, so the
  -- no-fact-outside-evidence rule covers them (register: "User oversells").
  kind              TEXT NOT NULL DEFAULT 'external'
                      CHECK (kind IN ('external', 'profile_claim')),
  company_id        TEXT REFERENCES company(id) ON DELETE CASCADE,
  person_id         TEXT REFERENCES person(id) ON DELETE CASCADE,
  user_id           TEXT REFERENCES app_user(id) ON DELETE CASCADE,

  -- Premise tier, research/template-doctrine.md §(a):
  --   1 what they made · 2 what they backed · 3 what they claim about
  --   themselves · 4 what happened to them · 5 what the company did ·
  --   6 junk drawer (banned as an opener)
  tier              INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 6),

  quote             TEXT NOT NULL,
  quote_translated  TEXT,
  language          TEXT NOT NULL DEFAULT 'en',

  -- HARD RULE 2: every claim traces to an evidence row with a source URL.
  -- Profile claims use interview://<answer_id>, so the invariant is literally
  -- true rather than true-with-an-exception.
  source_url        TEXT NOT NULL,
  context_snippet   TEXT,
  captured_at       TEXT NOT NULL,
  verified_on       TEXT,
  link_dead         INTEGER NOT NULL DEFAULT 0 CHECK (link_dead IN (0, 1)),

  topic_labels      TEXT NOT NULL DEFAULT '[]',
  -- Sensitivity gate: bereavement, health, family, religion, politics, legal,
  -- layoffs set usable=0 so tier-ranking picks the best *usable* fact.
  usable            INTEGER NOT NULL DEFAULT 1 CHECK (usable IN (0, 1)),
  unusable_reason   TEXT,
  -- The cue that ties this row to the right person ("mentions: ADCB").
  identity_match    TEXT,
  disputed          INTEGER NOT NULL DEFAULT 0 CHECK (disputed IN (0, 1)),

  -- Company-scoped hook lock: once used, this fact cannot hook the next rung
  -- of the same ladder (register: "The ladder's second email reuses the first
  -- email's only hook").
  used_for_person_id TEXT REFERENCES person(id) ON DELETE SET NULL,
  locked_by_user_id  TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  locked_until       TEXT,

  -- Unit economics: founder minutes are the real COGS.
  minutes_spent     INTEGER,

  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,

  CHECK (usable = 1 OR unusable_reason IS NOT NULL),
  CHECK (kind = 'profile_claim' OR company_id IS NOT NULL)
);
CREATE INDEX evidence_company ON evidence(company_id, usable, tier);
CREATE INDEX evidence_person ON evidence(person_id);

-- ---------------------------------------------------------------------------
-- Outreach
-- ---------------------------------------------------------------------------

CREATE TABLE outreach (
  id                  TEXT PRIMARY KEY,
  person_id           TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- Three touches, hard cap (research/template-doctrine.md §(d)).
  step                INTEGER NOT NULL CHECK (step IN (1, 2, 3)),

  subject             TEXT,
  body                TEXT,
  -- What actually went out. Follow-up generation and dispute forensics read
  -- this, not the generated text.
  sent_body_verbatim  TEXT,
  evidence_ids        TEXT NOT NULL DEFAULT '[]',
  template_version    TEXT,
  subject_variant     TEXT,
  premise_tier        INTEGER CHECK (premise_tier BETWEEN 1 AND 6),

  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN (
                          'queued', 'drafted', 'stale', 'needs_fact', 'approved',
                          'sending', 'sent', 'replied', 'bounced',
                          'superseded_by_reply', 'paused_pending_reply', 'closed')),

  -- HARD RULE 8: our own Message-ID is persisted BEFORE the Gmail call, so a
  -- crash mid-send can be resolved by probing rfc822msgid: rather than by
  -- blind retry.
  rfc822_message_id   TEXT UNIQUE,
  gmail_thread_id     TEXT,
  gmail_message_id    TEXT,
  -- Full References chain of the thread, so follow-ups thread in the
  -- recipient's client and not just in ours.
  references_chain    TEXT NOT NULL DEFAULT '[]',

  due_working_days    INTEGER,
  -- Always derived from (prior send date, working-day count, current
  -- calendar). Never authoritative — recomputed nightly and on calendar edits.
  scheduled_date      TEXT,
  calendar_version    INTEGER,
  regenerate_at_send  INTEGER NOT NULL DEFAULT 0 CHECK (regenerate_at_send IN (0, 1)),
  gap_working_days    INTEGER,

  sent_date_uae       TEXT,
  sent_at             TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,

  -- HARD RULE 8: running the sweep twice is a no-op.
  UNIQUE (person_id, step)
);
CREATE INDEX outreach_due ON outreach(user_id, status, scheduled_date);
CREATE INDEX outreach_thread ON outreach(gmail_thread_id);

CREATE TABLE inbound (
  id                TEXT PRIMARY KEY,
  outreach_id       TEXT REFERENCES outreach(id) ON DELETE SET NULL,
  person_id         TEXT REFERENCES person(id) ON DELETE SET NULL,
  gmail_thread_id   TEXT NOT NULL,
  gmail_message_id  TEXT NOT NULL UNIQUE,
  from_address      TEXT NOT NULL,
  to_addresses      TEXT NOT NULL DEFAULT '[]',
  cc_addresses      TEXT NOT NULL DEFAULT '[]',
  subject           TEXT,
  snippet           TEXT,
  body_text         TEXT,
  language          TEXT,
  translated_text   TEXT,

  -- Every inbound message is classified before it may change state. "Any reply
  -- stops the sequence" is wrong for most real inbound.
  classification    TEXT NOT NULL DEFAULT 'unclassified'
                      CHECK (classification IN (
                        'unclassified', 'human_positive', 'neutral_question',
                        'rejection_hard', 'rejection_soft', 'removal_request',
                        'referral', 'document_request', 'auto_reply_ooo',
                        'auto_ack_unmonitored', 'gateway_challenge', 'departed',
                        'complaint_escalation', 'provenance_challenge',
                        'prior_contact_callout', 'bounce')),
  -- Ambiguous defaults to a human reply and surfaces the thread: a false stop
  -- is cheap, a false bump is not.
  classifier_note   TEXT,
  extracted_date    TEXT,
  extracted_successor TEXT,
  extracted_url     TEXT,
  received_at       TEXT NOT NULL,
  processed_at      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX inbound_thread ON inbound(gmail_thread_id);

-- ---------------------------------------------------------------------------
-- Suppression and the cross-client ledger
-- ---------------------------------------------------------------------------

-- HARD RULE 11: permanent, global, checked BEFORE drafting. Survives dormancy
-- resets and future users. The email is stored as a hash so honouring a
-- removal request does not require keeping the address.
CREATE TABLE suppression (
  id         TEXT PRIMARY KEY,
  email_hash TEXT,
  domain     TEXT,
  scope      TEXT NOT NULL CHECK (scope IN ('person', 'domain')),
  reason     TEXT NOT NULL CHECK (reason IN (
               'removal_request', 'complaint_escalation', 'forget_person',
               'manual')),
  note       TEXT,
  created_at TEXT NOT NULL,
  CHECK ((scope = 'person' AND email_hash IS NOT NULL)
      OR (scope = 'domain' AND domain IS NOT NULL))
);
CREATE UNIQUE INDEX suppression_person ON suppression(email_hash) WHERE scope = 'person';
CREATE UNIQUE INDEX suppression_domain ON suppression(domain) WHERE scope = 'domain';

-- Written on every send. Redundant with one user, which is the point.
CREATE TABLE contact_ledger (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  outreach_id  TEXT REFERENCES outreach(id) ON DELETE SET NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  sent_at      TEXT NOT NULL
);
CREATE INDEX contact_ledger_person ON contact_ledger(person_id, sent_at);

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

-- Islamic dates finalize on moon-sighting, so a window is a range with a
-- confirmed flag, not a date. Unconfirmed counts as fully non-working.
CREATE TABLE calendar_window (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('public_holiday', 'ramadan_pause')),
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  confirmed  INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX calendar_window_range ON calendar_window(start_date, end_date);

-- Single row. Bumped on every window edit so a draft carrying a holiday opener
-- bound against an older calendar is detectable.
CREATE TABLE calendar_meta (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER calendar_window_bump_insert AFTER INSERT ON calendar_window
BEGIN
  UPDATE calendar_meta SET version = version + 1, updated_at = NEW.updated_at WHERE id = 1;
END;

CREATE TRIGGER calendar_window_bump_update AFTER UPDATE ON calendar_window
BEGIN
  UPDATE calendar_meta SET version = version + 1, updated_at = NEW.updated_at WHERE id = 1;
END;

CREATE TRIGGER calendar_window_bump_delete AFTER DELETE ON calendar_window
BEGIN
  UPDATE calendar_meta SET version = version + 1 WHERE id = 1;
END;

-- ---------------------------------------------------------------------------
-- Append-only log
-- ---------------------------------------------------------------------------

-- Both the debugging surface ("what do I see in the logs, and can I fix it
-- without raw SQL?") and the unit-economics dataset. Event names are fixed
-- from send #1 so the three pricing numbers are one query by week 6.
CREATE TABLE event_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,
  event       TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  -- JSON payload: minutes_spent, tier, contact_type, sentiment, error detail.
  detail      TEXT NOT NULL DEFAULT '{}',
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error'))
);
CREATE INDEX event_log_at ON event_log(at);
CREATE INDEX event_log_event ON event_log(event, at);
