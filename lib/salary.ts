/**
 * Salary: normalising what boards publish, and finding pay written into job
 * descriptions — most UAE postings never fill a salary field, but a fair few
 * say "AED 18,000 – 22,000 per month" in the text.
 *
 * Everything normalises to AED per month, total package, since that's how
 * UAE offers are quoted and compared.
 */

export type SalaryPeriod = 'year' | 'month' | 'week' | 'day' | 'hour';

export interface SalaryRange {
  minMonthlyAed?: number;
  maxMonthlyAed?: number;
  /** posted = a structured board field; text = found in the description. */
  source: 'posted' | 'text';
  currency: string;
  period: SalaryPeriod;
  /** The original wording, for the tooltip. */
  raw?: string;
}

/**
 * AED per unit. The Gulf currencies and the dollar are pegged, so those are
 * exact; the rest float and are approximate — close enough to rank by.
 */
export const AED_PER: Record<string, { rate: number; pegged: boolean }> = {
  AED: { rate: 1, pegged: true },
  USD: { rate: 3.6725, pegged: true },
  SAR: { rate: 0.9793, pegged: true },
  QAR: { rate: 1.0089, pegged: true },
  BHD: { rate: 9.7673, pegged: true },
  OMR: { rate: 9.5514, pegged: true },
  KWD: { rate: 11.95, pegged: false },
  EUR: { rate: 4.0, pegged: false },
  GBP: { rate: 4.7, pegged: false },
  INR: { rate: 0.044, pegged: false },
};

const PER_MONTH: Record<SalaryPeriod, number> = {
  year: 1 / 12,
  month: 1,
  week: 52 / 12,
  day: 21.67, // working days in a month
  hour: 173, // 40h week
};

/** Board period labels ("per-year-salary", "1 YEAR", "annually", "monthly"…) to a period. */
export function parsePeriod(raw: string | undefined | null): SalaryPeriod | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (/year|annual|annum|\bpa\b|yearly/.test(s)) return 'year';
  if (/month|\bpm\b|p\.m\./.test(s)) return 'month';
  if (/week/.test(s)) return 'week';
  if (/day|daily/.test(s)) return 'day';
  if (/hour/.test(s)) return 'hour';
  return undefined;
}

export function toMonthlyAed(amount: number, currency: string, period: SalaryPeriod): number | undefined {
  const fx = AED_PER[currency.toUpperCase()];
  if (!fx || !Number.isFinite(amount) || amount <= 0) return undefined;
  return Math.round((amount * fx.rate * PER_MONTH[period]) / 100) * 100;
}

/** Plausibility window for a UAE monthly package. Outside it, the number is
 *  almost certainly revenue, funding, a bonus pool or a typo. */
const MIN_MONTHLY = 2_000;
const MAX_MONTHLY = 250_000;

function plausible(monthly: number | undefined): monthly is number {
  return monthly !== undefined && monthly >= MIN_MONTHLY && monthly <= MAX_MONTHLY;
}

/** A structured range from a board. Values may arrive as strings. */
export function fromPosted(input: {
  min?: number | string | null;
  max?: number | string | null;
  currency?: string | null;
  period?: string | null;
  raw?: string;
}): SalaryRange | undefined {
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : NaN);
  const currency = (input.currency || 'AED').toUpperCase();
  const period = parsePeriod(input.period) ?? 'year';
  const min = toMonthlyAed(num(input.min), currency, period);
  const max = toMonthlyAed(num(input.max), currency, period);
  if (!plausible(min) && !plausible(max)) return undefined;
  return {
    minMonthlyAed: plausible(min) ? min : undefined,
    maxMonthlyAed: plausible(max) ? max : undefined,
    source: 'posted',
    currency,
    period,
    raw: input.raw,
  };
}

/* --------------------------------------------------------- text parsing */

const CURRENCY_TOKENS: Array<[RegExp, string]> = [
  [/^(aed|dhs?|dirhams?)$/i, 'AED'],
  [/^(usd|us\$|\$)$/i, 'USD'],
  [/^(sar|riyals?)$/i, 'SAR'],
  [/^qar$/i, 'QAR'],
  [/^bhd$/i, 'BHD'],
  [/^omr$/i, 'OMR'],
  [/^kwd$/i, 'KWD'],
  [/^(eur|€)$/i, 'EUR'],
  [/^(gbp|£)$/i, 'GBP'],
];

function currencyOf(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const t = token.trim().replace(/\.$/, '');
  for (const [re, code] of CURRENCY_TOKENS) if (re.test(t)) return code;
  return undefined;
}

const CUR = String.raw`(AED|Dhs?\.?|dirhams?|USD|US\$|\$|SAR|QAR|BHD|OMR|KWD|EUR|€|GBP|£)`;
const NUM = String.raw`(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(k|K)?`;
// "and" only counts as a range in "between X and Y"; checked in consider().
const DASH = String.raw`\s*(?:-|–|—|to|and)\s*`;

// currency first: "AED 18,000 - 22,000", "AED18k–22k", "$120k to $150k"
const CUR_FIRST = new RegExp(
  `${CUR}\\s*${NUM}(?:${DASH}(?:${CUR}\\s*)?${NUM})?`,
  'gi'
);
// currency last: "18,000 - 22,000 AED", "25k AED", "20,000 dirhams"
const CUR_LAST = new RegExp(`${NUM}(?:${DASH}${NUM})?\\s*${CUR}(?![a-z])`, 'gi');

const MAGNITUDE_WORDS = /^\s*(million|mn|m\b|billion|bn|b\b|thousand employees|employees|staff|users|customers)/i;
const SALARY_CONTEXT = /salary|package|compensation|remuneration|pay\b|paid|per month|per annum|monthly|annual|\bp\.?m\.?\b|\bp\.?a\.?\b|\/\s*(?:month|mo|year|yr)|ctc|basic|allowance/i;

function toNumber(digits: string, k?: string): number {
  const n = Number(digits.replace(/[,\s]/g, ''));
  return k ? n * 1000 : n;
}

function periodNear(text: string, start: number, end: number): SalaryPeriod | undefined {
  // Look a little beyond the match for "per month", "/year", "annually"…
  const after = text.slice(end, end + 30).toLowerCase();
  const before = text.slice(Math.max(0, start - 40), start).toLowerCase();
  return parsePeriod(after.match(/^\s*(?:\/|per|a|an|p\.?)\s*\w+|^\s*(monthly|annually|yearly|pm|pa)\b/)?.[0]) ??
    parsePeriod(before.match(/(monthly|annual|yearly)\s+(?:salary|package|pay)?\s*[:\-]?\s*$/)?.[0]);
}

/**
 * Find a salary in free text. Deliberately conservative: a number needs a
 * currency next to it, salary context nearby, and a plausible monthly value
 * once normalised — otherwise "AED 2 billion fund" or "5,000 employees" would
 * rank a role by nonsense.
 */
export function parseSalaryText(
  text: string | undefined | null,
  opts: { /** The text is a salary field, so it needs no "salary" wording around it. */ labelled?: boolean } = {}
): SalaryRange | undefined {
  if (!text) return undefined;
  const candidates: Array<SalaryRange & { score: number }> = [];

  const consider = (m: RegExpExecArray, curToken: string | undefined, a: [string, string?], b?: [string, string?]) => {
    const currency = currencyOf(curToken);
    if (!currency) return;
    // "AED 20,000 and 5 days' leave" is one number, not a range.
    if (b && /\d\s*k?\s*and\s/i.test(m[0]) && !/between\s*$/i.test(text.slice(Math.max(0, m.index - 12), m.index))) {
      b = undefined;
    }
    const end = m.index + m[0].length;
    if (MAGNITUDE_WORDS.test(text.slice(end, end + 20))) return;

    const window = text.slice(Math.max(0, m.index - 120), end + 60);
    if (!opts.labelled && !SALARY_CONTEXT.test(window)) return;

    let lo = toNumber(a[0], a[1]);
    let hi = b ? toNumber(b[0], b[1] ?? a[1]) : lo;
    // "18-22k": the k on the second number applies to both.
    if (b && !a[1] && b[1] && lo < 1000) lo *= 1000;
    if (hi < lo) [lo, hi] = [hi, lo];

    let period = periodNear(text, m.index, end);
    if (!period) {
      // No stated period: UAE salaries are mostly quoted monthly, but a
      // six-figure number is annual.
      period = hi >= 150_000 ? 'year' : 'month';
    }
    const min = toMonthlyAed(lo, currency, period);
    const max = toMonthlyAed(hi, currency, period);
    if (!plausible(min) || !plausible(max)) return;

    candidates.push({
      minMonthlyAed: min,
      maxMonthlyAed: max,
      source: 'text',
      currency,
      period,
      raw: m[0].trim().slice(0, 80),
      score: (b ? 2 : 1) + (periodNear(text, m.index, end) ? 2 : 0) + (currency === 'AED' ? 1 : 0),
    });
  };

  CUR_FIRST.lastIndex = 0;
  for (let m = CUR_FIRST.exec(text); m; m = CUR_FIRST.exec(text)) {
    consider(m, m[1], [m[2], m[3]], m[5] ? [m[5], m[6]] : undefined);
  }
  CUR_LAST.lastIndex = 0;
  for (let m = CUR_LAST.exec(text); m; m = CUR_LAST.exec(text)) {
    consider(m, m[5], [m[1], m[2]], m[3] ? [m[3], m[4]] : undefined);
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((x, y) => y.score - x.score);
  const { score: _score, ...best } = candidates[0];
  void _score;
  return best;
}

/** "AED 18,000–22,000/mo", "~AED 20,000/mo", or "" when unknown. */
export function formatMonthly(min?: number, max?: number, prefix = 'AED '): string {
  const f = (n: number) => n.toLocaleString('en-US');
  if (min && max && min !== max) return `${prefix}${f(min)}–${f(max)}/mo`;
  const one = min ?? max;
  return one ? `${prefix}${f(one)}/mo` : '';
}

/** The single figure ranking uses: the midpoint, or whichever end is known. */
export function midpoint(min?: number, max?: number): number | undefined {
  if (min && max) return Math.round((min + max) / 2);
  return min ?? max;
}
