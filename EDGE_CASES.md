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

## Weeks 2–4 — new edge cases found while building

### Sourcing (week 2)

**Two transliterations of one name become two ladder rungs** (critical) —
"Maryam AlSuweidi" from a press release and "Mariam Al Suwaidi" from a
leadership page are one person. As two rows they are two live sequences at one
company, and she receives two cold emails from the same stranger.
→ **Handled.** `phoneticKey()` collapses transliteration families
(Mohammed/Mohamed/Muhammad/Mohd → one key) and `canonicalToken()` strips a
leading `al|el|ash|ad|az|as` before the family lookup, so the space is
irrelevant. Enforced as `UNIQUE (company_id, phonetic_key)`, not as a check that
could be forgotten. (`lib/names.ts`, `lib/db/migrations/001_init.sql`; test:
*a company can be sourced end to end, and every planted trap is caught*.)

**"Al" split off as a given name** (high) — naive tokenisation makes
"Al Ketbi" into given "Al", family "Ketbi", and the email opens *Dear Mr. Al*.
→ **Handled.** `FAMILY_PARTICLES` are never separated from the token that
follows them. (`lib/names.ts`.)

**An unresolvable patronymic chain** (high) — "Ahmed bin Rashid bin Saeed" has
no family name to be formal with, and guessing one is worse than not trying.
→ **Handled.** `resolveSalutation` falls back to `Mr. + first name` rather than
inventing a family name, and never derives an honorific from the chain.
(`lib/names.ts`.)

**A catch-all domain reports every address as valid** (critical) — verification
returns "deliverable" for an address that does not exist, and the send lands
nowhere while the countdown runs.
→ **Handled.** `accept_all` is a distinct `email_status`, never collapsed into
`verified`, and is surfaced on the card as exactly what it is.
(`lib/email-pattern.ts`, schema check constraint.)

**One exemplar is not a pattern** (high) — a single `first.last@` sighting
mints the whole company's addresses from a guess.
→ **Handled.** `recordExemplar` requires two independent exemplars before a
pattern is `confirmed`; below that, addresses stay `guessed` and cannot be sent
to. (`lib/email-pattern.ts`.)

**The London trap** (high) — a Tier-3 search for a UAE role returns the
same-named person at the same company's London office, and the whole premise is
about a country they do not work in.
→ **Handled.** `checkGeography` on every Tier-3 result, and the search plan is
always scoped `site:ae.linkedin.com/in` — never `linkedin.com`, never a scrape.
(`lib/tier3.ts`.)

### Generation and sending (week 3)

**A documented conflict between two governing documents** (high) —
`research/template-doctrine.md` bans "I hope this email finds you well" as an AI
tell; `CULTURE.md` §5 lists it among safe pleasantries and argues the
bare-transactional email fails in the Gulf for its missing frame, not its
length. Both govern their area, so one of them had to lose somewhere.
→ **Resolved rather than deferred.** Banned at LOW and MEDIUM register, allowed
as a single line at HIGH — a government under-secretary expects the frame and a
startup founder reads it as spam. Implemented as `HIGH_REGISTER_EXEMPT`, tested
in both directions, and the reasoning is in the file header so the next reader
does not "fix" it. (`lib/template.ts`.)

**`SQLITE_BUSY` on a genuine two-tab send race** (critical) — one connection
cannot interleave two write transactions, so the loser of a Send race got a
driver error thrown at it. The user would have seen a failure on a send that
was actually fine.
→ **Handled.** Write transactions are serialised in-process behind a promise
queue, plus `PRAGMA busy_timeout = 5000` for the separate case of another
process holding the file. The compare-and-swap then decides the race instead of
the driver, and the loser reads "Sent from another device a moment ago."
(`lib/db/client.ts`; test: *two tabs pressing Send produce exactly one claim*.)

**"To see if we are a fit" slipped the banned-phrase lint** (medium) — the
pattern assumed a contraction, so the uncontracted form went through.
→ **Handled.** Loosened to `/\bto see if (we|there|you)\b.{0,25}\bfit\b/i`.
(`lib/template.ts`.)

**A stale tier-1 fact is not a tier-1 fact** (high) — congratulating someone on
a promotion they announced fourteen months ago is worse than saying nothing.
→ **Handled.** `effectiveTier` demotes on recency (tier 1–2 by one step past 90
days, two past a year; a tier-4 promotion note past 30 days drops to 6, i.e.
unusable). Expressed through the calendar module, because "older than ninety
days" is a calendar question, not an elapsed-milliseconds one — the date guard
caught the first version. (`lib/generator.ts`.)

### The cadence engine (week 4)

**An out-of-office reschedule undone by the nightly recompute** (critical) —
`scheduled_date` is derived, never authoritative, and is recomputed every
sweep. The OOO handler wrote the new date straight into it, so within hours the
recomputation put it back and the follow-up fired into the empty office anyway.
The bug is invisible in a unit test of the handler; it only appears when the two
correct behaviours meet.
→ **Handled.** A hold is now a stored fact the recomputation *reads*, not an
adjustment to its output: `outreach.hold_until` floors the derived date, and
`outreach.countdown_paused` stops the derivation entirely for a gateway
challenge, where there is no honest date to count from.
(`lib/db/migrations/002_cadence.sql`, `lib/state-machine.ts`,
`lib/derived-dates.ts`; tests: *an out-of-office is not a reply, not a touch,
and survives the recompute*, *a gateway challenge stops the clock instead of
moving it*.)

**A quarantined step read as due now** (high) — the gateway handler nulls
`scheduled_date`, and the queue treats a null date as "no deadline, offer it".
The follow-up would have been offered into a quarantine the recipient never
released.
→ **Handled.** `buildQueue` excludes `countdown_paused` rows outright.
(`lib/queue.ts`; test: *a quarantined step is never offered in the queue*.)

**The break-up anchored on the wrong touch** (high) — `template-doctrine` §(d)
counts both offsets from day 0 (0 → +4 → +15). Anchoring step 3 on step 2's send
date instead stretched the sequence to a month. Anchoring purely on day 0 has
the opposite failure: a user who disappears and sends touch 2 on day 13 gets
touch 3 two days later, which reads as pestering to the only person whose
opinion matters.
→ **Handled.** Anchored on touch 1 per the doctrine, with a four-working-day
floor after whatever the recipient actually last received.
(`lib/derived-dates.ts`; test: *a late touch 2 pushes the break-up out rather
than stacking it*.)

**The send window was documented but never enforced** (critical) — `CULTURE.md`
§9 makes Monday–Thursday the only window that is safe for every UAE org type,
and nothing in the code knew. A follow-up whose countdown landed on a Friday was
offered and sendable, into an inbox that would read it on Monday at best. Found
by running the sweep, not by reading the code.
→ **Handled.** `sendPermission` refuses outside the window, naming the next
send day. `buildQueue` still renders the cards but with Send off — an empty
screen on a Saturday reads as broken, whereas "three ready, held until Monday"
is reassuring and true. (`lib/queue.ts`; tests: *nothing may be sent on a
Friday, a Saturday or a Sunday*, *a weekend queue shows what is waiting rather
than an empty screen*.)

**The due-date clamp landed follow-ups on Saturdays** (high) — the rule "a date
may move earlier only to tomorrow at the soonest" was implemented as a literal
next calendar day, so a retroactive correction on a Friday produced a Saturday
due date that then sat outside the send window with its countdown reading as
satisfied.
→ **Handled.** The floor is the next working day.
(`lib/calendar.ts`; test: *the clamp floor is the next working day, never a
Saturday*.)

**The clamp fired on dates that were due today** (high) — between 20:00 UTC and
midnight, Dubai has rolled over and the server has not. Any sweep in that window
saw a legitimately-due follow-up as "in the past" and pushed it a day. This is
four hours of every day.
→ **Handled.** Today is not the past; the clamp only applies to dates strictly
before today. (`lib/calendar.ts`.)

**The year in an out-of-office is never written down** (medium) — "back on 5
January", read on 28 December, was parsed as *last* January, eleven months in
the past, where the clamp made it due tomorrow — into an empty office. And the
year itself came off a UTC `Date`, which disagrees with Dubai for four hours
either side of New Year.
→ **Handled.** The reference day is a UAE date, and a date more than sixty days
in the past rolls forward a year. The UTC read was caught by the date-arithmetic
guard, doing exactly what it was built for. (`lib/classifier.ts`; test: *"back
on 5 January" read in December means next January*.)

**`recordInbound` returned a dangling id on every re-poll** (high) — the insert
is `ON CONFLICT DO NOTHING` because polling is idempotent and sees the same
message every sweep, but the function returned the id it had minted rather than
the row that exists. The next foreign key pointing at it failed, so the second
poll of any replied thread threw.
→ **Handled.** It returns the stored row's id. (`lib/state-machine.ts`.)

**The cron bypass could never match its own route** (high) — the password
middleware let scheduled jobs through on `pathname.startsWith('/api/cron/')`,
with a trailing slash the route `/api/cron` never has. Behind a password gate
the sweep would have 401'd forever, silently, and the first symptom would have
been follow-ups quietly not going out.
→ **Handled.** (`middleware.ts`.)

**A touch manufactured after the break-up already went out** (medium) —
`advanceSequences` looked only at the row in front of it, so a history with a
gap in it could produce a "just checking you saw this" after the closing email.
→ **Handled.** The insert refuses when any later step already exists for that
person. (`lib/scheduler.ts`.)

**A dead thread costs a Gmail request every fifteen minutes, forever** (medium)
— the register requires polling every thread ever sent, and that set only grows.
Polling all of them every sweep is a quota storm waiting for the first quiet Eid
week; polling only live ones loses the late reply the rule exists for.
→ **Handled.** `thread_poll` carries a per-thread cadence: live sequences every
sweep, closed ones once a day, and a thread that 404s five times retires.
(`lib/poller.ts`, `lib/db/migrations/002_cadence.sql`.)

---

## Milestone audit — weeks 2, 3 and 4

Every register item in scope, with the code or the reason. Silence is not an
option, so items that are genuinely not done say so.

### Reply classification and inbound handling

| Register item | Status |
|---|---|
| Every inbound classified before it may change state (critical) | **Handled** — header pre-checks first (`Auto-Submitted`, `X-Autoreply`, `Precedence`, `multipart/report`), then patterns, then Claude; ambiguous defaults to a human reply and surfaces the thread (`lib/classifier.ts`). |
| Referral gets torched by the ladder (critical) | **Handled** — every From/To/CC on an inbound message marks matching people `in_warm_thread`, which is a hard block on rotation; the company goes `paused_referral` and leaves it only by user action (`lib/state-machine.ts`, `lib/scheduler.ts`; tests: *a referral pauses the company and marks everyone on the thread warm*, *a warm contact is never picked up by ladder rotation*). **Deferred:** creating person rows for unmatched addresses at the domain — the addresses are recorded on the inbound row, so nothing is lost, but promoting them to ladder members is week 5. |
| "Remove me" suppresses the domain, not the person (critical) | **Handled** — person suppressed by email hash and company `suppressed_by_request`, checked before any draft, permanent, surviving dormancy (`lib/state-machine.ts`, `lib/people.ts`). |
| A rejection kills the whole ladder (critical) | **Handled** — `dormant_until` +90 days, every ladder row frozen, and rotation gated on company state so no amount of silence rotates past a no (tests: *a rejection kills the whole ladder…*, *the ladder never rotates past a rejection…*). |
| Out-of-office counted as a real reply (critical) | **Handled** — not a reply, not a touch; return date + 2 working days, or 5 working days with no parseable date; `regenerate_at_send` set; past the break-up it stretches rather than closes (three tests). |
| Late reply after the sequence closed (critical) | **Handled** — every thread ever sent is polled forever; a real reply reopens the person, un-dormants the company and freezes siblings (`lib/poller.ts`, `reopenForLateReply`). |
| Escalation from an address we never emailed (high) | **Handled** — thread-first matching attaches any message on a tracked thread regardless of sender; `complaint_escalation` suppresses the domain at poll time, not at the next sweep. |
| Secure-gateway challenge (high) | **Handled** — countdown paused, `company.gateway` recorded, challenge URL surfaced as an action, and after five working days of nothing it is treated as a soft bounce so the best contact is not frozen forever. |
| "How did you get my email?" (high) | **Handled** — `provenance_challenge` halts the sequence and the action assembles the honest answer from the stored `person_source` URLs. |
| Reply on LinkedIn or by phone (high) | **Handled** — "they replied elsewhere" on the follow-up card sets `replied_external` and halts the countdowns (`app/api/draft/route.ts`). |
| Departed contact (medium) | **Handled** — permanent `departed`, evidence stale, named successor extracted and surfaced. |
| Auto-ack from an unmonitored mailbox (medium) | **Handled** — `dead_end_mailbox`, `role_based = 1`, portal URL surfaced, no cooldown wasted. |
| Person 2 calls out the email to person 1 (medium) | **Handled** — the generator receives `priorContactAtCompany` for every ladder step past the first and is contract-forbidden from first-contact phrasing; `prior_contact_callout` pre-drafts the honest pivot. |
| Arabic inbound (medium) | **Handled** — Arabic and mixed-language few-shots in the classifier prompt, Arabic OOO patterns (`إجازة`) in the pattern pass, `language` stored on every inbound row. **Deferred:** the machine translation shown on the Review card — the language is detected and stored, but the translated body is week 5. |
| Hard vs soft bounce (high) | **Handled** — 5.x.x closes the person and marks the pattern exemplar bounced; 4.x.x retries after one working day; the wording never contains an SMTP code (test: *a hard bounce closes the person and never blames the user*). |
| Reply lands in SPAM (high) | **Handled** — `threads.get` returns spam-labelled messages, the reply still stops the sequence, and a "mark Not Spam" action with a deep link is raised (`lib/poller.ts`). |
| historyId expiry and quota storms (medium) | **Handled differently, on purpose.** The History API is not used at all: the thread set is small and bounded, so `threads.get` on stored ids has no expiry to handle. The quota half is handled by the per-thread cadence, the token bucket and the backoff. |

### Scheduler and state machine

| Register item | Status |
|---|---|
| Reply races a queued follow-up (critical) | **Handled** — both guards. The poller supersedes atomically; the send-time gate re-checks inside the CAS and cannot lose (tests: *a reply supersedes every queued, drafted and approved step at once*, *the send gate wins the race the poller can lose*). |
| Follow-up whose predecessor never sent (high) | **Handled** — an invariant repair, not an assertion (test: *a follow-up whose predecessor never sent cannot exist*). |
| All date math in Asia/Dubai (high) | **Handled** — one module, CI grep, suite under `TZ=America/New_York`. Two live defects caught by it this week, both listed above. |
| `scheduled_date` derived, never authoritative (high) | **Handled** — recomputed every sweep and on every calendar edit, with `hold_until` and `countdown_paused` as the stored facts it reads. **Still deferred:** the "confirm Eid dates" founder task three days before each window. |
| Person 1 replies after person 2 started (high) | **Handled** — both resolutions, with person 2 pausing rather than closing so resuming needs no re-sourcing (two tests). |
| Stateless idempotent sweep (high) | **Handled** — tests assert that running twice changes nothing and that a three-day outage converges to the same state as three daily runs. |
| Post-gap backlog vs the daily ceiling (high) | **Handled** — follow-ups drain first against their own cap, first emails use the ramped ceiling after, combined hard cap, nothing rolls over (`lib/queue.ts`). |
| Queue-open freshness pass (high) | **Handled** — the full sweep runs on every queue open and sends stay blocked until it finishes; the returning user sees "welcome back", never a backlog count. |
| Sibling companies under one domain (medium) | **Handled** — every sequencing invariant keys on `org_group` (test: *two live sequences at one org group collapse to the oldest*). |
| Global pause and "I got the job" (medium) | **Handled** — pause freezes the sweep entirely rather than filtering the queue; "I got the job" closes silent sequences without a word, routes warm threads to a courteous withdrawal, and logs the placement numbers (`app/api/actions/route.ts`). |

### Still open, with reasons

| Item | Status |
|---|---|
| Reply-assist drafting (critical) | **Not done.** A reply raises an action with coaching text, which is what stops the user freezing, but the pre-drafted response itself is not written yet. This is the biggest remaining gap and is the first thing in week 5. |
| Inbound machine translation on the card | Week 5. Language is detected and stored; the translation is not rendered. |
| Referral addresses promoted to person rows | Week 5. Recorded on the inbound row, so nothing is lost. |
| "Confirm Eid dates" founder task | Week 5. The calendar screen already shows unconfirmed windows; the proactive nudge is missing. |
| Reconnect banner on every screen, day-6 token prompt | Week 5. The block itself is enforced everywhere; the banner is on `/today` only. |
| OAuth production publishing and CASA | Founder action, tracked in `DEPLOY.md`. |

---

## Week 5 — found by running it, not by reading it

Every item here was invisible to the unit tests, because each is two correct
pieces meeting badly. They were found by executing a full scenario end to end
against a real database: send touch 1, sweep, receive a referral, apply it,
rebuild the queue, sweep twice more.

**A referral was not caught without an API key** (critical) — the pattern pass
is the fallback when Claude is unconfigured or simply unreachable. It had rules
for gateways, out-of-office, removals, complaints, departures and provenance,
and none for referrals. "Looping in Fatima who runs our Emiratisation
programme" fell through to the safe default of a human reply, which protects the
sender — the sequence stops — but does not mark Fatima warm. She is rank 2 on
the ladder. The one classification whose failure cannot be undone was the one
depending on a network call.
→ **Handled.** `REFERRAL_PATTERNS` and a CV-request pattern, referral checked
first because a CV sent a day late is recoverable and a cold email to someone
just introduced is not. (`lib/classifier.ts`; tests: *a referral is caught by
pattern, with no model available*, *a departure still beats a referral when both
could match*.)

**`\b` around Arabic never matches** (medium) — the Arabic CV-request pattern
was written `/\b(أرسل)\b.../`. JavaScript defines `\b` on `[A-Za-z0-9_]`, and
every Arabic letter is a non-word character, so the boundary can never assert
between two of them. The pattern was dead on arrival and would have looked
correct in review forever.
→ **Handled.** Word boundaries dropped for the Arabic patterns.
(`lib/classifier.ts`.)

**The reply deadline was 88 hours** (high) — "within one working day", read
literally, means the *next* working day. On a Friday that is Monday evening.
The entire mechanism of reply assist is the pressure of a number in hours, and
88 is not a deadline, it is a shrug.
→ **Handled.** The deadline is today whenever today is a working day with at
least three hours left, and the next working day otherwise — a reply arriving at
16:30 gets tomorrow, because a deadline nobody could have met teaches the user
to ignore deadlines. (`lib/reply-assist.ts`; test: *the deadline is today
whenever today still has hours in it*.)

**`reply_conflict` was never set by anything** (high) — `resolveReplyConflict`
handled both resolutions and the dashboard rendered the choice, but no code path
ever put a company into the state. The decision card was unreachable, and a
company with two live threads simply stayed that way.
→ **Handled.** Any real reply — a question and a CV request as much as a yes —
checks for a colleague mid-sequence at the same org group and raises the
decision. (`lib/state-machine.ts`; tests: *a reply while a colleague is
mid-sequence is a decision, not a freeze*, *a mere question raises the same
conflict a yes would*.)

**A Next Action with no person stacked once per sweep** (high) — the dedupe is a
partial unique index on `(user_id, person_id, kind)`, and SQLite treats NULLs as
distinct. An action about the system rather than about somebody — "confirm the
Eid dates" — would have added a card every fifteen minutes, four an hour, until
the user stopped reading the list.
→ **Handled.** Person-less actions are checked explicitly, and marked cold so a
calendar chore can never sort above someone who wrote to you. (`lib/poller.ts`.)

**A reply the tool could not draft was an unanswerable question** (high) — with
no drafting service the card asked the user a question, and answering it re-ran
the drafting that had just failed, which asked again. An infinite loop with a
deadline attached, on the most time-critical screen in the product.
→ **Handled.** `needs_fact` and `write_yourself` are different states: one asks
for a fact only the user knows, the other hands over an empty box and says why.
(`lib/reply-assist.ts`, migration `003`; test: *a positive reply becomes a card
with a countdown even with no drafting service*.)

**The Mon–Thu send window existed in `lib/calendar.ts` and was never consulted**
(critical) — `isSendWindowDay` was written in week 1 straight from `CULTURE.md`
§9, correctly, and then no caller ever used it. A follow-up whose countdown
landed on a Friday was offered and sendable.
→ **Handled.** Enforced in `sendPermission` and shown held-with-a-date in the
queue. The general lesson is logged here deliberately: a helper that encodes a
rule is not the same as a rule being enforced, and only running the thing found
the difference. (`lib/queue.ts`.)

---

## The adversarial audit — twenty-eight defects, found by attacking the build

Six auditors, one per hard rule and per subsystem, each finding sent to
independent skeptics briefed to refute it. What follows survived. The pattern
is worth naming: almost none of these are a piece of logic being wrong. They
are two correct pieces meeting, a rule written down and never consulted, or a
promise made in the interface that no code kept.

### Reachable by a recipient

**No follow-up or break-up could ever be sent** (critical) — the Review
screen's evidence speed bump requires tapping a source chip. Touch 2 is a bump
on the same thread and touch 3 is a clean close, so both carry an empty
`evidenceIds`: no chips rendered, nothing was tappable, and Send stayed disabled
under the words "Check one source first" with nothing to check. Two thirds of
the cadence was unreachable through the interface.
→ **Handled.** The speed bump applies where there is evidence; the follow-up's
own speed bump is the interlock, which asks the harder question anyway.

**The Review screen sent a different email from the one on screen** (critical)
— Send posted the user's edit only while the editor was open. Tapping "Done
editing" first, which is what the button invites, sent the original stored text
while the screen displayed the rewrite. The exact inverse of this screen's one
guarantee.
→ **Handled.** Keyed on whether the body changed, not on whether the editor is
open.

**A bank's own footer suppressed the bank** (critical) — the complaint pattern
matched a bare "legal", "compliance" or "data protection". Every Gulf corporate
footer carries all three, so a warm reply followed by 200 words of
confidentiality boilerplate would have permanently blacklisted the employer.
→ **Handled.** Complaint patterns are sentences somebody chose to write,
matched against the message with the footer stripped.

**Every bounce was permanent** (critical) — a DSN carries `Status: 4.2.2` in a
`message/delivery-status` part, which the body extractor drops. The soft-bounce
branch could never fire, so a temporarily full mailbox closed a real contact and
marked the whole domain's address pattern bounced. And the retry, when it did
fire, updated only `approved` and `drafted` rows while the bounced message is
`sent` — so it told the user "retrying Sunday" and retried nothing.
→ **Handled**, both halves.

**The transport blind-retried sends** (critical) — `gmailRequest` retries three
times on 429 and 5xx. For `/messages/send` that means a response lost after
Gmail accepted the message sends it twice, defeating the entire discipline of
the send path, which exists to probe rather than retry.
→ **Handled.** Sends are attempted once; reads still retry.

**A reply could say "my CV is attached" with nothing attached** (critical) — if
the CV was missing or unapproved.
→ **Handled.** It refuses, naming which.

**Replies were addressed and threaded wrongly** (high) — `In-Reply-To` carried
`<{gmail_api_id}@mail.gmail.com>`, a header that has never existed anywhere, so
every reply arrived as an orphan in the thread it answered. And the reply went
to the person originally written to rather than whoever actually wrote, so an
escalation from legal-compliance@ would have been answered to the wrong mailbox.
→ **Handled.** Migration 005 stores the real RFC822 Message-ID and any Reply-To.

**A late rejection undid a suppression** (high) — any human reply on a closed
thread triggered the late-reply reopening, which sets `paused_late_reply` over
the top of a dormancy or a permanent `suppressed_by_request`.
→ **Handled.** The one state this product must never be able to undo is the one
somebody explicitly asked for.

**A delegating out-of-office lost the referral** (high) — "on leave until the
12th, contact Sara meanwhile" classified as OOO and stopped, so Sara was never
marked warm.
→ **Handled.** Delegation is checked before the autoresponder.

**Past dates were believed** (high) — an autoresponder still running from March
says "until 20 August" of last year; a soft rejection's extracted date is
format-checked, not sanity-checked. Both were written into a hold or a dormancy,
where a past date is no hold at all.
→ **Handled.** Future only, in both.

**An email could be signed off by nobody** (medium) — the generated body ends at
"Kind regards," because the sign-off is appended separately. With no Gmail
signature, which is the common case for a student's personal account, the
recipient got a message from an unnamed stranger.
→ **Handled.** The confirmed name is the fallback.

**An untranslated Arabic quote could be spliced into an English email**
(medium), past every lint, because none of them read Arabic.
→ **Handled** at the evidence store, with a reason the founder can act on.

### The engine stopping, silently

**The scheduler had a thirteen-month fuse** (critical) — `workingDaysBetween`
threw past a 400-day span. A person sits in `closed_silent` forever and a user
can come back after a year, so the throw never surfaced a bug; it would have
detonated the sweep on one old row and stopped every follow-up in the system.
→ **Handled.** A span beyond the search window reports the cap.

**The poller could permanently blind itself** (critical) — a thread retired
after five failures, and `failures` only resets on a successful fetch, so a
retired thread was never fetched again and could never recover. An hour of Gmail
500s across five sweeps would have blinded it to every thread, forever. **And it
would have reported that as healthy**, unblocking sending while completely
blind.
→ **Handled.** Retired threads retry daily; health means no live thread unread
past the staleness limit.

**An overdue follow-up could never be sent** (critical) — the clamp pushed a
past date to tomorrow, and the next sweep re-derived the same past date and
clamped it again. Perpetually one day away; the queue only offers follow-ups
whose date has arrived.
→ **Handled.** The clamp applies only when a date actually moved earlier, which
is the retroactive-edit case it was written for.

**A closed mid-sequence step stranded its person forever** (medium) —
`in_sequence` with nothing live and no break-up: the sweep can neither advance
nor rotate, and one-live-sequence-per-organisation then froze that company's
entire ladder behind a sequence that could never end. Reachable from a blocking
salutation lint, which is a normal outcome.
→ **Handled** as an invariant repair.

**A gateway challenge before the follow-up existed paused nothing** (high) — it
arrives within minutes of touch 1, when the only row is the sent one.
→ **Handled.** The pause is marked on the sent message, which is what
advancement checks.

**`regenerate_at_send` was written in three places and read in none** (medium) —
"holiday openers bind at send-eligibility time" was written down, stamped on the
row, and never acted on.
→ **Handled.**

**`org_group_link` was written by nothing and read by nothing** (medium), and
after the read path was added, conflict detection still grouped by raw
org_group_id — where two linked groups holding one live sequence each count as
one apiece, the exact case the link exists for.
→ **Handled**, both times.

### Promises the interface made and the code did not keep

**The gateway card promised the sequence restarts from day zero.** Nothing
cleared `countdown_paused`. **The reply-conflict buttons could only 500** —
they posted no person id, because the query never selected one, so the decision
card that unblocks a frozen company was unusable in both directions. **"I got
the job" said everything could be picked back up** and nothing could. All three
now do what they say.

**Two screens had no way out** (high) — a failed queue fetch left the app on
"Checking for replies first…" forever with nothing to tap; a failed draft fetch
returned "Opening…" *above* the Back button. The onboarding identity step had
the same shape on the way in, where it blocked setup entirely.
→ **Handled.** All three show what happened and offer a retry.

**Two destructive controls fired on one tap**, each sitting beside something
harmless: "I handled it myself" next to Send, and "Skip this company" — a
permanent blocklist entry — next to Edit.
→ **Handled.** Both ask once.

**The reply question loop had no failure path** (high) — the endpoint returns
200 with `ok: false` when drafting fails, so silence looked like success and the
user tapped the same button forever with a deadline running.

### Introduced and caught in the same audit

**The eligibility gate applied to follow-ups** — added one commit earlier to
close a real gap in step 1, and applied to every step. Touches 2 and 3 assert
nothing about the recipient, so a person whose evidence aged out had their live
sequence stranded behind a card asking for a fact the follow-up was never going
to use. Worth recording: the fix for one defect was itself a defect, and only
the next audit round found it.

### The one the skeptics could not refute

Forty-five of the audit's findings were refuted, almost all because the fix had
already landed while the audit was still running. One survived, and it is the
worst class of defect this product has:

**Pressing Send twice on a reply could deliver it twice** (critical) — the reply
path caught a Gmail failure, probed once, and on finding nothing reverted the
row to `approved` so the button worked again. But `probeForSentMessage`
swallowed every error and returned the same `null` for "searched, not there" and
"could not look" — and Gmail's `rfc822msgid:` index lags a freshly sent message
by seconds to minutes, so "the probe found nothing" routinely means "we cannot
tell yet". The user is told to try again, taps Send, and the retry POSTs a
second time with no probe at all: the hiring manager receives the reply, and the
attached CV, twice.

The comment I had written at that exact line claimed the opposite — that the
retry "records rather than duplicates" because "the probe above finds it". That
probe is inside the catch of the *second* attempt. It only helps if the second
attempt also fails.

→ **Handled.** The probe now returns `found | absent | unknown`. A reused
Message-ID makes the send path probe *before* calling Gmail. `unknown` never
reverts the row — it stays `sending`, and the repair sweep, which now covers
reply drafts as well as cold sends, resolves it later. The cold path had this
right from week 3; the reply path, written later and in a hurry to make the
button feel responsive, took the opposite choice.

The lesson is the one this whole register keeps arriving at: a comment asserting
an invariant is not the invariant. This one was wrong for a fortnight and read
as reassuring the entire time.

---

## Deferrals summary

Nothing critical is deferred without a dated reason. Updated at the end of week
4, so week 5 starts from a known position. Items closed since week 1 are struck
through with what closed them.

| Deferred | Until | Why |
|---|---|---|
| OAuth production publishing + Google verification | Before user #1 | Founder account action; tracked in `DEPLOY.md`. Also removes the 7-day testing-token expiry. **Still open** — nothing in the codebase can close it. |
| ~~`document_request` classification and CV-attached reply~~ | ~~Week 4~~ | **Half closed.** The classification exists and raises a CV action; the reply that carries the CV waits on reply-assist drafting in week 5. |
| ~~Reconnect banner on all screens, day-6 proactive prompt~~ | Week 5 | **Still open.** The *block* is enforced everywhere it matters — no send while not `connected`, none while the poll is stale — but the banner lives on `/today` alone. |
| ~~Re-matching stored hygiene text against newly added companies~~ | ~~Week 2~~ | **Closed** — `lib/blocklist.ts` matches by domain family at queue-build time, so a company added later is caught. |
| ~~Weekly signature re-fetch, nightly date recompute~~ | ~~Week 4~~ | **Closed** — the sweep recomputes derived dates on every run and on every calendar edit (`app/api/cron/route.ts`). |
| "Confirm Eid dates" founder task, three days before each window | Week 5 | **Still open.** The calendar screen shows unconfirmed windows and drafts crossing one carry `regenerate_at_send`, so the failure it guards against is already prevented; the nudge is the missing convenience. |
| Reply-assist drafting | Week 5 | **The largest remaining gap.** A reply raises an action with coaching, which is what stops the user freezing, but the pre-drafted response is not written. |
| Machine translation of Arabic inbound on the Review card | Week 5 | Language detected and stored; the rendered translation is missing. Classification itself is Arabic-capable and tested. |
| Referral addresses promoted to person rows | Week 5 | Recorded on the inbound row and marked warm, so nobody gets cold-emailed. Promoting them to ladder members is the convenience half. |
| Arabic-capable CV generation | No date | Upload path covers it; embedding a Unicode font is a week of work for a ten-second workaround. |
| ~~"Skip this company" and the warm-intro reframe~~ | ~~Week 3~~ | **Closed** — live on the Review card, feeding the blocklist rather than just hiding the card. |
| ~~Duplicate or lost sends: the CAS, pre-persisted Message-ID, repair sweep~~ | ~~Week 3~~ | **Closed** — `lib/send.ts`, with the two-tab and mid-send-crash tests. |
| ~~Follow-ups don't thread for the recipient~~ | ~~Week 3/4~~ | **Closed** — full `References` chain and `In-Reply-To`, subject verbatim after `Re:`. |
| ~~Reply in SPAM, DSN parsing, historyId expiry~~ | ~~Week 4~~ | **Closed** — spam-inclusive `threads.get`, DSN status parsing, and no History API to expire. |
| ~~Token revoked mid-campaign: reconnect reply-sweep and backlog re-spreading~~ | ~~Week 4~~ | **Closed** — the sweep on queue open is the reply-sweep, and the budget split re-spreads the backlog without a burst. |
| Explicit "switch account" action that archives live threads | No date | Rare, destructive, and safe today: a mismatched account is refused outright rather than silently accepted. |
