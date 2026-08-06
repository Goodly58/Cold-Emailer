# LinkedIn Data Access Landscape — 2026

**Prepared for:** Cold-Emailer / Emirati Cold-Outreach Engine
**Need being solved:** occasional, low-volume lookups (a few hundred UAE-company employee profiles, refreshed rarely) to keep a contact DB current.
**Date:** 2026-08-06

---

## 0. Verification caveat — read this first

This environment's network gateway blocked direct HTTP to `linkedin.com`, `github.com`, `index.commoncrawl.org`, and returned 403 to `WebFetch` on most vendor and news domains. So I could not empirically test the auth-wall, robots.txt, or Common Crawl coverage. Where a claim rests only on a search-result snippet from a vendor blog or SEO content farm, I mark it **[low-confidence]**. Court records, GitHub API results, and PyPI were directly verifiable and are marked as such.

**Pricing figures for 2026 are the weakest class of evidence in this report.** Nearly all of them come from comparison-blog content written by competitors of the vendor being priced. Treat every dollar figure as an order-of-magnitude estimate to be confirmed on the vendor's own pricing page before you commit.

---

## 1. Official LinkedIn APIs — definitively ruled out

**Verdict: there is no official path to what you need, at any price, on any timeline that matters.**

LinkedIn's developer platform is a set of purpose-built products, each mapped to OAuth scopes, and gated behind partner approval since the 2015 lockdown ([TechCrunch, 2015](https://techcrunch.com/2015/02/12/linkedin-battens-down-the-hatches-on-api-use-limiting-full-access-to-partners); [LinkedIn Product Catalog](https://developer.linkedin.com/product-catalog)).

| Product | What it gives | Relevance to you |
|---|---|---|
| Sign In with LinkedIn (OIDC) | Profile fields **of the person who just authenticated**, nothing more | None — your targets will never authenticate to your app |
| Share on LinkedIn / Posts API | Publish content as the authenticated member/org | None |
| Marketing Developer Platform | Ad campaign mgmt, audiences, lead-gen forms, analytics | None |
| Talent Solutions / Recruiter System Connect | ATS integration, job posting; requires being an ATS vendor | None |
| Sales Navigator API | CRM sync + display services for existing Sales Nav seats | None — it surfaces data into a CRM, it is not a bulk people-search endpoint |
| Compliance / Community Management | Archiving and moderation for enterprises | None |

The decisive fact: **there is no people-search endpoint and no third-party profile-lookup endpoint in any tier.** As one 2026 survey puts it, Sign In with LinkedIn "returns a fixed set of fields about the person who authenticated, but it cannot return anything about anyone else. There is no parameter for someone else's profile, no endpoint that lists your connections, and no search" ([Elfsight](https://elfsight.com/blog/linkedin-api-access-and-pricing/); [outx.ai](https://www.outx.ai/blog/linkedin-api-guide)) **[low-confidence on exact wording, high-confidence on substance]**.

Approval timelines reported at 4–8 weeks best case, 3–4 months typical, 4–6 months for Talent products, with common rejection triggers being "a use case that touches restricted data (messaging, connections, bulk profile data)" ([connectsafely.ai](https://connectsafely.ai/articles/linkedin-api-complete-guide-2026)) **[low-confidence]**. Your use case is precisely the rejection trigger.

**Action: close this line of inquiry. Do not spend a week on a partner application.**

---

## 2. Third-party data APIs

### 2.1 The structural distinction that determines everything

There are three genuinely different sourcing models, and they carry completely different risk:

**(A) Logged-out public crawling → licensed dataset.** The vendor crawls pages that are visible without authentication, structures them, and sells the result as a product. No LinkedIn account is created, no ToS is agreed to, no login wall is crossed. *This is the model the courts have blessed.*

**(B) Real-time proxy scraping.** The vendor fires a request per API call through a residential/ISP proxy pool, possibly executing a headless browser. Fresher than (A). Still logged-out if done properly; the risk is that "properly" is unverifiable from outside.

**(C) Fake or borrowed logged-in accounts.** The vendor (or you) authenticates to LinkedIn — using accounts they created en masse, or your own session cookie — and hits the internal Voyager API. *This is the model that has been sued into oblivion, twice.*

Everything below sorts into one of those three buckets. **The bucket matters far more than the brand name.**

### 2.2 Proxycurl — dead, and the reason is the whole lesson

- LinkedIn filed suit against Nubela Pte Ltd (Proxycurl) on **24 January 2025**, N.D. Cal., on six claims: breach of contract, fraud and deceit, CFAA, California UCL, Lanham Act, and misappropriation.
- The core allegation: Proxycurl created **hundreds of thousands of fake accounts** to scrape millions of profiles, *including non-public data*, and resold it via API.
- Proxycurl shut down permanently on **4 July 2025**. The founder's stated reason was economic, not legal merit: even winning wouldn't recover fees under the American Rule, and Microsoft-owned LinkedIn has an effectively unlimited war chest ([nubela.co goodbye post](https://nubela.co/blog/goodbye-proxycurl/); [Social Media Today](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/); [StartupHub.ai](https://www.startuphub.ai/ai-news/startup-news/2025/the-1-linkedin-scraping-startup-proxycurl-shuts-down)).

**Date correction worth flagging:** several 2026 content sites state the shutdown was July 2025 and several state July 2026. The lawsuit date (Jan 2025) plus the "filed suit six months earlier" framing, plus the timestamp encoded in the widely-cited [LinkedIn announcement post](https://www.linkedin.com/posts/maxkolysh_proxycurl-just-shut-down-after-linkedin-sued-activity-7351297064502206466-W_4c) (decodes to July 2025), all point to **July 2025**. Assume 2025; the "2026" citations are content-farm error.

**Lesson: it was the fake accounts, not the scraping, that killed them.** Bucket (C), not bucket (A).

### 2.3 EnrichLayer — the Proxycurl rebrand, and why that's a flag

EnrichLayer is Proxycurl rebranded, operated by the same entity (Nubela Pte Ltd), with an official "migrating from Proxycurl" guide and a `enrichlayer-api` compatibility shim so old code runs unchanged ([enrichlayer.com/docs](https://enrichlayer.com/docs/pc/); [Slicey](https://slicey.ai/tools/enrich-layer); [Linked API](https://linkedapi.io/guides/proxycurl-alternatives)). Reported model: on-demand crawling rather than cached serving, ~1M pages/day, ~2s response, 500 free credits on signup **[low-confidence]**.

**Risk assessment: I would not build on this.** The same operator, in the same jurisdiction, in the same business, after settling a suit whose allegations were fake-account creation. Whether the settlement included a permanent injunction against the operator is **UNVERIFIED** — I could not retrieve the consent judgment. If it did, EnrichLayer's continuity is legally precarious. Note also that the same company publicly counsels others on scraping legality ([nubela.co](https://nubela.co/blog/is-scraping-linkedin-legal-in-2026/) — 403'd, unread), which is not the posture of a party under a clean settlement.

### 2.4 Vendor-by-vendor

| Vendor | Sourcing bucket | Ballpark price (2026) | Freshness | UAE/GCC reputation | Who bears legal risk |
|---|---|---|---|---|---|
| **Bright Data — Datasets** | (A) logged-out, sold as product | LinkedIn people dataset **902.9M+ records**; from **$250/100K records ≈ $0.0025/record**; filter to a snapshot and pay only for filtered rows | Snapshot — a photograph, not a feed | Filterable by geography; no UAE-specific reputation found | **Vendor.** Strongest legal track record of anyone here |
| **Bright Data — Scraping Browser / Web Scraper API** | (B) you drive it | Web Scraper ~$3/1K page loads; residential proxies $8/GB PAYG → $2.50/GB at $1,999/mo commit; Scraping Browser bills per GB + proxy | Live | n/a | **Shared → you.** You author the requests |
| **Coresignal** | (A) explicitly logged-out | $49/mo entry → $800 Pro → $1,500 Premium; bulk datasets $1,000+/mo; free trial 200 collect + 400 search credits, 7 days | Refreshed dataset | 792M employee / 103M company records; no UAE-specific signal found | **Vendor.** EWDCI-certified; states it "does not need to log in to scrape public data" |
| **ScrapIn (scrapin.io)** | (B) real-time via managed proxies, **no user account required** | No free tier; $30 seven-day trial; credit-based, per-1K not published | Real-time, no cache, sub-2s claimed | Unknown | **Vendor** ("they carry the scraping risk") — but unaudited |
| **People Data Labs** | Hybrid: "Data Union" opt-in co-op **+ public web** | Free 100 lookups/mo; Pro $98/mo (350 person enrichments); Enterprise from ~$2,500/mo | Aggregated, variable | Global; not UAE-strong | **Vendor**, with contractual warranties from Data Union contributors |
| **Apollo.io** | Contributory network + public web; **database snapshot, not live LinkedIn** | Free / $59 / $99 / $149+ per seat/mo annual; **API access only on Custom plans** | Snapshot; export credits gate everything | Reported "stronger for LinkedIn-active UAE companies, weaker for traditional-sector accounts"; accuracy 65–80% | Vendor — but **LinkedIn removed Apollo's Company Page in 2025** |
| **RocketReach** | Aggregated public + partner | ~$80 / ~$150 / ~$300 per mo tiers; Pro ~1,500 lookups ~$108/mo | Aggregated | Weak GCC signal | Vendor; **partial GDPR compliance — no Art. 27 EU representative** |
| **SignalHire** | Real-time collection, 850M+ profiles | $49/mo (300 credits) phones; $139/mo (900 credits) email+phone | Real-time claimed | Weak GCC signal | Vendor; claims GDPR + right-to-be-forgotten |
| **ContactOut** | Static DB + browser extension | Recruiter ~$199/mo, ~100 reveals/day | Static | Weak GCC signal | Vendor; **extension model = extension operates in your logged-in session** |
| **Lix (lix-it.com)** | LinkedIn + Sales Navigator extraction | Free / £39/mo / £109/mo; 1 API call = 1 credit | Live-ish | Unknown | **Ambiguous → likely you**, since it extracts from LinkedIn/Sales Nav |
| **Unipile** | **(C) your own cookie-based session** | €49/$55 min per mo, ≤10 linked accounts; then ~$5.00–5.50/account | Live | n/a | **You, entirely.** Explicitly not the Partner API |
| **Apify actors** | (A/B) public, several explicitly no-cookie | `dev_fusion` ~$10/1K profiles; `harvestapi` ~$4–10/1K; others from ~$4/1K | Live per-run | n/a | Actor author + you |
| **Clay** | Waterfall across 75+ providers | Launch $185/mo (2,500 data credits); Growth $495/mo; LinkedIn profile from URL ≈ 1 credit | Depends on provider hit | Best-in-class for **waterfall**, which is the right answer for high-churn markets | Distributed across providers |

Sources for the table: [Bright Data LinkedIn datasets](https://brightdata.com/products/datasets/linkedin) · [Bright Data dataset pricing](https://brightdata.com/pricing/datasets) · [Coresignal pricing docs](https://docs.coresignal.com/introduction/pricing-and-subscriptions) · [Coresignal data & compliance](https://docs.coresignal.com/introduction/data-and-compliance) · [Coresignal transparency](https://coresignal.com/data-transparency/) · [ScrapIn](https://www.scrapin.io/) · [PDL on Datarade](https://datarade.ai/data-providers/people-data-labs/profile) · [Apollo pricing](https://www.apollo.io/pricing) · [RocketReach GDPR](https://rocketreach.co/gdpr) · [Is RocketReach GDPR compliant](https://www.simpleanalytics.com/is-gdpr-compliant/rocketreach) · [Unipile API pricing](https://www.unipile.com/pricing-api/) · [Lix pricing](https://lix-it.com/pricing) · [Apify LinkedIn actors](https://apify.com/dev_fusion/linkedin-profile-scraper) · [Clay pricing](https://astragtm.io/guides/clay-pricing-2026)

### 2.5 The UAE/GCC coverage problem — the finding that should change your plan

This is the single most operationally important thing in section 2:

> **"UAE expat churn means no single static database stays accurate long enough — waterfall enrichment across multiple providers produces materially better results."** ([SyncGTM, best B2B databases UAE](https://syncgtm.com/blog/best-b2b-database-uae)) **[low-confidence source, but consistent with every other GCC-focused writeup I found]**

Corroborating signals:
- Cognism's GCC coverage is reportedly strongest in UAE + Saudi, with phone-verified data beating Apollo/Lusha on connect rates in Dubai/Riyadh ([SyncGTM GCC](https://syncgtm.com/blog/best-b2b-database-gcc)).
- Lusha: "UAE and KSA coverage is stronger than smaller Gulf states, hit rates inconsistent."
- Apollo: stronger for LinkedIn-active tech/SaaS UAE companies, weak for traditional sectors — which is exactly where much Emiratisation-quota hiring lives (banking, energy, logistics, government-linked entities).
- Regional specialists exist (e.g. [Pintel.ai](https://pintel.ai/blogs/best-uae-company-databases-for-b2b-sales/)) claiming deeper UAE/GCC depth. **UNVERIFIED** — I could not evaluate their actual coverage or legitimacy, and vendor-adjacent blogs recommending them may be interested parties.

**Implication for your PLAN.md §3 staleness defense:** your existing rule ("second corroborating source or one source fresher than ~90 days") is *correct and unusually well-designed for this market*. The UAE expat-churn dynamic is exactly why. Keep it. It's more valuable than any single vendor choice.

---

## 3. Open-source GitHub tools — how they actually work, and what LinkedIn does about it

### 3.1 tomquirk/linkedin-api — **the reference implementation is gone**

**Verified directly:** I enumerated all 44 public repositories on the `tomquirk` GitHub account via the GitHub API. **`linkedin-api` is not among them.** It also does not appear in a stars-sorted GitHub repository search for "linkedin-api" (3,615 results) despite having had ~2.5k stars, where it would have ranked between two results I did receive. `raw.githubusercontent.com` returns 404 on both `master` and `main` branches.

Corroboration: a community fork describes itself as "Inspired by the **now-private** linkedin-api" ([EseToni/open-linkedin-api](https://github.com/EseToni/open-linkedin-api)).

**Conclusion: the repo was made private or deleted, some time after the LinkedIn enforcement wave.** I could **not** find a DMCA notice in [github/dmca](https://github.com/github/dmca) or any public statement of cause — **the reason is UNVERIFIED.** It may be legal pressure, it may be maintainer fatigue, it may be the token-format rotation that reportedly broke the library.

The package remains on PyPI at **v2.3.1, released 7 November 2024** ([pypi.org/project/linkedin-api](https://pypi.org/project/linkedin-api/)) — i.e. **~21 months stale against a target that actively rotates its internals.**

**How it worked (from the PyPI description, verified):** POST credentials to `https://www.linkedin.com/uas/authenticate`, retain the session cookie, then call **Voyager** — LinkedIn's internal structured-data service backing the website itself — with that cookie plus a set of required headers. Its own disclaimer: *"This library is not officially supported by LinkedIn. Using this library might violate LinkedIn's Terms of Service. Use it at your own risk."*

This is **bucket (C)**. It is the exact mechanism at issue in the Proxycurl and ProAPIs complaints, differing only in scale.

### 3.2 joeyism/linkedin_scraper — 4,394 stars, actively maintained, **now Playwright not Selenium**

[Repo](https://github.com/joeyism/linkedin_scraper) — verified via GitHub API: 4,394 stars, 968 forks, updated 2026-08-06.

Current README (fetched directly) states it uses **"Playwright instead of Selenium"**, driving Chromium, with two auth paths (manual login in the opened browser, or programmatic credential submission), then **persists the session to a JSON file** for reuse. Python 3.8+, Pydantic models, async throughout. Scrapes person profiles, company pages, job listings, and company posts.

Disclaimer: *"for educational purposes only,"* comply with ToS, *"authors are not responsible for any misuse."*

Still bucket (C) — it drives a real logged-in account.

### 3.3 StaffSpy — the closest fit to "employees of a company," and the most honest about it

[cullenwatson/StaffSpy](https://github.com/cullenwatson/StaffSpy) — 323 stars, updated 2026-08-06. README fetched directly:

- **Auth:** browser-based manual sign-in, *or* automated username/password with optional **CapSolver / 2Captcha** integration for CAPTCHA solving. Cookies persisted to file; **sessions last ~1 week**. Automated non-browser sign-in **requires disabling 2FA** — a serious account-hardening regression you'd be making to your own account.
- **Fetches:** names, locations, positions, contact info, employment history, schools, skills, certifications, followers/connections/mutuals, premium/creator/hiring flags, photos.
- **Limits:** 1,000 results per search (LinkedIn-imposed); `extra_profile_data` is O(n) extra requests per profile; **"if rate limited, the program will stop scraping."**
- **Honest caveat in the README:** account suspension is *possible*, though no confirmed incidents are documented. Unverified emails, new accounts, and low connection counts reduce what you can see.

The CAPTCHA-solver integration is the tell. A tool that needs to defeat CAPTCHAs is, by construction, operating against an anti-automation control — which is the *anti-circumvention* framing that has become legally dangerous (see §5).

### 3.4 PhantomBuster-style hosted automation

You hand PhantomBuster (or Unipile, HeyReach, Dux-Soup, LinkedHelper, Expandi) your **`li_at` session cookie**; their cloud runs the actions as you.

Two structural problems:
1. **You surrender your session cookie to a third party.** Full account authority.
2. **Cloud tools often egress from datacenter IPs LinkedIn has already blacklisted** ([leadsmonky](https://leadsmonky.com/phantombuster-for-linkedin/)) **[low-confidence]** — so your account's session suddenly originates from an ASN that has never been associated with it.

Enforcement is real and current: **LinkedIn permanently removed HeyReach's company page and banned founder Nikola Velkovski's personal profile in March 2026** ([LinkedInsider](https://linkedinsider.blog/linkedin-automation-crackdown-2026)) **[low-confidence, single source]**. In 2025, **Apollo.io and Seamless.ai had their Company Pages removed** in the same crackdown.

### 3.5 What LinkedIn actually detects

Layered, and the layers fire in order — several before your code sees a byte of HTML:

**Layer 1 — TLS handshake (JA3/JA4), pre-HTTP.** The Client Hello's cipher suites, extensions, and elliptic curves form a fingerprint. Real Chrome emits a specific JA3/JA4 hash; headless Chrome and Node-based HTTP clients emit a mismatched handshake. Critically: *"Browser-as-a-Service platforms can spoof nearly every JavaScript API and rotate residential IPs, but what they cannot easily fake is the TLS handshake"* ([Scrapfly JA3/JA4 guide](https://scrapfly.io/blog/posts/ja3-ja4-tls-fingerprinting-guide-to-detection-and-evasion); [konnector](https://konnector.ai/linkedin-headless-browsers/)). **This is why `undetected-chromedriver`-class tooling has a shorter half-life than its name implies.**

**Layer 2 — IP/ASN reputation.** Datacenter ranges are pre-scored. This is the entire economic reason residential proxies cost $2.50–$8/GB.

**Layer 3 — Browser/JS fingerprint.** `navigator.webdriver`, canvas, WebGL, CDP timing artifacts.

**Layer 4 — Session/device continuity.** The `li_at` cookie is expected to travel with a stable device+IP profile. A session that jumps ASN, geography, or fingerprint mid-life is anomalous *independently of volume*. **Session friction — repeated cookie expiry, forced logouts, login checkpoints — is the early warning signal that you have been flagged** ([Stormy AI](https://stormy.ai/blog/linkedin-automation-safety-2026-phantombuster-bereach-guide)).

**Layer 5 — Behavioral/rate patterns.** And this is the part people get wrong:

> *"The risk is not just 'how much did you do?' but 'does this look normal for this account?'"* — trigger patterns are **low activity for weeks followed by a sharp ramp**, many actions compressed into a short window, and moving from manual use to automation without a ramp ([LinkedSDR](https://www.linkedsdr.com/blog/how-to-avoid-linkedin-restrictions-safe-outreach-limits); [Dux-Soup](https://www.dux-soup.com/blog/linkedin-automation-safety-guide-how-to-avoid-account-restrictions-in-2026)) **[low-confidence]**.

**Layer 6 — Commercial Use Limit.** A separate, *non-punitive* throttle. Free accounts hit CUL around **~1,000 profile views/month**; search results then collapse to your 1st-degree network until midnight PST on the 1st ([LinkedIn Help — Commercial use limit](https://www.linkedin.com/help/linkedin/answer/a564226)). Reported hard daily view caps: ~500/day free, ~2,000/day paid, ~1,000/day within Sales Navigator **[low-confidence]**.

### 3.6 Realistic ban risk at *your* volume — the honest answer

You asked specifically about tens of views/day on a real account versus automated bursts. The honest split:

**A human browsing normally at ~30 profiles/day: negligible risk.** That is below every reported threshold, and operators routinely run 100–150 views/day. Your few-hundred-profile refresh, done by a person over a week or two, is indistinguishable from ordinary job-hunting.

**The same 30/day driven by a script: materially different risk, and not because of the number.** Volume is Layer 5 only. Layers 1–4 fire regardless. A script doing 30 profiles/day still presents a mismatched JA3, an automation-flagged browser, and possibly a datacenter IP — and it does so *every single day, forever*, giving the classifier an unlimited sample. One claim in circulation is that LinkedIn "bans accounts operating through Voyager within 3–7 days" ([Iron Mind](https://iron-mind.ai/blog/linkedin-profile-scraper-python-voyager-api)) — **[low-confidence, vendor-adjacent, and almost certainly volume-dependent; treat as directional, not a number]**.

**The asymmetry that decides it:** a permanent ban costs you the account you need to *do outreach from*, plus your professional identity, plus — as HeyReach's founder discovered — potentially your personal profile too. For a few hundred lookups you'd be wagering the identity your product depends on to save a few hours of clicking. **That trade is bad at every volume.**

Your PLAN.md hard rule #7 — *"No LinkedIn automation, ever. Tier 4 is human-only with a capture form"* — is, on this evidence, correct. **Nothing in my research suggests you should relax it.** Keep it.

---

## 4. Indirect routes — and the bad news about your Tier 3

### 4.1 SERP over `site:linkedin.com/in` — **the mechanism your plan depends on has degraded badly in 2026**

Your PLAN.md §3 Tier 3 reads: *"Query Google/Bing for `site:linkedin.com/in ...`. This reads public search results without touching LinkedIn itself — no automation against LinkedIn, no detection problem, ToS-clean."*

**The strategy is still right. The supply of APIs to execute it has contracted sharply in the last 18 months:**

| Route | Status as of Aug 2026 |
|---|---|
| **Bing Web Search API** | **RETIRED 11 August 2025.** Existing instances decommissioned, no new signups. Microsoft's replacement is "Grounding with Bing Search" inside Azure AI Agents — a platform commitment, not a drop-in API ([Microsoft Lifecycle](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)) |
| **Google Custom Search JSON API** | **Closed to new customers as of 2025**; existing users until **1 January 2027**, then retired. Google points to Vertex AI Search. Historic pricing was 100 free/day then $5/1K, capped 10K/day ([Google docs](https://developers.google.com/custom-search/v1/overview); [Expertrec](https://blog.expertrec.com/google-custom-search-json-api-simplified/)) **[closure status is low-confidence — VERIFY THIS FIRST, it is the highest-leverage unknown in this report]** |
| **Google `cache:` operator** | **Dead.** Announced March 2024, fully non-functional by September 2024. Google now links Internet Archive from "About this page" ([Search Engine Land](https://searchengineland.com/google-search-completely-kills-the-cache-feature-446904)) |
| **SerpApi** | Functional, but **Google sued SerpApi on 19 December 2025** (N.D. Cal.) under the DMCA, alleging circumvention of a TPM called "SearchGuard." Google claims SerpApi sends hundreds of millions of artificial queries daily, up ~25,000% over two years. SerpApi moved to dismiss Feb 2026; hearing reported for May 2026 ([IPWatchdog](https://ipwatchdog.com/2025/12/26/google-sues-serpapi-parasitic-scraping-circumvention-protection-measures/); [Search Engine Land](https://searchengineland.com/google-sues-serpapi-466541); [The Register](https://www.theregister.com/offbeat/2026/02/21/serpapi-asks-court-to-dismiss-google-web-scraping-lawsuit/4591023)). **An injunction could remove this vendor mid-build.** Pricing ~$25/1K entry, ~$9–15/1K at volume |
| **Serper.dev** | ~**$1.00/1K** queries, down to ~$0.30/1K at volume; 2,500 free trial queries; credits valid 6 months ([serp.fast](https://serp.fast/tools/serper-dev)) **[low-confidence]** |
| **DataForSEO** | **$0.60/1K** standard queue (~5 min latency), $2.00/1K live ([nextgrowth](https://nextgrowth.ai/dataforseo-serp-api/)) **[low-confidence]** |
| **Brave Search API** | Independent index, not a Google/Bing reseller. **Free tier was killed for new users in early 2026** — new signups get ~$5/mo metered credit (~1,000 queries) at $0.003–0.005/query ([implicator.ai](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/)) **[low-confidence]** |

**Two things follow from this table:**

1. **Verify the Google CSE closure before Week 2 of your build order.** If CSE is still open to you, 100 free queries/day covers a few-hundred-profile refresh essentially free and is the cleanest option on the board. If it's closed, you need a replacement, and the ones with clean legal standing and no signup barrier are **DataForSEO ($0.60/1K)** and **Serper ($1/1K)**. At your volume — call it 2,000 queries per refresh cycle — that's **$1.20 to $2.00 per full refresh.** Rounding error.
2. **Do not build a hard dependency on SerpApi** while Google's DMCA suit is live.

**What the SERP route actually returns:** title (name + headline), URL, and snippet. In practice: name, current title, current company, location. **Not** full employment history, not education, not skills. For your Tier 3 that is *sufficient* — you need to identify the right person and get a name + title + company to feed email-pattern inference. It is not sufficient if you want the rich evidence your §6 generator wants; that has to come from Tier 2 (company pages, press releases) anyway, which is where your best personalization lives regardless.

### 4.2 Common Crawl

**UNVERIFIED.** I could not reach `index.commoncrawl.org` to test LinkedIn coverage. Structurally: Common Crawl respects robots.txt, and LinkedIn's robots.txt is restrictive toward non-major-search-engine agents **[UNVERIFIED — could not fetch linkedin.com/robots.txt]**. Even if some `/in/` pages are present in older crawls, the data would be years stale — fatal for a market whose defining characteristic is expat churn. **Not worth engineering time for your use case.**

### 4.3 Wayback Machine

Reported: *"LinkedIn profiles cannot be displayed in the Wayback Machine due to robots.txt exclusion"* ([Max Intel](https://maxintel.org/wayback-osint-guide-2026.html)) **[low-confidence, single source]**. Even where captures exist, they are by definition historical — the opposite of what a staleness-defense pipeline needs. The Wayback **CDX API** is genuinely useful for a *different* job: detecting that a company's team page *changed* (i.e., someone left), which is a cheap departure signal. Worth 30 minutes of experimentation for that narrow purpose only.

### 4.4 The auth wall

Logged-out visitors reportedly get 2–3 profiles before hitting an authwall, then CAPTCHAs and login prompts ([nubela](https://nubela.co/blog/search-linkedin-without-login-anonymously/)) **[low-confidence]**. And even a successfully-viewed logged-out profile shows name, headline, current company — roughly what the SERP snippet already gave you. **This is why the vendors in §2 charge money: rotating residential IPs to defeat that wall at scale is the actual product.**

---

## 5. Legal lay of the land

### 5.1 hiQ v. LinkedIn — the case everyone cites for the wrong proposition

The Ninth Circuit's 2019/2022 rulings narrowed the **CFAA**: scraping publicly available data is not "access without authorization." That is the part people quote.

**What actually happened next is the part that matters.** On 4 November 2022 the district court found hiQ **breached LinkedIn's User Agreement** through automated scraping. In December 2022 the parties settled, and hiQ consented to:

- a **permanent injunction** — cease all scraping, and **delete all source code, data, and algorithms** derived from it;
- a **$500,000 judgment**, entered on **five** grounds: breach of contract; **CFAA violation "based on hiQ's data collection practices and based on hiQ's direct access to password-protected pages on LinkedIn's platforms using fake accounts"**; California §502; trespass to chattels and misappropriation; plus **spoliation sanctions**.

([Privacy World](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/); [Morgan Lewis](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators); [Proskauer](https://newmedialaw.proskauer.com/2022/11/11/court-finds-hiq-breached-linkedins-terms-prohibiting-scraping-but-in-mixed-ruling-declines-to-grant-summary-judgment-to-either-party-as-to-certain-key-issues/); [ZwillGen](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/))

**Read the CFAA clause carefully: the fake accounts brought the CFAA claim back.** hiQ won the public-data question and lost the case on contract — because they had agreed to the User Agreement, and because they logged in.

### 5.2 The counter-line: Meta v. Bright Data

Judge Edward Chen (N.D. Cal., Jan 2024) held **Bright Data did not breach Meta's ToS by scraping public Instagram/Facebook data — because Bright Data was not logged in when it collected.** In May 2024 a federal judge dismissed X Corp.'s parallel claims, holding X failed to state a claim as to public-site access, and that copying public data was preempted by the Copyright Act. ([Meta v. Bright Data — Farella Braun + Martel](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/); [Proskauer](https://www.proskauer.com/release/proskauer-secures-dismissal-of-scraping-claims-against-bright-data); [VentureBeat](https://venturebeat.com/ai/bright-data-beat-elon-musk-and-meta-in-court-now-its-100m-ai-platform-is-taking-on-big-tech))

### 5.3 The synthesis — one sentence

> **The login is the line.** Logged-out collection of public pages has survived repeated challenge. Creating accounts, or using yours, to reach the same data converts it into breach of contract + CFAA + fraud, because agreeing to the User Agreement is what makes the terms bind you.

### 5.4 The 2025–26 enforcement wave

- **Jan 2025:** LinkedIn sues Nubela/Proxycurl. **Proxycurl dead by July 2025.**
- **2025:** Apollo.io and Seamless.ai Company Pages removed.
- **Oct 2025:** LinkedIn sues **ProAPIs Inc.** and CTO Rehmat Alam, alleging **over one million fake accounts** — "one of the largest automated attacks ever against the professional network" — used to scrape profiles, posts, reactions and comments, resold at up to **$15,000/month** per client ([BleepingComputer](https://www.bleepingcomputer.com/news/legal/linkedin-sues-proapis-for-using-1m-fake-accounts-to-scrape-user-data/); [Security Affairs](https://securityaffairs.com/183001/security/linkedin-sues-proapis-for-15k-month-linkedin-data-scraping-scheme/)). **Settled by "agreement in principle" in 2026**, terms undisclosed ([Bloomberg Law](https://news.bloomberglaw.com/artificial-intelligence/linkedin-battles-online-scrapers-in-perpetual-struggle-over-data); [The Linked Blog](https://thelinkedblog.com/2026/linkedin-reaches-deal-in-data-scraping-lawsuit-against-proapis-3857/)).
- **Mar 2026:** HeyReach company page removed, founder's personal profile banned **[low-confidence]**.
- **Adjacent trend:** Google's DMCA suit against SerpApi (§4.1) signals that **anti-circumvention** — defeating a technical protection measure — is the emerging theory of liability, and it is not limited to LinkedIn. This is why CAPTCHA-solver integrations (StaffSpy) and fingerprint-spoofing browsers are a worse look in 2026 than they were in 2023.

### 5.5 What this means for **you**, concretely

**(a) As a customer of a third-party API.** Your exposure is **low but not zero**. You are not a party to LinkedIn's User Agreement in respect of the vendor's collection, and LinkedIn has consistently sued *suppliers*, not their customers. Your real risks are commercial and reputational: the vendor gets enjoined and your pipeline dies overnight (Proxycurl customers learned this with weeks of notice), and downstream data-protection duties attach to *you* as controller once you store the data.

**Practical filter:** prefer vendors who (i) state in writing they collect **logged-out only**, (ii) will say so in a contract, and (iii) have survived litigation. On that test **Bright Data ranks first and Coresignal second**; anything running on account-based collection ranks last regardless of price.

**(b) Running your own account-based automation.** Your exposure is **materially higher and personally borne**:
- Account termination (permanent, and it has reached founders' *personal* profiles).
- Direct breach of the User Agreement you personally accepted — the hiQ theory applies to you cleanly.
- If you ever create a supplementary account to do it, you are in fake-account territory, which is what upgraded Proxycurl and ProAPIs from contract disputes to fraud/CFAA cases.
- No vendor stands between you and LinkedIn.

**(c) UAE data protection.** Federal Decree-Law No. 45 of 2021 (PDPL), effective 2 January 2022. Business email addresses **are** personal data when they identify a person, and **there is no B2B carve-out** — the same principles apply regardless of recipient type. Commercial communications require sender identification and an opt-out. Critically: **unlike GDPR, PDPL does not clearly provide "legitimate interest" as a standalone lawful basis** — consent and enumerated exceptions carry more weight ([Securiti](https://securiti.ai/uae-personal-data-protection-law/); [DLA Piper](https://www.dlapiperdataprotection.com/countries/uae-general/collection-and-processing.html); [Multilaw UAE](https://www.multilaw.com/Multilaw/Multilaw/Data_Protection_Laws_Guide/DataProtection_Guide_United_Arab_Emirates.aspx)).

**The Executive Regulations status is genuinely contested in my sources** — some 2026 write-ups say issued, others say still unpublished as of April 2026, with Chambers' 2026 guide reportedly stating they "have yet to be issued." **Mark UNVERIFIED.** The compliance clock (six months to regularize) starts when they issue, so this is worth a real lawyer's answer before commercialization — which is exactly where your PLAN.md §12 already puts it. Correct call.

---

## 6. Recommendation matrix

### 6.1 For your actual need: a few hundred UAE profiles, refreshed rarely

| Rank | Option | Cost for ~300–500 profiles | Why |
|---|---|---|---|
| **BEST — Primary** | **Keep your existing Tier 1→2→3 pyramid.** Fix Tier 3's plumbing: use **DataForSEO ($0.60/1K)** or **Serper ($1/1K)** for `site:linkedin.com/in` queries. Verify Google CSE availability first — if open, 100 free/day covers you outright. | **~$1–3 per full refresh** | Logged-out public SERP data. Bucket (A). No LinkedIn contact, no account risk, no vendor lock-in, no ToS agreement in play. It is what your plan already says, and it is right |
| **BEST — Enrichment layer** | **Bright Data LinkedIn Profiles dataset**, filtered to UAE + your target companies, purchased as a one-time snapshot | **$250 minimum** (100K records at ~$0.0025/record; you'd pay only for the filtered snapshot) | Strongest legal position of any vendor — beat Meta *and* X in court on precisely the logged-out-public-data question. Vendor bears the risk. Free schema sample available before you buy. **Snapshot, not live** — but "refreshed rarely" is exactly the shape this fits |
| **FALLBACK — if UAE coverage disappoints** | **Waterfall via Clay** (Launch $185/mo, cancel after the refresh) or hand-rolled waterfall across 2–3 of Coresignal / PDL / SignalHire | ~$185–300 for a cycle | The GCC-specific finding is that *no single database survives UAE expat churn*. Waterfall is the documented answer. Clay buys you 75+ providers without 75 contracts. Rent it for the refresh month, cancel |
| **FALLBACK — cheap and dirty** | **Apify no-cookie actors** (`harvestapi` / `dev_fusion`) at ~$4–10/1K profiles | **$2–5** for 500 profiles | Public-data, no account, no cookie. Per-run, zero commitment. Weakest guarantee of the group — you're trusting an anonymous actor author's claim about their method. Use as a *cross-check* on Tier 3 output, never as the source of record |
| **LAST RESORT (already in your plan)** | **Tier 4: a human opens LinkedIn and pastes into your capture form** | ~2–4 hours of a person's time | At 300–500 profiles this is genuinely competitive on total cost, and it is the only option with *zero* legal and *zero* account risk. Your PLAN.md already specifies this. It is not a failure mode; it is a legitimate answer at your volume |

### 6.2 Avoid

| Avoid | Why |
|---|---|
| **Any account-based automation** — tomquirk/linkedin-api, joeyism/linkedin_scraper, StaffSpy, Unipile, PhantomBuster, Lix | You wager the LinkedIn identity your product runs on, against saving a few hours. Detection is pre-HTTP (TLS) and volume-independent. StaffSpy additionally wants your 2FA off. Your hard rule #7 already forbids this — **keep it** |
| **EnrichLayer** | Same operator (Nubela) as the service LinkedIn just sued out of existence over fake accounts. Whether a permanent injunction binds the operator is UNVERIFIED. Continuity risk is unacceptable for infrastructure |
| **Building on SerpApi right now** | Live DMCA suit from Google; injunction possible. Use DataForSEO or Serper instead — same job, ~1/20th the price, no active litigation |
| **Bing Web Search API** | Retired 11 August 2025. Dead. Remove it from your PLAN.md Tier 3 wording |
| **Apollo as your UAE system of record** | 65–80% accuracy, weak outside tech/SaaS — and UAE Emiratisation-quota hiring concentrates in banking, energy, logistics, and gov-linked entities, i.e. exactly the sectors it's weak in. API is Custom-plan-only anyway |
| **Common Crawl / Wayback as a profile source** | Stale by construction. Fatal against UAE expat churn. (Wayback CDX for *change detection* on company team pages is a different, legitimate, small idea) |

### 6.3 Three concrete changes to PLAN.md

1. **§3 Tier 3 — replace the plumbing.** "Query Google/**Bing**" is now wrong: Bing's API was retired 11 Aug 2025 and Google CSE is reportedly closed to new signups. Rewrite as: *Google CSE if still obtainable, else DataForSEO or Serper.* **Verify CSE availability in Week 1, not Week 2** — it's a $0-vs-$2 decision but a build-order dependency.
2. **§3 — add a Tier 2.5: purchased snapshot.** A one-time Bright Data UAE-filtered snapshot ($250) sits neatly between "company's own pages" and "SERP," gives you a *second corroborating source* for your §3 staleness rule at near-zero marginal cost per contact, and carries vendor-side legal risk. This directly strengthens the mechanism you already identified as your defense against LinkedIn staleness.
3. **§10 hard rule #7 — keep it verbatim, and add the reasoning.** The research fully vindicates it. Adding one line — *"detection operates at the TLS layer, before rate limits apply; low volume does not confer safety"* — will stop a future you (or a future contractor) from relitigating it on the theory that "we're only doing 30 a day."

---

## 7. Explicitly UNVERIFIED

- **Reason** `tomquirk/linkedin-api` went private/deleted. Absence from the account's 44 public repos is directly verified; the cause is not. No DMCA notice found in `github/dmca`.
- **Whether the Proxycurl/Nubela settlement included a permanent injunction binding the operator** — the consent judgment was not retrievable. This is the crux of the EnrichLayer risk assessment.
- **Google Custom Search JSON API closure to new customers** — single-source, non-Google. **Highest-value item to verify yourself**; it's a build-order dependency.
- **LinkedIn robots.txt contents** and the exact logged-out auth-wall threshold — gateway blocked; could not test.
- **Common Crawl LinkedIn `/in/` coverage** — `index.commoncrawl.org` unreachable from this environment.
- **UAE PDPL Executive Regulations publication status** — sources directly contradict each other on whether they issued. Needs a UAE-qualified lawyer, not a web search.
- **All 2026 pricing figures** — overwhelmingly sourced from competitor comparison blogs. Directionally useful, individually unreliable.
- **HeyReach March 2026 enforcement** — single low-quality source.
- **Pintel.ai and other UAE-specialist vendors** — surfaced only via vendor-adjacent content; coverage claims unevaluated.

---

## Sources

**Legal — primary and law-firm analysis**
[Privacy World — hiQ consent judgment](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/) · [Morgan Lewis — hiQ guidance](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators) · [Proskauer — hiQ breach ruling](https://newmedialaw.proskauer.com/2022/11/11/court-finds-hiq-breached-linkedins-terms-prohibiting-scraping-but-in-mixed-ruling-declines-to-grant-summary-judgment-to-either-party-as-to-certain-key-issues/) · [ZwillGen — hiQ wrapped up](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/) · [FindLaw — hiQ v. LinkedIn (2022)](https://caselaw.findlaw.com/court/us-dis-crt-n-d-cal/2182242.html) · [Farella — Meta v. Bright Data](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/) · [Proskauer — Bright Data dismissal](https://www.proskauer.com/release/proskauer-secures-dismissal-of-scraping-claims-against-bright-data) · [Lowenstein Sandler — Meta v. Bright Data implications](https://www.lowenstein.com/news-insights/publications/client-alerts/meta-v-bright-data-ruling-has-important-implications-for-webscraping-activities-by-investment-advisers-im) · [IPWatchdog — Google v. SerpApi](https://ipwatchdog.com/2025/12/26/google-sues-serpapi-parasitic-scraping-circumvention-protection-measures/) · [The Register — SerpApi motion to dismiss](https://www.theregister.com/offbeat/2026/02/21/serpapi-asks-court-to-dismiss-google-web-scraping-lawsuit/4591023) · [Search Engine Land — Google sues SerpApi](https://searchengineland.com/google-sues-serpapi-466541)

**Enforcement**
[BleepingComputer — LinkedIn v. ProAPIs](https://www.bleepingcomputer.com/news/legal/linkedin-sues-proapis-for-using-1m-fake-accounts-to-scrape-user-data/) · [Security Affairs — ProAPIs](https://securityaffairs.com/183001/security/linkedin-sues-proapis-for-15k-month-linkedin-data-scraping-scheme/) · [Bloomberg Law — LinkedIn v. scrapers](https://news.bloomberglaw.com/artificial-intelligence/linkedin-battles-online-scrapers-in-perpetual-struggle-over-data) · [Social Media Today — Proxycurl](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/) · [Nubela — goodbye Proxycurl](https://nubela.co/blog/goodbye-proxycurl/) · [StartupHub.ai — Proxycurl shutdown](https://www.startuphub.ai/ai-news/startup-news/2025/the-1-linkedin-scraping-startup-proxycurl-shuts-down) · [LinkedInsider — 2026 crackdown](https://linkedinsider.blog/linkedin-automation-crackdown-2026) · [The Linked Blog — ProAPIs settlement](https://thelinkedblog.com/2026/linkedin-reaches-deal-in-data-scraping-lawsuit-against-proapis-3857/)

**Official APIs & platform limits**
[LinkedIn Product Catalog](https://developer.linkedin.com/product-catalog) · [LinkedIn Help — Commercial use limit](https://www.linkedin.com/help/linkedin/answer/a564226) · [LinkedIn Help — public profile visibility](https://www.linkedin.com/help/linkedin/answer/a518980) · [TechCrunch 2015 — API lockdown](https://techcrunch.com/2015/02/12/linkedin-battens-down-the-hatches-on-api-use-limiting-full-access-to-partners) · [Clura — what's restricted](https://clura.ai/blog/linkedin-api) · [Elfsight](https://elfsight.com/blog/linkedin-api-access-and-pricing/) · [connectsafely.ai](https://connectsafely.ai/articles/linkedin-api-complete-guide-2026) · [outx.ai](https://www.outx.ai/blog/linkedin-api-guide)

**Vendors**
[Bright Data LinkedIn datasets](https://brightdata.com/products/datasets/linkedin) · [Bright Data profiles dataset](https://brightdata.com/products/datasets/linkedin/profiles) · [Bright Data dataset pricing](https://brightdata.com/pricing/datasets) · [Bright Data marketplace FAQ](https://docs.brightdata.com/datasets/marketplace/faqs) · [Coresignal pricing](https://docs.coresignal.com/introduction/pricing-and-subscriptions) · [Coresignal data & compliance](https://docs.coresignal.com/introduction/data-and-compliance) · [Coresignal transparency](https://coresignal.com/data-transparency/) · [Coresignal employee API](https://coresignal.com/solutions/employee-data-api/) · [ScrapIn](https://www.scrapin.io/) · [ScrapIn docs](https://documentation.scrapin.io/) · [People Data Labs on Datarade](https://datarade.ai/data-providers/people-data-labs/profile) · [Apollo pricing](https://www.apollo.io/pricing) · [RocketReach GDPR](https://rocketreach.co/gdpr) · [Is RocketReach GDPR compliant](https://www.simpleanalytics.com/is-gdpr-compliant/rocketreach) · [SignalHire vs ContactOut](https://www.signalhire.com/contactout-email-finder-alternative) · [Lix pricing](https://lix-it.com/pricing) · [Unipile API pricing](https://www.unipile.com/pricing-api/) · [Linked API vs Unipile](https://linkedapi.io/vs/unipile) · [EnrichLayer docs](https://enrichlayer.com/docs/pc/) · [Linked API — Proxycurl alternatives](https://linkedapi.io/guides/proxycurl-alternatives) · [Apify — dev_fusion profile scraper](https://apify.com/dev_fusion/linkedin-profile-scraper) · [Apify pricing](https://apify.com/pricing) · [Clay pricing 2026](https://astragtm.io/guides/clay-pricing-2026) · [Clay data providers](https://lelab0.com/en/guide-clay/data-sources/)

**Open source**
[joeyism/linkedin_scraper](https://github.com/joeyism/linkedin_scraper) · [cullenwatson/StaffSpy](https://github.com/cullenwatson/StaffSpy) · [PyPI linkedin-api](https://pypi.org/project/linkedin-api/) · [EseToni/open-linkedin-api](https://github.com/EseToni/open-linkedin-api) · [l4rm4nd/LinkedInDumper](https://github.com/l4rm4nd/LinkedInDumper) · [stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server) · [github/dmca](https://github.com/github/dmca)

**Detection & limits**
[Scrapfly — JA3/JA4 fingerprinting](https://scrapfly.io/blog/posts/ja3-ja4-tls-fingerprinting-guide-to-detection-and-evasion) · [Konnector — LinkedIn headless browsers](https://konnector.ai/linkedin-headless-browsers/) · [LinkedHelper — automation security study](https://www.linkedhelper.com/blog/linkedin-automation-security-study/) · [LinkedHelper — safe caps](https://www.linkedhelper.com/blog/linkedin-automation-limits/) · [LinkedSDR — safe outreach limits](https://www.linkedsdr.com/blog/how-to-avoid-linkedin-restrictions-safe-outreach-limits) · [Dux-Soup — avoiding restrictions](https://www.dux-soup.com/blog/linkedin-automation-safety-guide-how-to-avoid-account-restrictions-in-2026) · [PhantomBuster — safe limits](https://phantombuster.com/blog/linkedin-automation/linkedin-automation-safe-limits-2026/) · [Stormy AI — 2026 safety playbook](https://stormy.ai/blog/linkedin-automation-safety-2026-phantombuster-bereach-guide) · [Iron Mind — Voyager scraper](https://iron-mind.ai/blog/linkedin-profile-scraper-python-voyager-api)

**Search / indirect routes**
[Microsoft — Bing Search API retirement](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement) · [Google — Custom Search JSON API](https://developers.google.com/custom-search/v1/overview) · [Google — Site Restricted JSON API](https://developers.google.com/custom-search/v1/site_restricted_api) · [Expertrec — CSE pricing/status](https://blog.expertrec.com/google-custom-search-json-api-simplified/) · [Search Engine Land — cache killed](https://searchengineland.com/google-search-completely-kills-the-cache-feature-446904) · [SEJ — cache operator removed](https://www.searchenginejournal.com/google-removes-cache-search-operator-documentation/528022/) · [DataForSEO SERP pricing](https://nextgrowth.ai/dataforseo-serp-api/) · [Serper.dev pricing](https://serp.fast/tools/serper-dev) · [Implicator — Brave free tier ended](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/) · [Max Intel — Wayback CDX/OSINT](https://maxintel.org/wayback-osint-guide-2026.html) · [Internet Archive help](https://help.archive.org/help/using-the-wayback-machine/) · [Nubela — searching LinkedIn without login](https://nubela.co/blog/search-linkedin-without-login-anonymously/)

**UAE / GCC**
[Securiti — UAE PDPL overview](https://securiti.ai/uae-personal-data-protection-law/) · [DLA Piper — UAE collection & processing](https://www.dlapiperdataprotection.com/countries/uae-general/collection-and-processing.html) · [Multilaw — UAE data protection guide](https://www.multilaw.com/Multilaw/Multilaw/Data_Protection_Laws_Guide/DataProtection_Guide_United_Arab_Emirates.aspx) · [Pandectes — UAE PDPL](https://pandectes.io/blog/understanding-the-uaes-personal-data-protection-law/) · [SyncGTM — best B2B databases UAE](https://syncgtm.com/blog/best-b2b-database-uae) · [SyncGTM — GCC](https://syncgtm.com/blog/best-b2b-database-gcc) · [SyncGTM — MEA](https://syncgtm.com/blog/best-b2b-databases-middle-east-africa) · [Pintel — UAE company databases](https://pintel.ai/blogs/best-uae-company-databases-for-b2b-sales/) · [Puzzle Inbox — UAE/KSA cold email compliance](https://puzzleinbox.com/blog/cold-email-uae-saudi-compliance-2026)