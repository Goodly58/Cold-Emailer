# Company Universe Sourcing for UAE Emiratisation / Nafis Cold Outreach

**Research date:** 6 August 2026
**Deliverable:** per-source assessment + assembly recipe for a 100–500 company target list

---

## 0. Verification status — read this first

This research session's network tooling was heavily restricted: no pages could be fetched directly (all findings derive from search-engine-retrieved content). **Policy facts** (quota thresholds, fines, sector lists) are corroborated across multiple independent sources — high confidence. **Mechanics facts** (whether a list is paginated, login-walled, JSON-backed, exportable) are **UNVERIFIED** and individually flagged. ~30 minutes with an unrestricted browser re-checks the flagged items (see §6).

---

## 1. Nafis-derived sources

### 1.1 Nafis job board / "job offers" page

- **URL:** `https://nafis.gov.ae/job-offers`; portal root `https://nafis.gov.ae`. Programme owner: Emirati Talent Competitiveness Council (ETCC) — https://www.etcc.gov.ae/nafis/
- **What it would yield:** employer names attached to live vacancies — companies posting there are by definition Nafis-registered partners. The single highest-signal population for this tool.
- **Access:** multiple secondary sources state browsing requires UAE Pass sign-in with no anonymous path (https://emiratisationnafis.org/nafis-portal, https://emiratisationgate.org/nafis-portal/). Official onboarding PDFs (`https://nafis.gov.ae/files/examples/Nafis%20User%20Onboarding%20User%20Guide%20EN.pdf`, partner guide alongside) describe a *personalised* "Job Offered" feed, not a public directory.
- **Underlying JSON API:** UNVERIFIED — REQUIRES BROWSER. Native mobile apps exist on both stores (implies a REST backend possibly less gated than the web frontend); `nafis.gov.ae/job-offers` is search-indexed (weakly suggests a public server-rendered shell).
- **Legal:** `.gov.ae` portal behind a national identity gate. Scripted enumeration behind UAE Pass authentication is the legally and reputationally worst option on this list. **Do not build the product on this.** The correct route if wanted: a written data request to ETCC.
- **Verdict:** highest-value, lowest-obtainability. Out of scope for v1.

### 1.2 A "Nafis partners" directory

- **No public directory of Nafis partner companies exists**, as far as repeated targeted searching can establish. Aggregate counts only: ~32,000 companies hiring through the programme as of April 2026 (https://www.zawya.com/en/press-release/companies-news/nafis-signs-mou-with-du-the-uae-telecoms-provider-to-hire-500-emiratis-in-the-private-sector-qui2u7mi); ~30,000 companies employing ~154,000 Emiratis in the private sector as of Oct 2025 (https://gulfnews.com/uae/government/uae-private-sector-employs-154000-emiratis-1.500298213).
- **Verdict:** dead end for enumeration; useful for sizing.

### 1.3 Nafis Award winners — usable, cleanest Nafis-linked source

- **URLs:** https://nafisaward.etcc.gov.ae/en/homepage/ ; ETCC news at https://www.etcc.gov.ae/
- **Yields:** named companies with an implicit size band (large 1,000+; medium 500–999; small <500 — https://www.consultancy-me.com/news/6107/majid-al-futtaim-al-masar-and-kpmg-win-nafis-emiratisation-awards).
- **Confirmed names:** Majid Al Futtaim (large), Al Masar Recruitment (medium), KPMG (small) — first cycle; First Abu Dhabi Bank — first place large entities, 2025 (https://www.tradingview.com/news/reuters.com,2025-10-08:newsml_Zaw5ql22:0-pressr-fab-wins-first-place-at-nafis-award-2025-for-exceeding-emiratisation-mandate-among-large-entities/); ADNIC — insurance first place + Gold (https://gulfnews.com/business/corporate-news/adnic-honored-for-emiratisation-efforts-at-prestigious-nafis-awards-1.500300592); NBQ — 2024–25 cycle (https://menafn.com/1110325907/NBQs-Honored-With-Nafis-Award-For-20242025); third-cycle winners received by the President 8 May 2026 (https://www.thenationalnews.com/news/uae/2026/05/08/president-sheikh-mohamed-receives-latest-winners-of-nafis-awards/).
- **Extraction:** no export — press-release sweep per cycle (`"Nafis Award" winner/honoured` across Zawya, Gulf News, Aletihad, WAM, press wires + winners' own releases). ~20–60 names/cycle × 4 cycles.
- **Interpretation caveat:** winners are already compliant and over-performing — low "pressure" but **high hiring propensity** (see §5).

### 1.4 Nafis MoU signatories — usable, high-signal

Public, quantified Emirati-hiring commitments:

| Company | Commitment | Source |
|---|---|---|
| ADNOC | 13,500 private-sector jobs across its supply chain by 2028 | https://www.mediaoffice.abudhabi/en/energy/adnoc-partners-with-nafis-to-create-13500-private-sector-jobs-for-uae-nationals-by-2028/ |
| du | 500 Emiratis over five years | https://www.zawya.com/en/press-release/companies-news/nafis-signs-mou-with-du-the-uae-telecoms-provider-to-hire-500-emiratis-in-the-private-sector-qui2u7mi |
| etisalat by e& | 500+ Emiratis over five years (retail, CS, tech/IT) | https://www.eand.com/en/news/11-10-2022-eand-hire-500-uae-nationals.html |
| AD Ports Group | job openings under MoU | https://www.cbnme.com/logistics-news/nafis-signs-mou-with-ad-ports-group-to-offer-job-openings-for-emiratis-in-the-private-sector/ |
| Emirates Global Aluminium | best-practice sharing agreement | https://media.ega.ae/ega-signs-agreement-with-nafis-to-share-best-practice-in-emiratisation-with-the-private-sector/ |
| Huawei | Nafis International Programme for Emirati tech students | https://www.bignewsnetwork.com/news/279119665/etcc-partners-with-huawei-to-launch-2nd-edition-of-nafis-international-programme-for-emirati-tech-students |
| Ministry of Culture | 500 citizens in cultural & creative industries | https://moc.gov.ae/en/news/ministry-of-culture-partners-with-nafis-to-employ-citizens-in-the-cultural-and-creative-industries/ |

- **Extraction:** query `"MoU with Nafis" OR "partnership with Nafis" OR "signs with Nafis"` on zawya.com, khaleejtimes.com, wam.ae, mediaoffice.abudhabi, mediaoffice.ae, paginated 2021→2026. Expect 40–100 names. Legal: clean.

---

## 2. MoHRE / quota-derived universe

### 2.1 The quota rule itself — the universe is best **derived**, not listed

**No public register of quota-liable companies exists**, but the rule is precise enough to construct the universe from obtainable company attributes.

**Rule A — mainland companies with 50+ employees (MoHRE-registered):**
- 2% annual increase of Emiratis in **skilled** roles, semi-annual 1% targets due 30 June and 31 December (https://www.arabianbusiness.com/abnews/emiratisation-deadline-june-2026, https://www.gulftoday.ae/news/2026/06/29/deadline-for-firms-to-achieve-emiratisation-target-for-first-half-of-2026-ends-on-june-30)
- Cumulative target **10% of skilled workforce by end-Dec 2026** (https://mercans.com/glossary/emiratization/, https://reaphr.com/blog/emiratisation-2026-uae-quotas-fines-compliance)
- Non-compliance contributions: AED 96,000/head for 2024; AED 108,000/head for 2025 (https://www.mohre.gov.ae/en/media-center/news/2/1/2024/mohre-begins-implementing-emiratisation-targets-on-over-12000-private-companies-with-20-49-employees, https://gulfnews.com/amp/story/uae%2Fuae-firms-face-dh108000-fine-for-every-emirati-they-dont-hire-under-2025-targets-1.500369943)
- **CONFLICT — flag:** 2026 rate reported as AED 10,000/month (https://www.arabianbusiness.com/abnews/emiratisation-deadline-june-2026) vs AED 9,000/month (https://exiloz.com/news/uae-emiratisation-2026, https://maihrms.com/blog/emiratisation-requirements-nafis-2026). Verify with MoHRE before using either in copy.

**Rule B — companies with 20–49 employees in 14 designated sectors:** hire 1 Emirati in 2024, a second in 2025; 12,000+ companies notified. **The 14 sectors** (the sector filter): information & communications; finance & insurance; real estate; professional & technical activities; administrative & support services; education; healthcare & social work; arts & entertainment; mining & quarrying; transformative industries; construction; wholesale & retail; transportation & warehousing; accommodation & hospitality.

**Rule C — critical scoping filter: free zones are OUT.** Quotas apply to mainland, MoHRE-registered entities only. DIFC (own Employment Law No. 2 of 2019) and ADGM (Employment Regulations 2019) are outside MoHRE's remit, as are DMCC, JAFZA, etc. (https://rfsonshr.com/emiratisation/free-zone-emiratisation/, https://www.kayrouzandassociates.com/insights/difc-adgm-vs-mainland-employment-law-uae, https://www.remotepass.com/blog/free-zone-vs-mainland-hiring-rules-uae). Dual-licensed groups carry the obligation only on mainland headcount. → **Exclude or heavily de-rank free-zone-only entities. Highest-leverage filter in the pipeline.**

**Compliance context:** 95% of covered companies met H1 2026 targets; 190,000+ Emiratis employed (https://me.peoplemattersglobal.com/news/economy-policy/95percent-of-uae-private-sector-firms-meet-emiratisation-targets-employ-over-190000-emiratis-50973). The binding constraint for most targets is *sustaining* the 2%/yr ratchet — continuous hiring. Pitch accordingly.

### 2.2 Tawteen Partners Club / Emiratisation Partners Club

- **URLs:** https://mohre.gov.ae/en/media-center/news/13/7/2022/ministry-of-human-resources-and-emiratisation-reorganises-tawteen-partners-club-membership-requireme ; https://www.mohre.gov.ae/en/about-mohre/partners.aspx
- Membership: MoHRE Category 1 firms at ≥3× annual target with ≥30 extra Emiratis, OR Nafis partnership recruiting/training ≥500 Emiratis/yr (https://gulfmigration.grc.net/uae-mohre-reorganises-tawteen-partners-club-membership-requirements/). Benefits: up to 80% MoHRE fee discount, procurement priority, etc.
- **No public member roster found** (partners.aspx appears to list institutional partners — UNVERIFIED, page blocked). Thresholds imply a small elite list.
- **Action:** best candidate for a direct information request to MoHRE.

### 2.3 MoHRE company-information inquiry — **enrichment** tool

- MoHRE "Company Information Inquiry" (mohre.gov.ae + Smart App), reportedly free: company Category (1/2/3), **active worker headcount**, work-permit quota — by trade licence number (https://safeledger.ae/blog/how-to-check-company-category-in-uae, https://www.dbmsbusiness.ae/blog/mohre-enquiry-services-uae, https://mohreenquiryae.com/mohre-company-information/).
- **Why it matters:** headcount determines quota liability and is otherwise near-unobtainable. Trade licence numbers in → quota tier out.
- **UNVERIFIED — REQUIRES BROWSER** (all three sources are third-party SEO blogs). Verify headcount field, login requirement, rate limits, T&Cs. **Do not assume bulk automated querying is permitted.**

### 2.4 MoHRE press releases

Aggregate-only ("95% complied", "12,000 notified") — individual companies are never named outside the Nafis Award channel. **Dead end for enumeration.**

---

## 3. Other enumerable sources

### 3.1 Ru'ya Careers UAE exhibitor roster — **best single ready-made list**

- **URLs:** https://www.ruyacareers.ae/ ; https://10times.com/careers-uae ; past exhibitor manual https://exhibitors-dwtc.exhibitoronlinemanual.com/ruya-careers-uae-2025/Exhibitor
- **Yields:** company names + sector + self-selected intent — every exhibitor **pays money specifically to hire Emiratis**. Strongest qualification signal short of a live vacancy.
- **Size:** 180+ organisations at the 2025 edition (https://www.mediaoffice.ae/en/news/2025/september/22-09/ruya-careers-2025-kick-off-tomorrow); next edition 28–30 Sep 2026, DWTC.
- **Names from press:** DEWA, RTA, Abu Dhabi Police HQ, ADCB, Amazon, PwC, Emirates, Majid Al Futtaim; sponsors DP World (Platinum), ADIB (Gold), ENOC (Silver); first-timers Emirates Flight Catering, Aldar, Al Tayer Group, Dubai Academic Health Corp, Adidas; Pod exhibitors AI71, Liva Insurance, Buro Happold, Khansaheb, MedNet, Munich Re, Taaleem (https://www.zawya.com/en/press-release/companies-news/ruya-2025-introduces-pod-exhibitors-opening-new-pathways-for-emirati-talent-into-key-industries-c3ccxd9x).
- **Extraction:** UNVERIFIED — REQUIRES BROWSER (WAF-blocked). Event directories are typically JSON-backed; check `/exhibitor-list` + XHR. No-scrape fallback: launch press releases name ~25; the printed show directory / exhibitor manual is usually a downloadable PDF.
- **Filter:** DEWA, RTA, Abu Dhabi Police are **government entities** — not quota-subject; tag entity type and segment separately.

### 3.2 ADX and DFM listed companies

- **URLs:** https://www.adx.ae/all-equities ; https://www.dfm.ae/the-exchange/market-information/listed-securities/equities ; mirror https://stockanalysis.com/list/abu-dhabi-securities-exchange/
- ADX ~154 listed; DFM ~69 equities (both UNVERIFIED at primary source). Yields name, ticker, sector, market cap, IR contacts. Market cap proxies headcount.
- **Premise correction:** listed ≠ automatically quota-subject — only mainland MoHRE-registered headcount counts; some listings are holding companies or sit in DIFC/ADGM. ~220 combined names are a seed pool; verify domicile per company.

### 3.3 Semi-government groups and their subsidiaries

- **Mubadala** (https://www.mubadala.com): Aldar, EGA, FAB, G42, Masdar, Yahsat. **ADQ** (https://www.adq.ae/portfolio): ~250 subsidiaries — **FLAG, UNVERIFIED single source:** possible Jan 2026 consolidation into "L'IMAD Holding" (https://olam.business/adq); verify before using in copy. **Dubai Holding** (https://dubaiholding.com/en). Add manually: Emirates Group, ENOC, DP World, ADNOC group, e&, Etihad, Emaar, Al-Futtaim, Al Tayer.
- Curated, browsable subsidiary lists; these groups face the most visible Emiratisation expectations. Clean.

### 3.4 Business registries (trade licence numbers → §2.3 enrichment)

- National Economic Register (https://u.ae/en/information-and-services/business/important-digital-services/national-economic-register); Invest in Dubai licence search (https://app.invest.dubai.ae/search-license); Dubai Business Directory (https://www.investindubai.gov.ae/en/dubai-business-directory-search); MoET (https://www.moet.gov.ae/en/w/enquire-about-commercial-companies%C2%A0-licence)
- Yield licence number, activity codes, status. **No headcount, no contacts. Lookup services, not bulk export** — cannot enumerate "all mainland 50+ companies" (https://dnbuae.com/how-to-find-company-information-in-the-uae-a-complete-guide-for-investors-and-businesses/).
- Commercial alternative: CompanyData.com (~752,890 UAE entities — https://companydata.com/database/uae-dubai/), D&B UAE firmographics with employee bands. Paid; diligence provenance. **Role: enrichment, not sourcing.**

### 3.5 Commercial job boards as a Nafis-portal proxy

- Bayt Emiratisation hub (https://www.bayt.com/en/employers/emiratisation/), Indeed AE, LinkedIn — companies advertising "UAE National"/"Emirati" roles = live intent, the closest legitimate substitute for the gated Nafis board.
- **LinkedIn and Indeed prohibit scraping in their ToS** — official APIs or manual review only. Real constraint.

### 3.6 Banking / insurance — separate, stricter regime (CBUAE)

- Central Bank of the UAE runs its own Emiratisation rules, distinct from MoHRE's. End-2025: 23,364 nationals in banking/finance/insurance; sector rate 31%; 2,901 hired in 2025 vs 1,816 target (https://economymiddleeast.com/news/cbuae-boosts-emiratisation-rate-to-31-percent-across-banking-financial-and-insurance-sectors/, https://gulfnews.com/business/banking/cbuae-reports-surge-in-emiratisation-across-financial-sectors-exceeding-2025-targets-1.500515464). 2022–2026 strategy: 30% by 2026 (https://taxadepts.com/uae-emiratisation-2025-banking-finance-growth). 2027–2030: 50–60% at insurers by 2030 (https://www.khaleejtimes.com/uae/new-emiratisation-goal-50-60-insurance-sector-2030).
- **CONFLICT — flag:** a "45% 2026 banking target" appears in one result; irreconcilable with the 30% figure. Treat 45% as wrong until proven.
- CBUAE licensed-institutions register ≈ 50–60 banks + ~60 insurers: bounded, public, highly targetable (UNVERIFIED — centralbank.ae unreachable).
- **Why this sector ranks first:** highest quota intensity, dedicated regulator, published targets, and firms that most reliably publicise Emiratisation wins.

---

## 4. Source summary table

| # | Source | Yields | Enumerable? | Freshness | Legal | Priority |
|---|---|---|---|---|---|---|
| 1.1 | Nafis job board | Employers w/ live vacancies | No — UAE Pass gated (UNVERIFIED) | Live | Poor if scraped | Skip v1 |
| 1.2 | Nafis partners directory | — | Does not exist publicly | — | — | Dead end |
| 1.3 | Nafis Award winners | Names + size band | Yes, press sweep | Annual | Clean | **High** |
| 1.4 | Nafis MoU signatories | Names + commitments | Yes, press sweep | Rolling | Clean | **High** |
| 2.1 | Quota rule (derivation) | Filter criteria | Defines universe | 2026 current | Clean | **Critical** |
| 2.2 | Tawteen Partners Club | Elite over-performers | No public roster | Unknown | Clean | Request from MoHRE |
| 2.3 | MoHRE company inquiry | Category + headcount | Lookup only (licence no.) | Live | UNVERIFIED T&Cs | **High if verified** |
| 2.4 | MoHRE press releases | Aggregates only | No | Rolling | Clean | Dead end |
| 3.1 | Ru'ya exhibitors | ~180 names + sector + intent | Likely (UNVERIFIED) | Annual (Sep) | Clean | **Highest** |
| 3.2 | ADX + DFM listings | ~220 names + sector + size | Yes | Daily | Clean | **High** |
| 3.3 | Semi-gov portfolios | Subsidiary lists | Yes, manual | Rolling | Clean | Medium-High |
| 3.4 | Business registries | Licence no., activity | Lookup only, no bulk | Live | Clean | Enrichment |
| 3.5 | Job boards | Live Emirati-role intent | Partly; ToS-restricted | Live | **ToS risk** | Medium |
| 3.6 | CBUAE licensed institutions | ~110 banks/insurers | Yes (UNVERIFIED) | Rolling | Clean | **High** |

---

## 5. Recommendation: assembling a 100–500 company universe

### 5.1 Reframe the ranking axis: propensity beats pressure

A company under maximum *pressure* (behind quota, facing AED 108k/head) often has no Emirati hiring function and a defensive posture. A Nafis Award winner is over-compliant precisely because it runs a permanent Emirati talent pipeline with a named Emiratisation lead and budget. **For a job seeker, propensity-to-hire beats pressure-to-hire.** Composite score:

```
score = 0.30 × quota_liability      (mainland + headcount tier + designated sector)
      + 0.30 × demonstrated_intent  (Ru'ya exhibitor, Nafis MoU, award winner,
                                     live "UAE National" posting)
      + 0.20 × absorption_capacity  (headcount / market cap)
      + 0.20 × regime_intensity     (CBUAE-regulated = max; 14 sectors = high)
      − hard_exclusions             (free-zone-only domicile; government entity;
                                     headcount < 20)
```

### 5.2 Build order

**Phase 1 — seed, ~250 raw names, no scraping (1–2 days):** ADX + DFM listings (~220); CBUAE licensed banks/insurers (~110, heavy overlap); semi-gov portfolios (~60).
**Phase 2 — intent overlay, ~200 names (2–3 days):** Ru'ya exhibitor roster (~180; press releases + show directory PDF as fallback); Nafis MoU + Award press sweep (~60–100).
**Phase 3 — dedupe, filter, enrich:** move government entities to a separate public-sector segment; drop free-zone-only entities (**highest-leverage filter**); attach trade licence numbers (§3.4) → resolve MoHRE Category + headcount via §2.3 *if verified permitted* → score and rank.

**Expected yield: 280–350 unique companies**, ~150 in a high-confidence top tier.

### 5.3 The real bottleneck: contacts

None of these sources provide contact data — company names and sectors at best. Plan explicitly: careers-page and `careers@`/`hr@`/`emiratisation@` role addresses (role-based, cleanest under PDPL); named Emiratisation/TA leads via LinkedIn (manual or official API only); Ru'ya itself is where these people physically are — arguably a better channel than email for the top tier.

### 5.4 Legal posture (not legal advice — obtain UAE counsel before commercial launch)

- UAE PDPL, Federal Decree-Law No. 45 of 2021, in force 2 Jan 2022 (https://securiti.ai/uae-personal-data-protection-law/, https://uaelegislation.gov.ae/en/legislations/1972/download). Recognises **legitimate interest** without prior consent (GDPR-style) — what makes B2B cold outreach tenable; sources disagree on marketing-consent scope (https://imperiumglobalmedia.com/uae-pdpl-compliance-for-digital-marketing/). Counsel should adjudicate — it shapes the product.
- Always: identify the sender clearly; working opt-out in every message; prefer role-based addresses over named individuals; never use data from behind the UAE Pass gate; honour robots.txt/ToS (LinkedIn, Indeed prohibit scraping).
- A UAE-national job seeker contacting employers about Emiratisation roles is about as sympathetic as cold outreach gets. Keep it one-to-one, relevant, low volume — high-volume blasting forfeits that and is where enforcement risk lives.

---

## 6. Open items requiring an unrestricted browser

1. **§2.3 MoHRE company inquiry** — does it return headcount publicly; are automated queries permitted? (Sharpens the whole targeting model.)
2. **§3.1 Ru'ya exhibitor directory** — extractable list route or downloadable directory PDF?
3. **§1.1 Nafis job board** — anonymously viewable? App-facing JSON backend? (And whether reaching it is *appropriate* at all.)
4. **§2.2 Tawteen Partners Club roster** — check partners.aspx; else file a MoHRE request.
5. **§2.1 2026 fine rate** — AED 9,000 vs 10,000/month; resolve before any customer-facing copy.
6. **§3.3 ADQ → "L'IMAD Holding"** consolidation — single unverified source, material entity change.
7. **§3.6 CBUAE 2026 banking target** — 45% conflicts with 30%; treat 45% as wrong until proven.
