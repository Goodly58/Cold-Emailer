// Corporate email address inference. Companies use a consistent pattern for
// every employee, so once you know one address at a company you know them all.
// Generate candidates -> verify -> send to the one that resolves.

export const PATTERNS: Record<string, (f: string, l: string) => string> = {
  'first.last': (f, l) => `${f}.${l}`,
  firstlast: (f, l) => `${f}${l}`,
  'f.last': (f, l) => `${f[0]}.${l}`,
  flast: (f, l) => `${f[0]}${l}`,
  'first_last': (f, l) => `${f}_${l}`,
  'first-last': (f, l) => `${f}-${l}`,
  first: (f) => f,
  'last.first': (f, l) => `${l}.${f}`,
  'lastf': (f, l) => `${l}${f[0]}`,
  'first.l': (f, l) => `${f}.${l[0]}`,
};

/** Order matters: most common in UAE corporates first. */
export const PATTERN_ORDER = [
  'first.last',
  'f.last',
  'firstlast',
  'first_last',
  'flast',
  'first',
  'first.l',
  'last.first',
  'first-last',
  'lastf',
];

function normalize(part: string): string {
  return part
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export interface NameParts {
  first: string;
  last: string;
}

/**
 * Split a full name. Arabic names often carry particles (Al, bin, bint, Abu)
 * that belong to the surname — "Sara Al Mansoori" -> first "sara", last
 * "almansoori", which is how UAE corporate addresses are usually built.
 */
export function splitName(fullName: string): NameParts | null {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const first = normalize(tokens[0]);
  const particles = new Set(['al', 'el', 'bin', 'ben', 'bint', 'abu', 'abd', 'van', 'von', 'de', 'da', 'del']);

  // Walk from the end backwards, absorbing particles into the surname.
  let startOfLast = tokens.length - 1;
  while (startOfLast > 1 && particles.has(normalize(tokens[startOfLast - 1]))) {
    startOfLast -= 1;
  }
  const last = tokens.slice(startOfLast).map(normalize).join('');

  if (!first || !last) return null;
  return { first, last };
}

/** All plausible addresses for a person at a domain, best guess first. */
export function generateCandidates(fullName: string, domain: string, preferred?: string): string[] {
  const parts = splitName(fullName);
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!parts || !clean) return [];

  const order = preferred && PATTERNS[preferred]
    ? [preferred, ...PATTERN_ORDER.filter((p) => p !== preferred)]
    : PATTERN_ORDER;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of order) {
    const build = PATTERNS[key];
    if (!build) continue;
    const local = build(parts.first, parts.last);
    const addr = `${local}@${clean}`;
    if (!seen.has(addr)) {
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}

/** Infer a company's pattern from one address you already know is right. */
export function inferPattern(knownEmail: string, fullName: string): string | null {
  const parts = splitName(fullName);
  if (!parts) return null;
  const local = knownEmail.split('@')[0]?.toLowerCase();
  if (!local) return null;
  for (const key of PATTERN_ORDER) {
    if (PATTERNS[key](parts.first, parts.last) === local) return key;
  }
  return null;
}

/** Division presets — big UAE employers hire per business unit, not centrally. */
export const DIVISION_PRESETS: Record<string, string[]> = {
  Banking: [
    'Retail Banking',
    'Corporate & Investment Banking',
    'Private Banking / Wealth',
    'Treasury & Markets',
    'Risk',
    'Compliance & AML',
    'Technology / Digital',
    'Data & Analytics',
    'Operations',
    'Finance',
    'Human Resources / Emiratisation',
    'Strategy',
    'Marketing',
  ],
  Tech: [
    'Engineering',
    'Product',
    'Data & Analytics',
    'Design',
    'Security',
    'Infrastructure / Platform',
    'Sales / Commercial',
    'Marketing',
    'Operations',
    'People / Talent',
    'Finance',
  ],
  Energy: [
    'Upstream',
    'Downstream',
    'Trading & Supply',
    'Projects & Engineering',
    'HSE',
    'Technology / Digital',
    'Sustainability',
    'Finance',
    'Procurement / Supply Chain',
    'Human Capital',
    'Strategy',
  ],
  Consulting: [
    'Strategy',
    'Operations',
    'Technology / Digital',
    'People & Organisation',
    'Public Sector / Government',
    'Financial Services',
    'Energy & Resources',
    'Risk & Compliance',
    'Deals / M&A',
    'Recruiting',
  ],
  'Sovereign Investment': [
    'Direct Investments',
    'Public Markets',
    'Private Equity',
    'Real Estate & Infrastructure',
    'Portfolio Management',
    'Risk',
    'Legal & Compliance',
    'Finance',
    'Technology',
    'Human Capital',
  ],
  Aviation: [
    'Flight Operations',
    'Engineering & Maintenance',
    'Commercial / Network Planning',
    'Ground Operations',
    'Cargo',
    'Customer Experience',
    'Technology / Digital',
    'Finance',
    'Human Resources',
    'Safety & Compliance',
  ],
  Healthcare: [
    'Clinical Operations',
    'Nursing',
    'Quality & Patient Safety',
    'Digital Health / IT',
    'Revenue Cycle',
    'Facilities',
    'Finance',
    'Human Resources',
    'Strategy',
  ],
  Telecom: [
    'Network / Engineering',
    'IT & Digital',
    'Consumer / B2C',
    'Enterprise / B2B',
    'Data & AI',
    'Customer Experience',
    'Finance',
    'Regulatory',
    'Human Resources / Emiratisation',
  ],
  Default: [
    'Operations',
    'Finance',
    'Technology / IT',
    'Human Resources / Emiratisation',
    'Sales / Commercial',
    'Marketing',
    'Strategy',
    'Legal & Compliance',
    'Procurement',
  ],
};

/** Best-guess divisions for a company's sector string. */
export function divisionsForSector(sector: string): string[] {
  const s = sector.toLowerCase();
  if (s.includes('bank') || s.includes('insurance')) return DIVISION_PRESETS.Banking;
  if (s.includes('consult')) return DIVISION_PRESETS.Consulting;
  if (s.includes('invest') || s.includes('sovereign')) return DIVISION_PRESETS['Sovereign Investment'];
  if (s.includes('energy') || s.includes('petro') || s.includes('utilit') || s.includes('nuclear'))
    return DIVISION_PRESETS.Energy;
  if (s.includes('aviation') || s.includes('airline')) return DIVISION_PRESETS.Aviation;
  if (s.includes('health') || s.includes('medic')) return DIVISION_PRESETS.Healthcare;
  if (s.includes('telecom')) return DIVISION_PRESETS.Telecom;
  if (s.includes('tech') || s.includes('ai') || s.includes('software') || s.includes('fintech'))
    return DIVISION_PRESETS.Tech;
  return DIVISION_PRESETS.Default;
}

/** One-click research links — everything public about a person, in four tabs. */
export function researchLinks(name: string, company: string) {
  const q = (s: string) => encodeURIComponent(s);
  return [
    {
      label: 'LinkedIn profile',
      url: `https://www.linkedin.com/search/results/people/?keywords=${q(`${name} ${company}`)}`,
      hint: 'Their role, tenure, past employers, education',
    },
    {
      label: 'Google',
      url: `https://www.google.com/search?q=${q(`"${name}" "${company}"`)}`,
      hint: 'Interviews, panels, quotes, bio pages',
    },
    {
      label: 'Recent news',
      url: `https://www.google.com/search?q=${q(`"${name}" ${company}`)}&tbm=nws`,
      hint: 'Promotions, launches, announcements — best hook material',
    },
    {
      label: 'Company news',
      url: `https://www.google.com/search?q=${q(`${company} UAE`)}&tbm=nws&tbs=qdr:m3`,
      hint: 'Last 3 months — what the team is working on',
    },
  ];
}
