import { NextResponse, type NextRequest } from 'next/server';

import { todayUae } from '@/lib/calendar';
import { previewCadence } from '@/lib/derived-dates';
import { loadCalendar } from '@/lib/calendar-store';
import { execute, query, queryOne } from '@/lib/db/client';
import { evidenceById } from '@/lib/evidence';
import { generate, loadContext } from '@/lib/generator';
import { newId, nowIso } from '@/lib/ids';
import { logEvent } from '@/lib/log';
import { personEligibility } from '@/lib/people';
import { sendPermission } from '@/lib/queue';
import { approveDraft, sendOutreach } from '@/lib/send';
import { lintUserEdit } from '@/lib/template';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/** One draft, with the evidence behind every claim. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Which draft?' }, { status: 400 });

  const outreach = await queryOne<{
    id: string;
    person_id: string;
    step: number;
    subject: string | null;
    body: string | null;
    status: string;
    evidence_ids: string;
    premise_tier: number | null;
  }>('SELECT * FROM outreach WHERE id = ? AND user_id = ?', [id, user.id]);

  if (!outreach) return NextResponse.json({ error: 'That draft is no longer here.' }, { status: 404 });

  const person = await queryOne<{
    full_name_raw: string;
    role_title: string | null;
    company_id: string;
    anchor_source_url: string | null;
    freshness_date: string | null;
    email: string | null;
    email_status: string;
    contact_type: string;
  }>('SELECT * FROM person WHERE id = ?', [outreach.person_id]);

  const company = await queryOne<{ name: string; domain: string }>(
    'SELECT name, domain FROM company WHERE id = ?',
    [person?.company_id ?? '']
  );

  const evidenceIds: string[] = JSON.parse(outreach.evidence_ids);
  const evidence = (await Promise.all(evidenceIds.map((eid) => evidenceById(eid)))).filter(Boolean);

  // Everything that was found and not used, so the panel can show why the hook
  // is the second-best fact rather than leaving the user to wonder.
  const alsoFound = await query<{ id: string; tier: number; quote: string; source_url: string; usable: number; unusable_reason: string | null }>(
    `SELECT id, tier, quote, source_url, usable, unusable_reason
       FROM evidence
      WHERE kind = 'external' AND (person_id = ? OR company_id = ?)
        AND id NOT IN (${evidenceIds.map(() => '?').join(',') || "''"})
      ORDER BY usable DESC, tier ASC LIMIT 6`,
    [outreach.person_id, person?.company_id ?? '', ...evidenceIds]
  );

  const permission = await sendPermission(user, id);

  return NextResponse.json({
    outreach,
    person,
    company,
    evidence,
    alsoFound,
    permission,
    eligibility: await personEligibility(outreach.person_id),
    // The Dubai date, not the server's. Between 20:00 and midnight UTC they
    // disagree, and the preview is about the recipient's calendar.
    cadence: previewCadence(todayUae(), await loadCalendar()),
  });
}

/** Generate, approve, send, skip. */
export async function POST(request: NextRequest) {
  const user = await currentUser();

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Could not read that.' }, { status: 400 });
  }

  const action = String(payload.action ?? '');

  if (action === 'generate') {
    const personId = String(payload.personId ?? '');
    const step = Number(payload.step ?? 1) as 1 | 2 | 3;

    const eligibility = await personEligibility(personId);
    if (!eligibility.eligible) {
      return NextResponse.json(
        { error: eligibility.blockers[0].message, blockers: eligibility.blockers },
        { status: 409 }
      );
    }

    const context = await loadContext(personId, user.id, step);
    if (!context) return NextResponse.json({ error: 'No such person.' }, { status: 404 });

    const outcome = await generate(context);
    const at = nowIso();

    if (outcome.kind === 'halt') {
      await logEvent({ event: 'draft_refused', userId: user.id, entityType: 'person', entityId: personId, detail: { halt: outcome.reason } });
      return NextResponse.json({ kind: 'halt', reason: outcome.reason, detail: outcome.detail });
    }

    if (outcome.kind === 'refusal') {
      // A refusal becomes a "needs one fact" card, never an empty queue and
      // never a generic email.
      await execute(
        `INSERT INTO outreach (id, person_id, user_id, step, body, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'needs_fact', ?, ?)
         ON CONFLICT (person_id, step) DO UPDATE SET
           body = excluded.body, status = 'needs_fact', updated_at = excluded.updated_at`,
        [newId('outreach'), personId, user.id, step, outcome.refusal.collectionRequest, at, at]
      );
      await logEvent({
        event: 'draft_refused',
        userId: user.id,
        entityType: 'person',
        entityId: personId,
        detail: { request: outcome.refusal.collectionRequest, tiers: outcome.refusal.searchedTiers },
      });
      return NextResponse.json({ kind: 'refusal', ...outcome.refusal });
    }

    const draft = outcome.draft;
    const id = newId('outreach');
    await execute(
      `INSERT INTO outreach
         (id, person_id, user_id, step, subject, body, evidence_ids, template_version,
          subject_variant, premise_tier, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', ?, ?)
       ON CONFLICT (person_id, step) DO UPDATE SET
         subject = excluded.subject, body = excluded.body, evidence_ids = excluded.evidence_ids,
         template_version = excluded.template_version, subject_variant = excluded.subject_variant,
         premise_tier = excluded.premise_tier, status = 'drafted', updated_at = excluded.updated_at`,
      [
        id,
        personId,
        user.id,
        step,
        draft.subject,
        draft.body,
        JSON.stringify(draft.evidenceIds),
        draft.templateVersion,
        draft.subjectVariant,
        draft.premiseTier,
        at,
        at,
      ]
    );

    await logEvent({
      event: 'draft_generated',
      userId: user.id,
      entityType: 'person',
      entityId: personId,
      detail: { step, premiseTier: draft.premiseTier, register: draft.register },
    });

    return NextResponse.json({ kind: 'draft', draft });
  }

  if (action === 'lint') {
    // The user's edits get warnings, never blocks. Their name is on it.
    const { outreachId, edited } = payload as Record<string, string>;
    const outreach = await queryOne<{ body: string; evidence_ids: string }>(
      'SELECT body, evidence_ids FROM outreach WHERE id = ? AND user_id = ?',
      [outreachId, user.id]
    );
    if (!outreach) return NextResponse.json({ error: 'That draft is no longer here.' }, { status: 404 });

    const evidenceIds: string[] = JSON.parse(outreach.evidence_ids);
    const rows = (await Promise.all(evidenceIds.map((id) => evidenceById(id)))).filter(Boolean);
    const { generatorProfile } = await import('@/lib/profile');
    const profile = await generatorProfile(user.id);

    return NextResponse.json({
      findings: lintUserEdit(edited, outreach.body, {
        evidenceQuotes: rows.map((r) => `${r!.quote} ${r!.quote_translated ?? ''}`),
        profileValues: Object.values(profile),
      }),
    });
  }

  if (action === 'approve') {
    const { outreachId, edited } = payload as Record<string, string>;
    const ok = await approveDraft(outreachId, edited);
    if (!ok) return NextResponse.json({ error: 'That draft was already dealt with.' }, { status: 409 });
    if (edited) {
      await logEvent({ event: 'draft_edited', userId: user.id, entityType: 'outreach', entityId: outreachId });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'send') {
    const outreachId = String(payload.outreachId ?? '');

    const permission = await sendPermission(user, outreachId);
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.message }, { status: 409 });
    }

    if (payload.edited) await approveDraft(outreachId, String(payload.edited));
    else await approveDraft(outreachId);

    const result = await sendOutreach(outreachId, user);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (action === 'skip') {
    // Skipping feeds the blocklist rather than just hiding the card, so the
    // same company does not come back tomorrow.
    const { outreachId, reason } = payload as Record<string, string>;
    const row = await queryOne<{ person_id: string }>('SELECT person_id FROM outreach WHERE id = ?', [outreachId]);
    if (!row) return NextResponse.json({ error: 'That draft is no longer here.' }, { status: 404 });

    const person = await queryOne<{ company_id: string }>('SELECT company_id FROM person WHERE id = ?', [row.person_id]);
    const company = await queryOne<{ domain: string }>('SELECT domain FROM company WHERE id = ?', [
      person?.company_id ?? '',
    ]);

    if (company && person) {
      const { blockCompany } = await import('@/lib/blocklist');
      await blockCompany(
        user.id,
        person.company_id,
        company.domain,
        reason === 'know_someone' ? 'know_someone' : 'user_skip'
      );
    }
    await execute(`UPDATE outreach SET status = 'closed', updated_at = ? WHERE id = ?`, [nowIso(), outreachId]);
    return NextResponse.json({ ok: true });
  }

  if (action === 'replied_elsewhere') {
    // The interlock on every follow-up card. No LinkedIn integration exists by
    // design, so the only way we learn about a reply there is to ask.
    const outreachId = String(payload.outreachId ?? '');
    const row = await queryOne<{ person_id: string }>('SELECT person_id FROM outreach WHERE id = ?', [outreachId]);
    if (!row) return NextResponse.json({ error: 'That draft is no longer here.' }, { status: 404 });

    const at = nowIso();
    await execute(`UPDATE person SET status = 'replied_external', updated_at = ? WHERE id = ?`, [at, row.person_id]);
    await execute(
      `UPDATE outreach SET status = 'closed', updated_at = ?
        WHERE person_id = ? AND status IN ('queued', 'drafted', 'stale', 'approved', 'needs_fact')`,
      [at, row.person_id]
    );
    await logEvent({ event: 'reply', userId: user.id, entityType: 'person', entityId: row.person_id, detail: { channel: 'elsewhere' } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
