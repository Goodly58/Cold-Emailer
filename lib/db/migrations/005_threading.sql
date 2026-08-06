-- ---------------------------------------------------------------------------
-- The recipient's real Message-ID, and the address that actually wrote.
--
-- A reply threads in the recipient's client on `In-Reply-To`, which must carry
-- the RFC822 `Message-ID` of the message being answered. Gmail's API message id
-- is a different thing entirely — an opaque internal handle — and synthesising
-- `<{gmail_id}@mail.gmail.com>` from it produced a header that has never
-- existed anywhere, so every reply this product sent arrived as an orphan in
-- the thread it was answering.
--
-- `reply_to_address` exists because the person who writes is not always the
-- person we wrote to. Thread-first matching is the whole design: an escalation
-- from legal-compliance@, or a colleague answering on someone's behalf, both
-- attach to the outreach — and replying to the original contact instead of the
-- person holding the conversation is worse than not replying.
-- ---------------------------------------------------------------------------

ALTER TABLE inbound ADD COLUMN rfc822_message_id TEXT;
ALTER TABLE inbound ADD COLUMN reply_to_address TEXT;

CREATE INDEX inbound_rfc822 ON inbound(rfc822_message_id);

-- Every reply we send, so the poller can recognise its own work. Without this,
-- the next sweep sees a message from the user's own address that is not in
-- `outreach`, concludes they replied by hand in Gmail, and cancels the queued
-- follow-ups — the product sabotaging itself for using its own feature.
CREATE INDEX reply_draft_sent ON reply_draft(gmail_message_id);
