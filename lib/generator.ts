/**
 * The clarify-and-refuse generator.
 *
 * The contract, in one sentence: the generator sees structured evidence rows
 * and confirmed profile fields, and may state nothing else. Not "should not" —
 * the prompt says so, the lint checks the output, and a draft that fails is
 * refused rather than softened.
 *
 * Refusal is a first-class outcome. Thin evidence produces a "needs one fact"
 * card naming what would unblock it, never a generic email. Fabricating a
 * premise is the single largest reputational risk in the product, and the
 * failure it produces — a specific-sounding claim about a stranger that is not
 * true — is unrecoverable in a professional network this small.
 */
import { addDays, compareDates, toUaeDate, todayUae } from './calendar';
import { askClaude, isClaudeConfigured } from './claude';
import { usableEvidenceFor, type EvidenceRow } from './evidence';
import { queryOne, query } from './db/client';
import {
  deriveRegister,
  parseName,
  resolveSalutation,
  lintSalutation,
  type Honorific,
  type NationalityBucket,
  type Register,
} from './names';
import {
  CAPS,
  INTRO_SLOT_MATRIX,
  NAFIS_POSTURE,
  PUSH_PULL_LINES,
  TEMPLATE_VERSION,
  lintGenerated,
  type LintFinding,
} from './template';
import type { PersonRow } from './people';

export type GenerationOutcome =
  | { kind: 'draft'; draft: Draft }
  | { kind: 'refusal'; refusal: Refusal }
  | { kind: 'halt'; reason: string; detail: string };

export interface Draft {
  subject: string;
  body: string;
  evidenceIds: string[];
  premiseTier: number | null;
  templateVersion: string;
  subjectVariant: string;
  register: Register;
  salutation: string;
  /** Every claim, with the evidence row behind it — this is the panel. */
  annotations: Annotation[];
  lint: LintFinding[];
}

export interface Annotation {
  claim: string;
  evidenceId: string | null;
  sourceUrl: string | null;
  quote: string;
  quoteTranslated?: string | null;
  language: string;
  capturedAt: string;
  kind: 'evidence' | 'profile';
}

export interface Refusal {
  reason: string;
  /** What exactly would unblock this. Never "insufficient evidence". */
  collectionRequest: string;
  /** Shown on the card so the founder can act without opening the database. */
  searchedTiers: number[];
}

interface GenerationContext {
  person: PersonRow;
  company: { id: string; name: string; domain: string; org_type: string | null };
  profile: Record<string, string>;
  introBlocks: Array<{ slot: string; text: string }>;
  step: 1 | 2 | 3;
  gapWorkingDays?: number;
  priorContactAtCompany: boolean;
  previousBody?: string | null;
  previousSubject?: string | null;
}

// ---------------------------------------------------------------------------
// Premise selection
// ---------------------------------------------------------------------------

/**
 * Recency gates from template-doctrine §(a). A stale tier-1 is not a tier-1.
 *
 * "Older than ninety days" is a calendar question, so it goes through
 * lib/calendar.ts rather than a millisecond subtraction — the same reason the
 * countdowns do.
 */
function effectiveTier(row: EvidenceRow, today: string): number {
  const capturedDate = toUaeDate(new Date(row.captured_at));
  const olderThan = (days: number) => compareDates(capturedDate, addDays(today, -days)) < 0;

  let tier = row.tier as number;
  if (row.tier <= 2) {
    if (olderThan(365)) tier += 2;
    else if (olderThan(90)) tier += 1;
  }
  // Every tool congratulates promotions. A stale one is worse than nothing.
  if (row.tier === 4 && olderThan(30)) tier = 6;
  return Math.min(tier, 6);
}

/**
 * Picks the premise: the highest usable tier holding a real, recent, specific
 * artifact. Never mixes two tiers in one opener — two observables prove you
 * were researching rather than reading.
 */
export function selectPremise(
  rows: EvidenceRow[],
  now: Date = new Date()
): { premise: EvidenceRow | null; considered: number[] } {
  const today = todayUae(now);
  const ranked = rows
    .map((row) => ({ row, tier: effectiveTier(row, today) }))
    .filter((r) => r.tier <= 5)
    .sort((a, b) => a.tier - b.tier || Date.parse(b.row.captured_at) - Date.parse(a.row.captured_at));

  return {
    premise: ranked[0]?.row ?? null,
    considered: [...new Set(rows.map((r) => r.tier as number))].sort(),
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const CONTRACT = `You write one short cold email for an Emirati university student looking for a job in the UAE.

THE CONTRACT, WHICH OVERRIDES EVERY OTHER INSTRUCTION:
- You may state ONLY facts that appear in the EVIDENCE and PROFILE blocks below.
- You may not add a fact, a number, a date, a name, a job title, or an inference. Not one.
- If the evidence is too thin to open with something specific and real, output exactly:
  REFUSE: <one sentence naming the single fact that would unblock this>
  A refusal is a correct answer. An invented detail is not.
- Never assert the recipient's job title as a claim. It is targeting metadata, not something you know.
- Never state a policy figure, quota number, or subsidy amount, even if you know one.

SHAPE, in this order, four lines:
1. PREMISE — the observable, in your own words, proving you actually consumed it. The longest part.
   Name their argument, not the artifact: "Your talk argued X" beats "I watched your talk."
   Agree, disagree, extend, or ask. Never praise: "impressive", "insightful", "great post" are banned.
2. INTRO — one or two of the supplied intro slots, verbatim in substance. At most 2 sentences, 30 words.
3. ASK — exactly one, answerable by this person personally, in a line, without a calendar.
4. RELEASE — one line lowering the stakes. Never lower your own status to do it.

VOICE:
- Under 120 words, at most 6 sentences.
- Plain words. Short sentences. Reads like a sharp student typed it in three minutes.
- No em dashes. No exclamation marks. No links unless one is supplied.
- Banned outright: I came across · resonated · excited to · delve · leverage · passionate about ·
  reaching out · pick your brain · virtual coffee · quick call · let's connect · I'd love to ·
  quick question · just checking in · I know you're busy · I hope this email finds you well.

OUTPUT FORMAT — nothing else:
SUBJECT: <2-7 words, no colon, no Re:, no exclamation>
BODY:
<the email, without the greeting line and without the sign-off; both are added separately>`;

function evidenceBlock(rows: EvidenceRow[]): string {
  return rows
    .map((r, i) => {
      const text = r.quote_translated
        ? `${r.quote_translated}\n    (translated from ${r.language}; original not for quoting)`
        : r.quote;
      return `[E${i + 1}] tier ${r.tier} · captured ${r.captured_at.slice(0, 10)} · ${r.source_url}\n    ${text}`;
    })
    .join('\n');
}

function profileBlock(profile: Record<string, string>, introBlocks: Array<{ slot: string; text: string }>): string {
  const slots = introBlocks.map((b) => `[${b.slot}] ${b.text}`).join('\n');
  const fields = Object.entries(profile)
    .filter(([key]) => !['current_employers', 'recent_applications', 'never_contact'].includes(key))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `INTRO SLOTS (use one or two, unchanged in substance):\n${slots || '(none)'}\n\nCONFIRMED FIELDS:\n${fields}`;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export async function generate(context: GenerationContext, now: Date = new Date()): Promise<GenerationOutcome> {
  const { person, company, step } = context;

  const parsedName = parseName(person.full_name_raw);
  const register = deriveRegister({
    seniorityTier: (person.seniority_tier as 1 | 2 | 3 | 4 | null) ?? null,
    orgType: (company.org_type as never) ?? null,
    nationalityBucket: person.nationality_bucket as NationalityBucket,
    functionType:
      person.contact_type === 'hr' || person.contact_type === 'emiratisation_lead'
        ? 'hr_ta'
        : person.contact_type === 'exec'
          ? 'exec'
          : 'hiring_manager',
  });

  const salutationResult = resolveSalutation({
    name: parsedName,
    gender: person.gender,
    nationalityBucket: person.nationality_bucket as NationalityBucket,
    register,
    honorificDeclared: person.honorific_declared as Honorific | null,
  });

  if (salutationResult.halt === 'ruling_family') {
    return { kind: 'halt', reason: 'ruling_family', detail: salutationResult.reason };
  }
  const salutation = salutationResult.salutation ?? `Dear ${person.full_name_raw},`;

  const salutationLint = lintSalutation(salutation, {
    honorificDeclared: person.honorific_declared as Honorific | null,
    orgType: company.org_type,
  });
  const blockingSalutation = salutationLint.find((f) => f.severity === 'block');
  if (blockingSalutation) {
    return { kind: 'halt', reason: blockingSalutation.rule, detail: blockingSalutation.message };
  }

  // Step 2 is Lite: a reply on the same thread with no new premise. Step 3 is
  // the break-up on a fresh subject. Only step 1 needs a premise at all.
  if (step === 2) return liteFollowUp(context, salutation, register);
  if (step === 3) return breakUp(context, salutation, register);

  const evidence = await usableEvidenceFor(person.id, company.id);
  const { premise, considered } = selectPremise(evidence, now);

  if (!premise) {
    return {
      kind: 'refusal',
      refusal: {
        reason: `Nothing usable to open with for ${person.full_name_raw}.`,
        collectionRequest: `Find one recent, specific thing ${person.full_name_raw} said, wrote, or did — a post, a talk, a quote in a press release — or one thing ${company.name} did that directly creates what you would be asking about.`,
        searchedTiers: considered,
      },
    };
  }

  if (!isClaudeConfigured()) {
    return {
      kind: 'refusal',
      refusal: {
        reason: 'No Claude API key, so nothing can be drafted.',
        collectionRequest: 'Set ANTHROPIC_API_KEY. Drafting by hand would bypass every check that keeps a claim tied to its source.',
        searchedTiers: considered,
      },
    };
  }

  const slots = INTRO_SLOT_MATRIX[person.contact_type] ?? ['A_identity', 'B_credibility'];
  const chosenBlocks = context.introBlocks.filter((b) => slots.includes(b.slot as never)).slice(0, CAPS.maxIntroSlots);

  const prompt = [
    `RECIPIENT: ${person.full_name_raw}, at ${company.name}.`,
    `They are the ${person.contact_type.replace(/_/g, ' ')}. Do NOT assert this in the email.`,
    `REGISTER: ${register}.`,
    register === 'HIGH'
      ? 'This recipient expects a formal frame: full sentences, no contractions, and one line of genuine thanks before the sign-off.'
      : register === 'LOW'
        ? 'This recipient expects a direct, plain email. No ceremony.'
        : 'Professional but not stiff.',
    '',
    `EMIRATISATION POSTURE: ${NAFIS_POSTURE[person.contact_type] ?? NAFIS_POSTURE.hiring_manager}`,
    context.priorContactAtCompany
      ? 'IMPORTANT: someone else at this company has already been written to. You are forbidden from any first-contact framing that implies otherwise.'
      : '',
    '',
    'EVIDENCE — the only facts you may state about them or their company:',
    evidenceBlock([premise]),
    '',
    profileBlock(context.profile, chosenBlocks),
    '',
    `Open on [E1]. Use ${slots.join(' then ')}.`,
  ]
    .filter(Boolean)
    .join('\n');

  // Two attempts. The second is told exactly what tripped, because a generic
  // "try again" produces the same output.
  let lastLint: LintFinding[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askClaude({
      system: CONTRACT,
      prompt:
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous attempt was rejected:\n${lastLint.map((f) => `- ${f.message}`).join('\n')}\nRewrite it without those.`,
      maxTokens: 900,
      effort: 'medium',
    });

    if (!raw) break;

    if (/^REFUSE:/im.test(raw)) {
      const line = raw.split('\n').find((l) => /^REFUSE:/i.test(l)) ?? raw;
      return {
        kind: 'refusal',
        refusal: {
          reason: 'The evidence was too thin to say anything specific.',
          collectionRequest: line.replace(/^REFUSE:\s*/i, '').trim(),
          searchedTiers: considered,
        },
      };
    }

    const parsed = parseOutput(raw);
    if (!parsed) continue;

    lastLint = lintGenerated(parsed.body, { register, subject: parsed.subject });
    if (lastLint.some((f) => f.severity === 'block')) continue;

    return {
      kind: 'draft',
      draft: {
        subject: parsed.subject,
        body: assemble(salutation, parsed.body, context.profile),
        evidenceIds: [premise.id],
        premiseTier: premise.tier,
        templateVersion: TEMPLATE_VERSION,
        subjectVariant: 'bare_identity',
        register,
        salutation,
        annotations: buildAnnotations(parsed.body, [premise], context.profile, chosenBlocks),
        lint: lastLint,
      },
    };
  }

  return {
    kind: 'refusal',
    refusal: {
      reason: 'Two attempts could not produce a draft that passed the checks.',
      collectionRequest:
        lastLint.length > 0
          ? `The drafts kept tripping: ${lastLint.map((f) => f.message).join(' ')}`
          : 'Stronger evidence would help — something specific enough to build a real opening line on.',
      searchedTiers: considered,
    },
  };
}

function parseOutput(raw: string): { subject: string; body: string } | null {
  const subjectMatch = raw.match(/^SUBJECT:\s*(.+)$/im);
  const bodyMatch = raw.match(/^BODY:\s*\n?([\s\S]+)$/im);
  if (!subjectMatch || !bodyMatch) return null;

  return {
    subject: subjectMatch[1].trim().replace(/^["']|["']$/g, ''),
    body: bodyMatch[1].trim(),
  };
}

/** Greeting, body, sign-off. The signature is appended at send time. */
function assemble(salutation: string, body: string, profile: Record<string, string>): string {
  const signOff = profile.tone === 'Formal and respectful' ? 'With respect and thanks,' : 'Kind regards,';
  return `${salutation}\n\n${body.trim()}\n\n${signOff}`;
}

/**
 * Ties each sentence to what backs it.
 *
 * This is the evidence panel. It is the only mechanism standing between a
 * personalization error and a stranger's inbox, so a sentence that traces to
 * nothing is shown as tracing to nothing rather than quietly omitted.
 */
function buildAnnotations(
  body: string,
  evidence: EvidenceRow[],
  profile: Record<string, string>,
  introBlocks: Array<{ slot: string; text: string }>
): Annotation[] {
  const annotations: Annotation[] = [];
  const sentences = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();

    const row = evidence.find((e) => {
      const source = (e.quote_translated ?? e.quote).toLowerCase();
      const keywords = source.split(/\W+/).filter((w) => w.length > 5);
      const hits = keywords.filter((w) => lower.includes(w)).length;
      return hits >= 2;
    });

    if (row) {
      annotations.push({
        claim: sentence,
        evidenceId: row.id,
        sourceUrl: row.source_url,
        quote: row.quote,
        quoteTranslated: row.quote_translated,
        language: row.language,
        capturedAt: row.captured_at,
        kind: 'evidence',
      });
      continue;
    }

    const block = introBlocks.find((b) => {
      const keywords = b.text.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
      return keywords.filter((w) => lower.includes(w)).length >= 2;
    });

    if (block) {
      annotations.push({
        claim: sentence,
        evidenceId: null,
        sourceUrl: null,
        quote: block.text,
        language: 'en',
        capturedAt: '',
        kind: 'profile',
      });
    }
  }

  return annotations;
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

/**
 * Touch 2 — Lite, on the same thread.
 *
 * No new premise. "Any thoughts?" plus a PS carrying something genuinely new.
 * The PS is where a student beats a vendor: actually do the reading, run the
 * number, build the thing. A follow-up with nothing new should not be sent.
 */
async function liteFollowUp(
  context: GenerationContext,
  salutation: string,
  register: Register
): Promise<GenerationOutcome> {
  const { person, company } = context;

  // A gap this long makes "following up on my note" nonsense.
  if ((context.gapWorkingDays ?? 0) > 10) {
    return reintroduce(context, salutation, register);
  }

  const fresh = await usableEvidenceFor(person.id, company.id);
  const unusedForPs = fresh.filter((r) => r.used_for_person_id === null);

  const ps = unusedForPs[0];
  const body = ps
    ? `Any thoughts on the question below?\n\nPS. ${psLine(ps)}\n\nIf the timing is bad, say so and I will stop writing.`
    : `Any thoughts on the question below?\n\nIf the timing is bad, say so and I will stop writing.`;

  const subject = context.previousSubject ? `Re: ${context.previousSubject}` : 'Re: my note';

  return {
    kind: 'draft',
    draft: {
      subject,
      body: `${salutation}\n\n${body}\n\nKind regards,`,
      evidenceIds: ps ? [ps.id] : [],
      premiseTier: ps?.tier ?? null,
      templateVersion: TEMPLATE_VERSION,
      subjectVariant: 'thread_reply',
      register,
      salutation,
      annotations: ps
        ? [
            {
              claim: psLine(ps),
              evidenceId: ps.id,
              sourceUrl: ps.source_url,
              quote: ps.quote,
              quoteTranslated: ps.quote_translated,
              language: ps.language,
              capturedAt: ps.captured_at,
              kind: 'evidence',
            },
          ]
        : [],
      lint: [],
    },
  };
}

function psLine(row: EvidenceRow): string {
  const text = (row.quote_translated ?? row.quote).trim();
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/**
 * Touch 3 — the break-up, on a new subject.
 *
 * Holland's finding is that this converts highest of the sequence. No guilt, no
 * false finality, and no ask. It also carries the opt-out sentence, which
 * converts a silent spam-flag into a classifiable removal request.
 */
async function breakUp(
  context: GenerationContext,
  salutation: string,
  register: Register
): Promise<GenerationOutcome> {
  const { company, profile } = context;
  const thanksFor = profile.roles ? `the work your team does on ${profile.roles.split(',')[0].trim().toLowerCase()}` : 'your time';

  const body = [
    `I will stop writing after this one.`,
    ``,
    `If a ${profile.roles?.split(',')[0].trim().toLowerCase() ?? 'graduate'} opening ever comes up at ${company.name}, I would still like to hear about it.`,
    ``,
    `Thank you for ${thanksFor}. If you would rather not hear from me again, say the word and I will remove you.`,
  ].join('\n');

  return {
    kind: 'draft',
    draft: {
      subject: `Closing the loop, ${company.name}`,
      body: `${salutation}\n\n${body}\n\nKind regards,`,
      evidenceIds: [],
      premiseTier: null,
      templateVersion: TEMPLATE_VERSION,
      subjectVariant: 'breakup',
      register,
      salutation,
      annotations: [],
      lint: [],
    },
  };
}

/**
 * Re-introduction mode: the gap stretched past ten working days, usually across
 * Ramadan or Eid, and a bump would read as absurd.
 */
async function reintroduce(
  context: GenerationContext,
  salutation: string,
  register: Register
): Promise<GenerationOutcome> {
  const { company, profile } = context;
  const opener = 'I hope you had a good break.';

  const body = [
    opener,
    ``,
    `I wrote to you before the holidays about ${profile.roles?.split(',')[0].trim().toLowerCase() ?? 'a role'} at ${company.name}, and I do not think the timing helped.`,
    ``,
    `Is it worth me asking again now, or is this the wrong moment?`,
    ``,
    PUSH_PULL_LINES[3],
  ].join('\n');

  return {
    kind: 'draft',
    draft: {
      subject: context.previousSubject ? `Re: ${context.previousSubject}` : 'Following up after the break',
      body: `${salutation}\n\n${body}\n\nKind regards,`,
      evidenceIds: [],
      premiseTier: null,
      templateVersion: TEMPLATE_VERSION,
      subjectVariant: 'reintroduction',
      register,
      salutation,
      annotations: [],
      lint: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

export async function loadContext(
  personId: string,
  userId: string,
  step: 1 | 2 | 3
): Promise<GenerationContext | null> {
  const person = await queryOne<PersonRow>('SELECT * FROM person WHERE id = ?', [personId]);
  if (!person) return null;

  const company = await queryOne<{ id: string; name: string; domain: string; org_type: string | null }>(
    'SELECT id, name, domain, org_type FROM company WHERE id = ?',
    [person.company_id]
  );
  if (!company) return null;

  const { generatorProfile } = await import('./profile');
  const introBlocks = await query<{ slot: string; text: string }>(
    'SELECT slot, text FROM intro_block WHERE user_id = ?',
    [userId]
  );

  // Anyone else at this company already written to? The generator is
  // contract-forbidden from first-contact phrasing when so.
  const prior = await queryOne<{ n: number }>(
    `SELECT count(*) AS n FROM outreach o
       JOIN person p ON p.id = o.person_id
      WHERE p.company_id = ? AND o.status = 'sent' AND o.person_id <> ?`,
    [person.company_id, personId]
  );

  const previous = await queryOne<{ subject: string | null; sent_body_verbatim: string | null }>(
    `SELECT subject, sent_body_verbatim FROM outreach
      WHERE person_id = ? AND step = 1 AND status IN ('sent', 'replied')`,
    [personId]
  );

  return {
    person,
    company,
    profile: await generatorProfile(userId),
    introBlocks,
    step,
    priorContactAtCompany: (prior?.n ?? 0) > 0,
    previousSubject: previous?.subject ?? null,
    previousBody: previous?.sent_body_verbatim ?? null,
  };
}
