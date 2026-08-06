import { redirect } from 'next/navigation';

import { listBlocked } from '@/lib/blocklist';
import { query } from '@/lib/db/client';
import { leadingIndicators } from '@/lib/metrics';
import { openActions } from '@/lib/poller';
import { currentUser } from '@/lib/user';

import DashboardControls from './controls';

export const dynamic = 'force-dynamic';

/**
 * Screen 3 — Dashboard.
 *
 * Two rules govern everything on this page.
 *
 * **Warm above cold.** Anything a real person said comes first, above every
 * count and every cold draft. A reply is the climax of the whole product and
 * the moment the user freezes; burying it under a queue is how an interview
 * invite gets answered four days late, by which point the lead has moved on.
 *
 * **Leading indicators, not a scoreboard.** The cadence puts most replies on
 * days 5-12, so an honest reply count in week one is zero — and a big zero
 * rendered as a headline is a statistically normal state displayed as failure,
 * which is the strongest abandonment driver in the register. What is shown
 * instead is what the user did, which is the part they control.
 */
export default async function DashboardPage() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') redirect('/onboarding');

  const [actions, indicators, blocked, [ready], conflicts] = await Promise.all([
    openActions(user.id),
    leadingIndicators(user.id),
    listBlocked(user.id),
    query<{ n: number }>(
      `SELECT count(DISTINCT company_id) AS n FROM ladder_slot`
    ),
    query<{ company_id: string; name: string }>(
      `SELECT s.company_id, c.name FROM user_company_state s
         JOIN company c ON c.id = s.company_id
        WHERE s.user_id = ? AND s.status = 'reply_conflict'`,
      [user.id]
    ),
  ]);

  const onTimeShare =
    indicators.followUpsDue > 0
      ? Math.round((indicators.followUpsOnTime / indicators.followUpsDue) * 100)
      : null;

  return (
    <>
      <h1>Where this stands</h1>

      {/* ---- Warm, always first ------------------------------------------ */}
      {actions.length > 0 && (
        <>
          <h2>People are waiting on you</h2>
          {actions.map((action) => (
            <div className="card" key={action.id} style={{ borderColor: 'var(--accent)' }}>
              <strong>
                {action.personName ?? 'Someone'}
                {action.companyName ? ` at ${action.companyName}` : ''}
              </strong>
              <p style={{ margin: '6px 0 10px' }}>{action.message}</p>
              {action.url && (
                <p style={{ margin: '0 0 10px' }}>
                  <a className="linkish" href={action.url} target="_blank" rel="noreferrer">
                    Open it
                  </a>
                </p>
              )}
              <DashboardControls kind="resolve" id={action.id} />
            </div>
          ))}
        </>
      )}

      {conflicts.length > 0 && (
        <>
          <h2>One decision needed</h2>
          {conflicts.map((c) => (
            <div className="card" key={c.company_id}>
              <strong>Two live threads at {c.name}</strong>
              <p className="muted" style={{ margin: '6px 0 10px' }}>
                Someone replied while a colleague was mid-sequence. A reply always wins, so tell us
                which one you are following — the other stops either way.
              </p>
              <DashboardControls kind="conflict" id={c.company_id} />
            </div>
          ))}
        </>
      )}

      {/* ---- What you did ------------------------------------------------- */}
      <h2>This week</h2>
      <div className="card">
        <strong>
          {indicators.sentThisWeek} email{indicators.sentThisWeek === 1 ? '' : 's'} sent
        </strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {indicators.sentTotal} in total, across {indicators.companiesInPlay}{' '}
          {indicators.companiesInPlay === 1 ? 'company' : 'companies'}.
        </p>
      </div>

      {onTimeShare !== null && (
        <div className="card">
          <strong>{onTimeShare}% of follow-ups went out on the day they were due</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            This is the number that is actually yours. Grit and continuous chasing, without ever
            being annoying — that is what this measures.
          </p>
        </div>
      )}

      <div className="card">
        <strong>
          {indicators.contactsReady} contact{indicators.contactsReady === 1 ? '' : 's'} ready to write to
        </strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {ready?.n ?? 0} {ready?.n === 1 ? 'company has' : 'companies have'} a plan for who to
          approach and in what order.
        </p>
      </div>

      {/* ---- The honest reading ------------------------------------------- */}
      <h2>Replies</h2>
      <div className="card">
        <p style={{ margin: 0 }}>{indicators.reading}</p>
        {indicators.repliesMeaningful && (
          <p className="muted" style={{ margin: '10px 0 0' }}>
            {indicators.totalReplies} replies in total, {indicators.positiveReplies} of them positive.
            Out-of-office notes, bounces and automated acknowledgements are not counted as replies —
            they never were.
          </p>
        )}
      </div>

      {blocked.length > 0 && (
        <>
          <h2>Left alone</h2>
          <div className="card">
            {blocked.map((b) => (
              <p key={b.domain} className="muted" style={{ marginBottom: 6 }}>
                <strong style={{ color: 'var(--ink)' }}>{b.domain}</strong> —{' '}
                {b.note ?? b.reason.replace(/_/g, ' ')}
              </p>
            ))}
          </div>
        </>
      )}

      <h2>Controls</h2>
      <DashboardControls kind="global" paused={user.paused} placed={Boolean(user.placedDate)} />

      <p style={{ marginTop: 24 }}>
        <a className="linkish" href="/today">
          Back to today
        </a>
        {'  ·  '}
        <a className="linkish" href="/numbers">
          The numbers
        </a>
      </p>
    </>
  );
}
