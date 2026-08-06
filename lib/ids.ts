/**
 * Prefixed identifiers. The prefix is for the founder reading a log line at
 * midnight: `per_…` in an error about a missing anchor source says which table
 * to look in without a join.
 */
import { randomUUID } from 'node:crypto';

export const ID_PREFIX = {
  user: 'usr',
  answer: 'ans',
  intro: 'intro',
  cv: 'cv',
  orgGroup: 'org',
  company: 'cmp',
  person: 'per',
  personSource: 'src',
  ladderSlot: 'slot',
  emailPattern: 'pat',
  evidence: 'evd',
  outreach: 'out',
  inbound: 'inb',
  suppression: 'sup',
  ledger: 'led',
  calendarWindow: 'cal',
  blockedDomain: 'blk',
  event: 'evt',
  action: 'act',
  reply: 'rpl',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** UTC instant for a `*_at` column. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
