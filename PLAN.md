# Emirati Cold-Outreach Engine — v2 Plan

**Goal:** land interviews for one Emirati candidate (your friend) via personalized cold email, leveraging the structural advantage Emiratisation quotas and Nafis create. Build it friend-first as a pipeline you operate; commercialise only after it demonstrably produces interviews.

This plan supersedes everything previously in this repo.

---

## 1. Reframing the problem: it's three subsystems, not two

Your notebook splits the problem into (a) collect data and (b) write emails. That's right at a high level, but there's a third subsystem that campaigns live or die on, and it's the one your notebook only touches with "Rule: send first email, follow up 2x with good spacing":

1. **Data collection** — companies → people → *evidence* (the raw material for personalization).
2. **Email generation** — evidence + template → reviewed draft.
3. **Outreach state machine** — scheduling, follow-ups, reply detection, stop rules, tracking.

Most replies in cold outreach come from follow-ups 1 and 2, not the first email. If follow-up state is tracked in someone's head, it silently decays after week two. So subsystem 3 is a first-class build item, not a rule scribbled in the margin.

---

## 2. Locked assumptions (defaults chosen; overridable)

These were open questions; you didn't get a chance to answer, so the plan locks in the safest defaults. Changing any of them changes scope, so flag early if one is wrong.

| Decision | Default | Why |
|---|---|---|
| Sending | **Drafts written into the friend's real mailbox (Gmail API), human hits send** | Best deliverability (real account, real sending history), a human quality gate against hallucinated personalization, and the follow-up engine can read the same mailbox for replies. No auto-send in v1, ever. |
| Contact sourcing | **Manual LinkedIn browsing + email-pattern inference + verification API** | Automated LinkedIn scraping violates ToS, gets accounts restricted fast, and creates UAE PDPL exposure the moment you commercialise. Paid enrichment APIs (Apollo etc.) have weak GCC coverage. Manual sourcing is fine at friend-scale (30–50 companies) and produces *better* evidence anyway. |
| Target market | **Pluggable company list; decide segment with the friend in week 1** | Banking/finance has the hardest quotas; private multinationals respond to the Nafis cost argument; gov/semi-gov is where an Arabic template would matter. The pipeline doesn't care — the list is an input. |
| Operating model | **You drive the scripts; friend only reviews drafts and forwards replies** | Zero UI to build. The "product" in v1 is a pipeline + a database. Fastest route to the only question that matters: does this produce interviews? |
| Stack | **SQLite + Python scripts (or TS scripts — pick whichever you'll actually maintain), no web app** | The previous repo's dashboard was premature. A UI is a commercialisation artifact; build it after the pipeline has proven itself on one user. |

---

## 3. Data model

Five tables. The important design decision is that **evidence is a separate entity from emails** — this is also what makes the "same person gets 10 identical AI emails" collision problem solvable later (see §8).

```
company    id, name, domain, industry, tier (dream/target/backup),
           emiratisation_pressure (high/med/low), notes, status

person     id, company_id, name, role_title, seniority,
           contact_type (hiring_manager | hr | emiratisation_lead | exec),
           linkedin_url, email, email_status (guessed → verified → bounced),
           source_of_email (pattern_inferred | listed_publicly | ...)

evidence   id, person_id (nullable), company_id, 
           tier (1=they_wrote_it, 2=they_engaged_with_it, 3=shared_connection/common_ground,
                 4=company_news, 5=industry_generic),
           content, source_url (REQUIRED), collected_date

outreach   id, person_id, sequence_step (1|2|3), language (en|ar),
           template_version, subject, body,
           status (draft → approved → sent → replied | bounced | closed),
           evidence_ids_used, scheduled_date, sent_date, replied_date

campaign_log   append-only: every state change, for debugging and later analytics
```

Your notebook's many-to-one company→people relation is the `person.company_id` FK; the generic-vs-specific branching lives in `contact_type`.

### Contact-selection rule (from your notebook, made precise)

Per company, find **1–3 people**, chosen by this branch:

- **A specific role is open** (found via job description) → the hiring manager of that team (job descriptions often name the team/reporting line; LinkedIn maps the team) + optionally one senior person in the same function.
- **No specific role / generic interest** → HR lead, and specifically the **Emiratisation or Nafis program lead if one exists** — most large UAE employers have one, and they are *paid to find people like your friend*. This contact type is the single biggest structural edge this niche has; generic HR is the fallback, not the target.

Never contact two people at the same company in the same week (they talk to each other; two near-identical emails in one office is worse than none).

---

## 4. Pipeline stages (with human gates marked ✋)

```
Stage 0  INTAKE        friend's profile, CV, target roles, constraints, voice sample
Stage 1  COMPANIES     seed 30–50 companies manually with the friend  ✋
Stage 2  PEOPLE        manual LinkedIn browse → apply contact-selection rule
                       → infer email (first.last@domain is the dominant UAE
                       corporate pattern) → verify via API (NeverBounce/ZeroBounce,
                       ~$10–30 total) → only `verified` emails proceed
Stage 3  EVIDENCE      per person, collect 2–3 evidence items with source URLs,
                       highest pyramid tier available
Stage 4  GENERATE      LLM drafts email from template + evidence (see §5–6)
Stage 5  REVIEW        drafts land in friend's Gmail Drafts; friend edits/sends  ✋
Stage 6  CADENCE       state machine schedules follow-ups, detects replies, stops
Stage 7  LEARN         weekly: reply rate by template / evidence tier / contact type
```

Stages 2–3 are deliberately manual-with-tooling in v1. The tooling accelerates (pattern inference, verification, evidence capture form), the human sources. Automate only what proved to be the bottleneck.

---

## 5. The email template (search-fund pyramid, formalized)

Structure per email, matching what worked for you at Carlyle:

1. **Personal hook (1–2 sentences)** — drawn from the *highest available evidence tier*:
   - T1: something they wrote/said recently (post, article, panel)
   - T2: something they engaged with
   - T3: genuine common ground (university, mutual connection, shared interest)
   - T4: company-level event (expansion, deal, new program)
   - T5: industry-generic — **if this is the best available, the generator refuses to draft** (see §6). A generic opener is worse than no email; it burns the contact.
2. **Quick intro (2 sentences)** — who the friend is, one concrete credibility marker.
3. **The Emirati angle (0–1 sentence, contact-type dependent)** — see §7.
4. **One ask** — default **coffee chat / 15-minute call**; the direct job ask only when a specific open role was the trigger. Coffee-chat asks convert better cold and are how your Carlyle path actually worked.
5. Sign-off. Total length: under 120 words. No attachments on email 1.

**Follow-up templates** (steps 2 and 3) are short, reference the first email, add *one new piece of value or evidence*, and step 3 is a polite breakup note. They are separate templates, not "bumping this to the top of your inbox."

**Arabic template:** deferred to phase 2, and only if the week-1 segment decision includes gov/semi-gov. English is the working language of UAE corporate hiring; Arabic outreach is a differentiator in government contexts specifically.

---

## 6. The generator's "clarify & refuse" contract

Your notebook's "prompt that clarifies & refuses" is the right instinct — make it a hard contract, because hallucinated personalization is the single fastest way to destroy this project's credibility:

- The generator receives **only** structured evidence rows (each with a source URL). It is instructed it may not reference any fact not present in the input.
- If the best evidence is tier 5, or evidence is stale (> ~60 days for T1/T2), it **refuses and emits a request** for what to collect instead — that request goes back onto your Stage 3 to-do list.
- Every generated draft stores `evidence_ids_used`, so a bad email is traceable to bad evidence, not a mystery.
- Human review at Stage 5 is the backstop, not the primary defense.

---

## 7. Using the Emiratisation / Nafis angle without cheapening it

This is positioning, and it's easy to get wrong. The subsidy argument ("hiring me costs you less and helps your quota") is compelling to exactly one audience and mildly insulting to another:

- **To HR / Emiratisation leads:** state it plainly — quota contribution + Nafis salary support is their KPI. This is the segment where the niche's economics genuinely differ from generic cold-email tools.
- **To hiring managers:** lead with competence and interest in *their team's work*; mention Emirati status at most as a factual closer ("as a UAE national I'm also eligible under Nafis"), or omit it. A manager choosing someone for their team responds to fit, not subsidies.
- **Never** make the subsidy the opening line. The pyramid hook always comes first.

---

## 8. The personalization-collision problem (acknowledged, deferred, but designed for)

You correctly flagged that when 10 clients use the same tool, the same Emiratisation lead at FAB gets 10 structurally identical emails. Deferred for v1 (one client = no collisions), but the v1 design already contains the two mechanisms that solve it later:

1. **Evidence diversity:** because personalization is drawn from a per-person evidence *pool* rather than baked into a template, two clients emailing the same person can draw different hooks. Add a rule later: an evidence item used for person X is locked for N weeks across all clients.
2. **A central contact ledger:** the `outreach` table, made multi-tenant, becomes a registry of who-was-contacted-when across your whole client base — you can enforce spacing between *your own clients'* emails to the same person. Competitors without this coordination will spam; you won't. The collision problem is actually a **moat** for whoever operates the largest coordinated pool.

---

## 9. Hard rules (what makes this rigid)

1. **No auto-send.** Drafts only. A human clicks send in v1, always.
2. **No fabricated personalization.** Every claim in an email traces to an evidence row with a source URL, or the email doesn't get drafted.
3. **Verified emails only.** `guessed` never gets a draft; bounces poison mailbox reputation.
4. **Volume ceiling:** max 10–15 new first-emails per day from the friend's account (cold-start mailbox warmup; also matches realistic evidence-collection throughput).
5. **Cadence:** Day 0 → Day 4 (±1) → Day 9–10 breakup. Stop immediately on reply or bounce. Nothing sends Fri–Sat (UAE weekend) or during late Ramadan/Eid windows.
6. **One live contact per company at a time;** second contact only after the first sequence closes.
7. **No LinkedIn automation.** Ever, in any phase. It's the part of the system that must stay human.

---

## 10. Build order (friend-first milestones)

**Week 1 — Foundations + decisions.** Intake session with the friend (profile, targets, voice). Decide the segment (bank/finance vs multinationals vs gov). Build: SQLite schema, seed scripts, evidence-capture helper (a tiny CLI/form that makes logging a LinkedIn find take 20 seconds). Seed 30–50 companies.

**Week 2 — People + evidence.** Source 1–3 contacts for the top 20 companies; verify emails; collect evidence for the top 20 people. Build: email-pattern inference + verification integration.

**Week 3 — First sends.** Build: generator with the clarify/refuse contract + Gmail API draft-writer. Draft 10, review together with the friend (calibrate voice), send. This is the first real feedback.

**Week 4 — Cadence engine + full run.** Build: scheduler + reply detection (poll the mailbox) + follow-up drafting. Take the full list live at the volume ceiling.

**Weeks 5–6 — Learn.** Weekly reply-rate readout by template variant / evidence tier / contact type. Iterate the template, not the architecture.

**Success bar before any commercialisation:** ≥ 8–10% reply rate and **≥ 2 interviews or serious intro calls within 6 weeks**. If the pipeline can't do this for one motivated user with you hand-driving it, a SaaS wrapper won't fix it.

---

## 11. Explicitly NOT building in v1

- Web UI / dashboard (the previous repo's mistake — UI before proof)
- Auto-send or auto-follow-up without human approval
- LinkedIn scraping or browser automation
- Arabic template (phase 2, segment-dependent)
- Multi-tenant anything, payments, onboarding
- Apply-wide / ATS job-board ingestion (different product; the old plan conflated the two motions)

## 12. Risks to keep visible

- **Mailbox reputation** — one spam complaint from a UAE bank's HR inbox hurts every future send; the volume ceiling and verified-only rules exist for this.
- **UAE PDPL (data protection law)** — storing third parties' personal data (contacts, evidence) is fine at personal-use scale but needs a real basis + retention policy before commercialising. Budget for this at that point, not now.
- **Hallucinated personalization** — handled by §6, but stay paranoid in week-3 reviews.
- **The friend's follow-through** — the human-in-the-loop gate is also the failure point; if drafts sit unsent for a week, the cadence engine's schedule is fiction. Make "review drafts" a standing 20-min daily slot.

## 13. Open questions still needing your input

1. Which segment for the first 30–50 companies (banking / multinationals / gov)? — blocks week 1.
2. Python or TypeScript for the pipeline scripts? (Repo is currently Next.js/TS; scripts don't need to care.)
3. Does the friend use Gmail or Outlook? (Determines drafts API; both are fine, Gmail assumed.)
4. What's the friend's degree/background and target function? (Shapes the intro line and contact-selection.)
