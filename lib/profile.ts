/**
 * Storing interview answers, and turning them into the two things the
 * generator is allowed to read: intro blocks and profile-claim evidence rows.
 *
 * Self-claims become evidence rows with an `interview://` source URL so hard
 * rule 2 covers them without an exception (register: "User oversells in the
 * interview and gets called on it in a reply"). The generator therefore cannot
 * say anything about the user that the user did not say first.
 */
import { execute, query, queryOne } from './db/client';
import { newId, nowIso } from './ids';
import {
  assessAnswer,
  evaluateGate,
  fieldByKey,
  generateFollowup,
  INTERVIEW_FIELDS,
  type GateResult,
  type Specificity,
  type StoredAnswer,
} from './interview';
import { logEvent } from './log';

interface AnswerRow {
  id: string;
  field: string;
  value: string;
  specificity: Specificity;
  followup_question: string | null;
  followup_answer: string | null;
  verification_framing: string | null;
}

function toAnswer(row: AnswerRow): StoredAnswer & { id: string } {
  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = row.value;
  }
  return {
    id: row.id,
    field: row.field,
    value,
    specificity: row.specificity,
    followupQuestion: row.followup_question,
    followupAnswer: row.followup_answer,
    verificationFraming: row.verification_framing,
  };
}

export async function listAnswers(userId: string): Promise<Array<StoredAnswer & { id: string }>> {
  const rows = await query<AnswerRow>(
    'SELECT id, field, value, specificity, followup_question, followup_answer, verification_framing FROM profile_answer WHERE user_id = ?',
    [userId]
  );
  return rows.map(toAnswer);
}

export async function gateStatus(userId: string): Promise<GateResult> {
  return evaluateGate(await listAnswers(userId));
}

export interface SaveResult {
  specificity: Specificity;
  /** Present when the answer was too vague — exactly one question, never a list. */
  followupQuestion: string | null;
}

/**
 * Saves one answer. A thin answer gets exactly one follow-up question attached;
 * the user can answer it or move on, and the gate decides whether onboarding
 * can complete.
 */
export async function saveAnswer(
  userId: string,
  field: string,
  value: unknown,
  extras: { verificationFraming?: string | null } = {}
): Promise<SaveResult> {
  const definition = fieldByKey(field);
  if (!definition) throw new Error(`unknown interview field: ${field}`);

  const specificity = assessAnswer(definition, value);
  const existing = await queryOne<AnswerRow>(
    'SELECT * FROM profile_answer WHERE user_id = ? AND field = ?',
    [userId, field]
  );

  let followupQuestion: string | null = existing?.followup_question ?? null;

  // A thin answer typed into a chip field's Other box needs the same rescue a
  // thin text answer gets. Without this it stays thin forever — chip values are
  // arrays, and the rescue used to be reachable only for strings, so the answer
  // was quietly excluded from every draft with no way for the user to fix it.
  const thinText =
    typeof value === 'string'
      ? value
      : Array.isArray(value) && value.length === 1
        ? String(value[0])
        : null;

  if (specificity === 'thin' && thinText !== null) {
    // Re-ask only when the answer actually changed, so editing an unrelated
    // field does not reshuffle the question they are already looking at.
    const answerChanged = !existing || JSON.stringify(JSON.parse(existing.value)) !== JSON.stringify(value);
    if (answerChanged || !followupQuestion) {
      followupQuestion = await generateFollowup(field, thinText);
      await logEvent({
        event: 'interview_followup_asked',
        userId,
        detail: { field, question: followupQuestion },
      });
    }
  } else if (specificity === 'concrete') {
    followupQuestion = null;
  }

  const at = nowIso();
  if (existing) {
    await execute(
      `UPDATE profile_answer
          SET value = ?, specificity = ?, followup_question = ?,
              followup_answer = CASE WHEN ? THEN NULL ELSE followup_answer END,
              verification_framing = COALESCE(?, verification_framing),
              updated_at = ?
        WHERE id = ?`,
      [
        JSON.stringify(value),
        specificity,
        followupQuestion,
        specificity === 'concrete' ? 1 : 0,
        extras.verificationFraming ?? null,
        at,
        existing.id,
      ]
    );
  } else {
    await execute(
      `INSERT INTO profile_answer
         (id, user_id, field, value, specificity, followup_question, verification_framing, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('answer'),
        userId,
        field,
        JSON.stringify(value),
        specificity,
        followupQuestion,
        extras.verificationFraming ?? null,
        at,
        at,
      ]
    );
  }

  await logEvent({
    event: 'interview_answer_saved',
    userId,
    detail: { field, specificity },
  });

  return { specificity, followupQuestion };
}

export async function saveFollowupAnswer(
  userId: string,
  field: string,
  followupAnswer: string
): Promise<Specificity> {
  await execute(
    `UPDATE profile_answer SET followup_answer = ?, updated_at = ? WHERE user_id = ? AND field = ?`,
    [followupAnswer, nowIso(), userId, field]
  );
  const { assessText } = await import('./interview');
  return assessText(followupAnswer);
}

export async function saveVerificationFraming(
  userId: string,
  field: string,
  framing: string
): Promise<void> {
  await execute(
    `UPDATE profile_answer SET verification_framing = ?, updated_at = ? WHERE user_id = ? AND field = ?`,
    [framing, nowIso(), userId, field]
  );
}

/**
 * A fact the user supplied mid-flight, in answer to a drafting question.
 *
 * "When could you start?" gets asked by every second positive reply. Storing
 * the answer as a profile field rather than as a one-off means it is asked
 * once: a tool that asks the same question four times stops being trusted, and
 * this user has fifteen minutes a week to spend on it.
 *
 * `concrete` because the user typed it in answer to a specific question, which
 * is exactly the standard the interview's specificity gate is testing for.
 */
export async function recordSideAnswer(
  userId: string,
  question: string,
  answer: string
): Promise<void> {
  // Keyed on the question so the same one overwrites rather than accumulating,
  // and prefixed so it never collides with an interview field.
  const field = `asked:${question.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)}`;
  const at = nowIso();
  await execute(
    `INSERT INTO profile_answer (id, user_id, field, value, specificity, followup_question, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'concrete', ?, ?, ?)
     ON CONFLICT (user_id, field) DO UPDATE SET
       value = excluded.value, followup_question = excluded.followup_question,
       updated_at = excluded.updated_at`,
    [newId('answer'), userId, field, JSON.stringify(answer), question, at, at]
  );
}

// ---------------------------------------------------------------------------
// Turning answers into what the generator may read
// ---------------------------------------------------------------------------

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  return value == null ? '' : String(value);
}

/**
 * Writes the four intro slots from research/template-doctrine.md §(b) and the
 * matching profile-claim evidence rows.
 *
 * Idempotent: called at the end of onboarding and again whenever an answer
 * changes, replacing what it wrote before. Nothing here invents phrasing — each
 * block is the user's own words, and the evidence row points back at the answer
 * that produced it.
 */
export async function rebuildIntroBlocks(userId: string): Promise<number> {
  const answers = await listAnswers(userId);
  const byField = new Map(answers.map((a) => [a.field, a]));

  const education = byField.get('education');
  const credibility = byField.get('credibility_marker');
  const nafis = byField.get('nafis_registered');
  const availability = byField.get('availability');

  const blocks: Array<{ slot: string; text: string; answerId: string | null }> = [];

  if (education && asText(education.value).trim()) {
    blocks.push({ slot: 'A_identity', text: asText(education.value).trim(), answerId: education.id });
  }

  if (credibility) {
    // The confirmed specificity is the ceiling: if the answer was thin and the
    // follow-up rescued it, the follow-up text is what the generator may use —
    // never an upgraded paraphrase of the vaguer original.
    const rescued = credibility.specificity === 'thin' ? credibility.followupAnswer : null;
    const text = (rescued ?? asText(credibility.value)).trim();
    if (text) blocks.push({ slot: 'B_credibility', text, answerId: credibility.id });
  }

  // Slot C is compliance-adjacent: nationality, Nafis registration and
  // availability come only from confirmed profile fields, never inferred.
  const statusParts: string[] = ['UAE national'];
  if (asText(nafis?.value) === 'Yes') statusParts.push('registered with Nafis');
  if (availability && asText(availability.value).trim()) {
    statusParts.push(`available ${asText(availability.value).trim().toLowerCase()}`);
  }
  if (statusParts.length > 1 || nafis) {
    blocks.push({ slot: 'C_status', text: statusParts.join(', '), answerId: nafis?.id ?? null });
  }

  const at = nowIso();
  await execute('DELETE FROM intro_block WHERE user_id = ?', [userId]);
  for (const block of blocks) {
    await execute(
      `INSERT INTO intro_block (id, user_id, slot, text, source_answer_id, confirmed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [newId('intro'), userId, block.slot, block.text, block.answerId, at, at]
    );
  }

  // Profile claims as evidence rows, so the no-fact-outside-evidence rule
  // covers what the user says about themselves.
  await execute(`DELETE FROM evidence WHERE user_id = ? AND kind = 'profile_claim'`, [userId]);
  for (const answer of answers) {
    const text = asText(answer.value).trim();
    if (!text) continue;
    await execute(
      `INSERT INTO evidence
         (id, kind, user_id, tier, quote, source_url, captured_at, verified_on, created_at, updated_at)
       VALUES (?, 'profile_claim', ?, 3, ?, ?, ?, ?, ?, ?)`,
      [newId('evidence'), userId, text, `interview://${answer.id}`, at, at, at, at]
    );
  }

  return blocks.length;
}

/** The profile the generator reads: confirmed fields only, nothing inferred. */
export async function generatorProfile(userId: string): Promise<Record<string, string>> {
  const answers = await listAnswers(userId);
  const out: Record<string, string> = {};
  for (const answer of answers) {
    if (answer.specificity === 'thin' && answer.followupAnswer) {
      out[answer.field] = answer.followupAnswer;
      continue;
    }
    if (answer.specificity === 'thin') continue; // never usable as a claim
    out[answer.field] = asText(answer.value);
  }
  return out;
}

export const REQUIRED_FIELD_KEYS = INTERVIEW_FIELDS.filter((f) => f.required).map((f) => f.key);
