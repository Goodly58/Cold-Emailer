# Job Search Engine — Plan

A tailored, high-conversion job search system with three motions:

1. **Apply wide** — find every relevant open role, tailor materials fast, apply the same day.
2. **Cold outreach** — identify the best companies and email the actual decision-makers with highly personalized notes.
3. **Emirati advantage (UAE)** — systematically target employers where Emiratisation quotas and Nafis subsidies make you a *financially advantaged* hire, and say so explicitly in outreach.

Everything is tracked in the dashboard in this repo.

---

## Key decisions (assumptions — change any of these)

| Decision | Choice | Why |
|---|---|---|
| Apply automation | **Assisted apply**, not bots | Auto-apply bots violate LinkedIn/Indeed/Workday ToS, get accounts banned, and produce low-quality generic applications. The system instead finds roles (including via legitimate public ATS APIs), tailors materials, and queues one-click-ready applications. |
| Email sending | **Draft-first** | Emails are composed in the dashboard and opened pre-filled in Gmail for review before sending. Job outreach converts on personalization, not volume; keeping sends manual protects your Gmail reputation and lets you catch errors. |
| Stack | Next.js + JSON file store | One command to run, zero native deps, data lives in `data/db.json` (easy to back up; set `DB_PATH` to store elsewhere). |
| Targeting | UAE-first, global second | Emiratisation makes you structurally advantaged in the UAE private sector; global/remote roles run as a secondary pipeline. |

## Phase 1 — Dashboard (built)

- **Pipeline** — kanban for applications: Found → Tailored → Applied → Follow-up → Interview → Offer / Rejected, with next-action dates.
- **Companies** — target-company tracker with tier (Dream / Target / Backup) and an Emiratisation-priority flag.
- **Contacts** — decision-makers per company (name, role, email, LinkedIn), with outreach status.
- **Outreach** — template-driven email composer with merge fields, one-click "Open in Gmail" (pre-filled compose), copy-to-clipboard, and a send/reply/follow-up tracker.
- **Templates** — cold-email library including Emiratisation-angle variants and follow-up sequences.
- **Job import** — pull live openings straight from companies' public ATS feeds (Greenhouse / Lever board APIs — these are public, documented, ToS-clean) into the pipeline.
- **UAE playbook** — reference page: how Emiratisation quotas and Nafis work, and how to weaponize them in outreach.

## Phase 2 — Sourcing at scale (next)

- Expand ATS import: Ashby, Workable, SmartRecruiters public endpoints; saved company slugs re-checked on demand ("what's new since last check").
- UAE-specific sources worked manually but tracked in-app: Nafis portal (nafis.gov.ae), MoHRE, LinkedIn "Emiratisation" keyword searches, bank/telco early-career and Emiratisation program pages.
- Contact discovery workflow: for each Dream/Target company, identify 2–3 people — the hiring manager for your function, the Emiratisation/talent-acquisition lead, and one senior exec — via LinkedIn search; log them in Contacts. (Email patterns: most UAE corporates use first.last@domain; verify with a free verifier before sending.)

## Phase 3 — Outreach engine

- Cadence per contact: Day 0 intro → Day 3 follow-up → Day 8 breakup. Tracked per-outreach in the dashboard.
- Volume: 10–20 *tailored* emails/day beats 200 generic ones, and stays far under Gmail's spam heuristics.
- Every UAE email to HR/TA leads the Emiratisation angle (see playbook); every email to hiring managers leads with role-specific proof of competence and mentions Emirati status as a closing advantage.

## Phase 4 — Optional upgrades

- Gmail API integration to create real drafts / track replies automatically (needs OAuth setup).
- LLM-assisted per-role CV summary + cover letter generation from a master CV.
- Deploy dashboard to Vercel with auth so it's reachable from your phone.

---

## The Emirati advantage — why this works

- **MoHRE Emiratisation targets**: mainland private companies with 50+ skilled workers must grow Emirati share of skilled roles ~2%/year (10% target by 2026). Missing the target costs roughly AED 8–9k **per month per unfilled position** (rising each year). Companies with 20–49 employees in 14 designated sectors must also hire 1–2 Emiratis. *Hiring you saves them real money.*
- **Nafis**: government top-ups for Emiratis in the private sector — salary support, pension subsidy paid on the employer's behalf, child allowance, and training programs. *You cost the employer less than an equivalent expat hire.*
- **Banking/insurance/telecom** have their own regulator-driven Emiratisation points systems (CBUAE) — these sectors actively compete for Emirati talent.
- Figures above change yearly — verify current numbers on mohre.gov.ae and nafis.gov.ae before quoting them in an email.

**Priority targets** (seeded in the dashboard): FAB, Emirates NBD, ADCB, Mashreq, ADIB, e&, du, ADNOC, Mubadala, ADIA, ADQ, DP World, Masdar, TAQA, Emirates Group, Etihad, G42/Core42/Presight, Careem, talabat, noon, Emaar, plus MNC regional HQs (Microsoft, Google, Amazon, McKinsey/BCG/Bain, Big Four) — all quota-liable or Emiratisation-active.

## Operating rhythm

- **Daily (45 min)**: import/scan new roles → move cards → send 10–15 queued outreach emails → log replies.
- **Weekly**: add 5 new target companies + 10 new contacts; review reply rates by template; prune dead threads.
- **Metrics that matter**: applications/week, outreach sent, reply rate (aim >10% with good personalization), interviews booked.
