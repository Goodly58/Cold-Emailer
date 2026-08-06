/**
 * Creating and gating people.
 *
 * The gates here are the difference between a personalized email and a scam.
 * Three of them, in the order they can go wrong:
 *
 *   1. IDENTITY BINDING. A person is draft-eligible only with an *anchor
 *      source* — a URL naming this person AND the company or role together.
 *      Without one, a Tier-3 search result can bind the row to a different
 *      Ahmed Al Mansoori, and the email lands in the real one's inbox reading
 *      like a scam.
 *   2. FRESHNESS. LinkedIn lies; people who left do not update. Two
 *      corroborating sources, or one fresher than ninety days, before anything
 *      is drafted — otherwise the ladder's best evidence and three steps are
 *      spent on a ghost.
 *   3. SUPPRESSION. Checked before the row is even created, because a
 *      "remove me" is permanent and global, and re-sourcing someone who asked
 *      to be left alone is the failure that ends the mailbox.
 */
import { compareDates, addDays, todayUae, toUaeDate } from './calendar';
import { hashEmail } from './crypto';
import { execute, query, queryOne } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';
import {
  parseName,
  phoneticKey,
  type Gender,
  type Honorific,
  type NationalityBucket,
} from './names';

export type ContactType = 'hiring_manager' | 'emiratisation_lead' | 'hr' | 'exec';
export type EmailStatus = 'guessed' | 'verified' | 'accept_all' | 'bounced' | 'invalid';

export type PersonStatus =
  | 'identity_unconfirmed'
  | 'ready'
  | 'queued'
  | 'in_sequence'
  | 'replied'
  | 'replied_external'
  | 'departed'
  | 'dead_end_mailbox'
  | 'user_took_over'
  | 'closed_silent'
  | 'closed_won_silent'
  | 'suppressed';

/** Sources beyond this age need a second one before anything is drafted. */
export const FRESHNESS_DAYS = 90;

export interface PersonInput {
  companyId: string;
  fullNameRaw: string;
  roleTitle?: string | null;
  contactType: ContactType;
  sourceTier: 1 | 2 | 3 | 4;
  /** The URL naming this person and the company/role together. */
  anchorSourceUrl?: string | null;
  sourceUrls?: string[];
  freshnessDate?: string | null;
  gender?: Gender;
  nationalityBucket?: NationalityBucket;
  seniorityTier?: 1 | 2 | 3 | 4 | null;
  likelyMuslim?: 'high' | 'low' | 'unknown';
  email?: string | null;
  emailStatus?: EmailStatus;
  /** Only ever copied. The schema refuses a value with no source and URL. */
  honorificDeclared?: Honorific | null;
  honorificSource?: 'org_leadership_page' | 'email_signature' | 'linkedin_headline' | 'press_release' | null;
  honorificSourceUrl?: string | null;
  minutesSpent?: number | null;
  userId?: string | null;
}

export interface PersonRow {
  id: string;
  company_id: string;
  ladder_rank: number | null;
  full_name_raw: string;
  given_name: string | null;
  family_name: string | null;
  family_name_detected: number;
  phonetic_key: string;
  honorific_declared: Honorific | null;
  honorific_source: string;
  honorific_source_url: string | null;
  gender: Gender;
  nationality_bucket: NationalityBucket;
  likely_muslim: 'high' | 'low' | 'unknown';
  seniority_tier: number | null;
  role_title: string | null;
  contact_type: ContactType;
  source_tier: number;
  anchor_source_url: string | null;
  freshness_date: string | null;
  corroborating_source_count: number;
  email: string | null;
  email_status: EmailStatus;
  role_based: number;
  in_warm_thread: number;
  status: PersonStatus;
}

/** Generic mailboxes. Not people, and sourcing should down-rank them. */
const ROLE_BASED_PREFIXES = new Set([
  'careers', 'career', 'jobs', 'job', 'hr', 'recruitment', 'recruiting', 'talent',
  'emiratisation', 'emiratization', 'nationalisation', 'info', 'contact', 'hello',
  'enquiries', 'inquiries', 'admin', 'support', 'office', 'people', 'apply',
]);

export function isRoleBasedAddress(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase().replace(/[._-].*$/, '') ?? '';
  return ROLE_BASED_PREFIXES.has(local);
}

// ---------------------------------------------------------------------------
// Suppression and blocking
// ---------------------------------------------------------------------------

export interface SuppressionHit {
  suppressed: boolean;
  scope?: 'person' | 'domain';
  reason?: string;
  message?: string;
}

/**
 * Whether this address or its domain has been suppressed.
 *
 * Permanent, global, and checked before drafting rather than before sending.
 * A "remove me" suppresses the person AND the company; a complaint suppresses
 * the whole domain — because the colleague two desks away is exactly who the
 * ladder would have reached next.
 */
export async function checkSuppression(email: string | null, domain?: string | null): Promise<SuppressionHit> {
  if (email) {
    const person = await queryOne<{ reason: string }>(
      `SELECT reason FROM suppression WHERE scope = 'person' AND email_hash = ?`,
      [hashEmail(email)]
    );
    if (person) {
      return {
        suppressed: true,
        scope: 'person',
        reason: person.reason,
        message: 'This person asked not to be contacted. That is permanent.',
      };
    }
  }

  const host = (domain ?? email?.split('@')[1] ?? '').toLowerCase();
  if (host) {
    const byDomain = await queryOne<{ reason: string }>(
      `SELECT reason FROM suppression WHERE scope = 'domain' AND domain = ?`,
      [host]
    );
    if (byDomain) {
      return {
        suppressed: true,
        scope: 'domain',
        reason: byDomain.reason,
        message: 'Someone at this company asked us to stop. Nobody there gets email from us again.',
      };
    }
  }

  return { suppressed: false };
}

/** Records a suppression. Permanent by design — there is no un-suppress. */
export async function suppress(
  input: { email?: string | null; domain?: string | null; scope: 'person' | 'domain'; reason: string; note?: string }
): Promise<void> {
  await execute(
    `INSERT OR IGNORE INTO suppression (id, email_hash, domain, scope, reason, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('suppression'),
      input.email ? hashEmail(input.email) : null,
      input.domain?.toLowerCase() ?? null,
      input.scope,
      input.reason,
      input.note ?? null,
      nowIso(),
    ]
  );

  if (input.scope === 'person' && input.email) {
    await execute(`UPDATE person SET status = 'suppressed', updated_at = ? WHERE email = ?`, [
      nowIso(),
      input.email.toLowerCase(),
    ]);
  }
  if (input.scope === 'domain' && input.domain) {
    await execute(
      `UPDATE person SET status = 'suppressed', updated_at = ?
        WHERE company_id IN (SELECT id FROM company WHERE domain = ?)`,
      [nowIso(), input.domain.toLowerCase()]
    );
  }

  await logEvent({
    event: 'error',
    level: 'info',
    entityType: 'suppression',
    detail: { scope: input.scope, reason: input.reason, domain: input.domain ?? null },
  });
}

// ---------------------------------------------------------------------------
// Creating people
// ---------------------------------------------------------------------------

export interface CreateResult {
  id: string;
  status: PersonStatus;
  /** Present when an existing row shares the transliteration family. */
  duplicateOf?: { id: string; fullNameRaw: string };
  warnings: string[];
}

/**
 * Creates or merges a person.
 *
 * Duplicates are surfaced rather than silently merged: "Mohammed Al Marri" and
 * "Mohamed AlMarri" collapse to one phonetic key, but which rendering is
 * *theirs* is a judgement only a human looking at both sources can make, and we
 * never reformat someone's name.
 */
export async function createPerson(input: PersonInput): Promise<CreateResult> {
  const warnings: string[] = [];
  const parsed = parseName(input.fullNameRaw);

  if (!parsed.givenName) {
    throw new Error('A person needs a name. A row with no name is a role mailbox, not a contact.');
  }

  const company = await queryOne<{ id: string; domain: string; name: string }>(
    'SELECT id, domain, name FROM company WHERE id = ?',
    [input.companyId]
  );
  if (!company) throw new Error(`No company with id ${input.companyId}`);

  const suppression = await checkSuppression(input.email ?? null, company.domain);
  if (suppression.suppressed) {
    throw new Error(suppression.message ?? 'This contact is suppressed.');
  }

  const blocked = await queryOne<{ reason: string }>(
    'SELECT reason FROM blocked_domain WHERE domain = ?',
    [company.domain]
  );
  if (blocked) {
    warnings.push(
      `This company is on the never-contact list (${blocked.reason.replace(/_/g, ' ')}). The person is saved but will not be queued.`
    );
  }

  const key = phoneticKey(parsed.tokens);
  const existing = await queryOne<{ id: string; full_name_raw: string }>(
    'SELECT id, full_name_raw FROM person WHERE company_id = ? AND phonetic_key = ?',
    [input.companyId, key]
  );
  if (existing) {
    return {
      id: existing.id,
      status: 'identity_unconfirmed',
      duplicateOf: { id: existing.id, fullNameRaw: existing.full_name_raw },
      warnings: [
        `${existing.full_name_raw} is already on this company's ladder and looks like the same person. Merge them rather than adding a second rung — two live sequences at one company is worse than none.`,
      ],
    };
  }

  // An honorific found in the name text is reported, never applied: the schema
  // requires the source and URL that prove it.
  if (parsed.honorificInName && !input.honorificDeclared) {
    warnings.push(
      `The name contains "${parsed.honorificInName}". It is not applied until you record which page it came from — honorifics are copied, never derived.`
    );
  }

  const sourceUrls = [...new Set([...(input.sourceUrls ?? []), input.anchorSourceUrl].filter(Boolean))] as string[];
  const status = draftEligibility({
    anchorSourceUrl: input.anchorSourceUrl ?? null,
    corroboratingSourceCount: sourceUrls.length,
    freshnessDate: input.freshnessDate ?? null,
  }).eligible
    ? 'ready'
    : 'identity_unconfirmed';

  const id = newId('person');
  const at = nowIso();

  await execute(
    `INSERT INTO person
       (id, company_id, full_name_raw, given_name, family_name, family_name_detected,
        phonetic_key, honorific_declared, honorific_source, honorific_source_url,
        gender, nationality_bucket, likely_muslim, seniority_tier, role_title, contact_type,
        source_tier, anchor_source_url, freshness_date, corroborating_source_count,
        email, email_status, role_based, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.companyId,
      parsed.fullNameRaw,
      parsed.givenName,
      parsed.familyName,
      parsed.familyNameDetected ? 1 : 0,
      key,
      input.honorificDeclared ?? null,
      input.honorificSource ?? 'none',
      input.honorificSourceUrl ?? null,
      input.gender ?? 'unknown',
      input.nationalityBucket ?? 'unknown',
      input.likelyMuslim ?? 'unknown',
      input.seniorityTier ?? null,
      input.roleTitle ?? null,
      input.contactType,
      input.sourceTier,
      input.anchorSourceUrl ?? null,
      input.freshnessDate ?? null,
      sourceUrls.length,
      input.email?.toLowerCase() ?? null,
      input.emailStatus ?? 'guessed',
      input.email && isRoleBasedAddress(input.email) ? 1 : 0,
      status,
      at,
      at,
    ]
  );

  for (const url of sourceUrls) {
    await execute(
      'INSERT OR IGNORE INTO person_source (id, person_id, url, tier, captured_at) VALUES (?, ?, ?, ?, ?)',
      [newId('personSource'), id, url, input.sourceTier, at]
    );
  }

  await logEvent({
    event: status === 'ready' ? 'person_created' : 'person_identity_unconfirmed',
    userId: input.userId ?? null,
    entityType: 'person',
    entityId: id,
    detail: {
      company: company.name,
      contactType: input.contactType,
      tier: input.sourceTier,
      minutes: input.minutesSpent ?? null,
      status,
    },
  });

  return { id, status, warnings };
}

export interface EligibilityInput {
  anchorSourceUrl: string | null;
  corroboratingSourceCount: number;
  freshnessDate: string | null;
  emailStatus?: EmailStatus;
  now?: Date;
}

export interface Eligibility {
  eligible: boolean;
  /** Ordered, most fundamental first — the first one is what to fix. */
  blockers: Array<{ code: string; message: string }>;
}

/**
 * Whether this person may reach the draft queue.
 *
 * Every blocker here has a specific failure behind it in the register. None of
 * them is a style preference, and none may be waived by the UI.
 */
export function draftEligibility(input: EligibilityInput): Eligibility {
  const blockers: Array<{ code: string; message: string }> = [];

  if (!input.anchorSourceUrl) {
    blockers.push({
      code: 'no_anchor',
      message:
        'No anchor source: nothing we have names this person and this company together. Without it the row may be a different person with the same name.',
    });
  }

  const fresh =
    input.freshnessDate != null &&
    compareDates(input.freshnessDate, addDays(todayUae(input.now ?? new Date()), -FRESHNESS_DAYS)) >= 0;

  if (input.corroboratingSourceCount < 2 && !fresh) {
    blockers.push({
      code: 'stale_single_source',
      message: `One source, and older than ${FRESHNESS_DAYS} days. People who have left do not update their profiles — find a second source or a fresher one.`,
    });
  }

  if (input.emailStatus === 'guessed') {
    blockers.push({
      code: 'email_unverified',
      message: 'The address is inferred but not verified. Verified addresses only.',
    });
  }
  if (input.emailStatus === 'bounced' || input.emailStatus === 'invalid') {
    blockers.push({ code: 'email_dead', message: 'That address is not live.' });
  }

  return { eligible: blockers.length === 0, blockers };
}

/** Full eligibility for a stored person, including their address status. */
export async function personEligibility(personId: string, now?: Date): Promise<Eligibility> {
  const person = await queryOne<PersonRow>('SELECT * FROM person WHERE id = ?', [personId]);
  if (!person) return { eligible: false, blockers: [{ code: 'missing', message: 'No such person.' }] };

  const eligibility = draftEligibility({
    anchorSourceUrl: person.anchor_source_url,
    corroboratingSourceCount: person.corroborating_source_count,
    freshnessDate: person.freshness_date,
    emailStatus: person.email_status,
    now,
  });

  if (person.in_warm_thread === 1) {
    eligibility.blockers.unshift({
      code: 'warm_thread',
      message: 'This person is already in a live thread with you. Cold-emailing them now would be strange.',
    });
    eligibility.eligible = false;
  }

  // accept_all is sendable only when the exact address was seen verbatim in a
  // public source — the server swallows everything otherwise, silently.
  if (person.email_status === 'accept_all') {
    const seenVerbatim = await queryOne<{ n: number }>(
      `SELECT count(*) AS n FROM person_source WHERE person_id = ? AND url LIKE '%' || ? || '%'`,
      [personId, person.email ?? ' ']
    );
    if (!seenVerbatim || seenVerbatim.n === 0) {
      eligibility.blockers.push({
        code: 'accept_all_unconfirmed',
        message:
          'This domain accepts everything, so verification proves nothing. Only send if you have seen this exact address written down somewhere public.',
      });
      eligibility.eligible = false;
    }
  }

  return eligibility;
}

/** Re-runs eligibility and moves the person between ready and unconfirmed. */
export async function refreshPersonStatus(personId: string): Promise<PersonStatus> {
  const person = await queryOne<PersonRow>('SELECT * FROM person WHERE id = ?', [personId]);
  if (!person) throw new Error('No such person.');

  // Never overwrite a state a human or a reply put us in.
  if (!['identity_unconfirmed', 'ready'].includes(person.status)) return person.status;

  const eligibility = await personEligibility(personId);
  const status: PersonStatus = eligibility.eligible ? 'ready' : 'identity_unconfirmed';
  await execute('UPDATE person SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), personId]);
  return status;
}

/** Attaches a person to their ladder slot, filling the plan seeded in week 1. */
export async function assignToLadder(personId: string, companyId: string, contactType: ContactType): Promise<number | null> {
  const slot = await queryOne<{ id: string; rank: number }>(
    'SELECT id, rank FROM ladder_slot WHERE company_id = ? AND contact_type = ? AND person_id IS NULL ORDER BY rank ASC LIMIT 1',
    [companyId, contactType]
  );
  if (!slot) return null;

  await execute('UPDATE ladder_slot SET person_id = ? WHERE id = ?', [personId, slot.id]);
  await execute('UPDATE person SET ladder_rank = ?, updated_at = ? WHERE id = ?', [slot.rank, nowIso(), personId]);
  return slot.rank;
}

/** Merges a duplicate into the row we keep, preserving both renderings. */
export async function mergePeople(keepId: string, mergeId: string): Promise<void> {
  const at = nowIso();
  await execute('UPDATE evidence SET person_id = ? WHERE person_id = ?', [keepId, mergeId]);
  await execute('UPDATE person_source SET person_id = ? WHERE person_id = ?', [keepId, mergeId]);
  await execute(
    `UPDATE person
        SET corroborating_source_count = (SELECT count(*) FROM person_source WHERE person_id = ?),
            updated_at = ?
      WHERE id = ?`,
    [keepId, at, keepId]
  );
  await execute('UPDATE ladder_slot SET person_id = NULL WHERE person_id = ?', [mergeId]);
  await execute('DELETE FROM person WHERE id = ?', [mergeId]);
  await refreshPersonStatus(keepId);
}

export async function personById(id: string): Promise<PersonRow | null> {
  return queryOne<PersonRow>('SELECT * FROM person WHERE id = ?', [id]);
}

export async function peopleForCompany(companyId: string): Promise<PersonRow[]> {
  return query<PersonRow>(
    'SELECT * FROM person WHERE company_id = ? ORDER BY ladder_rank ASC NULLS LAST, created_at ASC',
    [companyId]
  );
}

/** Marks a departure: their evidence is stale and the ladder moves on. */
export async function markDeparted(personId: string, successorName?: string | null): Promise<void> {
  const at = nowIso();
  await execute(
    `UPDATE person SET status = 'departed', email_status = 'invalid', updated_at = ? WHERE id = ?`,
    [at, personId]
  );
  await execute(
    `UPDATE evidence SET usable = 0, unusable_reason = 'the person this was about has left the company', updated_at = ?
      WHERE person_id = ?`,
    [at, personId]
  );
  await execute(
    `UPDATE outreach SET status = 'closed', updated_at = ?
      WHERE person_id = ? AND status IN ('queued', 'drafted', 'approved', 'stale', 'needs_fact')`,
    [at, personId]
  );
  await logEvent({
    event: 'reply',
    entityType: 'person',
    entityId: personId,
    detail: { classification: 'departed', successor: successorName ?? null },
  });
}

/** Freshness in the terms the Review panel shows: "last confirmed at company". */
export function freshnessLabel(freshnessDate: string | null, now: Date = new Date()): string {
  if (!freshnessDate) return 'never confirmed';
  const today = todayUae(now);
  if (compareDates(freshnessDate, addDays(today, -FRESHNESS_DAYS)) >= 0) {
    return `confirmed ${freshnessDate}`;
  }
  return `last confirmed ${freshnessDate} — over ${FRESHNESS_DAYS} days ago`;
}

export { toUaeDate };
