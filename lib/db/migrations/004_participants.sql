-- ---------------------------------------------------------------------------
-- Who was actually on the thread, with their names.
--
-- `to_addresses` and `cc_addresses` hold bare addresses, which is right for the
-- warm-thread matching that reads them — the comparison is case-insensitive on
-- the address and a display name would only get in the way.
--
-- But a referral is the one case where the *name* is the payload. "Looping in
-- Sara who runs our Nafis programme" arrives with `"Sara Al Nuaimi"
-- <s.alnuaimi@bank.ae>` in the CC line, and that is the warmest contact the
-- user will ever have. Reducing it to an address throws away the half that
-- makes it usable.
--
-- Stored as JSON `[{name, email}]` alongside the existing columns rather than
-- replacing them, because the matching code is correct as it stands and this is
-- additional information, not a correction.
-- ---------------------------------------------------------------------------

ALTER TABLE inbound ADD COLUMN participants TEXT NOT NULL DEFAULT '[]';

-- Register: the Review card shows a machine translation of Arabic inbound, so
-- the user understands what they are approving. `translated_text` already
-- exists on the table; this index is what makes "have we translated this yet"
-- cheap enough to ask on every queue open.
CREATE INDEX inbound_untranslated ON inbound(language, translated_text);

-- How a person came to be known to us. `referral` outranks every sourcing tier:
-- somebody vouched for the introduction, which is not something a search result
-- can ever be.
ALTER TABLE person ADD COLUMN discovered_via TEXT NOT NULL DEFAULT 'sourced'
  CHECK (discovered_via IN ('sourced', 'referral', 'inbound'));
