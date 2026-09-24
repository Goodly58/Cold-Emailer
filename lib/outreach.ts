/**
 * Cold-email rules that don't need a server: checks to run before sending,
 * and the follow-up schedule on the UAE working week. Shared by the Outreach
 * page, the Overview and the API so they always agree.
 */

import type { Contact, Outreach } from './types';

/* --------------------------------------------------------- working days */

/** The UAE working week has been Monday to Friday since 2022. */
export function isWorkday(date: Date): boolean {
  const d = date.getUTCDay();
  return d !== 0 && d !== 6;
}

/** YYYY-MM-DD plus n working days (public holidays aren't known here). */
export function addWorkdays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkday(d)) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * A two-step sequence: a nudge three working days after the first email,
 * then a polite close-the-loop five working days after that. More than two
 * follow-ups reads as pressure in the Gulf and rarely changes the outcome.
 */
export const FOLLOW_UP_GAPS = [3, 5] as const;
export const MAX_FOLLOW_UPS = FOLLOW_UP_GAPS.length;

/** When the next follow-up is due, or undefined once the sequence is done. */
export function nextFollowUp(fromDate: string, followUpsSent: number): string | undefined {
  const gap = FOLLOW_UP_GAPS[followUpsSent];
  return gap === undefined ? undefined : addWorkdays(fromDate, gap);
}

export function followUpsDue(outreach: Outreach[], today: string): Outreach[] {
  return outreach
    .filter((o) => o.status === 'sent' && o.nextFollowUpAt && o.nextFollowUpAt <= today)
    .sort((a, b) => String(a.nextFollowUpAt).localeCompare(String(b.nextFollowUpAt)));
}

/** Sent, both follow-ups done, and a week of silence since: time to call it. */
export function wentQuiet(o: Outreach, today: string): boolean {
  if (o.status !== 'sent' || o.nextFollowUpAt || o.followUps < MAX_FOLLOW_UPS) return false;
  const last = o.lastFollowUpAt || o.sentAt;
  return Boolean(last && addWorkdays(last, 5) <= today);
}

/**
 * A hint about when to send, in UAE time. Replies come fastest early in the
 * working week and in the morning; a Friday afternoon or weekend email sits
 * under Monday's pile.
 */
export function sendTimeHint(now = new Date()): string | undefined {
  // Gulf Standard Time is UTC+4 with no daylight saving.
  const gst = new Date(now.getTime() + 4 * 3_600_000);
  const day = gst.getUTCDay();
  const hour = gst.getUTCHours();
  if (day === 6 || day === 0) return "It's the weekend in the UAE. Use Gmail's Schedule send for Monday or Tuesday, 8–10am.";
  if (day === 5 && hour >= 12) return "It's Friday afternoon in the UAE. Schedule it for Monday or Tuesday morning instead.";
  if (hour >= 18 || hour < 7) return "It's outside UAE working hours. Schedule it for 8–10am so it lands at the top of the inbox.";
  return undefined;
}

/* ------------------------------------------------------------- checks */

export interface LintIssue {
  level: 'error' | 'warn';
  message: string;
}

export interface LintInput {
  toEmail?: string;
  toName?: string;
  companyName?: string;
  subject: string;
  body: string;
  contact?: Pick<Contact, 'emailStatus'>;
  /** Everything sent before, to catch double-sends. */
  history?: Outreach[];
  isFollowUp?: boolean;
  today?: string;
}

const SPAMMY = [
  'act now', 'urgent', 'guarantee', 'guaranteed', '100%', 'risk-free', 'click here', 'free of charge',
  'limited time', 'once in a lifetime', 'dear sir/madam', 'to whom it may concern', 'dear sir or madam',
];

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/**
 * What a careful sender would check before hitting send. Errors are the
 * embarrassing ones (a literal "[first name]" in the greeting); warnings are
 * judgement calls.
 */
export function lintEmail(input: LintInput): LintIssue[] {
  const issues: LintIssue[] = [];
  const { subject, body } = input;
  const all = `${subject}\n${body}`;
  const err = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warn', message });

  // Unfilled merge fields and template placeholders.
  const brackets = [...new Set(all.match(/\[[^\]\n]{2,120}\]|\{\{\s*\w+\s*\}\}/g) || [])];
  if (brackets.length) {
    err(`Unfilled placeholder${brackets.length > 1 ? 's' : ''}: ${brackets.slice(0, 3).join(', ')}${brackets.length > 3 ? '…' : ''}`);
  }

  if (!input.toEmail?.trim()) err('No recipient email address.');
  else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(input.toEmail.trim())) err(`"${input.toEmail}" doesn't look like an email address.`);
  else if (input.contact?.emailStatus === 'bounced') err('This address bounced before. Try the next pattern on the contact.');
  else if (input.contact?.emailStatus === 'guessed') warn('The address is a pattern guess, not verified. A bounce hurts your sender reputation.');

  if (!subject.trim()) err('No subject line.');
  else {
    if (subject.length > 70) warn(`Subject is ${subject.length} characters; phones cut it off around 40–60.`);
    if (/[A-Z]{5,}/.test(subject.replace(/\b(UAE|MOHRE|ADNOC|ADIA|ADQ|DEWA|ENOC|CEO|CFO|CTO|COO|HR|TA|AI|ML)\b/g, ''))) warn('Capitals in the subject read as shouting.');
    if (/!/.test(subject)) warn('Exclamation marks in a subject look like marketing.');
  }

  const words = wordCount(body);
  if (!input.isFollowUp && words < 50) warn(`Only ${words} words. Say who you are, why them and what you're asking for.`);
  if (words > 200) warn(`${words} words. Cold emails that get replies are usually under 150; cut to the hook and one ask.`);

  const lower = all.toLowerCase();
  const spam = SPAMMY.filter((w) => lower.includes(w));
  if (spam.length) warn(`Words that trip spam filters or read as generic: ${spam.map((w) => `"${w}"`).join(', ')}.`);
  if ((body.match(/!/g) || []).length > 2) warn('Several exclamation marks. One at most.');
  const links = (body.match(/https?:\/\//g) || []).length;
  if (links > 2) warn(`${links} links. More than two looks like a newsletter to spam filters.`);

  const firstName = input.toName?.trim().split(/\s+/)[0];
  if (firstName && firstName.length > 1 && !body.includes(firstName)) warn(`The greeting doesn't use their name (${firstName}).`);
  if (!input.isFollowUp && input.companyName && !lower.includes(input.companyName.toLowerCase().split(/\s+/)[0])) {
    warn(`The body never mentions ${input.companyName}. Personalised emails get far more replies.`);
  }
  if (/attach(ed|ing)|find my cv|my cv (is )?attached/i.test(body)) {
    warn('You mention an attachment. Gmail opens without it, so attach your CV before sending.');
  }

  // Double-sends to the same address.
  if (input.toEmail && input.history && !input.isFollowUp) {
    const to = input.toEmail.trim().toLowerCase();
    const prior = input.history.find(
      (o) => o.toEmail?.toLowerCase() === to && o.status !== 'draft' && o.status !== 'ready'
    );
    if (prior) warn(`You already emailed ${input.toEmail}${prior.sentAt ? ` on ${prior.sentAt}` : ''}. Send a follow-up on that thread instead.`);
  }

  return issues;
}

/* --------------------------------------------------------------- stats */

export interface TemplateStats {
  sent: number;
  replied: number;
  rate: number;
}

/** Reply rate per template, counting only emails that actually went out. */
export function statsByTemplate(outreach: Outreach[]): Map<string, TemplateStats> {
  const out = new Map<string, TemplateStats>();
  for (const o of outreach) {
    if (!o.templateId || !['sent', 'replied', 'no-reply'].includes(o.status)) continue;
    const s = out.get(o.templateId) || { sent: 0, replied: 0, rate: 0 };
    s.sent += 1;
    if (o.status === 'replied') s.replied += 1;
    s.rate = Math.round((s.replied / s.sent) * 100);
    out.set(o.templateId, s);
  }
  return out;
}

/** Emails logged as sent today, first sends and follow-ups alike. */
export function sentToday(outreach: Outreach[], today: string): number {
  return outreach.reduce(
    (n, o) => n + (o.sentAt === today ? 1 : 0) + (o.lastFollowUpAt === today ? 1 : 0),
    0
  );
}
