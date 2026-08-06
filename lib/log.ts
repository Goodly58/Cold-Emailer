/**
 * The append-only log: the founder's debugging surface and the unit-economics
 * dataset, which are the same table on purpose.
 *
 * Event names are fixed from send #1 (register: "The friend phase is the only
 * cheap unit-economics dataset ever") so the three pricing numbers —
 * minutes/send, sends/positive-reply, replies/interview — are one query by
 * week 6 rather than an archaeology project.
 */
import { execute } from './db/client';
import { newId, nowIso } from './ids';

/**
 * Every event the system may record. Adding a name here is a deliberate act;
 * a typo'd string is a metric that silently never fires.
 */
export type EventName =
  // Onboarding
  | 'onboarding_started'
  | 'gmail_consent_opened'
  | 'gmail_connected'
  | 'gmail_scope_refused'
  | 'gmail_account_mismatch'
  | 'gmail_disconnected'
  | 'interview_answer_saved'
  | 'interview_followup_asked'
  | 'profile_gate_blocked'
  | 'identity_block_confirmed'
  | 'cv_generated'
  | 'cv_uploaded'
  | 'onboarding_completed'
  // Sourcing
  | 'company_seeded'
  | 'evidence_collected'
  | 'person_created'
  | 'person_identity_unconfirmed'
  // Generation
  | 'draft_generated'
  | 'draft_refused'
  | 'draft_edited'
  | 'draft_stale'
  // Sending
  | 'send_blocked'
  | 'sent'
  // Inbound
  | 'reply'
  | 'bounce'
  | 'interview_booked'
  | 'placed'
  // Operational
  | 'calendar_edited'
  | 'sweep_ran'
  | 'error';

export interface LogEntry {
  event: EventName;
  userId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  detail?: Record<string, unknown>;
  level?: 'info' | 'warn' | 'error';
}

/**
 * Records an event. Never throws — a logging failure must not take down the
 * flow it is observing, and a silent failure here is better than a 500 on the
 * Review screen. The failure still reaches the console.
 */
export async function logEvent(entry: LogEntry): Promise<void> {
  try {
    await execute(
      `INSERT INTO event_log (id, at, user_id, event, entity_type, entity_id, detail, level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('event'),
        nowIso(),
        entry.userId ?? null,
        entry.event,
        entry.entityType ?? null,
        entry.entityId ?? null,
        JSON.stringify(entry.detail ?? {}),
        entry.level ?? 'info',
      ]
    );
  } catch (e) {
    console.error('[log] could not record event', entry.event, e);
  }
}

/** Shorthand for the error path, which is where logging matters most. */
export async function logError(
  event: EventName,
  error: unknown,
  extra: Omit<LogEntry, 'event' | 'level'> = {}
): Promise<void> {
  await logEvent({
    ...extra,
    event,
    level: 'error',
    detail: {
      ...extra.detail,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
}
