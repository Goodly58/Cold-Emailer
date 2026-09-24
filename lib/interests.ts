/**
 * Interests: the fields you want to work in, used to tag roles, companies
 * and events so every list can be filtered to them and the ranking can
 * favour them.
 *
 * Matching is phrase-based and deliberately literal, so a tag can always be
 * explained ("title says 'portfolio manager'"). Text is lowercased and
 * punctuation becomes spaces (except & + #), then each phrase must appear as
 * whole words: "ai" matches "AI Engineer" but not "Dubai" or "Retail".
 *
 * Pure and dependency-free, so it runs in the browser and on the server.
 */

import type { Company } from './types';

export type InterestId = 'investing' | 'finance' | 'cyber' | 'ai';

export const INTEREST_IDS: InterestId[] = ['investing', 'finance', 'cyber', 'ai'];

export interface InterestDef {
  id: InterestId;
  label: string;
  short: string;
  description: string;
  /** In a title, one of these puts the role squarely in the field. */
  title: string[];
  /** Titles containing one of these are never in the field, whatever else matches. */
  exclude: string[];
  /** Extra phrases that only count in a job description or department. */
  context: string[];
  /** Distinct description phrases needed before a role "mentions" the field. */
  mentionThreshold: number;
  /**
   * Title words too generic to count in a description: "tax-free salary,
   * medical insurance, paid by bank transfer" is benefits boilerplate, not a
   * finance job, and "an AI-powered company" says nothing about the role.
   */
  descriptionStop: string[];
  /** Fallback for companies without curated tags: matched against the sector label. */
  sector: string[];
  /** Sector phrases that veto the fallback, e.g. "money exchange" isn't investing. */
  sectorExclude: string[];
}

export const INTERESTS: Record<InterestId, InterestDef> = {
  investing: {
    id: 'investing',
    label: 'Investing & markets',
    short: 'Investing',
    description:
      'Sovereign wealth funds, asset and wealth managers, private equity, venture capital, family offices, brokers and exchanges; investment, portfolio, trading, M&A and capital-markets roles.',
    title: [
      'investment', 'investments', 'investor relations', 'investing', 'portfolio', 'portfolio manager',
      'asset management', 'asset manager', 'wealth management', 'wealth manager', 'wealth', 'private banker',
      'private equity', 'venture capital', 'venture', 'vc', 'hedge fund', 'fund', 'funds', 'fund manager',
      'fund accountant', 'fund accounting', 'fund operations', 'equity research', 'equities', 'equity analyst',
      'trader', 'trading', 'dealing', 'capital markets', 'debt capital markets', 'equity capital markets', 'dcm',
      'ecm', 'm&a', 'mergers', 'acquisitions', 'corporate development', 'transaction services',
      'transaction advisory', 'deals advisory', 'valuation', 'valuations', 'investment banking',
      'investment banker', 'securities', 'brokerage', 'stockbroker', 'quant', 'quantitative', 'fixed income',
      'derivatives', 'asset allocation', 'multi asset', 'family office', 'alternatives', 'alternative investments',
      'private markets', 'public markets', 'private credit', 'direct investments', 'co investment', 'buy side',
      'sell side', 'market maker', 'market making', 'sovereign', 'limited partner', 'private banking',
      'structured products', 'deal advisory', 'transaction diligence', 'financial due diligence',
      'corporate finance', 'growth equity', 'leveraged finance', 'money market', 'money markets',
      'treasury dealer', 'dealer treasury', 'fx dealer', 'forex dealer', 'foreign exchange dealer', 'chief dealer',
    ],
    exclude: [
      'real estate broker', 'property broker', 'real estate agent', 'property consultant', 'insurance broker',
      'customs broker', 'project portfolio', 'product portfolio', 'programme portfolio', 'program portfolio',
      'portfolio management office', 'brand portfolio', 'retail trading', 'trade marketing', 'car dealer',
      'vehicle dealer', 'dealer sales', 'dealer network', 'dealer development', 'fund raising', 'fundraising',
      'fundraiser', 'investment promotion', 'investment attraction', 'wealth of experience',
      'real estate brokerage', 'insurance brokerage', 'customs', 'property investment', 'property & investment',
      'property and investment', 'off plan', 'real estate investment consultant', 'real estate investment advisor',
      'general trading', 'trading company', 'pmo', 'it portfolio', 'portfolio marketing', 'fund development',
      'funds transfer', 'foreign direct investment', 'social investment', 'media investment', 'media buying',
      'asset management engineer', 'it asset', 'facilities management', 'maintenance', 'capital investment',
      'joint venture', 'av vc', 'audio visual', 'video conferencing', 'talent acquisitions', 'used car',
      'vehicle valuation', 'market research', 'sovereign cloud', 'sovereign ai', 'security portfolio',
      'cybersecurity portfolio', 'solutions portfolio',
    ],
    context: [
      'due diligence', 'financial modelling', 'financial modeling', 'investment committee', 'irr', 'dcf', 'cfa',
      'deal flow', 'deal sourcing', 'portfolio companies', 'assets under management', 'aum', 'limited partners',
      'capital raising', 'secondaries', 'bloomberg terminal', 'pitch books', 'pitchbook',
    ],
    mentionThreshold: 2,
    descriptionStop: ['investment', 'investments', 'investing', 'portfolio', 'wealth', 'venture', 'vc', 'fund', 'funds', 'trading', 'trader', 'dealing', 'equities', 'securities', 'valuation', 'valuations', 'quant', 'quantitative', 'sovereign', 'alternatives', 'acquisitions', 'mergers', 'brokerage'],
    sector: [
      'sovereign', 'investment', 'investments', 'asset management', 'wealth', 'private equity', 'venture', 'hedge fund',
      'family office', 'brokerage', 'securities', 'stock exchange', 'capital markets', 'digital asset exchange',
      'virtual asset exchange', 'wealthtech', 'alternative asset', 'fund management',
    ],
    sectorExclude: [
      'money exchange', 'remittance', 'real estate', 'law', 'media investment', 'investment promotion', 'fdi',
      'hospitality', 'education & healthcare', 'recruitment', 'communications', 'destination',
    ],
  },
  finance: {
    id: 'finance',
    label: 'Banking & finance',
    short: 'Finance',
    description:
      'Banks, fintech and payments, insurance and takaful, and finance roles anywhere: credit, treasury, risk, FP&A, accounting, audit, compliance and financial crime.',
    title: [
      'finance', 'financial', 'bank', 'banking', 'banker', 'credit', 'lending', 'loan', 'loans', 'mortgage',
      'mortgages', 'treasury', 'treasurer', 'fp&a', 'financial planning', 'financial analyst', 'finance analyst',
      'accountant', 'accounting', 'accounts payable', 'accounts receivable', 'accounts executive',
      'accounts officer', 'accounts assistant', 'accounts manager', 'audit', 'auditor', 'tax', 'vat',
      'financial controller', 'cfo', 'payments', 'payment', 'fintech', 'insurance', 'underwriter', 'underwriting',
      'actuary', 'actuarial', 'claims', 'takaful', 'reinsurance', 'relationship manager', 'relationship officer',
      'aml', 'kyc', 'anti money laundering', 'financial crime', 'fraud', 'sanctions', 'collections',
      'cash management', 'trade finance', 'correspondent banking', 'islamic finance', 'sukuk', 'economist',
      'budget', 'budgeting', 'costing', 'cost accountant', 'cost controller', 'bookkeeper', 'revenue assurance',
      'billing and collections', 'teller', 'credit card', 'cards', 'bancassurance', 'market risk',
      'liquidity risk', 'accounts clerk', 'accounts supervisor', 'accounts & admin', 'accounts and admin',
      'taxation', 'transfer pricing', 'ifrs', 'regulatory reporting', 'loss adjuster', 'transaction monitoring',
      'customer due diligence', 'cdd', 'money laundering', 'mlro', 'shariah compliance', 'sharia compliance',
      'remittance', 'money exchange', 'exchange house',
    ],
    exclude: [
      'blood bank', 'food bank', 'key accounts', 'key account', 'strategic accounts', 'global accounts',
      'national accounts', 'clinical audit', 'quality audit', 'quality auditor', 'hse audit', 'safety audit',
      'food safety', 'energy audit', 'iso auditor', 'warranty claims', 'question bank', 'clinical auditor', 'hse',
      'qhse', 'hseq', 'energy auditor', 'safety auditor', 'iso 9001', 'iso 14001', 'iso 45001',
      'social compliance', 'process auditor', 'environmental auditor', 'contracts & claims',
      'contracts and claims', 'delay claims', 'quantity surveyor', 'museum', 'collections care', 'archives',
      'merchandiser', 'public relationship', 'patient relationship', 'costing engineer', 'health economist',
    ],
    context: [
      'ifrs', 'financial statements', 'reconciliation', 'reconciliations', 'general ledger', 'credit risk',
      'market risk', 'basel', 'cbuae', 'central bank', 'financial reporting', 'balance sheet', 'p&l', 'cash flow',
      'dfsa', 'fsra', 'erp finance', 'sap fico', 'month end close', 'underwriting', 'acca', 'cpa', 'cma',
    ],
    mentionThreshold: 3,
    descriptionStop: ['finance', 'financial', 'bank', 'banking', 'banker', 'credit', 'lending', 'loan', 'loans', 'mortgage', 'mortgages', 'payment', 'payments', 'insurance', 'claims', 'tax', 'taxation', 'vat', 'audit', 'auditor', 'accounting', 'accountant', 'budget', 'budgeting', 'costing', 'collections', 'cards', 'credit card', 'fraud', 'sanctions', 'economist', 'remittance', 'cfo', 'teller', 'ifrs'],
    sector: [
      'bank', 'banking', 'banks', 'fintech', 'payment', 'payments', 'insurance', 'takaful', 'reinsurance',
      'finance', 'financial', 'financing', 'credit', 'lending', 'money exchange', 'remittance', 'central bank',
      'bnpl', 'neobank', 'insurtech',
    ],
    sectorExclude: ['law', 'recruitment', 'communications', 'market research', 'health insurance tpa', 'aviation finance'],
  },
  cyber: {
    id: 'cyber',
    label: 'Cybersecurity',
    short: 'Cyber',
    description:
      'Security operations, threat intelligence, incident response, penetration testing, GRC, identity and access, cloud, application and OT security; and companies whose business is cybersecurity.',
    title: [
      'cyber', 'cybersecurity', 'cyber security', 'information security', 'infosec', 'it security',
      'security analyst', 'security engineer', 'security architect', 'security consultant', 'security specialist',
      'security operations center', 'security operations centre', 'soc', 'soc analyst', 'siem', 'secops',
      'threat intelligence', 'threat hunter', 'threat hunting', 'threat detection', 'threat analyst',
      'incident response', 'incident responder', 'dfir', 'digital forensics', 'penetration tester', 'pentester',
      'pen tester', 'red team', 'blue team', 'purple team', 'ethical hacker', 'offensive security',
      'vulnerability', 'appsec', 'application security', 'product security', 'devsecops', 'cloud security',
      'network security', 'ot security', 'ics security', 'scada security', 'iam', 'identity and access',
      'identity & access', 'identity access management', 'privileged access', 'ciso', 'cryptography',
      'cryptographer', 'malware', 'security researcher', 'bug bounty', 'data protection officer',
      'privacy engineer', 'zero trust', 'endpoint security', 'edr', 'xdr', 'security awareness',
      'information assurance', 'isms', 'iso 27001', 'cyber defense', 'cyber defence', 'csirt', 'cert analyst',
      'security governance', 'security risk', 'security compliance', 'firewall engineer',
      'security operations analyst', 'security operations engineer', 'digital forensic', 'cybercrime', 'pentest',
      'pentesting', 'penetration testing', 'penetration test', 'vapt', 'red teamer', 'firewall', 'cyberark',
      'identity governance', 'soar', 'detection and response', 'detection & response', 'dlp',
      'data loss prevention', 'security architecture', 'security engineering', 'security automation', 'pki',
      'grc analyst', 'grc specialist', 'grc consultant', 'grc officer', 'grc lead', 'grc manager', 'grc associate',
      'grc director', 'grc advisor', 'head of grc', 'it grc', 'analyst grc', 'specialist grc', 'associate grc',
    ],
    exclude: [
      'security guard', 'security supervisor', 'physical security', 'safety and security',
      'security services officer', 'cctv', 'food security', 'social security', 'security clearance',
      'event security', 'close protection', 'bodyguard', 'hotel security', 'mall security', 'security patrol',
      'aviation security', 'airport security', 'maritime security', 'port security', 'energy security',
      'water security', 'national security', 'sira', 'elv', 'fire', 'hse', 'oil spill', 'climate',
      'loss prevention & security', 'loss prevention and security',
    ],
    context: [
      'siem', 'soc', 'splunk', 'qradar', 'sentinel', 'crowdstrike', 'nist', 'iso 27001', 'mitre att&ck',
      'penetration testing', 'incident response', 'vulnerability management', 'threat intelligence', 'firewall',
      'firewalls', 'zero trust', 'ids ips', 'dlp', 'edr', 'cissp', 'cism', 'ceh', 'oscp', 'ia standards', 'uae ia',
      'nesa', 'owasp', 'identity and access management', 'security operations', 'grc',
    ],
    mentionThreshold: 2,
    descriptionStop: ['cyber', 'cybersecurity', 'cyber security', 'information security', 'it security', 'data protection officer', 'security awareness', 'firewall', 'vulnerability'],
    sector: [
      'cyber', 'cybersecurity', 'cyber security', 'information security', 'infosec', 'managed security', 'mssp',
      'security software',
      'security solutions', 'digital forensics', 'identity security',
    ],
    sectorExclude: ['physical security', 'security guarding', 'manned guarding', 'cash in transit'],
  },
  ai: {
    id: 'ai',
    label: 'AI & machine learning',
    short: 'AI',
    description:
      'Machine learning, data science, LLMs and generative AI, NLP, computer vision, MLOps, AI research, AI product and AI governance; and companies whose business is AI.',
    title: [
      'ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'data scientist', 'data science',
      'nlp', 'natural language processing', 'computer vision', 'llm', 'llms', 'large language model',
      'large language models', 'generative ai', 'genai', 'gen ai', 'mlops', 'ml ops', 'applied scientist',
      'prompt engineer', 'responsible ai', 'conversational ai', 'chatbot', 'speech recognition',
      'reinforcement learning', 'neural', 'recommender', 'recommendation systems', 'ai researcher', 'ai scientist',
      'data annotation', 'data labelling', 'data labeling', 'agentic', 'llmops', 'speech scientist',
      'data annotator', 'foundation model', 'foundation models', 'perception engineer', 'machine vision',
    ],
    exclude: [
      'nlp coach', 'nlp practitioner', 'nlp trainer', 'life coach', 'ml tf', 'ml & tf', 'insemination',
    ],
    context: [
      'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'scikit learn', 'hugging face', 'llm', 'llms',
      'large language models', 'generative ai', 'nlp', 'computer vision', 'mlops', 'rag',
      'retrieval augmented generation', 'fine tuning', 'transformers', 'model training', 'neural networks',
      'vector database', 'langchain', 'openai', 'ai agents', 'predictive models', 'data science',
    ],
    mentionThreshold: 2,
    descriptionStop: ['ai', 'artificial intelligence', 'ml', 'chatbot', 'neural', 'agentic', 'genai', 'gen ai', 'generative ai'],
    sector: [
      'ai', 'artificial intelligence', 'machine learning', 'data science', 'generative', 'genai', 'ai infrastructure',
      'ai research', 'computer vision', 'conversational ai',
    ],
    sectorExclude: [],
  },
};

/* ------------------------------------------------------------ matching */

/** Lowercase, punctuation to spaces (keeping & + #), padded for whole-word search. */
export function normalizeForMatch(text: string | undefined | null): string {
  const t = (text || '')
    .toLowerCase()
    .replace(/\ba\.i\.?(?![a-z])/g, 'ai')
    // "Finance&Admin", "Data&AI", "Cyber+Cloud" are two words; "m&a", "fp&a", "c++" are one.
    .replace(/([a-z0-9]{2,})([&+])(?=[a-z0-9]{2,})/g, '$1 $2 ')
    .replace(/[^a-z0-9&+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // "M & A", "FP & A" written with spaces.
    .replace(/(^| )([a-z]{1,2}) & ([a-z])(?= |$)/g, '$1$2&$3');
  return ` ${t} `;
}

export function hasPhrase(normalized: string, phrase: string): boolean {
  return normalized.includes(` ${phrase} `);
}

function hits(normalized: string, phrases: string[]): string[] {
  return phrases.filter((p) => hasPhrase(normalized, p));
}

function withoutPhrases(normalized: string, phrases: string[]): string {
  let out = normalized;
  for (const p of phrases) out = out.split(` ${p} `).join(' | ');
  return out;
}

/** "generative ai" and "ai" from one mention are one hit, not two. */
function withoutSubPhrases(found: string[]): string[] {
  return found.filter((p) => !found.some((q) => q !== p && ` ${q} `.includes(` ${p} `)));
}

export interface InterestMatch {
  id: InterestId;
  /** title = the role itself is in the field; mention = its department or description is. */
  via: 'title' | 'mention';
  /** The phrases that matched, for the tooltip. */
  terms: string[];
}

/**
 * Which fields a role belongs to. The title decides; the department and the
 * job description only add a weaker "mention" when enough distinct field
 * phrases appear, so one passing reference to "AI" in a sales job doesn't
 * make it an AI role.
 */
export function matchRoleInterests(role: { title: string; division?: string; description?: string }): InterestMatch[] {
  const title = normalizeForMatch(role.title);
  const dept = normalizeForMatch(role.division);
  const desc = role.description ? normalizeForMatch(role.description.slice(0, 20_000)) : '';
  const out: InterestMatch[] = [];

  for (const def of Object.values(INTERESTS)) {
    const vetoed = hits(title, def.exclude).length > 0;
    const inTitle = vetoed ? [] : hits(title, def.title);
    if (inTitle.length) {
      out.push({ id: def.id, via: 'title', terms: inTitle });
      continue;
    }
    if (vetoed) continue;
    // Excluded phrases are blanked out first, so "a wealth of experience" or
    // "general trading company" in an ad can't count towards the field.
    const inDept = hits(withoutPhrases(dept, def.exclude), def.title);
    const descPhrases = [...def.title.filter((p) => !def.descriptionStop.includes(p)), ...def.context];
    const inDesc = desc ? hits(withoutPhrases(desc, def.exclude), descPhrases) : [];
    const distinct = withoutSubPhrases([...new Set([...inDept, ...inDesc])]);
    if (inDept.length || distinct.length >= def.mentionThreshold) {
      out.push({ id: def.id, via: 'mention', terms: distinct.slice(0, 6) });
    }
  }
  return out;
}

/**
 * The fields a company works in: its curated tags when it has them (the
 * starter list is tagged by hand), otherwise a guess from its sector label.
 */
export function companyInterests(company: Pick<Company, 'sector'> & { interests?: InterestId[] }): InterestId[] {
  if (company.interests) return company.interests;
  const sector = normalizeForMatch(company.sector);
  return INTEREST_IDS.filter((id) => {
    const def = INTERESTS[id];
    return hits(sector, def.sector).length > 0 && hits(sector, def.sectorExclude).length === 0;
  });
}

/**
 * An event's fields: the ones set on it, otherwise whatever its name and
 * description say ("Dubai FinTech Summit" is finance), so events you add
 * yourself show up under a field without extra work.
 */
export function eventInterests(event: { name: string; description?: string; interests?: InterestId[] }): InterestId[] {
  if (event.interests) return event.interests;
  const found = matchRoleInterests({ title: event.name, description: event.description }).map((m) => m.id);
  return INTEREST_IDS.filter((id) => found.includes(id));
}

export function isInterestId(v: unknown): v is InterestId {
  return typeof v === 'string' && (INTEREST_IDS as string[]).includes(v);
}

export function interestLabels(ids: InterestId[]): string {
  return ids.map((id) => INTERESTS[id].short).join(', ');
}
