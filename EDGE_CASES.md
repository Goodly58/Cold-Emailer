# EDGE_CASES.md — the living register

The register in `ULTRAPROMPT.md` §5 is a floor, not a ceiling. This file holds
every edge case found **while building**, each with its solution or an explicit
deferral and a reason. It is reviewed at every milestone; silence is not an
option.

Format matches the register: what breaks, why it matters, and what was done.

Severity: **critical** must be handled in v1 · **high** handled or deferred with
a dated reason · **medium/low** may be deferred.

---

## Week 1 — new edge cases found while building

### Onboarding and identity

**Google returns no refresh token on a repeat authorization** (high) — a user
who reconnects, or who has authorized this app before, gets an access token and
no refresh token. Everything works for an hour and then the connection can never
be renewed, silently, at the moment the first follow-up comes due.
→ **Handled.** `prompt=consent` is forced on every authorization, and the
callback refuses to record a connection with no refresh token, sending the user
back with "Google did not give us a lasting connection. Tap connect again."
(`lib/gmail/oauth.ts`, `app/api/gmail/callback/route.ts`; test: *exactly two
scopes are requested*.)

**The consent screen is left open past the state cookie's life** (medium) — the
user opens Google, gets distracted, comes back twenty minutes later and
approves. The `oauth_state` cookie has expired, so the callback cannot verify
the request and must reject it. Rejecting it with a security message would read
as an accusation.
→ **Handled.** Ten-minute cookie; the failure renders as "That link had expired.
Tap connect again and it will work." (`app/api/gmail/callback/route.ts`.)

**An unverified send-as alias is chosen** (high) — Gmail accepts an unverified
alias in `sendAs.list`, and mail sent from it is rewritten or bounced at
delivery. The user experiences this as "my email never arrived", with nothing in
the app suggesting why.
→ **Handled.** Only primary and `verificationStatus: accepted` entries are
offered, and the choice is re-checked against Gmail at save time rather than
trusted from the browser. (`lib/gmail/client.ts` `listSendAs`,
`app/api/onboarding/identity/route.ts`.)

**The Gmail display name and the confirmed name disagree** (medium) — the
from-line says "mohd shamsi 98" and the signature says "Mohammed Al Shamsi".
Both reach the recipient; neither is visible to the user in one place.
→ **Handled.** The identity step shows Google's display name beside the name
they typed and, when they differ, says so and points at Google account settings.
Not blocking — it is their name, not ours. (`app/onboarding/onboarding-client.tsx`,
`Identity`.)

**`TOKEN_ENCRYPTION_KEY` unset** (high) — without a key, tokens are either
stored in plaintext or the app refuses to boot. Plaintext refresh tokens are
unacceptable; refusing to boot in development guarantees the founder works
around it.
→ **Handled.** Production throws with the exact command to generate a key.
Development derives a stable key from the database path and warns once that
tokens saved now become unreadable when a real key is set. (`lib/crypto.ts`.)

**A second device resumes onboarding mid-step** (low) — the step is read from
the database, so both devices see the same step, but two tabs answering
different questions race on `advanceOnboarding`.
→ **Handled enough.** `advanceOnboarding` only ever moves forward, so the worst
case is one device showing a step the other has passed; a refresh corrects it.
No locking in v1.

### The interview

**Editing an unrelated answer re-rolls the follow-up the user is mid-way through
answering** (medium) — every save regenerated the Claude follow-up, so a user who
went back to change their city found the credibility question they were halfway
through replaced with a differently-worded one.
→ **Handled.** The follow-up is regenerated only when the answer text itself
changed. (`lib/profile.ts` `saveAnswer`.)

**A rescued thin answer has two texts and the generator could pick the wrong
one** (high) — "im hardworking" plus the follow-up "two months on the operations
desk at Emirates NBD" gives two candidate claims. Using the original, or a
paraphrase that blends them, phrases the claim *above* its confirmed
specificity — exactly the failure the verification-framing question exists to
prevent.
→ **Handled.** When an answer was thin and its follow-up rescued it, the
follow-up text is what the generator may use; the vaguer original is never a
claim. A thin answer with no rescue is excluded from `generatorProfile`
entirely. (`lib/profile.ts` `rebuildIntroBlocks` / `generatorProfile`; tests:
*a thin answer never reaches the CV as a claim*.)

**Claude returns a preamble, a list, or three questions** (medium) — the
micro-interview prompt asks for one question; models sometimes answer with
"Sure! Here are a few things you could add: …". Pasting that into the interview
would be worse than asking nothing.
→ **Handled.** First line only, stripped of quotes, rejected if it is over 160
characters or contains more than one question mark; a per-field fallback is used
instead. The same fallback covers a missing API key, so onboarding never depends
on Claude being reachable. (`lib/interview.ts` `generateFollowup`; tests: *a
missing Claude key still produces exactly one usable question*.)

**"Not sure" about Nafis registration** (medium) — the status intro slot is
compliance-adjacent. Treating anything but an explicit yes as registration would
put a false claim in front of an HR lead whose job is to check it.
→ **Handled.** Only `Yes` adds "registered with Nafis" to slot C; "Not yet" and
"Not sure" add nothing. (`lib/profile.ts` `rebuildIntroBlocks`.)

**A hygiene answer names a company that is not in the database yet** (high) —
the user types "my uncle's firm" or a company we have not sourced. Matching
silently fails and they believe it is blocked.
→ **Handled.** Unmatched names are reported back on screen — "we could not find
these in our list yet … the names are saved" — and the raw answer is stored, so
the founder can see what the matcher missed. **Residual:** the stored raw text is
not yet re-matched when a company is added later. Deferred to week 2, when
company ingestion exists to hook it to.

**"Anything" typed into the Other box of a chip question** (medium) — chip
fields were assumed concrete by construction, but the free-text escape hatch
lets an empty word through.
→ **Handled.** `assessChips` marks a single empty-word selection thin, so the
gate catches it like any other vague answer. (`lib/interview.ts`.)

### The CV

**An Arabic-script name cannot be drawn** (high) — the built-in Helvetica font
is Latin-1 only. An Emirati user typing their name in Arabic would get a CV of
blank boxes and no indication anything went wrong.
→ **Handled.** Unencodable characters are collected and returned, and the CV
step says so plainly and offers the upload path instead. A box of question marks
presented as their CV is worse than an honest warning. (`lib/cv.ts`
`unencodableCharacters`; test: *characters the built-in font cannot draw are
reported, not silently dropped*.) **Residual:** no Arabic-capable CV generation.
Deferred — the upload path covers it, and embedding a Unicode font is a week of
work for a case the user can solve in ten seconds.

**A 40MB scanned CV, or a `.pages` file** (medium) — an upload with no limits
either fills the database or produces an attachment the recipient cannot open.
→ **Handled.** 5MB cap and a PDF/Word allowlist, both with plain-language
messages that say why. (`app/api/onboarding/cv/route.ts`.)

### Calendar and dates

**A calendar window with no end date hangs the scheduler** (high) — a typo in
the end date (2027 → 2077) makes `nextDue` walk forward forever inside a request.
→ **Handled.** Every search is bounded at 400 days and throws a `CalendarError`
naming the cause: "the calendar has a window that never ends". (`lib/calendar.ts`;
test: *a window with no end fails loudly instead of hanging*.)

**Friday is a working day and a bad send day, and conflating them is wrong both
ways** (high) — `PLAN.md` §5 counts Mon–Fri; `CULTURE.md` §9 establishes Mon–Thu
as the only safe send band. Treating Friday as non-working would stretch every
countdown; treating it as sendable lands mail during Friday prayers.
→ **Handled.** Two functions, one module: `isWorkingDay` for counting,
`isSendWindowDay` for landing. The send window never changes the countdown.
(`lib/calendar.ts`; test: *the send window is Mon-Thu even though Friday counts
as a working day*.)

**Seeded Islamic dates are estimates presented as facts** (high) — shipping
Eid windows as confirmed would make the scheduler treat a guess as settled and
bind a holiday opener against it.
→ **Handled.** Every moon-sighting-dependent window ships `confirmed = 0` with a
note saying so and a day's margin either side. Unconfirmed counts as fully
non-working, so an uncertain date always delays rather than risks. (`lib/
calendar-store.ts`; test: *every Islamic window ships unconfirmed*.)

### Infrastructure

**A missing `data/` directory surfaces as SQLite error 14** (medium) — hit
during the build. The message tells the founder nothing.
→ **Handled.** The parent directory is created on first connection.
(`lib/db/client.ts`.)

**Server modules reachable from a client component** (medium) — importing one
value from `lib/cv.ts` into the onboarding client dragged SQLite and `node:fs`
into the browser bundle and broke the build. It would equally have leaked
server-only code into a shipped bundle.
→ **Handled.** Shared user-facing copy lives in `lib/copy.ts`, which imports
nothing. Everything else the client needs from a server module is a `import type`.

**Nothing can send in week 1, and that is not a bug** (noted) —
`sendBlockFor()` blocks while `last_successful_poll_at` is older than six hours,
and nothing sets it until reply polling lands in week 4. Hard rule 10 is
therefore satisfied by construction right now. Recorded so week 4 does not read
the permanent block as a regression. (`lib/user.ts`.)

---

## Week 1 — register audit

Every item in the register's **Onboarding** and **Gmail Integration & OAuth**
sections, plus the calendar items week 1 owns. Handled with the code, or
deferred with a reason.

### Onboarding

| Register item | Status |
|---|---|
| Google "unverified app" warning kills onboarding (critical) | **Handled** — pre-consent explainer quoting Google's wording plus an advance warning about the red-triangle screen and what to tap (`app/onboarding/onboarding-client.tsx` `Connect`). Two scopes only, `gmail.compose` dropped (`lib/gmail/oauth.ts`). **Deferred:** moving the OAuth app to production publishing status and starting Google verification — a founder account action, not code. Tracked in `DEPLOY.md`; required before user #1. |
| Positive replies ask for a CV that doesn't exist (critical) | **Handled** for the onboarding half — generation from interview answers with glance-approval, or upload, stored versioned, with the never-send-your-Emirates-ID coaching (`lib/cv.ts`, `lib/copy.ts`). **Deferred to week 4:** the `document_request` classifier category and the pre-drafted in-thread reply with the CV attached — both need the reply pipeline. |
| One-word interview answers produce an unusable profile (high) | **Handled** — chip UI over curated UAE lists, one Claude micro-follow-up per thin field, minimum-viable-profile gate blocking completion by named field (`lib/interview.ts`, `lib/profile.ts`, `app/api/onboarding/complete/route.ts`). Tests: *one thin field blocks completion and is named*, *answering the one follow-up concretely unblocks it*. |
| User oversells and gets called on it in a reply (high) | **Handled** — the verification-framing question ("if they ask about this in a reply, what would you say?"), the confirmed-specificity ceiling, and profile answers stored as evidence rows with `interview://` URLs so the no-fact-outside-evidence rule covers self-claims (`lib/profile.ts`; test: *a profile claim is an evidence row too*). |
| Partial consent: user unchecks the send scope (high) | **Handled** — granted scopes inspected in the callback; a missing scope blocks completion and re-launches with wording naming the box that matters (`app/api/gmail/callback/route.ts`; test: *unticking the send box is detected rather than discovered days later*). |
| Queue auto-targets employer / rejecting company / family firm (high) | **Handled** — three hygiene questions writing `blocked_domain` and `user_company_state.blocked`, matched by normalized company name and domain label, greyed on the dashboard (`lib/blocklist.ts`, `app/dashboard/page.tsx`). **Deferred to week 3:** the per-draft "Skip this company" control and the "know someone there" warm-intro reframe — both live on the Review card. |
| Identity block: name spelling, send-as alias, signature (medium) | **Handled** — `sendAs.list` filtered to verified, display name shown beside the typed name, signature pulled via `sendAs.get` and confirmed as a fixed block outside the word budget (`app/api/onboarding/identity/route.ts`). **Deferred to week 4:** the weekly signature re-fetch, which belongs to the scheduler. |

### Gmail integration & OAuth

| Register item | Status |
|---|---|
| Testing-mode refresh tokens die after 7 days (critical) | **Partly handled** — `connection_state` exists and `invalid_grant` flips it to `revoked`, blocking sends (`lib/gmail/client.ts`, `lib/user.ts` `sendBlockFor`). **Deferred to week 4:** the full-width reconnect banner on all three screens and the proactive day-6 prompt — there are only two screens with content so far. **Deferred to the founder:** production publishing status, which is what actually removes the 7-day expiry. |
| Token revoked mid-campaign (high) | **Partly handled** — the invariant is in place: no send while not `connected`, no send while the last poll is over six hours old. **Deferred to week 4:** the reconnect reply-sweep and backlog re-spreading, which need sequences to re-spread. |
| Reconnect with the wrong Google account (high) | **Handled** — connected address stored from `users.getProfile`, `login_hint` pins the chooser, mismatch refused and the partial token deleted (`app/api/gmail/callback/route.ts`). **Deferred to week 4:** the explicit "switch account" action that archives live threads. |
| Follow-ups don't thread for the recipient (critical) | **Deferred to week 3/4** — schema is ready (`rfc822_message_id`, `references_chain`, `gmail_thread_id`), but there is no send path yet. Nothing can regress until one exists. |
| Duplicate or lost sends (critical) | **Partly handled in schema** — `UNIQUE (person_id, step)`, unique `rfc822_message_id`, and the `sending` status for the compare-and-swap (test: *a person cannot hold two rows for the same step*). **Deferred to week 3:** the CAS itself, the pre-persisted Message-ID, and the repair sweep. |
| Reply in SPAM, DSN parsing, historyId expiry | **Deferred to week 4** — the polling pipeline. |

### Scheduler and dates (week 1 scope only)

| Register item | Status |
|---|---|
| All date math must be Asia/Dubai calendar dates (high) | **Handled** — `lib/calendar.ts` is the only date module, enforced by `npm run check:dates` in CI; the suite runs under `TZ=America/New_York`. |
| `scheduled_date` is derived, never authoritative (high) | **Handled** — `recomputeDerivedDates()` derives from (prior send date, working-day count, current calendar) and runs on every calendar edit; `clampRecomputedDueDate` stops a retroactive correction firing a follow-up immediately; `calendar_version` stamps every row (`lib/derived-dates.ts`, `app/api/calendar/route.ts`). **Deferred to week 4:** the nightly cron that calls it, and the "confirm Eid dates" founder task three days ahead of each window. |
| The scheduler must be a stateless idempotent sweep (high) | **Deferred to week 4** by design. The two constraints that make it safe are already in the schema: `UNIQUE (person_id, step)` makes a double run a no-op, and derived dates make a late run converge. |

---

## Deferrals summary

Nothing critical is deferred without a dated reason. The list, so week 2 starts
from a known position:

| Deferred | Until | Why |
|---|---|---|
| OAuth production publishing + Google verification | Before user #1 | Founder account action; tracked in `DEPLOY.md`. Also removes the 7-day testing-token expiry. |
| `document_request` classification and CV-attached reply | Week 4 | Needs the reply pipeline. The CV half — having a CV at all — is done. |
| Reconnect banner on all screens, day-6 proactive prompt | Week 4 | Two screens have content so far. |
| Re-matching stored hygiene text against newly added companies | Week 2 | Needs company ingestion to hook to. |
| Weekly signature re-fetch, nightly date recompute, "confirm Eid dates" task | Week 4 | All are scheduler jobs; the functions they call exist and are tested. |
| Arabic-capable CV generation | No date | Upload path covers it; embedding a Unicode font is a week of work for a ten-second workaround. |
| "Skip this company" and the warm-intro reframe | Week 3 | Live on the Review card. |
