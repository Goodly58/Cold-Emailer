/**
 * The user record. v1 is single-user, so "the current user" is one row created
 * on first boot — but every query still takes a userId, because the schema is
 * global-keyed and the multi-user shape must not need a rewrite later.
 */
import { execute, queryOne } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';

export type ConnectionState = 'disconnected' | 'connected' | 'expired' | 'revoked';

/**
 * The onboarding path, in order. Screen 1 is "under 10 minutes on a phone",
 * so this is short by design and every step is resumable — a user who closes
 * the tab comes back to the step they were on, not to the beginning.
 */
export const ONBOARDING_STEPS = [
  'welcome',
  'connect',
  'identity',
  'interview',
  'hygiene',
  'cv',
  'done',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface User {
  id: string;
  name: string;
  gmailAddress: string | null;
  connectionState: ConnectionState;
  lastSuccessfulPollAt: string | null;
  sendAsEmail: string | null;
  signatureBlock: string | null;
  signatureFetchedAt: string | null;
  canonicalName: string | null;
  paused: boolean;
  placedDate: string | null;
  dailyCeiling: number;
  onboardingStep: OnboardingStep;
  onboardingCompletedAt: string | null;
}

interface UserRow {
  id: string;
  name: string;
  gmail_address: string | null;
  connection_state: ConnectionState;
  last_successful_poll_at: string | null;
  send_as_email: string | null;
  signature_block: string | null;
  signature_fetched_at: string | null;
  canonical_name: string | null;
  paused: number;
  placed_date: string | null;
  daily_ceiling: number;
  onboarding_step: OnboardingStep;
  onboarding_completed_at: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    gmailAddress: row.gmail_address,
    connectionState: row.connection_state,
    lastSuccessfulPollAt: row.last_successful_poll_at,
    sendAsEmail: row.send_as_email,
    signatureBlock: row.signature_block,
    signatureFetchedAt: row.signature_fetched_at,
    canonicalName: row.canonical_name,
    paused: row.paused === 1,
    placedDate: row.placed_date,
    dailyCeiling: row.daily_ceiling,
    onboardingStep: row.onboarding_step,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

export async function getUser(id: string): Promise<User | null> {
  const row = await queryOne<UserRow>('SELECT * FROM app_user WHERE id = ?', [id]);
  return row ? toUser(row) : null;
}

/**
 * The single v1 user, created on first access. There is no signup screen: the
 * first thing the friend sees is "connect your email", not a form.
 */
export async function currentUser(): Promise<User> {
  const existing = await queryOne<UserRow>('SELECT * FROM app_user ORDER BY created_at ASC LIMIT 1');
  if (existing) return toUser(existing);

  const id = newId('user');
  const at = nowIso();
  await execute(
    `INSERT INTO app_user (id, name, onboarding_step, created_at, updated_at)
     VALUES (?, ?, 'welcome', ?, ?)`,
    [id, 'you', at, at]
  );
  await logEvent({ event: 'onboarding_started', userId: id });

  const created = await queryOne<UserRow>('SELECT * FROM app_user WHERE id = ?', [id]);
  return toUser(created as UserRow);
}

const FIELD_TO_COLUMN: Record<string, string> = {
  name: 'name',
  gmailAddress: 'gmail_address',
  connectionState: 'connection_state',
  lastSuccessfulPollAt: 'last_successful_poll_at',
  sendAsEmail: 'send_as_email',
  signatureBlock: 'signature_block',
  signatureFetchedAt: 'signature_fetched_at',
  canonicalName: 'canonical_name',
  placedDate: 'placed_date',
  dailyCeiling: 'daily_ceiling',
  onboardingStep: 'onboarding_step',
  onboardingCompletedAt: 'onboarding_completed_at',
};

export async function updateUser(
  id: string,
  patch: Partial<Omit<User, 'id' | 'paused'>> & { paused?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const args: Array<string | number | null> = [];

  for (const [field, value] of Object.entries(patch)) {
    if (field === 'paused') {
      sets.push('paused = ?');
      args.push(value ? 1 : 0);
      continue;
    }
    const column = FIELD_TO_COLUMN[field];
    if (!column) continue;
    sets.push(`${column} = ?`);
    args.push(value as string | number | null);
  }
  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  args.push(nowIso(), id);
  await execute(`UPDATE app_user SET ${sets.join(', ')} WHERE id = ?`, args);
}

/** Moves onboarding forward, never backward — refreshing a step page is safe. */
export async function advanceOnboarding(id: string, to: OnboardingStep): Promise<void> {
  const user = await getUser(id);
  if (!user) return;
  const currentIndex = ONBOARDING_STEPS.indexOf(user.onboardingStep);
  const targetIndex = ONBOARDING_STEPS.indexOf(to);
  if (targetIndex <= currentIndex) return;
  await updateUser(id, { onboardingStep: to });
}

/**
 * Hard rule 10, "no send while blind": nothing may go out while the Gmail
 * connection is not `connected` or while the last successful poll is more than
 * six hours old. A reply we cannot see is a follow-up fired at someone who
 * already answered.
 */
export const POLL_STALENESS_LIMIT_MS = 6 * 60 * 60 * 1000;

export interface SendBlock {
  blocked: boolean;
  reason?: 'not_connected' | 'poll_stale' | 'paused' | 'placed';
  userMessage?: string;
}

export function sendBlockFor(user: User, now: Date = new Date()): SendBlock {
  if (user.placedDate) {
    return {
      blocked: true,
      reason: 'placed',
      userMessage: 'You marked yourself as placed, so sending is switched off.',
    };
  }
  if (user.paused) {
    return { blocked: true, reason: 'paused', userMessage: 'Everything is paused. Resume when you are ready.' };
  }
  if (user.connectionState !== 'connected') {
    return {
      blocked: true,
      reason: 'not_connected',
      userMessage: 'Reconnect your email to keep going — nothing is lost.',
    };
  }
  if (
    !user.lastSuccessfulPollAt ||
    now.getTime() - Date.parse(user.lastSuccessfulPollAt) > POLL_STALENESS_LIMIT_MS
  ) {
    return {
      blocked: true,
      reason: 'poll_stale',
      userMessage:
        'We are checking for replies before anything else goes out, so nobody gets chased after they answered. One moment.',
    };
  }
  return { blocked: false };
}
