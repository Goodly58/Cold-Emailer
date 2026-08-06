/**
 * The profile interview (ULTRAPROMPT §5, "One-word interview answers produce an
 * unusable profile").
 *
 * The shape is chips wherever chips work, because "roles: anything, industries:
 * business, credibility: im hardworking" gives the generator nothing and every
 * draft comes out generic. Two free-text fields survive — the credibility
 * marker and the education detail — and both go through a thinness check that
 * asks exactly one concrete follow-up.
 *
 * Two rules the rest of the system depends on:
 *
 *   - The minimum-viable-profile gate blocks onboarding completion. It never
 *     causes a refusal later: the generator's refuse contract fires on thin
 *     EVIDENCE, never on a thin profile, or the user's first experience is an
 *     empty queue they cannot fix.
 *   - The generator may phrase a credibility marker at or below its confirmed
 *     specificity, never above it. `verificationFraming` is what the user said
 *     they would answer if a hiring manager probed the claim in a reply, and it
 *     is the ceiling.
 */

export type FieldKind = 'chips' | 'text' | 'chips_with_other';

export interface InterviewField {
  key: string;
  question: string;
  help?: string;
  kind: FieldKind;
  options?: string[];
  multi?: boolean;
  /** Onboarding cannot complete until every required field is `concrete`. */
  required: boolean;
  placeholder?: string;
  /** Asked after the answer, for claims a recipient could probe in a reply. */
  askVerificationFraming?: boolean;
}

/**
 * The curated lists. These are chips rather than a text box because the user
 * types as little as possible, and because free text here produces "business"
 * — a word that cannot target anything.
 */
export const INTERVIEW_FIELDS: InterviewField[] = [
  {
    key: 'roles',
    question: 'What kind of job are you after?',
    help: 'Pick as many as fit. You can change these later.',
    kind: 'chips_with_other',
    multi: true,
    required: true,
    options: [
      'Finance / analyst',
      'Accounting',
      'Banking — retail',
      'Banking — corporate',
      'Investment / asset management',
      'Marketing',
      'Communications / PR',
      'Human resources',
      'Operations',
      'Supply chain / logistics',
      'Data / analytics',
      'Software engineering',
      'IT / infrastructure',
      'Cybersecurity',
      'Consulting',
      'Project management',
      'Engineering — civil',
      'Engineering — mechanical',
      'Engineering — electrical',
      'Legal',
      'Government relations',
      'Customer experience',
      'Sales / business development',
      'Graduate programme (open to any team)',
    ],
  },
  {
    key: 'industries',
    question: 'Which industries interest you?',
    help: 'Pick two or three. More is fine.',
    kind: 'chips_with_other',
    multi: true,
    required: true,
    options: [
      'Banking',
      'Insurance',
      'Energy / oil and gas',
      'Renewables',
      'Aviation',
      'Logistics / ports',
      'Real estate',
      'Construction',
      'Telecoms',
      'Technology',
      'Healthcare',
      'Education',
      'Retail',
      'Hospitality',
      'Government-linked / sovereign',
      'Consulting / professional services',
      'Media',
      'Manufacturing',
    ],
  },
  {
    key: 'cities',
    question: 'Where do you want to work?',
    kind: 'chips',
    multi: true,
    required: true,
    options: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Anywhere in the UAE'],
  },
  {
    key: 'education',
    question: 'Where do you study, and what?',
    help: 'For example: "Zayed University, BSc Finance, graduating June 2027".',
    kind: 'text',
    required: true,
    placeholder: 'University, subject, when you finish',
  },
  {
    key: 'credibility_marker',
    question: 'What is one concrete thing you have actually done?',
    help: 'An internship, a project, a competition, a number you moved. One is enough. This is the sentence that makes a stranger take you seriously.',
    kind: 'text',
    required: true,
    placeholder: 'One specific thing, in your own words',
    askVerificationFraming: true,
  },
  {
    key: 'nafis_registered',
    question: 'Are you registered with Nafis?',
    kind: 'chips',
    multi: false,
    required: true,
    options: ['Yes', 'Not yet', 'Not sure'],
    help: 'This is a fact we may mention to an HR contact. We never guess it.',
  },
  {
    key: 'availability',
    question: 'When could you start?',
    kind: 'chips_with_other',
    multi: false,
    required: true,
    options: ['Right away', 'After I graduate', 'One month', 'Two months', 'Three months'],
    help: 'Positive replies ask this within a day. Answering it now means you are not stuck later.',
  },
  {
    key: 'tone',
    question: 'How should your emails sound?',
    kind: 'chips',
    multi: false,
    required: false,
    options: ['Formal and respectful', 'Straightforward and warm', 'Short and direct'],
    help: 'We adjust anyway for who is receiving it. This is your starting point.',
  },
];

export const HYGIENE_FIELDS: InterviewField[] = [
  {
    key: 'current_employers',
    question: 'Where do you work or intern right now?',
    help: 'So we never email your own employer. Leave blank if none.',
    kind: 'text',
    required: false,
    placeholder: 'Company name, or leave blank',
  },
  {
    key: 'recent_applications',
    question: 'Anywhere you have applied or been turned down in the last few months?',
    help: 'We will leave those alone for now.',
    kind: 'text',
    required: false,
    placeholder: 'Company names, separated by commas',
  },
  {
    key: 'never_contact',
    question: 'Anywhere you would rather we never contacted?',
    help: 'Family business, a company where you know people, anywhere awkward. No explanation needed.',
    kind: 'text',
    required: false,
    placeholder: 'Company names, separated by commas',
  },
];

// ---------------------------------------------------------------------------
// Thinness
// ---------------------------------------------------------------------------

export type Specificity = 'unknown' | 'thin' | 'concrete';

/** Answers that technically fill the box and say nothing. */
const EMPTY_WORDS = [
  'anything',
  'any',
  'whatever',
  'business',
  'general',
  'na',
  'n/a',
  'none',
  'idk',
  'not sure',
  'dunno',
  'hardworking',
  'hard working',
  'hard worker',
  'good communicator',
  'team player',
  'quick learner',
  'motivated',
  'passionate',
  'dedicated',
  'reliable',
  'ambitious',
];

/**
 * Whether a text answer is concrete enough to build an email on.
 *
 * Deliberately generous — this gate exists to catch "im hardworking", not to
 * grade prose. A false "thin" costs one extra question; a false "concrete"
 * costs every draft that field ever touches.
 */
export function assessText(value: string): Specificity {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'unknown';

  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9\s/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (EMPTY_WORDS.includes(normalized)) return 'thin';

  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 4) return 'thin';

  // A specific claim almost always carries a proper noun, a number, or a date.
  const hasProperNoun = /[A-Z][a-z]{2,}/.test(trimmed);
  const hasNumber = /\d/.test(trimmed);
  const contentWords = words.filter((w) => !EMPTY_WORDS.includes(w));
  if (!hasProperNoun && !hasNumber && contentWords.length < 6) return 'thin';

  return 'concrete';
}

/**
 * How specific a chip answer is.
 *
 * **A value the user picked from a list we wrote is concrete by construction.**
 * There is nothing vague about tapping "Banking" or "Yes" — we offered those
 * words, and grading them against a prose heuristic condemns every single-chip
 * answer in the interview as thin. That matters far more than it looks: a thin
 * answer is excluded from `generatorProfile`, and chip answers are arrays, so
 * they never get the rescue question that saves a thin *text* answer. The
 * result was that "When could you start?" — the question every second positive
 * reply asks, which onboarding collects for exactly that reason — was silently
 * discarded, and reply assist asked the user for it again every time.
 *
 * Only free text typed into an Other box is assessed, and only when it is the
 * whole answer.
 */
export function assessChips(values: string[], options: string[] = []): Specificity {
  if (values.length === 0) return 'unknown';

  const known = new Set(options.map((o) => o.toLowerCase()));
  const freeText = values.filter((v) => !known.has(v.trim().toLowerCase()));

  // At least one thing was picked from the list. That is a real answer.
  if (freeText.length < values.length) return 'concrete';

  // Everything was typed. Now the prose heuristic earns its keep — this is the
  // "anything" typed into the Other box that the register asks us to catch.
  if (values.length === 1) return assessText(values[0]);
  return 'concrete';
}

export function assessAnswer(field: InterviewField, value: unknown): Specificity {
  if (field.kind === 'text') {
    return typeof value === 'string' ? assessText(value) : 'unknown';
  }
  const values = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  return assessChips(values, field.options ?? []);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface StoredAnswer {
  field: string;
  value: unknown;
  specificity: Specificity;
  followupQuestion: string | null;
  followupAnswer: string | null;
  verificationFraming: string | null;
}

export interface GateResult {
  complete: boolean;
  /** Fields still to answer, in interview order. */
  missing: string[];
  /** Fields answered but too vague to build on. */
  thin: string[];
}

/**
 * The minimum-viable-profile gate. Onboarding cannot complete while this
 * returns `complete: false`, and the reason is always a specific field the
 * user can fix — never "your profile is incomplete".
 *
 * A thin field counts as satisfied once its one follow-up has been answered
 * concretely: we ask once, we do not interrogate.
 */
export function evaluateGate(answers: StoredAnswer[]): GateResult {
  const byField = new Map(answers.map((a) => [a.field, a]));
  const missing: string[] = [];
  const thin: string[] = [];

  for (const field of INTERVIEW_FIELDS) {
    if (!field.required) continue;
    const answer = byField.get(field.key);

    if (!answer || answer.specificity === 'unknown') {
      missing.push(field.key);
      continue;
    }
    if (answer.specificity === 'thin') {
      const rescued = answer.followupAnswer && assessText(answer.followupAnswer) === 'concrete';
      if (!rescued) thin.push(field.key);
    }
  }

  return { complete: missing.length === 0 && thin.length === 0, missing, thin };
}

export function fieldByKey(key: string): InterviewField | undefined {
  return [...INTERVIEW_FIELDS, ...HYGIENE_FIELDS].find((f) => f.key === key);
}

// ---------------------------------------------------------------------------
// The micro-follow-up
// ---------------------------------------------------------------------------

const FOLLOWUP_SYSTEM = `You help a UAE university student make one sentence about themselves specific enough to put in a cold email to a hiring manager.

You will be shown a question and the student's answer. The answer is too vague to use.

Write EXACTLY ONE short follow-up question that would make it concrete. Rules:
- One question. Never two. Never a list.
- Under 20 words.
- Ask for a specific thing: what they did, where, when, or a number.
- Plain words. No jargon. Assume they are typing on a phone and are slightly embarrassed.
- Never criticise the answer or explain why it was not good enough.
- Never suggest an answer for them, and never invent a detail.

Output only the question. No preamble, no quotation marks.`;

/** A per-field fallback, so a missing API key still asks something useful. */
const FALLBACK_FOLLOWUPS: Record<string, string> = {
  credibility_marker: 'What did you actually do there, and roughly when?',
  education: 'Which university, which subject, and when do you finish?',
  roles: 'Which one job title would you take tomorrow if it were offered?',
  industries: 'Which single industry would you pick if you had to choose one?',
};

const GENERIC_FOLLOWUP = 'Can you add one specific detail — a name, a place, or a number?';

/**
 * Asks Claude for one concrete follow-up. Never blocks on Claude: without an
 * API key, or on any failure, the user still gets a sensible question rather
 * than a spinner.
 */
export async function generateFollowup(fieldKey: string, answer: string): Promise<string> {
  const field = fieldByKey(fieldKey);
  const fallback = FALLBACK_FOLLOWUPS[fieldKey] ?? GENERIC_FOLLOWUP;
  if (!field) return fallback;

  const { askClaude } = await import('./claude');
  const reply = await askClaude({
    system: FOLLOWUP_SYSTEM,
    prompt: `Question: ${field.question}\nTheir answer: ${answer}`,
    maxTokens: 100,
    effort: 'low',
  });

  if (!reply) return fallback;

  // Take the first line, and only if it actually reads as one short question.
  const line = reply.split('\n')[0].trim().replace(/^["'`]|["'`]$/g, '');
  if (line.length === 0 || line.length > 160 || line.split('?').length > 2) return fallback;
  return line.endsWith('?') ? line : `${line}?`;
}
