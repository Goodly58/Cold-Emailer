# Emirati Cold-Outreach Engine — Plan v3

**Goal:** land interviews for Emirati candidates via personalized cold email, leveraging the structural advantage Emiratisation quotas and Nafis create. Build for one friend first; the same build is the seed of the commercial product.

**Core product assumption (from founder):** users are lazy and tech-shy. Every flow must be embarrassingly easy — connect email in one click, answer a few questions, review, send. If a step feels like "setup," it's designed wrong. This makes the minimal UI a v1 requirement, not a later phase.

---

## 1. The three subsystems

1. **Data collection** — companies → people → *evidence* (raw-source facts for personalization).
2. **Email generation** — evidence + template → draft, with a clarify-&-refuse contract (§6).
3. **Outreach state machine** — working-day countdowns, UAE-holiday awareness, follow-ups, person rotation within a company, reply detection (§5).

The tone target for subsystem 3, in the founder's words: *grit and continuous chasing, but never annoying.*

---

## 2. Product shape: three screens

### Screen 1 — Onboard (once, < 10 minutes)
1. **Connect Gmail** — one-click Google OAuth (`gmail.compose` + `gmail.readonly` + `gmail.send`). Gmail only in v1; most users' personal mail.
2. **Profile interview** — short structured questions: who you are, education, one credibility marker, what roles you want, industries, cities, tone preferences. Output: a candidate profile that seeds the email template and the targeting queue.
3. Done. The system starts building their company/people queue behind the scenes.

### Screen 2 — Review & Send (daily, the core loop)
Split view:
- **Left:** the email exactly as it will send (editable).
- **Right:** the evidence panel — every personalized claim in the draft, each with the **raw-source quote and a link to where it came from**. The user can judge in 10 seconds whether the personalization is real.
- One button: **Send** (via their Gmail account through the API — same deliverability as sending by hand, but no tab-switching). Every send is human-approved; there is no auto-send.
- Follow-ups appear in the same queue when their countdown hits zero, pre-drafted, same evidence panel, same one-click send.

### Screen 3 — Dashboard
- Companies reached, per-company timeline (who, when, which step).
- **Next actions:** who is due for follow-up and in how many working days; who is next in the queue.
- Reply/bounce status per thread (read from Gmail).

---

## 3. Sourcing pyramid (contact discovery)

Work each company top-down; stop at the first tier that yields the right person. Every contact records which tier it came from.

- **Tier 1 — Regulatory & official registers.** Honest caveat: the UAE has no free Companies-House equivalent that lists officers for ordinary companies. Tier 1 is strong only for specific segments:
  - **DFSA Public Register** (DIFC financial firms — lists authorized individuals with roles)
  - **ADGM/FSRA Financial Services Register** (same, for ADGM firms)
  - **DFM / ADX listed-company disclosures + annual reports** (board and senior management)
  - **Central Bank / SCA licensed-entity lists** (institutions, not people — company-level only)
  - Government/semi-gov entities: official org pages, WAM (state news agency) announcements
  - For everything else, Tier 1 will miss → fall through. (The National Economic Register has license data but no people.)
- **Tier 2 — The company's own pages.** Leadership/team pages, press releases, "our people," Emiratisation/careers pages (these often name the Emiratisation or early-careers lead — the highest-value contact in this niche, see §4).
- **Tier 3 — Search-engine-indexed LinkedIn.** Query Google/Bing for `site:linkedin.com/in "<company>" "head of <function>"` etc. This reads public search results without touching LinkedIn itself — no automation against LinkedIn, no detection problem, ToS-clean.
- **Tier 4 — Manual LinkedIn browsing (last resort, human-only).** A person browses normally and pastes the profile URL/details into a quick capture form; the tool structures it. **Hard rule: no automated LinkedIn crawling, "undetected" or otherwise.** It's an account ban plus legal exposure (UAE PDPL) waiting to happen, and at our volumes the human path is fast enough.

**Staleness defense** (LinkedIn lies — people who left don't update): every contact needs either a second corroborating source or one source fresher than ~90 days before drafting. Email verification (below) is itself a departure check — a bounce on a verified pattern often means they're gone; log it and rotate.

**Email addresses:** infer the company pattern (first.last@domain dominates UAE corporates), verify with an API (NeverBounce/ZeroBounce class, ~$10–30). Only `verified` addresses ever get a draft.

---

## 4. Contact strategy within a company

Per company, build a ranked ladder of 2–4 people, then walk it one person at a time:

- **Specific open role found** (via job description — JD text often names the team/reporting line) → the hiring manager of that team, then a senior person in the same function.
- **Generalist route** → the **Emiratisation / Nafis program lead if one exists** (most large UAE employers have one; their KPI is literally hiring Emiratis — likely the highest-reply contact type in this niche), then HR/talent acquisition.

**Sequencing rules (no carpet-bombing):**
1. Only **one live sequence per company** at a time.
2. A person's sequence = email 1 → follow-up 1 → follow-up 2 (breakup). If it closes with no reply, wait a **cooldown of ~5 working days**, then start the next person on the ladder — with a *fresh angle and fresh evidence*, never referencing that someone else ignored us.
3. Never email two people at the same company on the same day (they talk; twin emails in one office is worse than none).
4. After the ladder is exhausted (max 3 people), the company goes dormant for 60–90 days.

---

## 5. Follow-up engine: working-day countdown, UAE-aware

- Cadence: **Day 0 → +4 working days → +5 more working days (breakup)**. Counts skip:
  - **Sat–Sun** (the UAE weekend since 2022 — not Fri–Sat)
  - **UAE public holidays:** Eid al-Fitr, Eid al-Adha + Arafat Day, Islamic New Year, Prophet's Birthday, Commemoration Day + National Day (Dec 1–3). Islamic dates shift on moon-sighting — store them as windows and confirm near the date.
  - A send-pause window through late Ramadan.
- **Holiday-aware warmth:** a follow-up whose countdown crosses a holiday reschedules to just after it and gets a contextual opening line ("Eid Mubarak — hope you had a good break with family") instead of a generic bump. This is the "grit without being annoying" mechanic: persistent, but human.
- Follow-ups add one new thing each time (a new evidence item, a relevant link, a sharper ask). The breakup email is polite and leaves the door open. Never "just bumping this."
- **Reply detection:** poll the connected Gmail; any reply (or bounce) stops the person's sequence immediately and surfaces the thread on the dashboard.

---

## 6. Email generation: the clarify-&-refuse contract

- Template skeleton (search-fund pyramid, adapted): **personal hook** (highest-tier evidence available) → **2-sentence intro** with one credibility marker → **the Emirati angle** (see §7) → **one ask** (coffee chat by default; direct job ask only when a specific open role triggered the email) → sign-off. Under 120 words. No attachments on email 1.
- The generator receives **only structured evidence rows, each with a source URL**, and may not state any fact not present in them.
- If the best evidence is generic (industry-level) or stale, it **refuses and emits a collection request** ("need one recent post or company event for X") instead of hallucinating. That request goes into the sourcing queue.
- Every draft stores which evidence IDs it used — that's what powers the Review screen's side-by-side evidence panel.
- English template in v1. Arabic variant deferred until gov/semi-gov targets justify it (UAE corporate hiring runs in English, even Emirati-to-Emirati).

### 6a. Template doctrine (founder's field experience + Becc Holland framework)

- **Base script:** Becc Holland's personalization approach as used in search-fund outreach — personalize to the *person* (what they wrote/said/did recently), pyramid-ordered, then a short intro, then one ask. A dedicated research pass is digesting her framework properly; its output becomes the canonical template spec in `TEMPLATE.md`.
- **Subject lines: short and identity-led.** Founder's tested pattern: "UCL student" style — the sender's identity marker, 2–4 words, no clickbait. For this product the natural analogues to A/B test: "Emirati [university] grad", "UAE national — [function]", "[University] student". Subject line is a first-class template variable, tracked per send for reply-rate attribution.
- **Intro-block library, not a fixed intro.** Onboarding collects rich structured material about the user — education, standout achievement with a number, work/internship experiences, national status, languages, affiliations, interests — stored as discrete intro *blocks*. The generator selects 1–2 blocks per email based on the recipient (manager vs HR), the company, and the role, so the intro flexes without being rewritten. If the profile interview yields thin blocks, the interview asks follow-ups until each block is concrete (same clarify-&-refuse spirit as evidence).
- **Voice constraints (hard):** no em dashes; no AI-typical phrasing — banned list enforced on generator output includes "I hope this email finds you well", "I came across", "resonated", "I'd love the opportunity", "excited to", "delve", "leverage", "passionate about"; short sentences; plain words; reads like a sharp student typed it in 3 minutes. A lint pass rejects drafts containing banned patterns before they reach the Review screen.
- Templates are versioned; every outreach row records `template_version` + subject variant so reply rates attribute cleanly.
- **Cultural register (UAE-aware, research in progress → `CULTURE.md`):** salutation, honorific, body formality, and sign-off are selected per recipient from a register matrix, not hard-coded. "Hi [first name]" is the UK default, not the UAE one: senior/traditional Emirati recipients likely require formal address and correct honorifics (H.E., Sheikh, Dr., Eng.), and misusing or omitting these is a higher-risk failure than blandness. The contact record therefore carries the fields the register needs: seniority, likely nationality, gender, formal title. Religious/seasonal greetings (Ramadan, Eid) follow researched rules, and every register decision gets validated with the founder's Emirati friend before going live.

## 7. Using the Emiratisation / Nafis angle

- **To HR / Emiratisation leads:** state it plainly — quota contribution + Nafis salary support is their KPI.
- **To hiring managers:** lead with fit and interest in their team's work; Emirati/Nafis status at most as a factual closer, or omitted.
- **Never** open with the subsidy. The personal hook always comes first.

---

## 8. Stack

**TypeScript end-to-end** (decision — answers "Python or TS?"):
- The product now includes a real UI, and this repo is already Next.js/TS: one language for UI, API routes, and pipeline jobs, one deploy.
- Gmail API, Google OAuth, and the Anthropic SDK are all first-class in TS.
- Python would win only for heavy scraping/data science, which we've explicitly ruled out.

Components: **Next.js** (3 screens + API routes) · **SQLite** via Prisma/Drizzle (single-file DB, easy backup) · **Gmail API** (OAuth, draft/send, reply polling) · **Claude API** (generation + evidence structuring) · a **scheduler job** (cron/queue) for countdowns and follow-up drafting.

## 9. Data model

```
user           id, name, gmail_oauth_tokens, profile (interview answers), template_prefs
company        id, name, domain, industry, emiratisation_flag, tier, status
               (active | dormant_until | exhausted)
person         id, company_id, ladder_rank, name, role_title,
               contact_type (hiring_manager | emiratisation_lead | hr | exec),
               source_tier (1–4), source_urls[], freshness_date,
               email, email_status (guessed → verified → bounced)
evidence       id, person_id?, company_id, tier (1=wrote_it, 2=engaged, 3=common_ground,
               4=company_news, 5=generic), quote, source_url (REQUIRED), collected_date
outreach       id, person_id, step (1|2|3), subject, body, evidence_ids[],
               status (queued → drafted → approved_sent → replied | bounced | closed),
               due_working_day_count, scheduled_date, sent_date
calendar       UAE holiday windows + weekend rules (drives all countdowns)
log            append-only state changes (debugging + later analytics)
```

## 10. Hard rules

1. No auto-send — every email is human-approved on the Review screen.
2. No fabricated personalization — every claim traces to an evidence row with a source URL.
3. Verified emails only.
4. Volume ceiling: 10–15 first-emails/day per user (mailbox warmup + realistic evidence throughput).
5. One live sequence per company; ladder rotation per §4; company dormancy after exhaustion.
6. Countdown in UAE working days; holiday-aware rescheduling per §5.
7. No LinkedIn automation, ever. Tier 4 is human-only with a capture form.

## 11. Build order

**Week 1 — Skeleton + onboarding.** Next.js app, SQLite schema, Google OAuth + Gmail connect, profile interview flow, UAE calendar table. Seed the friend's profile and 30–50 companies (any segment with Emiratisation/Nafis exposure; rank ladder per company).
**Week 2 — Sourcing tooling.** Capture form (Tiers 2–4), search-engine Tier-3 helper, email pattern inference + verification, evidence store.
**Week 3 — Generate + Review screen.** Clarify-&-refuse generator, split-view Review & Send via Gmail API. First 10 real sends with the friend, calibrating voice.
**Week 4 — Cadence engine + Dashboard.** Working-day scheduler, follow-up pre-drafting, reply polling, holiday-aware openers, dashboard timeline. Full list live at the ceiling.
**Weeks 5–6 — Learn.** Reply rate by evidence tier / contact type / template variant. Iterate templates, not architecture.

### Experiment 1 (runs from week 3): HR-first vs manager-first ROI

Founder's hypothesis to test: for Emirati candidates, plain HR/Emiratisation-lead outreach may beat the (much more expensive) manager-targeting on ROI, because the Emirati signal does the work that personalization does elsewhere.

- **Design:** randomize companies into two arms, matched roughly by segment/size. Arm A: ladder starts with the Emiratisation/HR lead, lighter personalization (tier 4 company-level evidence is acceptable). Arm B: ladder starts with the team/hiring manager, full pyramid personalization required.
- **Measure per arm:** reply rate, positive-reply rate, interviews, AND sourcing cost (minutes spent finding the contact + evidence — logged by the tool per contact, since ROI is outcome ÷ effort, not outcome alone).
- **Decision rule:** if Arm A is within ~70% of Arm B's positive-reply rate at less than half the effort, HR-first becomes the default ladder and manager-targeting is reserved for dream companies with specific open roles.

**Success bar before commercialising:** ≥ 8–10% reply rate and ≥ 2 interviews or serious intro calls within 6 weeks for the friend.

## 12. Deferred (commercialisation phase)

Multi-tenant + payments + onboarding polish · Arabic template · the **personalization-collision defense** (per-person evidence locking + a cross-client contact ledger enforcing spacing — the ledger is a moat: the biggest coordinated pool spams least) · UAE PDPL compliance work (needed before storing third-party personal data at commercial scale) · Outlook support.

## 13. Open items

1. Confirm the UAE Tier-1 register list above covers the segments we care about (strong for finance/listed/gov; thin elsewhere — Tier 2 carries the rest).
2. Nafis program rules (subsidy amounts, quota thresholds) to be verified at template-writing time — they shift year to year.
3. Exact UAE holiday calendar for the build year (Islamic dates finalize on moon-sighting).
