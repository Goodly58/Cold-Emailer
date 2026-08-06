/**
 * The evidence store.
 *
 * Evidence is the only thing the generator may state a fact from (hard rule 2),
 * so everything that could put a wrong or embarrassing sentence in front of a
 * stranger is enforced here rather than hoped for later:
 *
 *   - a SENSITIVITY GATE, because the highest-tier item is sometimes a post
 *     about a bereavement, and "use the best evidence" would open with it;
 *   - ENTITY RESOLUTION, because a Gulf News quote from a footballer with the
 *     same name is a real quote with a real link that belongs to someone else;
 *   - a SNAPSHOT at collection, because the LinkedIn post the user clicks
 *     through to three weeks later may be gone;
 *   - a COMPANY-SCOPED HOOK LOCK, because the second person on a ladder must
 *     not receive a near-identical email to the first — they compare notes.
 */
import { addDays, compareDates, toUaeDate, todayUae } from './calendar';
import { askClaude } from './claude';
import { execute, query, queryOne } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';

/** Premise tiers, research/template-doctrine.md §(a). */
export const EVIDENCE_TIERS = {
  1: 'what they made — a talk, post, article, paper',
  2: 'what they backed — shared or commented with their own framing',
  3: 'what they claim about themselves — headline, About, how they phrase their remit',
  4: 'what happened to them — promotion, award, speaking slot',
  5: 'what the company did — results, expansion, an Emiratisation milestone',
  6: 'junk drawer — hobbies, sports, hometown',
} as const;

export type EvidenceTier = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Topics that make a hook creepy rather than warm. A blocked row is kept and
 * shown greyed with its reason — the user needs to see *why* the opener is the
 * second-best fact, or they stop trusting the panel.
 */
export const SENSITIVE_TOPICS = [
  'health',
  'illness',
  'bereavement',
  'death',
  'family',
  'children',
  'marriage',
  'religion',
  'politics',
  'legal_dispute',
  'litigation',
  'layoffs',
  'redundancy',
  'resignation_under_pressure',
  'personal_finance',
] as const;

const SENSITIVE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'bereavement', pattern: /\b(passed away|passing of|condolence|funeral|rest in peace|mourn|bereave|loss of (his|her|their) )/i },
  { label: 'health', pattern: /\b(illness|hospital|diagnos|cancer|surgery|recovery from|sick leave|medical leave)\b/i },
  { label: 'family', pattern: /\b(my (wife|husband|son|daughter|child|children)|newborn|wedding|engaged to|maternity|paternity)\b/i },
  { label: 'religion', pattern: /\b(hajj|umrah|pilgrimage|prayer|blessed month|faith)\b/i },
  { label: 'politics', pattern: /\b(election|political party|protest|sanction|regime|war in)\b/i },
  { label: 'legal_dispute', pattern: /\b(lawsuit|litigation|court case|tribunal|allegation|investigation into|fraud charge)\b/i },
  { label: 'layoffs', pattern: /\b(laid off|layoff|redundanc|job cuts|downsizing|restructur\w* affecting)\b/i },
];

export interface EvidenceInput {
  companyId: string | null;
  personId?: string | null;
  tier: EvidenceTier;
  quote: string;
  quoteTranslated?: string | null;
  language?: string;
  sourceUrl: string;
  /** Snapshot taken now, so a dead link later is an inconvenience not a dead end. */
  contextSnippet?: string | null;
  topicLabels?: string[];
  /** The cue tying this to the right person — "mentions: ADCB". */
  identityMatch?: string | null;
  minutesSpent?: number | null;
  userId?: string | null;
}

export interface SensitivityVerdict {
  usable: boolean;
  reason: string | null;
  labels: string[];
}

/**
 * The sensitivity gate. Pattern matching runs first and always; Claude refines
 * it when configured. A missing API key must never turn the gate off, so the
 * patterns are the floor rather than a fallback.
 */
export async function assessSensitivity(quote: string, context?: string): Promise<SensitivityVerdict> {
  const labels: string[] = [];
  for (const { label, pattern } of SENSITIVE_PATTERNS) {
    if (pattern.test(quote) || (context && pattern.test(context))) labels.push(label);
  }

  if (labels.length > 0) {
    return {
      usable: false,
      reason: `Sensitive topic (${labels.join(', ')}). Opening a cold email on this reads as intrusive, however public it is.`,
      labels,
    };
  }

  const reply = await askClaude({
    system: `You screen quotes that a job-seeking student might open a cold email with.

Answer with ONE line, exactly one of:
  OK
  BLOCK: <topic> — <one clause on why opening with this would be intrusive>

BLOCK when the quote touches health, bereavement, family or children, marriage, religion beyond a neutral seasonal greeting, politics, legal disputes, layoffs, or personal finance.
OK for ordinary professional content: work, results, opinions, events, awards, company news.
Err towards OK. A blocked quote costs a better opener; a wrong OK costs the relationship.`,
    prompt: `Quote: ${quote}${context ? `\nContext: ${context}` : ''}`,
    maxTokens: 120,
    effort: 'low',
  });

  if (reply && /^BLOCK/i.test(reply.trim())) {
    const reason = reply.trim().replace(/^BLOCK:\s*/i, '');
    return { usable: false, reason: `Sensitive topic. ${reason}`, labels: ['claude_flagged'] };
  }

  return { usable: true, reason: null, labels };
}

/**
 * Entity resolution: does this quote actually belong to the person we think?
 *
 * A person-level row must co-mention the company, the known role, or the
 * anchor's link identity. Failing that it is downgraded to unusable with
 * "namesake risk" — the failure mode is a genuine quote from a footballer with
 * the same name, which passes every other check.
 */
export function resolveIdentity(
  quote: string,
  context: string | null,
  cues: { companyName: string; roleTitle?: string | null; personName: string; sourceUrl: string; anchorUrl?: string | null }
): { matched: boolean; cue: string | null } {
  const haystack = `${quote} ${context ?? ''} ${cues.sourceUrl}`.toLowerCase();

  const companyWords = cues.companyName
    .toLowerCase()
    .replace(/\b(the|group|holding|company|co|corp|inc|llc|plc|pjsc|ltd|limited)\b/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  for (const word of companyWords) {
    if (haystack.includes(word)) return { matched: true, cue: `mentions: ${cues.companyName}` };
  }

  if (cues.roleTitle) {
    const roleWords = cues.roleTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    if (roleWords.length > 0 && roleWords.every((w) => haystack.includes(w))) {
      return { matched: true, cue: `mentions: ${cues.roleTitle}` };
    }
  }

  // Same page as the anchor source: whoever the anchor identified, this is them.
  if (cues.anchorUrl && sameDocument(cues.sourceUrl, cues.anchorUrl)) {
    return { matched: true, cue: 'same page as the anchor source' };
  }

  return { matched: false, cue: null };
}

function sameDocument(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.host === ub.host && ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '');
  } catch {
    return a === b;
  }
}

/**
 * Stores one evidence row, having run every gate.
 *
 * Person-level rows (tiers 1-3) that fail entity resolution are stored
 * unusable rather than dropped, so the panel can show why the hook is not the
 * one the founder expected.
 */
export async function storeEvidence(
  input: EvidenceInput,
  identity?: { companyName: string; personName: string; roleTitle?: string | null; anchorUrl?: string | null }
): Promise<{ id: string; usable: boolean; reason: string | null }> {
  if (!input.sourceUrl?.trim()) {
    // Hard rule 2 is a schema constraint too, but failing here gives the
    // founder a sentence instead of a SQLITE_CONSTRAINT.
    throw new Error('Evidence needs the URL it came from. That link is what the user checks in ten seconds.');
  }

  const sensitivity = await assessSensitivity(input.quote, input.contextSnippet ?? undefined);

  let usable = sensitivity.usable;
  let reason = sensitivity.reason;
  let identityMatch = input.identityMatch ?? null;

  if (usable && input.personId && input.tier <= 3 && identity) {
    const resolved = resolveIdentity(input.quote, input.contextSnippet ?? null, {
      ...identity,
      sourceUrl: input.sourceUrl,
    });
    identityMatch = resolved.cue ?? identityMatch;
    if (!resolved.matched) {
      usable = false;
      reason =
        'Namesake risk: nothing in this source ties the quote to this company or role. It may be a different person with the same name.';
    }
  }

  // Tier 6 is banned as an opener outright; shared institution is promoted to
  // tier 2 at capture time instead of being smuggled in here.
  if (usable && input.tier === 6) {
    usable = false;
    reason = 'Junk drawer. Hobbies and hometowns are not openers, however true they are.';
  }

  // A quote in a language the email is not written in, with no translation.
  //
  // The generator's PS line falls back to the original when there is no
  // translation, which would splice an Arabic sentence verbatim into an English
  // follow-up — past every lint, because none of them read Arabic. Blocked with
  // a reason rather than dropped, so the founder can add the translation and
  // recover what may be the best hook they have.
  const language = (input.language ?? 'en').toLowerCase();
  if (usable && !language.startsWith('en') && !input.quoteTranslated?.trim()) {
    usable = false;
    reason = `This quote is in ${language} and has no English translation. The email is written in English, so it cannot be used until one is added.`;
  }

  const id = newId('evidence');
  const at = nowIso();
  await execute(
    `INSERT INTO evidence
       (id, kind, company_id, person_id, user_id, tier, quote, quote_translated, language,
        source_url, context_snippet, captured_at, verified_on, topic_labels, usable,
        unusable_reason, identity_match, minutes_spent, created_at, updated_at)
     VALUES (?, 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.companyId,
      input.personId ?? null,
      input.userId ?? null,
      input.tier,
      input.quote.trim(),
      input.quoteTranslated ?? null,
      input.language ?? 'en',
      input.sourceUrl.trim(),
      input.contextSnippet ?? null,
      at,
      at,
      JSON.stringify([...(input.topicLabels ?? []), ...sensitivity.labels]),
      usable ? 1 : 0,
      reason,
      identityMatch,
      input.minutesSpent ?? null,
      at,
      at,
    ]
  );

  await logEvent({
    event: 'evidence_collected',
    userId: input.userId ?? null,
    entityType: 'evidence',
    entityId: id,
    detail: {
      tier: input.tier,
      minutes: input.minutesSpent ?? null,
      usable,
      reason,
      companyId: input.companyId,
      personId: input.personId ?? null,
    },
  });

  return { id, usable, reason };
}

export interface EvidenceRow {
  id: string;
  company_id: string | null;
  person_id: string | null;
  tier: EvidenceTier;
  quote: string;
  quote_translated: string | null;
  language: string;
  source_url: string;
  context_snippet: string | null;
  captured_at: string;
  verified_on: string | null;
  link_dead: number;
  usable: number;
  unusable_reason: string | null;
  identity_match: string | null;
  disputed: number;
  used_for_person_id: string | null;
}

/**
 * Evidence available to hook an email to this person, best first.
 *
 * "Best" means: usable, not already spent on a colleague at the same company,
 * not disputed, not behind a dead link, and — because a promotion nobody
 * mentions for a year is not news — recent enough for its tier.
 */
export async function usableEvidenceFor(
  personId: string,
  companyId: string
): Promise<EvidenceRow[]> {
  const rows = await query<EvidenceRow>(
    `SELECT * FROM evidence
      WHERE usable = 1
        AND disputed = 0
        AND link_dead = 0
        AND kind = 'external'
        AND (person_id = ? OR (person_id IS NULL AND company_id = ?))
        AND (used_for_person_id IS NULL OR used_for_person_id = ?)
      ORDER BY tier ASC, captured_at DESC`,
    [personId, companyId, personId]
  );
  return rows;
}

/**
 * Locks the evidence a send used, scoped to the company.
 *
 * This is what stops the ladder's second email reusing the first email's only
 * hook. Rotation then requires at least one unlocked row, and when there is
 * none the honest answer is a collection request rather than a rehash.
 */
export async function lockEvidenceForSend(
  evidenceIds: string[],
  personId: string,
  userId: string
): Promise<void> {
  if (evidenceIds.length === 0) return;
  const placeholders = evidenceIds.map(() => '?').join(', ');
  await execute(
    `UPDATE evidence
        SET used_for_person_id = ?, locked_by_user_id = ?, updated_at = ?
      WHERE id IN (${placeholders}) AND used_for_person_id IS NULL`,
    [personId, userId, nowIso(), ...evidenceIds]
  );
}

/** Flags a row the user disputed, and pulls anything drafted from it. */
export async function disputeEvidence(evidenceId: string): Promise<void> {
  await execute('UPDATE evidence SET disputed = 1, updated_at = ? WHERE id = ?', [nowIso(), evidenceId]);
  await execute(
    `UPDATE outreach SET status = 'stale', updated_at = ?
      WHERE status IN ('queued', 'drafted', 'approved')
        AND evidence_ids LIKE '%' || ? || '%'`,
    [nowIso(), evidenceId]
  );
  await logEvent({ event: 'draft_stale', entityType: 'evidence', entityId: evidenceId, detail: { cause: 'disputed' } });
}

/**
 * Marks links that no longer resolve.
 *
 * A dead link on a queued draft flags it for re-review rather than releasing
 * it: the user clicking through to a 404 stops trusting the panel entirely, and
 * the panel is the only defence against a fabricated hook.
 */
/**
 * Hosts this check must never touch, whatever is stored against them.
 *
 * Hard rule 7 is "no LinkedIn automation, ever", and it does not have an
 * exception for a HEAD request. Tier-3 evidence URLs are `ae.linkedin.com/in/…`
 * by construction, so a link-checker with no host filter would make automated
 * requests to LinkedIn from the user's own server — detection there operates at
 * the TLS layer, so low volume confers no safety. A tier-3 source that has gone
 * is caught the next time a human looks at it instead.
 */
const NEVER_FETCH = [/(^|\.)linkedin\.com$/i];

export async function checkLinks(limit = 50): Promise<{ checked: number; dead: number; skipped: number }> {
  const rows = await query<{ id: string; source_url: string }>(
    `SELECT id, source_url FROM evidence
      WHERE link_dead = 0 AND kind = 'external' AND source_url LIKE 'http%'
      ORDER BY captured_at ASC LIMIT ?`,
    [limit]
  );

  let dead = 0;
  let skipped = 0;
  for (const row of rows) {
    let host: string;
    try {
      host = new URL(row.source_url).hostname;
    } catch {
      skipped++;
      continue;
    }
    if (NEVER_FETCH.some((pattern) => pattern.test(host))) {
      skipped++;
      continue;
    }

    let alive = true;
    try {
      const response = await fetch(row.source_url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      alive = response.status < 400;
    } catch {
      // A network failure is not proof the page is gone. Only a real 4xx/5xx
      // counts, or one bad afternoon marks the whole corpus dead.
      continue;
    }

    if (!alive) {
      dead++;
      await execute('UPDATE evidence SET link_dead = 1, updated_at = ? WHERE id = ?', [nowIso(), row.id]);
      await execute(
        `UPDATE outreach SET status = 'stale', updated_at = ?
          WHERE status IN ('queued', 'drafted', 'approved') AND evidence_ids LIKE '%' || ? || '%'`,
        [nowIso(), row.id]
      );
    }
  }

  return { checked: rows.length - skipped, dead, skipped };
}

/**
 * Nafis and MoHRE claims that need re-checking before they may be cited.
 *
 * Quota thresholds and subsidy amounts change by decree, and the one person
 * guaranteed to know the current rules is the Emiratisation lead we are writing
 * to. Anything past the window is re-fetched before a citing draft is released.
 */
export async function stalePolicyEvidence(days = 30, now: Date = new Date()): Promise<EvidenceRow[]> {
  const rows = await query<EvidenceRow>(
    `SELECT * FROM evidence
      WHERE kind = 'external'
        AND (source_url LIKE '%nafis.gov.ae%' OR source_url LIKE '%mohre.gov.ae%')
      ORDER BY verified_on ASC`
  );

  const cutoff = addDays(todayUae(now), -days);
  return rows.filter(
    (r) => !r.verified_on || compareDates(toUaeDate(new Date(r.verified_on)), cutoff) < 0
  );
}

export async function evidenceById(id: string): Promise<EvidenceRow | null> {
  return queryOne<EvidenceRow>('SELECT * FROM evidence WHERE id = ?', [id]);
}
