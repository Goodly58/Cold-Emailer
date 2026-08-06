/**
 * Email pattern inference and verification.
 *
 * `first.last@domain` dominates UAE corporates, which makes guessing tempting
 * and wrong. Three failures the register describes, and what stops each:
 *
 *   - ONE EXEMPLAR IS NOT A PATTERN. A group that hires under `brand.ae` but
 *     mails from `group.com` will accept a single lucky guess and then make
 *     every other contact unreachable while looking green. Confidence needs two
 *     independent exemplars from public sources, per domain.
 *   - ACCEPT-ALL IS NOT VERIFIED. A catch-all domain returns "yes" for every
 *     address. Collapsing that into `verified` means the server swallows all
 *     three steps silently and the reply-rate metric that gates
 *     commercialisation is quietly corrupted.
 *   - AN EXEMPLAR CAN DIE. When the only exemplar hard-bounces, every sibling
 *     address minted from that pattern reverts to guessed rather than sitting
 *     in the queue looking fine.
 */
import { execute, query, queryOne } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';
import { parseName } from './names';

export type PatternName =
  | 'first.last'
  | 'firstlast'
  | 'f.last'
  | 'flast'
  | 'first_last'
  | 'first'
  | 'last.first'
  | 'first.l';

export type PatternConfidence = 'insufficient' | 'probable' | 'confirmed';

export interface Exemplar {
  address: string;
  /** Where this address was seen written down. Provenance, not a guess. */
  sourceUrl: string;
  status: 'live' | 'bounced' | 'unknown';
  seenAt: string;
}

const BUILDERS: Record<PatternName, (first: string, last: string) => string> = {
  'first.last': (f, l) => `${f}.${l}`,
  firstlast: (f, l) => `${f}${l}`,
  'f.last': (f, l) => `${f[0]}.${l}`,
  flast: (f, l) => `${f[0]}${l}`,
  first_last: (f, l) => `${f}_${l}`,
  first: (f) => f,
  'last.first': (f, l) => `${l}.${f}`,
  'first.l': (f, l) => `${f}.${l[0]}`,
};

function normalizeForAddress(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

/**
 * Name parts usable in an address.
 *
 * Both renderings of an Al- family name are produced — "almazrouei" and
 * "mazrouei" — because organisations split on this and getting it wrong is a
 * bounce, not a near miss.
 */
export function addressParts(fullNameRaw: string): { firsts: string[]; lasts: string[] } {
  const parsed = parseName(fullNameRaw);
  const tokens = parsed.tokens.map(normalizeForAddress).filter(Boolean);
  if (tokens.length === 0) return { firsts: [], lasts: [] };

  const firsts = [tokens[0]];
  const lasts: string[] = [];

  if (parsed.familyName) {
    const family = parsed.familyName.split(/\s+/).map(normalizeForAddress).filter(Boolean);
    if (family.length > 1) {
      lasts.push(family.join(''));        // almazrouei
      lasts.push(family[family.length - 1]); // mazrouei
    } else if (family.length === 1) {
      lasts.push(family[0]);
    }
  }
  if (lasts.length === 0 && tokens.length > 1) lasts.push(tokens[tokens.length - 1]);

  return { firsts: [...new Set(firsts)], lasts: [...new Set(lasts)] };
}

/** Every address this pattern could produce for this name, most likely first. */
export function candidateAddresses(fullNameRaw: string, domain: string, pattern: PatternName | null): string[] {
  const { firsts, lasts } = addressParts(fullNameRaw);
  if (firsts.length === 0) return [];

  const patterns: PatternName[] = pattern
    ? [pattern]
    : ['first.last', 'firstlast', 'f.last', 'flast', 'first_last', 'first'];

  const out: string[] = [];
  for (const p of patterns) {
    for (const first of firsts) {
      for (const last of lasts.length > 0 ? lasts : ['']) {
        if (!last && p !== 'first') continue;
        const local = BUILDERS[p](first, last);
        if (local && !local.includes('undefined')) out.push(`${local}@${domain.toLowerCase()}`);
      }
    }
  }
  return [...new Set(out)];
}

/** Which pattern an exemplar address demonstrates, if any. */
export function inferPatternFrom(address: string, fullNameRaw: string): PatternName | null {
  const local = address.split('@')[0]?.toLowerCase();
  if (!local) return null;

  const { firsts, lasts } = addressParts(fullNameRaw);
  for (const [name, build] of Object.entries(BUILDERS) as Array<[PatternName, (f: string, l: string) => string]>) {
    for (const first of firsts) {
      for (const last of lasts.length > 0 ? lasts : ['']) {
        if (!last && name !== 'first') continue;
        if (build(first, last) === local) return name;
      }
    }
  }
  return null;
}

interface PatternRow {
  id: string;
  domain: string;
  pattern: PatternName | null;
  exemplar_addresses: string;
  confidence: PatternConfidence;
}

export interface DomainPattern {
  domain: string;
  pattern: PatternName | null;
  confidence: PatternConfidence;
  exemplars: Exemplar[];
  /** What the Review panel shows: "first.last@group.com — pattern from 2 sources". */
  provenance: string;
}

export async function patternFor(domain: string): Promise<DomainPattern | null> {
  const row = await queryOne<PatternRow>('SELECT * FROM email_pattern WHERE domain = ?', [
    domain.toLowerCase(),
  ]);
  if (!row) return null;

  const exemplars: Exemplar[] = JSON.parse(row.exemplar_addresses);
  return {
    domain: row.domain,
    pattern: row.pattern,
    confidence: row.confidence,
    exemplars,
    provenance: describeProvenance(row.pattern, row.confidence, exemplars),
  };
}

function describeProvenance(
  pattern: PatternName | null,
  confidence: PatternConfidence,
  exemplars: Exemplar[]
): string {
  const live = exemplars.filter((e) => e.status !== 'bounced').length;
  if (!pattern || confidence === 'insufficient') {
    return live === 0
      ? 'No confirmed address seen at this domain yet.'
      : `Only ${live} confirmed address seen at this domain — one is not a pattern.`;
  }
  return `${pattern}@domain — pattern from ${live} independent source${live === 1 ? '' : 's'}.`;
}

/**
 * Records an address seen written down somewhere public, and re-derives the
 * domain's pattern from every exemplar it now has.
 *
 * Two live exemplars agreeing is `confirmed`; two disagreeing is
 * `insufficient`, not "pick the first" — a domain running two conventions is
 * exactly the case where guessing produces silent unreachability.
 */
export async function recordExemplar(input: {
  domain: string;
  address: string;
  fullNameRaw: string;
  sourceUrl: string;
}): Promise<DomainPattern> {
  const domain = input.domain.toLowerCase();
  const existing = await patternFor(domain);
  const exemplars: Exemplar[] = existing?.exemplars ?? [];

  const address = input.address.toLowerCase().trim();
  if (!exemplars.some((e) => e.address === address)) {
    exemplars.push({ address, sourceUrl: input.sourceUrl, status: 'unknown', seenAt: nowIso() });
  }

  const observed = exemplars
    .filter((e) => e.status !== 'bounced')
    .map((e) => inferPatternFrom(e.address, e.address === address ? input.fullNameRaw : e.address))
    .filter(Boolean) as PatternName[];

  const agreed = [...new Set(observed)];
  const liveCount = exemplars.filter((e) => e.status !== 'bounced').length;

  let pattern: PatternName | null = null;
  let confidence: PatternConfidence = 'insufficient';
  if (agreed.length === 1 && liveCount >= 2) {
    pattern = agreed[0];
    confidence = 'confirmed';
  } else if (agreed.length === 1 && liveCount === 1) {
    pattern = agreed[0];
    confidence = 'probable';
  }

  const at = nowIso();
  await execute(
    `INSERT INTO email_pattern (id, domain, pattern, exemplar_addresses, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET
       pattern = excluded.pattern,
       exemplar_addresses = excluded.exemplar_addresses,
       confidence = excluded.confidence,
       updated_at = excluded.updated_at`,
    [newId('emailPattern'), domain, pattern, JSON.stringify(exemplars), confidence, at, at]
  );

  return {
    domain,
    pattern,
    confidence,
    exemplars,
    provenance: describeProvenance(pattern, confidence, exemplars),
  };
}

/**
 * A hard bounce on an exemplar poisons every address minted from its pattern.
 *
 * Distinguishing this from a departure matters: a bounce with a still-live
 * anchor source means the address was wrong (try the next variant), while a
 * bounce with nothing else fresh means the person is gone (rotate the ladder).
 */
export async function markExemplarBounced(address: string): Promise<{ reverted: number }> {
  const domain = address.split('@')[1]?.toLowerCase();
  if (!domain) return { reverted: 0 };

  const existing = await patternFor(domain);
  if (!existing) return { reverted: 0 };

  const exemplars = existing.exemplars.map((e) =>
    e.address === address.toLowerCase() ? { ...e, status: 'bounced' as const } : e
  );
  const live = exemplars.filter((e) => e.status !== 'bounced');

  const confidence: PatternConfidence =
    live.length >= 2 ? 'confirmed' : live.length === 1 ? 'probable' : 'insufficient';

  await execute(
    `UPDATE email_pattern SET exemplar_addresses = ?, confidence = ?, pattern = ?, updated_at = ? WHERE domain = ?`,
    [
      JSON.stringify(exemplars),
      confidence,
      confidence === 'insufficient' ? null : existing.pattern,
      nowIso(),
      domain,
    ]
  );

  // With no live exemplar left, every sibling address is a guess again and must
  // leave the queue rather than sit in it looking verified.
  if (confidence === 'insufficient') {
    const reverted = await execute(
      `UPDATE person
          SET email_status = 'guessed', status = 'identity_unconfirmed', updated_at = ?
        WHERE email LIKE ? AND email_status = 'verified' AND email <> ?`,
      [nowIso(), `%@${domain}`, address.toLowerCase()]
    );
    await logEvent({
      event: 'bounce',
      level: 'warn',
      detail: { domain, revertedAddresses: reverted, cause: 'sole exemplar bounced' },
    });
    return { reverted };
  }

  return { reverted: 0 };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerificationResult =
  | { status: 'verified'; provider: string; note: string }
  | { status: 'accept_all'; provider: string; note: string }
  | { status: 'invalid'; provider: string; note: string }
  | { status: 'guessed'; provider: string; note: string };

/**
 * Verifies one address.
 *
 * `accept_all` is returned as its own status and never folded into `verified`.
 * Without a verifier key the answer is `guessed` — an honest "we do not know"
 * beats a syntax check dressed up as verification, because hard rule 3 is
 * "verified emails only" and a false verified is how a whole sequence goes into
 * a black hole.
 */
export async function verifyAddress(address: string): Promise<VerificationResult> {
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address)) {
    return { status: 'invalid', provider: 'syntax', note: 'That is not a valid address.' };
  }

  const key = process.env.EMAIL_VERIFIER_API_KEY;
  const provider = (process.env.EMAIL_VERIFIER_PROVIDER ?? 'zerobounce').toLowerCase();
  if (!key) {
    return {
      status: 'guessed',
      provider: 'none',
      note: 'No verifier configured, so this address is unconfirmed. Verified addresses only — set EMAIL_VERIFIER_API_KEY.',
    };
  }

  try {
    if (provider === 'zerobounce') {
      const url = new URL('https://api.zerobounce.net/v2/validate');
      url.searchParams.set('api_key', key);
      url.searchParams.set('email', address);
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { status?: string; sub_status?: string };

      if (body.status === 'valid') {
        return { status: 'verified', provider, note: 'The mailbox exists.' };
      }
      if (body.status === 'catch-all' || body.sub_status === 'global_suppression') {
        return {
          status: 'accept_all',
          provider,
          note: 'This domain accepts every address, so nothing was actually proved.',
        };
      }
      if (body.status === 'invalid') {
        return { status: 'invalid', provider, note: 'That mailbox does not exist.' };
      }
      return { status: 'guessed', provider, note: `Verifier was unsure (${body.status ?? 'unknown'}).` };
    }

    // NeverBounce shape.
    const url = new URL('https://api.neverbounce.com/v4/single/check');
    url.searchParams.set('key', key);
    url.searchParams.set('email', address);
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { result?: string };

    if (body.result === 'valid') return { status: 'verified', provider, note: 'The mailbox exists.' };
    if (body.result === 'catchall') {
      return {
        status: 'accept_all',
        provider,
        note: 'This domain accepts every address, so nothing was actually proved.',
      };
    }
    if (body.result === 'invalid') return { status: 'invalid', provider, note: 'That mailbox does not exist.' };
    return { status: 'guessed', provider, note: `Verifier was unsure (${body.result ?? 'unknown'}).` };
  } catch (e) {
    return {
      status: 'guessed',
      provider,
      note: `Could not reach the verifier (${e instanceof Error ? e.message : 'network error'}). Left unverified rather than assumed good.`,
    };
  }
}

/**
 * Infers an address for a person and verifies it.
 *
 * Below two exemplars the address is held at `guessed` and a collection request
 * is the honest output — not a send. Candidate domains are tried in the order
 * the company recorded them, since the domain a group *mails* from is often not
 * the one it *hires* under.
 */
export async function resolveAddressFor(personId: string): Promise<{
  address: string | null;
  status: VerificationResult['status'];
  note: string;
  provenance: string;
}> {
  const person = await queryOne<{ id: string; full_name_raw: string; company_id: string }>(
    'SELECT id, full_name_raw, company_id FROM person WHERE id = ?',
    [personId]
  );
  if (!person) throw new Error('No such person.');

  const company = await queryOne<{ domain: string; candidate_domains: string }>(
    'SELECT domain, candidate_domains FROM company WHERE id = ?',
    [person.company_id]
  );
  if (!company) throw new Error('No such company.');

  const domains = [company.domain, ...(JSON.parse(company.candidate_domains) as string[])];

  for (const domain of [...new Set(domains)]) {
    const pattern = await patternFor(domain);

    if (!pattern || pattern.confidence === 'insufficient') {
      continue; // one exemplar is not a pattern; try the next domain
    }

    for (const candidate of candidateAddresses(person.full_name_raw, domain, pattern.pattern)) {
      const result = await verifyAddress(candidate);
      if (result.status === 'verified' || result.status === 'accept_all') {
        await execute('UPDATE person SET email = ?, email_status = ?, role_based = ?, updated_at = ? WHERE id = ?', [
          candidate,
          result.status,
          0,
          nowIso(),
          personId,
        ]);
        return {
          address: candidate,
          status: result.status,
          note: result.note,
          provenance: pattern.provenance,
        };
      }
      if (result.status === 'invalid') continue;
    }
  }

  return {
    address: null,
    status: 'guessed',
    note: 'No confirmed pattern for this company yet. Find one address written down publicly — a press release or a leadership page — and the rest follow.',
    provenance: 'Needs a second exemplar before any address here can be trusted.',
  };
}

/** Domains that need one more exemplar before they can produce an address. */
export async function domainsNeedingExemplars(): Promise<Array<{ domain: string; company: string; have: number }>> {
  const rows = await query<{ domain: string; name: string; exemplar_addresses: string | null }>(
    `SELECT c.domain, c.name, p.exemplar_addresses
       FROM company c
       LEFT JOIN email_pattern p ON p.domain = c.domain
      WHERE p.confidence IS NULL OR p.confidence <> 'confirmed'
      ORDER BY c.propensity DESC`
  );
  return rows.map((r) => ({
    domain: r.domain,
    company: r.name,
    have: r.exemplar_addresses ? (JSON.parse(r.exemplar_addresses) as Exemplar[]).length : 0,
  }));
}
