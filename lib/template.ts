/**
 * The email spec (research/template-doctrine.md, adapted from Becc Holland).
 *
 * Four lines, in this order and no other:
 *
 *   PREMISE   the observable — the longest part, ~40% of the words
 *   INTRO     one or two slots from the user's library, ≤2 sentences, ≤30 words
 *   ASK       exactly one, answerable by this person personally
 *   PUSH/PULL a release valve that lowers the stakes without lowering status
 *
 * The rule underneath all of it is the pizza rule: an observable you cannot
 * connect to the ask in the next sentence gets dropped, even at tier 1.
 * Decoration is a sin.
 *
 * ---
 *
 * ONE CONFLICT, RESOLVED HERE. `research/template-doctrine.md` bans "I hope
 * this email finds you well" as an AI tell. `CULTURE.md` §5 lists "I hope this
 * message finds you well" among the safe pleasantries, and argues the UK
 * bare-transactional email fails in the Gulf not for its length but for its
 * missing frame.
 *
 * Both are right about different recipients. The resolution: the pleasantry is
 * banned at LOW and MEDIUM register, where it reads as a template, and allowed
 * as exactly one line at HIGH register, where its absence reads as someone who
 * did not think the recipient was worth the effort. Logged in EDGE_CASES.md.
 */
import type { Register } from './names';

export const TEMPLATE_VERSION = 'v1.2026-08';

/** Hard caps, enforced mechanically rather than requested in a prompt. */
export const CAPS = {
  maxWords: 120,
  softWarnWords: 150,
  maxSentences: 6,
  maxIntroSlots: 2,
  maxIntroWords: 30,
  maxObservables: 1,
  maxAsks: 1,
  maxLinks: 1,
  /** Hard, and not configurable upward. A fourth touch makes a nuisance. */
  maxTouches: 3,
} as const;

/**
 * The blocklist. Holland's 49-words list, plus the AI tells from PLAN §6a.
 *
 * Five of these are exactly what a job-seeker reaches for by default — pick
 * your brain, virtual coffee, quick call, let's connect, I'd love to network —
 * which makes the list more applicable here than in the sales context it came
 * from.
 */
export const BANNED_PHRASES: Array<{ phrase: RegExp; label: string; why: string }> = [
  { phrase: /\bi hope (this|you)\b.{0,30}\b(well|finds you)\b/i, label: 'hope this finds you well', why: 'The most recognisable opener in cold email. Allowed only at high register, where its absence reads as disrespect.' },
  { phrase: /\bhappy (monday|tuesday|wednesday|thursday|friday)\b/i, label: 'happy [weekday]', why: 'Filler that announces a template.' },
  { phrase: /\bi know you'?re busy\b/i, label: "I know you're busy", why: 'Lowers your status without lowering the ask.' },
  { phrase: /\bto see if (we|there|you)\b.{0,25}\bfit\b/i, label: 'to see if we are a fit', why: 'Vendor language.' },
  { phrase: /\bi'?d love (to|the opportunity)\b/i, label: "I'd love to", why: 'Says nothing and reads as filler.' },
  { phrase: /\bi'?ll be brief\b/i, label: "I'll be brief", why: 'Being brief is better than announcing it.' },
  { phrase: /\bquick question\b/i, label: 'quick question', why: 'A tell, and usually untrue.' },
  { phrase: /\bjust (checking in|following up|circling back|touching base|wondering)\b/i, label: 'just checking in', why: 'Every follow-up must carry something new. This carries nothing.' },
  { phrase: /\bwe'?re the #?1\b/i, label: "we're the #1", why: 'Vendor language.' },
  { phrase: /\bif this is relevant to you\b/i, label: 'if this is relevant to you', why: 'If you are not sure it is relevant, do not send it.' },
  { phrase: /\bdid you get my last email\b/i, label: 'did you get my last email', why: 'Never reference the non-response.' },
  { phrase: /\bcheers\b/i, label: 'cheers', why: 'Wrong register for a stranger in the Gulf.' },
  { phrase: /\bpick your brain\b/i, label: 'pick your brain', why: "Asks for unpaid work and signals you have not thought about what you want." },
  { phrase: /\b(virtual coffee|e-?meet|coffee chat)\b/i, label: 'virtual coffee', why: 'UAE recruiters say plainly that their inboxes are full of these.' },
  { phrase: /\bi don'?t want to waste your time\b/i, label: "I don't want to waste your time", why: 'Lowers your status without lowering the ask.' },
  { phrase: /\bi was really impressed by your profile\b/i, label: 'impressed by your profile', why: 'Praise is not a premise. Agree, disagree, extend, or ask.' },
  { phrase: /\bwe work with leaders like you\b/i, label: 'leaders like you', why: 'Vendor language.' },
  { phrase: /\bquick call\b/i, label: 'quick call', why: 'A tell.' },
  { phrase: /\blet'?s connect\b/i, label: "let's connect", why: 'Asks for nothing in particular.' },
  { phrase: /\bROI\b/, label: 'ROI', why: 'Vendor language.' },
  { phrase: /\bi'?d love to network\b/i, label: "I'd love to network", why: 'Networking is not an ask anyone can answer.' },
  { phrase: /\bi came across\b/i, label: 'I came across', why: 'The most common AI-written opener there is.' },
  { phrase: /\bresonated?\b/i, label: 'resonated', why: 'An AI tell.' },
  { phrase: /\bexcited to\b/i, label: 'excited to', why: 'An AI tell.' },
  { phrase: /\bdelve\b/i, label: 'delve', why: 'An AI tell.' },
  { phrase: /\bleverage\b/i, label: 'leverage', why: 'An AI tell, and jargon.' },
  { phrase: /\bpassionate about\b/i, label: 'passionate about', why: 'An AI tell, and unfalsifiable.' },
  { phrase: /\breach(ing)? out\b/i, label: 'reaching out', why: 'An AI tell. Say what you are actually doing.' },
  { phrase: /\bin today'?s .{0,25}\b(landscape|world|market|environment)\b/i, label: "in today's landscape", why: 'An AI tell.' },
  { phrase: /\bi can help you meet your (emiratisation|emiratization) targets?\b/i, label: 'help you meet your targets', why: 'Tells a UAE HR lead what their obligations are. They administer them.' },
];

/** Phrases banned only outside high register, where CULTURE.md wants them. */
const HIGH_REGISTER_EXEMPT = new Set(['hope this finds you well']);

export interface LintFinding {
  rule: string;
  severity: 'block' | 'warn';
  message: string;
  /** The offending text, so the Review screen can point at it. */
  excerpt?: string;
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The generator-output lint. Everything here BLOCKS — a draft that trips it
 * never reaches the Review screen, because the user cannot be expected to
 * recognise an AI tell.
 *
 * The user's own edits go through `lintUserEdit` instead, which only warns:
 * their email, their words.
 */
export function lintGenerated(
  body: string,
  options: { register?: Register; subject?: string } = {}
): LintFinding[] {
  const findings: LintFinding[] = [];
  const register = options.register ?? 'MEDIUM';

  for (const { phrase, label, why } of BANNED_PHRASES) {
    const match = body.match(phrase) ?? options.subject?.match(phrase);
    if (!match) continue;
    if (register === 'HIGH' && HIGH_REGISTER_EXEMPT.has(label)) continue;
    findings.push({
      rule: `banned:${label}`,
      severity: 'block',
      message: `"${label}" — ${why}`,
      excerpt: match[0],
    });
  }

  // Em dashes are the single most reliable AI tell in this context.
  if (/[—–]/.test(body)) {
    findings.push({
      rule: 'em_dash',
      severity: 'block',
      message: 'Em dashes read as machine-written here. Use a full stop or a comma.',
      excerpt: body.match(/.{0,20}[—–].{0,20}/)?.[0],
    });
  }

  const wordCount = words(body).length;
  if (wordCount > CAPS.maxWords) {
    findings.push({
      rule: 'too_long',
      severity: 'block',
      message: `${wordCount} words. The cap is ${CAPS.maxWords} — a hiring manager reads this on a phone.`,
    });
  }

  const sentenceCount = sentences(body).length;
  if (sentenceCount > CAPS.maxSentences) {
    findings.push({
      rule: 'too_many_sentences',
      severity: 'block',
      message: `${sentenceCount} sentences. Four lines is the shape: premise, intro, ask, release.`,
    });
  }

  const links = body.match(/https?:\/\//g)?.length ?? 0;
  if (links > CAPS.maxLinks) {
    findings.push({
      rule: 'too_many_links',
      severity: 'block',
      message: `${links} links. More than one is a spam-filter trigger on a personal mailbox.`,
    });
  }

  if (/\b(bit\.ly|tinyurl|goo\.gl|t\.co)\b/i.test(body)) {
    findings.push({ rule: 'shortener', severity: 'block', message: 'Link shorteners are a spam-filter trigger.' });
  }

  // Two asks means neither gets answered.
  const questionMarks = (body.match(/\?/g) ?? []).length;
  if (questionMarks > CAPS.maxAsks) {
    findings.push({
      rule: 'multiple_asks',
      severity: 'block',
      message: `${questionMarks} questions. Exactly one ask, or you get an answer to neither.`,
    });
  }

  if (options.subject) {
    const subjectWords = words(options.subject).length;
    if (subjectWords > 7) {
      findings.push({
        rule: 'subject_long',
        severity: 'block',
        message: `Subject is ${subjectWords} words. Two to seven, and it must survive truncation at about 35 characters on a phone.`,
      });
    }
    if (/^re:/i.test(options.subject)) {
      findings.push({ rule: 'fake_re', severity: 'block', message: 'Never "Re:" on a first touch.' });
    }
    if (/!/.test(options.subject)) {
      findings.push({ rule: 'subject_exclamation', severity: 'block', message: 'No exclamation marks in the subject.' });
    }
  }

  if (register === 'HIGH') {
    if (!/\bthank you\b|\bgrateful\b|\bthanks for\b/i.test(body)) {
      findings.push({
        rule: 'high_register_no_thanks',
        severity: 'block',
        message: 'High register needs one line of genuine thanks. Its absence is what reads as disrespect, not the brevity.',
      });
    }
    if (/!/.test(body)) {
      findings.push({ rule: 'high_register_exclamation', severity: 'warn', message: 'Exclamation marks read as over-familiar at this register.' });
    }
  }

  return findings;
}

/**
 * The lint on what the USER typed. Warnings only, always.
 *
 * Their name is on it. The job here is to catch the two edits that genuinely
 * hurt — deleting the personal opening, and adding a claim nothing backs — and
 * then get out of the way.
 */
export function lintUserEdit(
  edited: string,
  original: string,
  backing: { evidenceQuotes: string[]; profileValues: string[] }
): LintFinding[] {
  const findings: LintFinding[] = [];

  const wordCount = words(edited).length;
  if (wordCount > CAPS.softWarnWords) {
    findings.push({
      rule: 'user_long',
      severity: 'warn',
      message: `${wordCount} words. Long emails from strangers get skimmed, but it is your call.`,
    });
  }

  const originalOpening = sentences(original)[0];
  if (originalOpening && !edited.includes(originalOpening.slice(0, Math.min(40, originalOpening.length)))) {
    findings.push({
      rule: 'hook_removed',
      severity: 'warn',
      message: 'You removed the opening line — the part that shows you actually read something of theirs. That line is why this gets a reply.',
    });
  }

  // New sentences carrying a factual claim that nothing backs.
  const originalSentences = new Set(sentences(original).map((s) => s.toLowerCase().trim()));
  const haystack = [...backing.evidenceQuotes, ...backing.profileValues].join(' ').toLowerCase();

  for (const sentence of sentences(edited)) {
    const normalized = sentence.toLowerCase().trim();
    if (originalSentences.has(normalized)) continue;
    if (!looksFactual(sentence)) continue;

    const claimWords = normalized
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const supported = claimWords.length > 0 && claimWords.some((w) => haystack.includes(w));

    if (!supported) {
      findings.push({
        rule: 'unbacked_claim',
        severity: 'warn',
        message: 'Nothing in your profile or the research backs this sentence. Send it anyway if it is true — just be ready to stand behind it in a reply.',
        excerpt: sentence,
      });
    }
  }

  return findings;
}

/** A sentence making a checkable claim, rather than a pleasantry. */
function looksFactual(sentence: string): boolean {
  return (
    /\b(i (have|am|was|did|led|built|ran|worked|applied|studied|completed|managed|won))\b/i.test(sentence) ||
    /\b\d/.test(sentence)
  );
}

// ---------------------------------------------------------------------------
// Asks and release valves
// ---------------------------------------------------------------------------

/** Ask patterns, ranked. Interest-based beats time-based on a first touch. */
export const ASK_PATTERNS = {
  single_question: 'One specific question drawn from the premise, answerable in a line without a calendar.',
  bounded_time: 'Fifteen minutes, their choice of time, no calendar link. Only after a strong tier 1 or 2 premise.',
  redirect: 'If someone on your team is closer to this, I would rather ask them. Good for senior recipients; delegation still counts as a win.',
  permission: 'Would it be useful if I sent the two-page version? Only if the artifact exists.',
} as const;

export const PUSH_PULL_LINES = [
  'Either way, thank you for putting that online.',
  'If the answer is no, that is a completely fine answer.',
  'If you would rather point me to someone else, that works too.',
  'No reply needed if the timing is wrong.',
] as const;

/**
 * Which intro slots to use, by recipient (template-doctrine §(b)).
 *
 * The Emiratisation lead is the one case where status leads: for that
 * recipient, status IS the relevance.
 */
export const INTRO_SLOT_MATRIX: Record<string, Array<'A_identity' | 'B_credibility' | 'C_status' | 'D_affinity'>> = {
  hiring_manager: ['A_identity', 'B_credibility'],
  exec: ['A_identity', 'B_credibility'],
  hr: ['A_identity', 'C_status'],
  emiratisation_lead: ['C_status', 'A_identity'],
};

/** Subject-line families to A/B test. Judged on reply rate, never opens. */
export const SUBJECT_VARIANTS = [
  { id: 'bare_identity', template: 'Emirati {university} grad', note: "The founder's tested pattern." },
  { id: 'identity_company', template: '{university} student, {company}', note: 'Tests the company-name lift.' },
  { id: 'identity_topic', template: '{university} grad, {topic}', note: 'Identity plus a narrow topic.' },
  { id: 'premise_echo', template: 'Your {artifact}', note: 'Highest personalization, lowest scale.' },
] as const;

/**
 * How the Emiratisation angle is allowed to appear, by recipient.
 *
 * Never as the opener, never as leverage, and never at all to a senior Emirati
 * — foregrounding it there reframes the sender as a compliance line-item
 * rather than a candidate.
 */
export const NAFIS_POSTURE: Record<string, string> = {
  emiratisation_lead:
    'State it plainly and early. It is material business information to this person, and it is why the email is relevant to them.',
  hr: 'State it once, factually, as a fact about you: "I am a UAE national graduating in June."',
  hiring_manager: 'At most a factual closer. Lead with the work.',
  exec: 'Omit it. They can already tell from the name, and raising it makes you a line-item.',
};
