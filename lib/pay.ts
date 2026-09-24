/**
 * What a role is likely to pay, and what it's worth to you once the Nafis
 * top-up is added. Pure functions over static tables, so the pipeline can
 * rank in the browser without a round trip.
 *
 * Posted pay always wins. For the majority of UAE postings that don't state
 * pay, the estimate comes from a benchmark table (below) built from 2025–26
 * salary-guide coverage and aggregator data — medium-to-low confidence, and
 * labelled as an estimate everywhere it's shown.
 */

import { sectorGroup } from './sectors';
import type { Application, Company, Profile } from './types';

export type FamilyId = keyof typeof FAMILIES;
export type Level = 0 | 1 | 2 | 3 | 4;

export const LEVEL_LABELS = ['Intern / trainee', 'Junior / graduate', 'Mid-level', 'Senior / manager', 'Head / director'] as const;

/**
 * AED a month, total package, private sector: [low, typical, high] for each
 * level 0 (intern) to 4 (head of / director). Anchored at levels 2–4 on the
 * Michael Page UAE Salary Guide 2026 as reported in the press, and on
 * aggregator data (Indeed, PayScale, Glassdoor) for the junior end, which is
 * largely extrapolated.
 */
export const FAMILIES = {
  software_engineering: {
    label: "Software engineering",
    keywords: ["software engineer", "software developer", "developer", "programmer", "backend", "back-end", "frontend", "front-end", "full stack", "fullstack", "mobile developer", "ios", "android", "devops", "sre", "site reliability", "cloud engineer", "platform engineer", "qa engineer", "test engineer", "sdet", "machine learning engineer", "ml engineer", "ai engineer", "solutions architect", "software architect", "tech lead", "engineering manager", "head of engineering", "cto"],
    levels: [[3000, 4500, 6500], [10000, 14000, 20000], [18000, 25000, 35000], [28000, 38000, 50000], [40000, 55000, 80000]],
  },
  data_analytics: {
    label: "Data & analytics (analyst, data scientist)",
    keywords: ["data analyst", "data scientist", "data engineer", "analytics", "business intelligence", "bi analyst", "bi developer", "business analyst", "insights analyst", "reporting analyst", "statistician", "quantitative analyst", "machine learning", "data science", "head of data", "chief data officer", "analytics engineer", "analyst"],
    levels: [[2500, 4000, 6000], [9000, 13000, 18000], [16000, 24000, 35000], [27000, 37000, 50000], [40000, 55000, 80000]],
  },
  product_management: {
    label: "Product management",
    keywords: ["product manager", "product owner", "associate product manager", "product lead", "head of product", "group product manager", "product director", "vp product", "chief product officer", "cpo", "product analyst", "product specialist"],
    levels: [[3000, 4000, 6000], [10000, 14000, 20000], [20000, 28000, 38000], [30000, 40000, 52000], [42000, 58000, 80000]],
  },
  finance_accounting: {
    label: "Finance & accounting",
    keywords: ["accountant", "accounting", "accounts payable", "accounts receivable", "financial analyst", "finance analyst", "fp&a", "financial planning", "auditor", "internal audit", "external audit", "financial controller", "controller", "treasury", "tax", "vat", "bookkeeper", "finance manager", "finance director", "cfo", "chief financial officer", "financial reporting", "cost accountant", "acca", "cpa", "finance"],
    levels: [[2500, 3500, 5000], [7000, 10000, 14000], [13000, 18000, 25000], [22000, 30000, 40000], [35000, 50000, 75000]],
  },
  banking: {
    label: "Banking (relationship manager, risk, compliance)",
    keywords: ["relationship manager", "banker", "banking", "private banking", "wealth manager", "corporate banking", "retail banking", "investment banking", "credit analyst", "credit risk", "risk manager", "risk analyst", "market risk", "operational risk", "compliance", "aml", "kyc", "mlro", "financial crime", "fraud", "trade finance", "branch manager", "underwriter", "treasury sales", "investment associate", "portfolio manager", "investment"],
    levels: [[3000, 4000, 6000], [9000, 13000, 18000], [18000, 26000, 36000], [30000, 42000, 58000], [48000, 68000, 100000]],
  },
  consulting_strategy: {
    label: "Consulting / strategy",
    keywords: ["consultant", "consulting", "management consultant", "strategy", "strategy analyst", "strategy manager", "associate consultant", "senior consultant", "advisory", "transformation", "engagement manager", "principal", "business consultant", "corporate development", "strategic planning", "chief strategy officer"],
    levels: [[3000, 4500, 6500], [11000, 15000, 22000], [20000, 28000, 40000], [32000, 45000, 60000], [50000, 70000, 100000]],
  },
  marketing_communications: {
    label: "Marketing & communications",
    keywords: ["marketing", "brand", "brand manager", "communications", "corporate communications", "pr", "public relations", "content", "copywriter", "social media", "digital marketing", "performance marketing", "seo", "sem", "crm marketing", "growth", "creative", "media", "events", "marketing manager", "marketing director", "cmo", "trade marketing"],
    levels: [[2000, 3000, 4500], [7000, 10000, 14000], [13000, 18000, 26000], [22000, 30000, 42000], [35000, 50000, 70000]],
  },
  sales_bd: {
    label: "Sales / business development",
    keywords: ["sales", "sales executive", "sales manager", "business development", "bdm", "account manager", "account executive", "key account", "commercial", "partnerships", "pre-sales", "presales", "inside sales", "territory manager", "channel manager", "sales director", "head of sales", "client acquisition"],
    levels: [[2000, 3000, 4500], [6000, 9000, 13000], [12000, 18000, 26000], [22000, 30000, 42000], [35000, 50000, 75000]],
  },
  hr_talent: {
    label: "HR & talent",
    keywords: ["hr", "human resources", "talent acquisition", "recruiter", "recruitment", "people partner", "people operations", "hr business partner", "hrbp", "learning and development", "l&d", "training officer", "compensation", "benefits", "reward", "employee relations", "emiratisation", "hr coordinator", "hr manager", "hr director", "chro", "organisational development"],
    levels: [[2000, 3000, 4500], [7000, 10000, 14000], [14000, 20000, 28000], [24000, 33000, 45000], [38000, 55000, 80000]],
  },
  operations_supply_chain: {
    label: "Operations & supply chain",
    keywords: ["operations", "operations manager", "supply chain", "logistics", "procurement", "purchasing", "buyer", "sourcing", "category manager", "warehouse", "inventory", "demand planner", "supply planner", "planning", "fleet", "shipping", "freight", "import", "export", "coo", "chief operating officer", "procurement director"],
    levels: [[2000, 3000, 4500], [6500, 9500, 13000], [12000, 18000, 25000], [22000, 30000, 42000], [35000, 48000, 70000]],
  },
  engineering_energy: {
    label: "Engineering (oil & gas / energy / civil / mechanical)",
    keywords: ["civil engineer", "mechanical engineer", "electrical engineer", "petroleum engineer", "reservoir engineer", "drilling", "process engineer", "chemical engineer", "structural engineer", "site engineer", "mep", "hse", "instrumentation", "piping", "maintenance engineer", "commissioning", "oil and gas", "oil & gas", "upstream", "downstream", "energy", "renewable", "solar", "nuclear", "utilities", "power plant", "geologist", "geophysicist", "production engineer", "field engineer", "engineer"],
    levels: [[2000, 3500, 5000], [8000, 11000, 15000], [14000, 20000, 28000], [24000, 32000, 45000], [38000, 52000, 75000]],
  },
  healthcare_non_physician: {
    label: "Healthcare (non-physician clinical/admin)",
    keywords: ["nurse", "nursing", "registered nurse", "midwife", "pharmacist", "physiotherapist", "occupational therapist", "radiographer", "sonographer", "lab technician", "medical laboratory", "dietitian", "nutritionist", "allied health", "dental hygienist", "respiratory therapist", "clinical coordinator", "medical coder", "health information", "patient services", "hospital administrator", "practice manager", "healthcare administrator", "clinical research"],
    levels: [[1500, 2500, 4000], [5000, 8000, 11000], [8000, 12000, 17000], [12000, 17000, 25000], [20000, 30000, 45000]],
  },
  legal: {
    label: "Legal",
    keywords: ["lawyer", "legal", "legal counsel", "counsel", "general counsel", "in-house counsel", "attorney", "advocate", "paralegal", "legal associate", "legal officer", "legal advisor", "legal consultant", "contracts manager", "company secretary", "trainee solicitor", "solicitor"],
    levels: [[3000, 4000, 5000], [10000, 15000, 22000], [22000, 35000, 50000], [38000, 52000, 70000], [55000, 75000, 110000]],
  },
  project_management: {
    label: "Project management",
    keywords: ["project manager", "program manager", "programme manager", "project coordinator", "pmo", "project director", "delivery manager", "scrum master", "agile coach", "project controls", "project planner", "project lead", "pmp"],
    levels: [[2000, 3500, 5000], [8000, 11000, 15000], [15000, 22000, 30000], [26000, 35000, 48000], [40000, 55000, 85000]],
  },
  customer_service_admin: {
    label: "Customer service / admin",
    keywords: ["customer service", "customer support", "customer care", "customer experience", "call center", "call centre", "contact center", "contact centre", "receptionist", "front desk", "administrator", "administrative assistant", "admin assistant", "office manager", "office administrator", "executive assistant", "personal assistant", "secretary", "data entry", "clerk", "document controller", "coordinator"],
    levels: [[1500, 2500, 3500], [4000, 6000, 9000], [7000, 10000, 14000], [11000, 15000, 21000], [16000, 23000, 32000]],
  },
  cybersecurity: {
    label: "Cybersecurity",
    keywords: ["cybersecurity", "cyber security", "cyber", "information security", "infosec", "security analyst", "security engineer", "security architect", "soc analyst", "soc", "penetration tester", "pentest", "ethical hacker", "grc", "iam", "identity and access", "threat intelligence", "incident response", "vulnerability", "ciso", "head of security"],
    levels: [[3000, 4500, 6000], [9000, 13000, 18000], [17000, 24000, 33000], [28000, 38000, 52000], [45000, 62000, 95000]],
  },
  government_relations_public_sector: {
    label: "Government relations / public sector",
    keywords: ["government relations", "government affairs", "public affairs", "public policy", "policy analyst", "policy advisor", "regulatory affairs", "stakeholder relations", "stakeholder management", "protocol", "international relations", "public sector", "government liaison", "institutional relations"],
    levels: [[2500, 4000, 6000], [9000, 13000, 18000], [16000, 23000, 32000], [26000, 36000, 48000], [40000, 58000, 85000]],
  },
} as const satisfies Record<string, { label: string; keywords: readonly string[]; levels: readonly (readonly [number, number, number])[] }>;

/** Paid internships in Dubai, all fields (Indeed, 2026): mostly AED 1,500–5,000 a month. */
const INTERN_RANGE = { low: 1_500, mid: 3_000, high: 5_000 };

/** The Emirati private-sector minimum wage from 1 January 2026 (MoHRE). */
export const EMIRATI_MIN_WAGE = 6_000;

/* ---------------------------------------------------------- classification */

function hasWord(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

/** The job family a title belongs to: the most specific keyword match wins. */
export function roleFamily(title: string, division = ''): FamilyId | undefined {
  const text = `${title} ${division}`.toLowerCase();
  let best: { id: FamilyId; len: number } | undefined;
  for (const [id, fam] of Object.entries(FAMILIES) as Array<[FamilyId, (typeof FAMILIES)[FamilyId]]>) {
    for (const kw of fam.keywords) {
      // Titles are weighed above divisions: "Data Analyst" in Finance is a data role.
      const inTitle = hasWord(title.toLowerCase(), kw);
      if (!inTitle && !hasWord(text, kw)) continue;
      const len = kw.length + (inTitle ? 100 : 0);
      if (!best || len > best.len) best = { id, len };
    }
  }
  return best?.id;
}

/**
 * Seniority for pay purposes. Stricter than relevance scoring about the word
 * "manager": a relationship or account manager is a mid-level individual
 * contributor in the UAE, not a people manager.
 */
export function payLevel(title: string): Level {
  const t = title.toLowerCase();
  if (/\b(intern|internship|apprentice|summer)\b/.test(t)) return 0;
  // Graduate programmes for nationals are salaried jobs, not stipends.
  if (/\bgraduate\b/.test(t)) return 1;
  if (/\btrainee\b/.test(t)) return 0;
  if (/\bassociate director\b/.test(t)) return 3;
  if (/\b(chief|ceo|cto|cfo|coo|cmo|cpo|ciso|vp|svp|evp|vice president|head of|director|general manager|managing director|partner)\b/.test(t)) return 4;
  if (/\bassistant manager\b/.test(t)) return 2;
  if (/\b(senior|sr|lead|principal|staff)\b/.test(t)) return 3;
  if (/\b(relationship|account|sales|client|property|community|social media|case|customer success|office|store|shift) manager\b/.test(t)) return 2;
  if (/\bmanager\b/.test(t)) return 3;
  if (/\b(graduate|junior|jr|entry[- ]level|associate|assistant|fresh|analyst i)\b/.test(t)) return 1;
  return 2;
}

/**
 * Employer-type adjustment from the company's sector. Banking and energy
 * aren't applied on top of families whose table already reflects them.
 */
export function employerMultiplier(company: Company | undefined, family: FamilyId | undefined): { factor: number; why?: string } {
  if (!company) return { factor: 1 };
  const group = sectorGroup(company.sector || '');
  if (group === 'Government & Public') return { factor: 1.15, why: 'government employer' };
  if (group === 'Banking & Finance' && family !== 'banking') return { factor: 1.15, why: 'banking & finance employer' };
  if (group === 'Energy & Utilities' && family !== 'engineering_energy') return { factor: 1.15, why: 'energy employer' };
  if (group === 'Technology' && company.tier === 'dream') return { factor: 1.2, why: 'top-tier tech employer' };
  if (group === 'Hospitality & Tourism' || group === 'Retail & Consumer') return { factor: 0.75, why: 'hospitality/retail employer' };
  return { factor: 1 };
}

/* --------------------------------------------------------------- estimate */

export interface PayView {
  /** AED a month: the posted range, or the estimate. */
  low: number;
  mid: number;
  high: number;
  /** posted/text = the employer said so; estimate = our benchmark. */
  basis: 'posted' | 'text' | 'manual' | 'estimate';
  family?: FamilyId;
  level?: Level;
  /** How the number was arrived at, for the tooltip. */
  notes: string[];
}

const round500 = (n: number) => Math.round(n / 500) * 500;

export function estimatePay(
  role: Pick<Application, 'roleTitle' | 'division' | 'employmentType'>,
  company?: Company
): PayView | undefined {
  const family = roleFamily(role.roleTitle, role.division);
  const level: Level = role.employmentType === 'internship' ? 0 : payLevel(role.roleTitle);
  if (!family) {
    // Any internship still has a known going rate, whatever the field.
    return level === 0
      ? { ...INTERN_RANGE, basis: 'estimate', level, notes: ['Typical paid UAE internship (Indeed Dubai data, 2026)'] }
      : undefined;
  }
  const [lo, mid, hi] = FAMILIES[family].levels[level];
  const { factor, why } = employerMultiplier(company, family);

  const notes = [`${FAMILIES[family].label}, ${LEVEL_LABELS[level].toLowerCase()} benchmark`];
  if (why) notes.push(`${factor > 1 ? '+' : '−'}${Math.round(Math.abs(factor - 1) * 100)}% for a ${why}`);

  // The Emirati minimum wage is a floor for employees; internships aren't covered.
  const floor = level === 0 ? 0 : EMIRATI_MIN_WAGE;
  const clamp = (n: number) => Math.max(floor, round500(n * factor));
  const view: PayView = { low: clamp(lo), mid: clamp(mid), high: clamp(hi), basis: 'estimate', family, level, notes };
  if (floor && lo * factor < floor) notes.push('raised to the AED 6,000 Emirati minimum wage');
  return view;
}

/** Posted pay if the role has it, otherwise the benchmark estimate. */
export function payFor(app: Application, company?: Company): PayView | undefined {
  const min = app.salaryMin ?? app.salaryMax;
  const max = app.salaryMax ?? app.salaryMin;
  if (min && max) {
    const basis = app.salarySource ?? 'posted';
    return {
      low: min,
      mid: Math.round((min + max) / 2),
      high: max,
      basis,
      notes: [
        basis === 'manual'
          ? 'entered by you'
          : basis === 'text'
            ? `stated in the job description${app.salaryText ? `: "${app.salaryText}"` : ''}`
            : `posted by the employer${app.salaryText ? `: "${app.salaryText}"` : ''}`,
      ],
    };
  }
  return estimatePay(app, company);
}

/* ------------------------------------------------------------------ Nafis */

export interface NafisView {
  eligible: boolean;
  /** Maximum monthly top-up, AED. Absent when it can't be worked out. */
  amount?: number;
  reason: string;
}

/**
 * Nafis salary support under the framework for people enrolling from
 * September 2026, as announced by the Emirati Talent Competitiveness Council
 * and reported in April 2026: up to AED 6,000 a month with a bachelor's,
 * 5,000 with a diploma, 4,000 with secondary school, for private-sector
 * salaries of AED 6,000–20,000. Figures are maximums; verify on nafis.gov.ae.
 */
export const NAFIS_CAPS = { degree: 6_000, diploma: 5_000, secondary: 4_000 } as const;
export const NAFIS_SALARY_RANGE = [6_000, 20_000] as const;

export function nafisTopUp(
  monthlyPay: number | undefined,
  education: Profile['educationLevel'],
  company?: Company,
  opts: { estimated?: boolean } = {}
): NafisView {
  if (company && sectorGroup(company.sector || '') === 'Government & Public') {
    return { eligible: false, reason: 'Government employer — Nafis covers private-sector jobs only' };
  }
  const amount =
    education === 'bachelor' || education === 'master' || education === 'doctorate'
      ? NAFIS_CAPS.degree
      : education === 'diploma'
        ? NAFIS_CAPS.diploma
        : education === 'high-school'
          ? NAFIS_CAPS.secondary
          : undefined;
  const upTo = amount === undefined ? 'AED 4,000–6,000 (by education)' : `AED ${amount.toLocaleString('en-US')}`;

  if (monthlyPay !== undefined && monthlyPay > NAFIS_SALARY_RANGE[1]) {
    return {
      eligible: false,
      reason: opts.estimated
        ? `Likely pays over AED 20,000, above Nafis salary support. An offer of 20,000 or less would qualify for up to ${upTo} a month.`
        : 'Pays over AED 20,000, above Nafis salary support',
    };
  }
  if (monthlyPay !== undefined && monthlyPay < NAFIS_SALARY_RANGE[0]) {
    return { eligible: false, reason: 'Below AED 6,000 — employers must pay Emiratis at least this' };
  }
  return {
    eligible: true,
    amount,
    reason:
      amount === undefined
        ? 'Up to AED 4,000–6,000 a month depending on your education — set it on your Profile'
        : `Up to ${upTo} a month on top of salary, for new Nafis enrolments from Sept 2026 (verify on nafis.gov.ae)`,
  };
}

/* ------------------------------------------------------------ opportunity */

export interface Opportunity {
  score: number;
  pay?: PayView;
  nafis: NafisView;
  /** Employer pay plus any Nafis top-up. */
  totalMid?: number;
  belowMinimum: boolean;
  ageDays?: number;
  parts: Array<{ label: string; points: number }>;
}

export function daysSince(date: string | undefined, today: string): number | undefined {
  if (!date) return undefined;
  const d = (Date.parse(today) - Date.parse(date.slice(0, 10))) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : undefined;
}

/**
 * One 0–100 number for "how much should this role get my time": relevance to
 * what you're looking for (45), pay against your minimum (25), freshness
 * (15) and the employer (15). Every part is shown in the tooltip, so the
 * ranking can be argued with.
 */
export function opportunity(app: Application, profile: Profile, company: Company | undefined, today: string): Opportunity {
  const pay = payFor(app, company);
  const nafis = nafisTopUp(pay?.mid, profile.educationLevel, company, { estimated: pay?.basis === 'estimate' });
  const totalMid = pay ? pay.mid + (nafis.eligible && nafis.amount ? nafis.amount : 0) : undefined;
  const parts: Opportunity['parts'] = [];

  // Once you've run the AI fit check against your CV, it outweighs keyword matching.
  const fit = app.aiFit !== undefined ? (app.score ?? 30) * 0.4 + app.aiFit * 0.6 : app.score ?? 30;
  const relevance = Math.round((fit / 100) * 45);
  parts.push({ label: app.aiFit !== undefined ? 'Fit (checked against your CV)' : 'Fit with your targets', points: relevance });

  // Pay: against your minimum if you've set one, otherwise on an absolute
  // scale from the minimum wage to AED 40k. Posted pay below your minimum is
  // a near-disqualifier; an estimate below it only costs points, because
  // estimates are rough.
  const min = profile.minMonthlySalary;
  let payPoints = 10;
  let belowMinimum = false;
  if (pay && totalMid !== undefined) {
    const certain = pay.basis !== 'estimate';
    if (min && pay.high + (nafis.amount ?? 0) < min) {
      belowMinimum = certain;
      payPoints = certain ? 0 : 4;
    } else {
      const base = min || EMIRATI_MIN_WAGE;
      payPoints = Math.round(Math.min(1, Math.max(0, (totalMid - base) / Math.max(10_000, 40_000 - base))) * 20) + (certain ? 5 : 2);
    }
  }
  parts.push({ label: pay ? (pay.basis === 'estimate' ? 'Pay (estimated)' : 'Pay (stated)') : 'Pay (unknown)', points: payPoints });

  const ageDays = daysSince(app.postedAt ?? app.createdAt, today);
  const fresh = ageDays === undefined ? 7 : ageDays <= 7 ? 15 : ageDays <= 14 ? 12 : ageDays <= 30 ? 8 : ageDays <= 60 ? 4 : 1;
  parts.push({ label: ageDays === undefined ? 'Freshness (unknown)' : `Posted ${ageDays}d ago`, points: fresh });

  let employer = company ? (company.tier === 'dream' ? 11 : company.tier === 'target' ? 8 : 5) : 4;
  if (company?.emiratisation) employer += 4;
  parts.push({ label: company ? `${company.tier}-tier employer${company.emiratisation ? ', Emiratisation' : ''}` : 'Employer not in your list', points: Math.min(15, employer) });

  let score = parts.reduce((s, p) => s + p.points, 0);
  if (app.closed) score = Math.round(score * 0.3);
  return { score: Math.max(0, Math.min(100, score)), pay, nafis, totalMid, belowMinimum, ageDays, parts };
}
