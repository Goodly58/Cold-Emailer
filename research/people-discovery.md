# UAE People-Discovery Playbook — Research Report

## 0. Method and verification caveat (read first)

The research session's egress policy blocked all direct page loads, so **verification is search-index-level, not page-load-level**: each URL was confirmed to exist and be indexed, and field-level claims were corroborated from ≥2 independent sources where possible. Anything not corroborated is marked **UNVERIFIED**. Before shipping any connector against these, load each URL once in a browser and confirm the DOM.

---

## 1. The direct answer to the founder's framing

The London triad is **LinkedIn + Companies House + FCA Register**. The UAE mapping is asymmetric — one leg strong, one partially replicated, one missing:

| London leg | UAE equivalent | Verdict |
|---|---|---|
| **LinkedIn** | LinkedIn, via search-engine SERPs (`ae.linkedin.com`) | **Fully equivalent, arguably better** — UAE professionals are heavy LinkedIn users and the `ae.` subdomain gives free geo-filtering London doesn't have |
| **FCA Register** (people, with roles) | **DFSA Public Register – Individuals** (DIFC) + **FSRA Financial Services Register** (ADGM) | **Equivalent but ~2% of the economy.** Only DIFC/ADGM-authorised financial firms. CBUAE and SCA registers list *institutions*, not individuals |
| **Companies House** (officers of every company) | **DIFC Public Register** + **ADGM Public Register** only | **Partially replicated, only inside two free zones.** There is **no UAE-wide officer register.** Mainland (DED/NER), DMCC, JAFZA, RAKEZ etc. expose *company* records without officers |

**The compensating asymmetry** — three source classes London doesn't have, which are *better* than Companies House for this product:
1. **Emiratisation infrastructure** — companies publish named Emirati employees and Emiratisation leads because it is a reputational KPI.
2. **PR-saturated business media** — Zawya has a literal `people-in-the-news` press-release feed; ITP trade titles run weekly named appointment roundups down to *manager* level.
3. **Mega-conference speaker corpora** — ADIPEC publishes 1,800+ named speakers with employers annually, plus the SPE technical-paper corpus naming working-level ADNOC engineers.

For a **junior/mid person at a multinational's Dubai office, the UAE is *easier* than London** — trade press and conference agendas name mid-level people at a rate UK media doesn't.

---

## 2. Free-zone and official registers

### 2.1 DIFC Public Register — the best "Companies House equivalent"
- https://www.difc.com/business/public-register — yields status, location, legal structure, registration number, **director names**, **shareholders**. Free. Covers **all** DIFC entities (law firms, consultancies, family offices, HQs — not just finance).
- Senior only (board/shareholder layer; may be nominee/group directors). Name-based lookup, **not enumerable**; deeper detail (Certificate of Incumbency) is paid. Clean. Field list UNVERIFIED at DOM level.

### 2.2 ADGM Public Register
- https://www.adgm.com/public-registers → live search https://newreg.adgm.com/s/search-results — yields company details + **director names with appointment dates** (dates = a "recently appointed" personalisation hook), filing history. Free, clean. Senior only. Director-field UNVERIFIED at DOM level.

### 2.3 DFSA Public Register — Individuals ⭐ (the FCA analogue)
- Individuals https://www.dfsa.ae/public-register/individuals · Firms https://www.dfsa.ae/public-register/firms
- **Enumerable firm URL pattern:** `https://www.dfsa.ae/Public-Register/Firm?F=F003333` — numeric firm ID, **iterable**. Highest-structure UAE endpoint.
- Yields every Authorised Individual (current **and past**) per firm with role/function (SEO, Compliance Officer, MLRO, Finance Officer, Licensed Director) — exactly "head of department" people. Clean.

### 2.4 DMCC — **do not use for outreach**
- Directors/shareholders NOT public (court order only), and the directory terms **expressly forbid** using it for email or telephone marketing. The one unambiguous prohibition found. **AVOID.**

### 2.5 JAFZA, RAKEZ, RAK ICC, SHAMS, Meydan, IFZA, DAFZA
- No public officer registers. Third-party aggregator lists (yello.ae, Scribd PDFs) have murky provenance — do not ingest. **People-discovery dead end; fall through to Tier 2/3.**

### 2.6 National Economic Register (mainland)
- Licence status/activities only; ownership detail requires a formal extract request. No people for free.

### 2.7 Open-data portals
- Dubai Pulse and Abu Dhabi Open Data (Bayanat) publish business-registration datasets, bulk-downloadable — useful for company-universe building and domain resolution, not named people. UNVERIFIED for officer names.

---

## 3. Listed-company disclosures

### 3.1 ADX — enumerable per-ticker board pages ⭐
- Template (verified indexed for ADCB, ADA, ADSB, ADPORTS, GCEM): `https://www.adx.ae/main-market/company-profile/shareholder-and-board?symbols=<SYMBOL>`; ticker universe at https://www.adx.ae/all-equities → complete crawl frontier. Board + major shareholders. Likely JS-rendered (budget for headless browser). UNVERIFIED whether exec management below board appears.

### 3.2 DFM
- Per-company pattern `https://www.dfm.ae/the-exchange/market-information/company/<TICKER>/...` (confirmed for DU, DAMAC, `top-shareholders` subpage). Board-page equivalent UNVERIFIED.

### 3.3 The real prize: SCA continuous-disclosure obligations
- SCA's Corporate Governance Code mandates annual Integrated Reports and **continuous disclosure of "board or senior management changes"** → the DFM/ADX disclosure feeds are a **structured, dated, mandatory stream of senior-appointment announcements** — the best ≤90-day freshness corroborator for listed companies. Annual/governance reports typically list "Senior Executive Management" one level below board (UNVERIFIED at document level; sample 5 before relying).
- Sources: https://www.tamimi.com/news/sca-freshens-up-the-corporate-governance-code-for-uae-listed-companies/, https://www.sca.gov.ae/en/corporate-governance.aspx

---

## 4. Media & PR — strongest single channel for MID-LEVEL people

**UAE media names people well below C-level, routinely, with name + exact title + employer.**

- **Zawya "People in the News"** ⭐⭐ https://www.zawya.com/en/press-release/people-in-the-news/ — dedicated, dated, paginated appointments feed from company press releases; verified reaching GM / Business Director / SVP level. Syndicated to Reuters/TradingView so items are re-findable. Clean.
- **ITP trade titles** ⭐⭐ — pattern `/<title>/people/appointments/`: Hotelier Middle East (verified weekly roundups naming GMs, marketing, PR, culinary leads — genuine mid/junior), Construction Week (verified), likely Campaign ME, Caterer ME, Logistics ME (UNVERIFIED). RSS/tag-scrapable. Clean.
- **Executive Moves** https://executive-moves.com/ — per-company leadership + move history, MENA-wide, C-suite/board **only** (senior scenario only). Clean.
- **WAM (Emirates News Agency)** https://wam.ae/ — senior appointments at government/semi-gov/national champions. Highest-authority, dateable corroboration for Emirati and gov-sector targets. Clean.
- Also: MENews247 appointments category (corroboration only), Gulf Business `new-appointment` tag. **The National has no dedicated appointments column** — don't build against it expecting one.

---

## 5. Events

- **ADIPEC** ⭐⭐ https://www.adipec.com/conferences/2026-speakers/ — 1,800+ speakers, name + exact title + company; moderators and session chairs are routinely director/manager grade. 2–5 Nov 2026.
- **SPE / OnePetro technical papers** ⭐⭐ https://onepetro.org/SPEADIP/25ADIP/conference/25ADIP — **the best junior/mid source in the country** (energy only): paper authors are working engineers and team leads with employer affiliation, findable by technical topic, and citing someone's own paper is the strongest personalisation hook that exists. Abstract metadata is free and sufficient. Resolve `Surname, Initial` to full names via LinkedIn.
- **GITEX** — marquee speakers are global C-suite; mid-level lives in the long tail of track agendas. Exhibitor lists → tech-vertical company universe.
- **Dubai FinTech Summit** https://dubaifintechsummit.com/ — 300+ speakers, senior banking/fintech; mid-level as panellists.
- **10times.com** mirrors speaker lists in a more scrapeable format — partial coverage; fallback only.
- **Emiratisation career fairs** ⭐ — Tawdheef × Zaheb (ADNEC, 17–19 Nov 2026), Ru'ya (28–30 Sep 2026), Zayed University Career Fair (145+ orgs verified incl. ADNOC, KPMG, ADCB, FAB, DIB). Exhibitor lists = pre-qualified companies actively hiring Emiratis; booth staff = TA/Emiratisation leads.

---

## 6. Job postings as a people source

**Job ads are a strong *role and reporting-line* source and a weak *name* source.** No UAE portal systematically names the hiring manager. Reporting lines appear as titles ("reporting directly to the Managing Director"). Verified example of the pattern that works: Standard Chartered's "Head of Emiratisation, UAE (UAE National)" LinkedIn ad — it names no person but **proves the role exists**, converting an unbounded search into a two-term query.

**Correct architecture:** job ad → extract the hiring-manager/team *title* → resolve to a **name** via §7 SERP triangulation. Never expect the ad to give the name.

---

## 7. Search-engine triangulation — live-tested, works

Four real query shapes were tested; all returned named individuals:

| Test | Query shape | Result |
|---|---|---|
| Senior, UAE bank | `Emirates NBD "Head of" Dubai` on `ae.linkedin.com` | ✅ Named heads incl. Wholesale Banking, Asset Management CEO |
| Senior, named function | `"First Abu Dhabi Bank" "Head of Talent Acquisition" OR "Head of Human Resources"` | ⚠️ Returned FAB's Head of HR — **based in London.** Geography false positive |
| Mid, multinational Dubai | `"Microsoft" "United Arab Emirates" "Customer Success Account Manager"` on `ae.linkedin.com` | ✅ Exact junior/mid target, first-page hit |
| Mid, UAE bank | `"Emirates NBD" "Relationship Manager"` on `ae.linkedin.com` | ⚠️ Weakest — drowned in job listings and same-title people at other banks |

**Operational rules:**
1. **Always restrict to `ae.linkedin.com`** — free geo-filter; unrestricted linkedin.com leaks London/Cairo/Karachi.
2. **Multinational + distinctive internal title = high precision** (company-specific taxonomy acts as a near-unique key).
3. **Bank + generic title = low precision** — go senior ("Head of X") or add a niche qualifier (segment, product, desk).
4. **Every SERP hit needs a geography check and freshness check** before entering the draft queue.
5. Reading SERPs is ToS-clean; it is not automation against LinkedIn. Keep the hard no-crawl rule.

---

## 8. Other sources

### 8.1 Company Emiratisation pages ⭐⭐⭐ — highest-value find for this product
- **Emirates NBD "Meet our people"** https://www.emiratesnbd.com/en/careers/join-emirates-nbd/meet-our-people — names real employees across the range: Group Head of ALM, Head of Client Relationships (Business Banking), **Scrum Master (Group IT)**, **Assistant Manager (Deskside Support)**. Companion Emiratisation-strategy and graduate-programme pages.
- **Why this beats every register:** names **junior and mid Emirati employees**, on the company's own domain, published deliberately for recruitment. Simultaneously a contact source, a warm-intro source, and an evidence source — and self-selecting for exactly the companies this product targets.
- **Build note:** make "does this company have an Emiratisation / meet-our-people / UAE-nationals careers page?" a **first-class Tier-2 check**. Crawl for `/careers/emiratisation*`, `/careers/*uae-national*`, `/meet-our-people`, `/emiratisation-strategy`.

### 8.2 Award and power lists
- Forbes Middle East Lists (https://www.forbesmiddleeast.com/lists/) — CMO list: 101 leaders, 49 UAE-based, **13 Emirati executives — nationality-tagged**, which finds Emirati seniors specifically. Also Top Tech Leaders, Top CEOs. Finance ME Top 30 GCC CFOs; Hotelier Power List. Senior only, clean.

### 8.3 Employer-quality lists — company selection, not people
- Great Place to Work UAE 2026 (170 companies), LinkedIn Top Companies UAE. Zero named people; seed the company queue only.

### 8.4 Chambers and professional bodies
- Dubai Chambers directory (245k+ members — companies only). AmCham Dubai committees, **CFA Society Emirates board & committees** (https://cfaemirates.com/board-committees/) — committee volunteers are usually VPs/Directors at banks and asset managers with employer stated: small but high-precision finance list. UNVERIFIED at page level; check manually. Same pattern likely: ICAEW/ACCA UAE, IIA UAE, ACAMS, CIPD ME.

### 8.5 DIFC Courts judgments — do not build
- Judgments name employees vs employers, but since the 9 Oct 2025 Practice Direction employment cases publish anonymised, and someone in litigation with their employer is a terrible outreach target anyway.

### 8.6 Tenders — no evidence of named contacts; deprioritise.

### 8.7 Podcasts — evidence source, not discovery source
- Business Extra (The National), Beyond the Skyline etc. Guests skew founder/CEO. Use for personalisation depth on an already-identified senior target ("heard you on Business Extra discussing X") — a genuinely strong hook.

### 8.8 Company social (LinkedIn/Instagram/X)
- Employee-spotlight and Emiratisation-milestone posts occasionally name individuals; mainly a **freshness-corroboration layer** for the ≤90-day rule, not discovery. UNVERIFIED as a discovery source.

---

## 9. RANKED PLAYBOOK A — SENIOR PERSON (e.g. head of department at a UAE bank)

Given company **C** and function **F**, stop at the first tier yielding a name + corroborating source:

1. **C's own leadership/management page** — resolves for nearly all banks and listed cos.
2. **ADX board page** (`...shareholder-and-board?symbols=<TICKER>`) / **DFM** equivalent — board level.
3. **Annual report / SCA governance report** — "Senior Executive Management," one layer below board. Best senior-below-board list that exists.
4. **DFSA Individuals register** (DIFC-regulated) / **FSRA register** (ADGM) — definitive for compliance/finance/risk functions.
5. **DIFC / ADGM company register** — directors + shareholders; beware nominee/group directors.
6. **SERP triangulation** `"<C>" "Head of <F>" site:ae.linkedin.com` — **verify geography** (the FAB/London trap).
7. **Zawya People in the News** — best freshness signal.
8. **WAM** — highest authority for Emirati & gov targets.
9. **Trade-press appointments feed** matching C's sector.
10. **Forbes ME / power lists** — finds Emirati seniors specifically.
11. **Executive Moves company page** — C-suite only.
12. **Conference speakers** (ADIPEC, FinTech Summit) — best *personalisation* payload.

For a UAE bank, tiers 1–4 resolve nearly all cases; 7–8 supply freshness corroboration.

## 10. RANKED PLAYBOOK B — JUNIOR/MID PERSON (e.g. team manager at a multinational's Dubai office)

Registers are useless here. The winning move: **establish the exact internal title from a job ad, then resolve the name via geo-restricted SERP.**

1. **C's Emiratisation / "meet our people" / UAE-nationals careers page** ⭐ — named junior + mid employees with exact titles, plus the Emiratisation lead. Highest-value source in this report.
2. **C's UAE job ads → extract reporting-line title** (Bayt, career site, ae.linkedin.com/jobs) — titles, never names; a title-extraction step.
3. **SERP with the exact title from step 2** ⭐ `"<C>" "<exact internal title>" site:ae.linkedin.com` — verified working (Microsoft CSAM Dubai, first page). Precision collapses on generic bank titles; add product/segment qualifiers.
4. **Trade-press appointments feeds** (Hotelier, Construction Week, Zawya people feed) — verified to reach genuine mid/junior titles.
5. **SPE/OnePetro paper authors** (energy/technical only) ⭐ — cite their own paper; unbeatable hook.
6. **Conference agenda long tail** (not marquee lists) — panellists/moderators/track chairs are manager/director grade.
7. **Professional-body committee rosters** (CFA Emirates, AmCham committees) — UNVERIFIED, check manually first.
8. **Emiratisation career-fair exhibitor lists** (Tawdheef, Ru'ya, ZU fair) — company-universe + intent; names only via session speakers/post-event coverage.
9. **Company social employee spotlights** — corroboration only.
10. **Manual LinkedIn (human, last resort)** — keep the hard no-crawl rule.

**Do not attempt for mid-level:** DIFC/ADGM/DFSA/FSRA registers, ADX/DFM, NER, WAM, Executive Moves, Forbes lists — all structurally senior-only. **Never** use the DMCC directory at any tier.

---

## 11. Legal and ToS notes (condensed)

- **AVOID — DMCC Business Directory:** terms expressly forbid use for email/telephone marketing.
- **CAUTION — LinkedIn:** SERP reading fine; crawling linkedin.com is a ToS breach + ban risk. The Tier 3/Tier 4 split in PLAN.md is the correct architecture.
- **CAUTION — third-party company lists** (yello.ae, Scribd "JAFZA databases", ZoomInfo/SignalHire/ContactOut extracts): unknown provenance, likely scraped, stale, possible unlawful redistribution. Do not ingest.
- **UAE PDPL (45/2021): Executive Regulations issued 2026 — enforcement is live.** Data subjects have an **express right to object to direct-marketing processing** → build a hard, permanent suppression list; keep per-contact source provenance (the evidence table's source URLs are the compliance artefact — mandatory, not nice-to-have). No confirmed "publicly available data" exemption — do not assume one.
- **TDRA unsolicited-communications policy (RUEC):** consent + sender ID + unsubscribe for commercial e-marketing; penalties cited to AED 10m. Applicability to *individual job-seeking correspondence* is contested and UNVERIFIED — likely aimed at bulk commercial senders, but get UAE counsel before scaling. Meanwhile: real sender identity, low volume, human-approved, honour opt-outs instantly. The no-auto-send design is also the best legal defence.
- **Clean, no caveats:** DIFC/ADGM/DFSA/FSRA registers; ADX/DFM disclosures; WAM; Zawya press releases; trade-press editorial; conference speaker pages; OnePetro metadata; company careers/Emiratisation pages.

---

## 12. Build recommendations (three concrete changes to PLAN.md §3)

1. **Add the Emiratisation-page check as a first-class Tier-2 step, ahead of generic leadership pages** — the only verified free source that reliably reaches the junior tier, and it exists because of the same quota structure the product's thesis rests on.
2. **Add the `title-extraction → SERP-resolution` two-step for the mid-level path**, with a mandatory geography check on every SERP hit.
3. **Promote the two enumerable endpoints to structured connectors:** `dfsa.ae/Public-Register/Firm?F=<ID>` and `adx.ae/main-market/company-profile/shareholder-and-board?symbols=<TICKER>` (frontier: adx.ae/all-equities). Everything else is name-lookup or editorial-feed shaped.

**Before implementing:** load every URL once from an unrestricted environment and confirm the DOM — all field-level claims are corroborated from search snippets, not page loads.
