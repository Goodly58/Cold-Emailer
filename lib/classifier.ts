/**
 * Inbound classification.
 *
 * "Any reply stops the sequence" is wrong for most real inbound, and each way
 * it is wrong costs something specific:
 *
 *   - an Eid out-of-office stops the sequence forever and shows a celebratory
 *     "Replied" — in bulk, around every Eid;
 *   - a bounce shows a happy badge on a dead address;
 *   - "looping in Sara who runs our Nafis programme" gets Sara a cold email
 *     days after she was warm-introduced;
 *   - "remove me" closes one person while the ladder emails their colleague
 *     two desks away.
 *
 * So every message is classified before it may change state. Header pre-checks
 * run first and decide most of it deterministically; Claude handles the rest,
 * with Arabic and mixed-language examples because a polite Arabic rejection
 * classified as neutral engagement produces an enthusiastic English reply to a
 * no.
 *
 * When in doubt the answer is `human_reply`: a false stop costs a follow-up, a
 * false bump costs the relationship.
 */
import { addDays, compareDates, todayUae } from './calendar';
import { askClaude } from './claude';

export type Classification =
  | 'human_positive'
  | 'neutral_question'
  | 'rejection_hard'
  | 'rejection_soft'
  | 'removal_request'
  | 'referral'
  | 'document_request'
  | 'auto_reply_ooo'
  | 'auto_ack_unmonitored'
  | 'gateway_challenge'
  | 'departed'
  | 'complaint_escalation'
  | 'provenance_challenge'
  | 'prior_contact_callout'
  | 'bounce';

export interface InboundMessage {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  headers: Record<string, string>;
}

export interface ClassificationResult {
  classification: Classification;
  /** How it was decided, for the log and for the founder at midnight. */
  via: 'header' | 'pattern' | 'claude' | 'default';
  confidence: 'high' | 'medium' | 'low';
  language: string;
  /** A return date, a successor's name, a portal URL — whatever was extractable. */
  extracted: {
    date?: string | null;
    successor?: string | null;
    url?: string | null;
  };
  note: string;
}

/** Classifications that are not replies and must not stop a sequence. */
export const NOT_A_REPLY: Classification[] = ['auto_reply_ooo', 'auto_ack_unmonitored', 'bounce'];

/** Classifications that must never be followed by ladder rotation. */
export const KILLS_THE_LADDER: Classification[] = [
  'rejection_hard',
  'rejection_soft',
  'removal_request',
  'complaint_escalation',
];

// ---------------------------------------------------------------------------
// Header pre-checks
// ---------------------------------------------------------------------------

/**
 * Deterministic classification from headers alone.
 *
 * These run first because they are certain, and because an autoresponder that
 * reaches the model is an autoresponder that might be read as enthusiasm.
 */
export function classifyByHeaders(message: InboundMessage): ClassificationResult | null {
  const headers = Object.fromEntries(
    Object.entries(message.headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  const from = message.from.toLowerCase();

  // A delivery status notification. Which kind matters enormously.
  const isDsn =
    /mailer-daemon|postmaster/i.test(from) ||
    /multipart\/report/i.test(headers['content-type'] ?? '') ||
    headers['content-type']?.includes('delivery-status');

  if (isDsn) {
    const status = message.body.match(/Status:\s*([245])\.\d+\.\d+/i)?.[1];
    return {
      classification: 'bounce',
      via: 'header',
      confidence: 'high',
      language: 'en',
      extracted: {},
      // 5.x.x is permanent; 4.x.x is a full mailbox or a bad afternoon and
      // deserves one retry rather than burning a real contact.
      note: status === '4' ? 'soft bounce, retry once' : 'hard bounce',
    };
  }

  const autoSubmitted = headers['auto-submitted'];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return autoReplyResult(message, 'header');
  }
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['x-auto-response-suppress']) {
    return autoReplyResult(message, 'header');
  }
  if (/^(auto_reply|auto-replied|bulk|list|junk)$/i.test(headers['precedence'] ?? '')) {
    return autoReplyResult(message, 'header');
  }

  return null;
}

function autoReplyResult(message: InboundMessage, via: 'header' | 'pattern'): ClassificationResult {
  const ticket = /\b(ticket|case|reference)\s*(#|no\.?|number)?\s*[:\s]\s*\w+/i.test(message.body);
  const portal = message.body.match(/https?:\/\/[^\s>)\]]+/)?.[0] ?? null;

  if (ticket || /do[\s-]?not[\s-]?reply|unmonitored|no[\s-]?reply@/i.test(message.body + message.from)) {
    return {
      classification: 'auto_ack_unmonitored',
      via,
      confidence: 'high',
      language: 'en',
      extracted: { url: portal },
      note: 'A ticketing or unmonitored mailbox. Nobody read this, so it is not a touch either.',
    };
  }

  return {
    classification: 'auto_reply_ooo',
    via,
    confidence: 'high',
    language: 'en',
    extracted: { date: extractReturnDate(message.body) },
    note: 'Out of office. Not a reply and not a touch.',
  };
}

/** Out-of-office phrasings, English and Arabic. */
const OOO_PATTERNS = [
  /out of (the )?office/i,
  /on (annual )?leave/i,
  /away from (the office|my desk)/i,
  /currently travell?ing/i,
  /on vacation/i,
  /limited access to email/i,
  /إجازة/, // إجازة — leave
  /خارج\s+المكتب/, // خارج المكتب — out of office
];

/** Secure gateways common at UAE banks quarantine the first email. */
const GATEWAY_PATTERNS = [
  /mimecast/i,
  /proofpoint/i,
  /barracuda/i,
  /verify (you are|you're) (a )?human/i,
  /click (the link )?below to release/i,
  /held in quarantine/i,
  /sender verification/i,
];

export function classifyByPattern(message: InboundMessage): ClassificationResult | null {
  const text = `${message.subject}\n${message.body}`;
  const language = detectLanguage(text);

  if (GATEWAY_PATTERNS.some((p) => p.test(text))) {
    return {
      classification: 'gateway_challenge',
      via: 'pattern',
      confidence: 'high',
      language,
      extracted: { url: text.match(/https?:\/\/[^\s>)\]]+/)?.[0] ?? null },
      note: 'The message was quarantined. The clock is running on an email nobody has seen, so it pauses.',
    };
  }

  if (OOO_PATTERNS.some((p) => p.test(text))) {
    return autoReplyResult(message, 'pattern');
  }

  if (/\b(unsubscribe|remove me|stop emailing|do not (contact|email) me|take me off)\b/i.test(text)) {
    return {
      classification: 'removal_request',
      via: 'pattern',
      confidence: 'high',
      language,
      extracted: {},
      note: 'Suppresses this person and the company. Permanent.',
    };
  }

  if (/\b(pdpl|data protection|legal|compliance|report(ed)? (this )?as spam|cease and desist)\b/i.test(text)) {
    return {
      classification: 'complaint_escalation',
      via: 'pattern',
      confidence: 'medium',
      language,
      extracted: {},
      note: 'Suppresses the whole domain. Reply once, apologise, never argue.',
    };
  }

  if (/\b(no longer (with|at)|has left|left the (company|organisation|bank)|resigned from)\b/i.test(text)) {
    return {
      classification: 'departed',
      via: 'pattern',
      confidence: 'medium',
      language,
      extracted: { successor: extractSuccessor(text) },
      note: 'Their evidence is stale and the ladder moves on.',
    };
  }

  if (/\b(how did you (get|find) my (email|address)|where did you get)\b/i.test(text)) {
    return {
      classification: 'provenance_challenge',
      via: 'pattern',
      confidence: 'high',
      language,
      extracted: {},
      note: 'Answer honestly from the stored sources. Evasion converts this into a spam report.',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const CLASSIFIER_SYSTEM = `You classify one reply to a job-seeking student's cold email. Answer with ONE line:

<category>|<confidence high|medium|low>|<extracted date as YYYY-MM-DD or ->|<note under 12 words>

Categories:
  human_positive        interested, willing to talk, asks to meet, forwards them on positively
  neutral_question      a real person asking something without saying yes or no
  rejection_hard        no, and not later. "our quota is met", "we are not hiring"
  rejection_soft        no for now, with or without a timeframe. "try us in Q4"
  removal_request       asks not to be contacted
  referral              names or copies someone else who should be spoken to instead
  document_request      asks for a CV, portfolio, transcript, or an application form
  prior_contact_callout points out you already wrote to a colleague
  provenance_challenge  asks how you got their address
  departed              says this person has left the organisation
  gateway_challenge     an automated quarantine or sender-verification step
  auto_reply_ooo        an out-of-office autoresponder
  auto_ack_unmonitored  an automated acknowledgement from a ticketing or unmonitored mailbox
  complaint_escalation  legal, compliance, or a spam complaint
  bounce                a delivery failure notice

Rules:
- Arabic and mixed Arabic-English replies are common. Classify on meaning, not language.
- An Arabic polite refusal is a rejection, not neutral engagement. Gulf refusals are indirect:
  "نتمنى لك التوفيق" (we wish you success) closing a short reply is a no.
- If it could be human_positive or neutral_question, choose neutral_question.
- If you genuinely cannot tell, answer neutral_question. A false stop costs one follow-up;
  a false bump costs the relationship.
- Extract a return or revisit date when one is stated, in YYYY-MM-DD. Otherwise "-".`;

const VALID: Classification[] = [
  'human_positive', 'neutral_question', 'rejection_hard', 'rejection_soft', 'removal_request',
  'referral', 'document_request', 'auto_reply_ooo', 'auto_ack_unmonitored', 'gateway_challenge',
  'departed', 'complaint_escalation', 'provenance_challenge', 'prior_contact_callout', 'bounce',
];

/**
 * Classifies one message. Headers, then patterns, then Claude, then the safe
 * default — and the safe default is a human reply.
 */
export async function classify(message: InboundMessage): Promise<ClassificationResult> {
  const byHeader = classifyByHeaders(message);
  if (byHeader) return byHeader;

  const byPattern = classifyByPattern(message);
  if (byPattern) return byPattern;

  const language = detectLanguage(`${message.subject}\n${message.body}`);

  const reply = await askClaude({
    system: CLASSIFIER_SYSTEM,
    prompt: `From: ${message.from}\nCc: ${message.cc.join(', ') || '(none)'}\nSubject: ${message.subject}\n\n${message.body.slice(0, 4000)}`,
    maxTokens: 120,
    effort: 'low',
  });

  if (reply) {
    const [category, confidence, date, note] = reply.split('\n')[0].split('|').map((p) => p.trim());
    if (VALID.includes(category as Classification)) {
      return {
        classification: category as Classification,
        via: 'claude',
        confidence: (['high', 'medium', 'low'].includes(confidence) ? confidence : 'medium') as 'high' | 'medium' | 'low',
        language,
        extracted: {
          date: date && date !== '-' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
          successor: extractSuccessor(message.body),
          url: message.body.match(/https?:\/\/[^\s>)\]]+/)?.[0] ?? null,
        },
        note: note ?? '',
      };
    }
  }

  // Unclassifiable is a human reply. Surfacing a thread costs a moment;
  // bumping someone who answered costs the thread.
  return {
    classification: 'neutral_question',
    via: 'default',
    confidence: 'low',
    language,
    extracted: {},
    note: 'Could not classify with confidence, so it is treated as a real reply and surfaced.',
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * A return date from an out-of-office.
 *
 * Only unambiguous forms are taken. An unparseable date is better handled as
 * "pause five working days" than as a wrong date that fires an "Eid Mubarak"
 * a week late.
 */
export function extractReturnDate(body: string, today: string = todayUae()): string | null {
  const iso = body.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = body.match(
    new RegExp(`\\b(?:back|return(?:ing)?|until|till)\\b[^.\\n]{0,30}?\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})\\b`, 'i')
  );
  if (named) {
    return withYear(Number(named[1]), MONTHS.indexOf(named[2].toLowerCase()) + 1, today);
  }

  const reversed = body.match(
    new RegExp(`\\b(?:back|return(?:ing)?|until|till)\\b[^.\\n]{0,30}?\\b(${MONTHS.join('|')})\\s+(\\d{1,2})\\b`, 'i')
  );
  if (reversed) {
    return withYear(Number(reversed[2]), MONTHS.indexOf(reversed[1].toLowerCase()) + 1, today);
  }

  return null;
}

/**
 * "Back on 5 January", read on 28 December, means next January.
 *
 * The year is never written in an out-of-office, and taking the current one
 * would schedule the follow-up eleven months into the past — where the clamp
 * would make it due tomorrow, into an empty office. The reference day is a UAE
 * date, not a UTC one: between 20:00 and midnight UTC on 31 December the two
 * disagree about the year, and the recipient lives in the Dubai one.
 */
function withYear(day: number, month: number, today: string): string {
  const stamp = (year: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const thisYear = Number(today.slice(0, 4));
  const candidate = stamp(thisYear);
  // Two months of slack, so a genuinely recent date is still read as the past
  // (an OOO that has already ended) rather than pushed a year out.
  return compareDates(candidate, addDays(today, -60)) < 0 ? stamp(thisYear + 1) : candidate;
}

/** A named successor in a departure or referral, so the ladder can jump to them. */
export function extractSuccessor(body: string): string | null {
  const patterns = [
    /\b(?:contact|speak to|reach out to|please email|redirect(?:ing)? (?:you )?to|looping in|copying in|cc'?ing)\s+([A-Z][a-z]+(?:\s+(?:Al|El|bin|bint)?\s?[A-Z][a-z]+){1,3})/,
    /\b([A-Z][a-z]+(?:\s+(?:Al|El)?\s?[A-Z][a-z]+){1,3})\s+(?:is|now|has taken over|handles|looks after)\b/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1].replace(/\s+/g, ' ').trim();
  }
  return null;
}

/** Arabic script present in any quantity means the reply is at least partly Arabic. */
export function detectLanguage(text: string): string {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  if (arabic === 0) return 'en';
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return arabic > latin ? 'ar' : 'ar-en';
}
