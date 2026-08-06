/**
 * Arabic and expat name handling (CULTURE.md §3, §4, §8).
 *
 * Two jobs, and they must not be confused:
 *
 *   1. DEDUPLICATION. "Mohammed Al Marri" from a leadership page and "Mohamed
 *      AlMarri" from a search result are one person. Without a stable key they
 *      become two ladder rungs, two live sequences at one company, and one
 *      bounced email variant. `phoneticKey()` collapses transliteration
 *      families so the database can enforce one-person-per-company.
 *
 *   2. ADDRESS. Which token to greet. The last token of an Arabic name is not
 *      reliably a surname — in `Ahmed Hassan Ibrahim` it is the grandfather's
 *      given name, and `Dear Mr. Ibrahim` addresses a man by it. This is
 *      exactly why the Gulf `Mr. + first name` convention exists.
 *
 * The rule that outranks both: **never reformat their name.** `full_name_raw`
 * is stored exactly as the source rendered it. Everything here derives
 * alongside it, never over it. If their signature says "Mohd Al Blooshi", we
 * write Mohd.
 */

export type NationalityBucket =
  | 'emirati'
  | 'gcc_arab'
  | 'levant_egypt_arab'
  | 'south_asian'
  | 'filipino'
  | 'western'
  | 'east_asian'
  | 'unknown';

export type Gender = 'M' | 'F' | 'unknown';

/** Honorifics that may exist, all of which must be copied from a source. */
export type Honorific = 'H.E.' | 'Dr.' | 'Eng.' | 'Sheikh' | 'Sheikha' | 'H.H.';

/** son of / daughter of. Connectors, never name tokens. */
const PATRONYMIC_CONNECTORS = new Set(['bin', 'ben', 'bint', 'ibn', 'bn', 'al-din', 'ud-din']);

/**
 * Lineage particles. These are part of the family name and must never be split
 * off — a naive `split(' ')[1]` on "Ahmed Al Mazrouei" yields "Al", and
 * `Dear Mr. Al,` is the single clearest tell that an email came off a list.
 */
const FAMILY_PARTICLES = new Set(['al', 'el', 'ash', 'ad', 'az', 'as', 'abu', 'abd', 'bu']);

/**
 * Transliteration families. Each entry maps every spelling seen in the wild to
 * one key. Deliberately conservative: merging two genuinely different names is
 * worse than missing a duplicate, because the merge silently drops a real
 * person from the ladder.
 */
const TRANSLITERATION_FAMILIES: Record<string, string[]> = {
  mohammed: ['mohammed', 'mohamed', 'mohammad', 'muhammad', 'muhammed', 'mohd', 'mohammod', 'mehmet'],
  ahmed: ['ahmed', 'ahmad', 'ahmet', 'ahmd'],
  abdullah: ['abdullah', 'abdulla', 'abdallah', 'abdalla', 'abdollah'],
  abdulrahman: ['abdulrahman', 'abdelrahman', 'abdurrahman', 'abdul rahman', 'abd al rahman'],
  hamad: ['hamad', 'hamed', 'hammad'],
  hamdan: ['hamdan', 'hamadan'],
  khalid: ['khalid', 'khaled', 'khalifa'].slice(0, 2),
  saeed: ['saeed', 'said', 'sayed', 'saïd', 'saed'],
  sultan: ['sultan', 'soltan'],
  yousef: ['yousef', 'youssef', 'yusuf', 'yousif', 'yusef', 'joseph'].slice(0, 5),
  ibrahim: ['ibrahim', 'ebrahim', 'ibraheem'],
  hussain: ['hussain', 'hussein', 'husain', 'husayn', 'hossein'],
  hassan: ['hassan', 'hasan', 'hassen'],
  fatima: ['fatima', 'fatema', 'fatma', 'fatimah'],
  aisha: ['aisha', 'aysha', 'ayesha', 'aicha'],
  maryam: ['maryam', 'mariam', 'meriem', 'marium'],
  noora: ['noora', 'nora', 'noura', 'nour', 'noor'],
  shamma: ['shamma', 'shama'],
  mansoori: ['mansoori', 'mansouri', 'mansuri', 'almansoori', 'almansouri'],
  mazrouei: ['mazrouei', 'mazrui', 'mazroui', 'almazrouei'],
  suwaidi: ['suwaidi', 'suweidi', 'alsuwaidi'],
  ketbi: ['ketbi', 'katbi', 'alketbi'],
  nuaimi: ['nuaimi', 'noaimi', 'nuaimy', 'alnuaimi'],
  marri: ['marri', 'mari', 'almarri'],
  muhairi: ['muhairi', 'mehairi', 'muhairy', 'mheiri', 'almuhairi'],
  blooshi: ['blooshi', 'balooshi', 'baloushi', 'albloushi', 'bloushi'],
  hosani: ['hosani', 'hosany', 'husani', 'alhosani'],
  hammadi: ['hammadi', 'hamadi', 'alhammadi'],
  shamsi: ['shamsi', 'shamsy', 'alshamsi'],
  marzooqi: ['marzooqi', 'marzouqi', 'marzouki', 'almarzooqi'],
  qubaisi: ['qubaisi', 'kubaisi', 'qabaisi', 'alqubaisi'],
  dhaheri: ['dhaheri', 'daheri', 'zaheri', 'aldhaheri'],
};

const SPELLING_TO_FAMILY = new Map<string, string>();
for (const [family, spellings] of Object.entries(TRANSLITERATION_FAMILIES)) {
  for (const spelling of spellings) SPELLING_TO_FAMILY.set(spelling.replace(/\s/g, ''), family);
}

/** Emirati tribal family names, used to detect a genuine surname. Not exhaustive. */
const EMIRATI_FAMILY_NAMES = new Set(
  Object.keys(TRANSLITERATION_FAMILIES).filter((k) =>
    ['mansoori', 'mazrouei', 'suwaidi', 'ketbi', 'nuaimi', 'marri', 'muhairi', 'blooshi',
     'hosani', 'hammadi', 'shamsi', 'marzooqi', 'qubaisi', 'dhaheri'].includes(k)
  )
);

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

/**
 * Collapses a token to its transliteration family, if it belongs to one.
 *
 * Handles the closed-up form too: "AlSuweidi" written as one word has to reach
 * the same family as "Al Suwaidi" written as two, or the same person becomes
 * two rungs on one ladder.
 */
export function canonicalToken(token: string): string {
  const normalized = normalizeToken(token);
  const direct = SPELLING_TO_FAMILY.get(normalized);
  if (direct) return direct;

  const stripped = normalized.replace(/^(al|el|ash|ad|az|as)(?=[a-z]{3,})/, '');
  if (stripped !== normalized) {
    const viaStripped = SPELLING_TO_FAMILY.get(stripped);
    if (viaStripped) return viaStripped;
    return stripped;
  }

  return normalized;
}

export interface ParsedName {
  /** Exactly as the source rendered it. Never normalised, never corrected. */
  fullNameRaw: string;
  givenName: string | null;
  familyName: string | null;
  familyNameDetected: boolean;
  /** The dedup key: `(company_id, phonetic_key)` is unique in the schema. */
  phoneticKey: string;
  /** Honorific text found in the raw string, for the caller to verify against a source. */
  honorificInName: Honorific | null;
  /** Tokens after stripping honorifics and patronymic connectors. */
  tokens: string[];
}

const HONORIFIC_PATTERNS: Array<{ pattern: RegExp; value: Honorific }> = [
  { pattern: /\bh\.?\s?h\.?\b/i, value: 'H.H.' },
  { pattern: /\bh\.?\s?e\.?\b/i, value: 'H.E.' },
  { pattern: /\bsheikha\b/i, value: 'Sheikha' },
  { pattern: /\bsheikh\b/i, value: 'Sheikh' },
  { pattern: /\b(dr|doctor|prof|professor)\.?\b/i, value: 'Dr.' },
  { pattern: /\b(eng|ing|muhandis|mohandes)\.?\b/i, value: 'Eng.' },
];

/**
 * Splits a rendered name into its parts.
 *
 * Honorifics found here are *reported*, not applied — the schema requires a
 * source and a URL before one can be stored, and a title someone typed into a
 * spreadsheet is not a source. The caller decides.
 */
export function parseName(fullNameRaw: string): ParsedName {
  const trimmed = fullNameRaw.trim().replace(/\s+/g, ' ');

  let honorificInName: Honorific | null = null;
  let working = trimmed;
  for (const { pattern, value } of HONORIFIC_PATTERNS) {
    if (pattern.test(working)) {
      honorificInName ??= value;
      working = working.replace(pattern, ' ');
    }
  }
  // "Mr."/"Ms." carry no information; they are not honorifics in our sense.
  working = working.replace(/\b(mr|mrs|ms|miss|sayed|sayeda)\.?\b/gi, ' ');

  const rawTokens = working
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const tokens: string[] = [];
  for (const token of rawTokens) {
    const normalized = normalizeToken(token);
    if (!normalized) continue;
    if (PATRONYMIC_CONNECTORS.has(normalized)) continue;
    tokens.push(token);
  }

  const { familyName, familyNameDetected } = detectFamilyName(tokens);

  return {
    fullNameRaw: trimmed,
    givenName: tokens[0] ?? null,
    familyName,
    familyNameDetected,
    phoneticKey: phoneticKey(tokens),
    honorificInName,
    tokens,
  };
}

/**
 * The family name, when one is genuinely detectable.
 *
 * An Al-prefixed tail is a real tribal family name and works perfectly in
 * English. Anything else in an Arabic chain is a patronymic, and we say so by
 * returning null rather than guessing — the caller then falls back to the given
 * name or the full name, both of which are safe.
 */
function detectFamilyName(tokens: string[]): { familyName: string | null; familyNameDetected: boolean } {
  if (tokens.length < 2) return { familyName: null, familyNameDetected: false };

  // "… Al Mazrouei" — the particle and what follows it are one name.
  for (let i = tokens.length - 2; i >= 1; i--) {
    if (FAMILY_PARTICLES.has(normalizeToken(tokens[i]))) {
      return { familyName: tokens.slice(i).join(' '), familyNameDetected: true };
    }
  }

  // "AlMazrouei" written closed up, or a known tribal name standing alone.
  const last = tokens[tokens.length - 1];
  const lastNormalized = normalizeToken(last);
  if (/^(al|el)[a-z]{3,}$/.test(lastNormalized) || EMIRATI_FAMILY_NAMES.has(canonicalToken(last))) {
    return { familyName: last, familyNameDetected: true };
  }

  // A bare two-token pair is a Western-style given/surname pair often enough to
  // treat as one. Three or more tokens with no particle is an unresolved
  // patronymic chain, and guessing there produces the grandfather's first name.
  if (tokens.length === 2) return { familyName: last, familyNameDetected: true };

  return { familyName: null, familyNameDetected: false };
}

/**
 * The deduplication key.
 *
 * Every token is collapsed to its transliteration family, particles are
 * dropped, and the result is sorted — so "Mohammed Al Marri" and "Mohamed
 * AlMarri" and "Al Marri, Mohammad" all produce the same key.
 */
export function phoneticKey(tokensOrName: string[] | string): string {
  const tokens = Array.isArray(tokensOrName)
    ? tokensOrName
    : parseName(tokensOrName).tokens;

  const parts = tokens
    .map((t) => normalizeToken(t))
    .filter((t) => t.length > 0 && !PATRONYMIC_CONNECTORS.has(t))
    // A standalone particle carries no identity; "AlMarri" already includes it.
    .filter((t) => !FAMILY_PARTICLES.has(t))
    .map((t) => canonicalToken(t))
    .filter(Boolean);

  return [...new Set(parts)].sort().join(' ');
}

// ---------------------------------------------------------------------------
// Address resolution (CULTURE.md §10)
// ---------------------------------------------------------------------------

export type Register = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RegisterInput {
  seniorityTier: 1 | 2 | 3 | 4 | null;
  orgType: 'government' | 'semi_gov' | 'private_local' | 'mnc' | 'startup' | null;
  nationalityBucket: NationalityBucket;
  functionType: 'exec' | 'hiring_manager' | 'hr_ta' | 'other';
  ageBracketGuess?: '50+' | null;
}

/** CULTURE.md §10's traditionalism score, verbatim. */
export function deriveRegister(input: RegisterInput): Register {
  let score = 0;
  if (input.seniorityTier === 1) score += 2;
  if (input.seniorityTier === 2) score += 1;
  if (input.orgType === 'government' || input.orgType === 'semi_gov') score += 2;
  if (input.orgType === 'startup') score -= 2;
  if (input.nationalityBucket === 'emirati' || input.nationalityBucket === 'gcc_arab') score += 1;
  if (input.ageBracketGuess === '50+') score += 1;
  if (input.nationalityBucket === 'western') score -= 1;

  const register: Register = score >= 3 ? 'HIGH' : score >= 1 ? 'MEDIUM' : 'LOW';

  // HR and talent acquisition is a transactional function whatever the tier.
  if (input.functionType === 'hr_ta' && register === 'HIGH') return 'MEDIUM';
  return register;
}

export interface SalutationInput {
  name: ParsedName;
  gender: Gender;
  nationalityBucket: NationalityBucket;
  register: Register;
  /** Only ever a value copied from a source. Never derived. */
  honorificDeclared: Honorific | null;
}

export interface SalutationResult {
  /** The rendered line, or null when the send must halt. */
  salutation: string | null;
  /** Set when a human has to look before anything goes out. */
  halt: 'ruling_family' | 'no_name' | null;
  reason: string;
}

/**
 * Resolves the greeting.
 *
 * Order of preference throughout: be correct, then be warm. The full name is
 * never wrong — only slightly heavy — so it is the fallback whenever structure
 * or gender is uncertain, and `Dear Sir/Madam` is never produced at all.
 */
export function resolveSalutation(input: SalutationInput): SalutationResult {
  const { name, gender, nationalityBucket, register, honorificDeclared } = input;

  // A student cold-emailing a ruling-family member is a founder decision, not a
  // template decision. Note that an Al- family name is NOT evidence of this —
  // most Emirati family names are Al-prefixed, and inferring Sheikh from one is
  // the worst address error available.
  if (honorificDeclared === 'Sheikh' || honorificDeclared === 'Sheikha' || honorificDeclared === 'H.H.') {
    return {
      salutation: null,
      halt: 'ruling_family',
      reason: `${honorificDeclared} is a ruling-family or religious style. A person, not a template, decides whether to write at all.`,
    };
  }

  if (!name.givenName) {
    return {
      salutation: 'Dear Hiring Manager,',
      halt: 'no_name',
      reason: 'No name on the record. A role-based greeting reads better than Sir/Madam, but a missing name is a data problem, not a salutation problem.',
    };
  }

  const bestToken = bestNameToken(name, nationalityBucket);

  if (honorificDeclared === 'H.E.') {
    return {
      salutation: `Dear H.E. ${bestToken},`,
      halt: null,
      reason: 'H.E. is declared in a source. Omitting it on a government recipient is the highest-cost address error there is.',
    };
  }

  // Dr. replaces Mr./Ms. — never "Dear Mr. Dr. Ahmed".
  if (honorificDeclared === 'Dr.' || honorificDeclared === 'Eng.') {
    return {
      salutation: `Dear ${honorificDeclared} ${bestToken},`,
      halt: null,
      reason: `${honorificDeclared} is declared in a source. In the Gulf this is a status marker, and omitting it is a genuine slight.`,
    };
  }

  // Never Mrs.: Emirati women keep their father's family name after marriage,
  // so Mrs. carries no information and can simply be wrong.
  const title = gender === 'M' ? 'Mr.' : gender === 'F' ? 'Ms.' : null;

  if (!title) {
    return {
      salutation: `Dear ${name.fullNameRaw},`,
      halt: null,
      reason: 'Gender unknown. The full name is never wrong, only slightly heavy — and it beats guessing from a name we have not seen before.',
    };
  }

  if (register === 'LOW') {
    return {
      salutation: `Hi ${name.givenName},`,
      halt: null,
      reason: 'Low register: a Western or startup recipient expects the first name, and formality reads as stiff.',
    };
  }

  if (!name.familyNameDetected && nationalityBucket !== 'emirati') {
    return {
      salutation: `Dear ${title} ${name.givenName},`,
      halt: null,
      reason: 'Unresolved patronymic chain. The Gulf convention of title plus given name exists precisely for this — the last token would be the grandfather.',
    };
  }

  return {
    salutation: `Dear ${title} ${bestToken},`,
    halt: null,
    reason: name.familyNameDetected
      ? 'A tribal family name works as a surname in English.'
      : 'Falling back to the given name rather than guessing at a surname.',
  };
}

function bestNameToken(name: ParsedName, bucket: NationalityBucket): string {
  if (name.familyNameDetected && name.familyName) return name.familyName;
  if (bucket === 'levant_egypt_arab' || bucket === 'gcc_arab' || bucket === 'emirati') {
    return name.givenName ?? name.fullNameRaw;
  }
  if (bucket === 'south_asian' || bucket === 'western' || bucket === 'filipino' || bucket === 'east_asian') {
    return name.tokens[name.tokens.length - 1] ?? name.fullNameRaw;
  }
  return name.fullNameRaw;
}

// ---------------------------------------------------------------------------
// Pre-send lint (CULTURE.md §10)
// ---------------------------------------------------------------------------

export interface LintFinding {
  rule: string;
  severity: 'block' | 'warn';
  message: string;
}

/**
 * The salutation lint. Blocks are unrecoverable-in-four-words errors; warnings
 * are judgement calls a human should see.
 */
export function lintSalutation(
  salutation: string,
  context: { honorificDeclared: Honorific | null; orgType: string | null }
): LintFinding[] {
  const findings: LintFinding[] = [];

  // "Dear Mr. Al," — a tokenisation failure that identifies the email as bulk
  // before the body is read.
  if (/\b(Mr\.|Ms\.|Dr\.|Eng\.)\s+(Al|El|Bin|Bint|Abu|Abd|Ash|Ad|Az)[,\s]*$/i.test(salutation.trim())) {
    findings.push({
      rule: 'bare_particle',
      severity: 'block',
      message: 'The greeting ends on a lineage particle. "Al" is part of the family name, never the whole of it.',
    });
  }

  if (/\bEng\./.test(salutation) && context.honorificDeclared !== 'Eng.') {
    findings.push({
      rule: 'derived_eng',
      severity: 'block',
      message: 'Eng. attaches to someone who styles themselves that way, not to a job title containing "engineer".',
    });
  }

  if (
    /\bH\.E\./.test(salutation) &&
    ['private_local', 'mnc', 'startup'].includes(context.orgType ?? '')
  ) {
    findings.push({
      rule: 'he_on_private_sector',
      severity: 'block',
      message: 'H.E. does not extend to private-sector leadership. Applying it reads as either sycophancy or automation.',
    });
  }

  if (/\bMrs\./.test(salutation)) {
    findings.push({
      rule: 'mrs',
      severity: 'block',
      message: 'Use Ms. Emirati women keep their father’s family name after marriage, so Mrs. carries no information and may be wrong.',
    });
  }

  if (/\bDear Sir\b|\bSir\/Madam\b/i.test(salutation)) {
    findings.push({
      rule: 'sir_madam',
      severity: 'block',
      message: 'Sir/Madam reads dated. A role-based greeting or the full name is better.',
    });
  }

  if (/\{\{|\[First|undefined|null/.test(salutation)) {
    findings.push({
      rule: 'unresolved_token',
      severity: 'block',
      message: 'An unresolved merge token reached the greeting.',
    });
  }

  return findings;
}
