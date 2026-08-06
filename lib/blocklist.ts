/**
 * The never-contact list (register: "Queue auto-targets the user's employer, a
 * rejecting company, or the family firm").
 *
 * Sourcing runs behind the scenes, so without this the first thing the user
 * sees could be a drafted email to the company they currently intern at. The
 * UAE professional network is dense enough that one of those costs more than
 * the tool earns.
 *
 * Matching is by domain family at queue-build time, not by exact company row,
 * because the company they typed may not be in the database yet.
 */
import { execute, query } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';

export type BlockReason =
  | 'current_employer'
  | 'recent_employer'
  | 'recent_application'
  | 'rejection'
  | 'never_contact'
  | 'user_skip'
  | 'know_someone';

/** Company-name noise that would otherwise defeat matching. */
const NAME_NOISE =
  /\b(the|group|holding|holdings|company|co|corp|corporation|inc|llc|plc|pjsc|psc|fz|fze|fzco|ltd|limited|uae|emirates?|bank|international|middle east|mena|gulf)\b/gi;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits "FAB, ADCB and Emaar" into individual names. */
export function splitCompanyList(raw: string): string[] {
  return raw
    .split(/[,;\n]|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
}

/**
 * Resolves free text to company domains.
 *
 * Deliberately loose on the matching side and conservative on the outcome: an
 * unmatched name is reported back rather than silently dropped, because "I told
 * it not to email my employer and it did" is unrecoverable, while "it asked me
 * to pick which one I meant" is a five-second tap.
 */
export async function matchCompanies(
  names: string[]
): Promise<{ matched: Array<{ input: string; company: CompanyRow }>; unmatched: string[] }> {
  if (names.length === 0) return { matched: [], unmatched: [] };

  const companies = await query<CompanyRow>('SELECT id, name, domain FROM company');
  const indexed = companies.map((c) => ({ company: c, key: normalizeName(c.name) }));

  const matched: Array<{ input: string; company: CompanyRow }> = [];
  const unmatched: string[] = [];

  for (const input of names) {
    const key = normalizeName(input);
    if (!key) continue;

    const hit =
      indexed.find((c) => c.key === key) ??
      indexed.find((c) => c.key.length > 2 && (c.key.includes(key) || key.includes(c.key))) ??
      // Fall back to the domain label, which catches "bankfab" for "FAB".
      indexed.find((c) => c.company.domain.split('.')[0] === key.replace(/\s/g, ''));

    if (hit) matched.push({ input, company: hit.company });
    else unmatched.push(input);
  }

  return { matched, unmatched };
}

/** Records a blocked domain. Idempotent — re-running onboarding is safe. */
export async function blockDomain(
  userId: string,
  domain: string,
  reason: BlockReason,
  note?: string
): Promise<void> {
  await execute(
    `INSERT INTO blocked_domain (id, user_id, domain, reason, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, domain) DO UPDATE SET reason = excluded.reason, note = excluded.note`,
    [newId('blockedDomain'), userId, domain.toLowerCase(), reason, note ?? null, nowIso()]
  );
}

/** Blocks a company for this user and greys it on the dashboard. */
export async function blockCompany(
  userId: string,
  companyId: string,
  domain: string,
  reason: BlockReason,
  note?: string
): Promise<void> {
  const at = nowIso();
  await blockDomain(userId, domain, reason, note);
  await execute(
    `INSERT INTO user_company_state (user_id, company_id, status, blocked_reason, note, created_at, updated_at)
     VALUES (?, ?, 'blocked', ?, ?, ?, ?)
     ON CONFLICT (user_id, company_id) DO UPDATE SET
       status = 'blocked', blocked_reason = excluded.blocked_reason,
       note = excluded.note, updated_at = excluded.updated_at`,
    [userId, companyId, reason, note ?? null, at, at]
  );
}

export interface BlockedEntry {
  domain: string;
  reason: BlockReason;
  note: string | null;
}

export async function listBlocked(userId: string): Promise<BlockedEntry[]> {
  return query<BlockedEntry>(
    'SELECT domain, reason, note FROM blocked_domain WHERE user_id = ? ORDER BY domain',
    [userId]
  );
}

/**
 * Applies one hygiene answer: matches the names, blocks what it recognises, and
 * hands back what it did not so the user can see it rather than assume it
 * worked.
 */
export async function applyHygieneAnswer(
  userId: string,
  raw: string,
  reason: BlockReason
): Promise<{ blocked: string[]; unmatched: string[] }> {
  const names = splitCompanyList(raw);
  const { matched, unmatched } = await matchCompanies(names);

  for (const { input, company } of matched) {
    await blockCompany(userId, company.id, company.domain, reason, `you told us: "${input}"`);
  }

  if (matched.length > 0 || unmatched.length > 0) {
    await logEvent({
      event: 'interview_answer_saved',
      userId,
      detail: { hygiene: reason, blocked: matched.map((m) => m.company.name), unmatched },
    });
  }

  return { blocked: matched.map((m) => m.company.name), unmatched };
}
