import { redirect } from 'next/navigation';

import { query } from '@/lib/db/client';
import { currentUser, sendBlockFor } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Screen 2 — Review & Send. The daily core loop.
 *
 * Week 1 ships the shell and the states around it; the draft card, the evidence
 * panel and the send path land in week 3. What matters now is that the empty
 * state says something true and forward-looking rather than "0 emails" — the
 * register is explicit that a user who opens this and sees a zero on day one
 * does not come back on day two.
 */
export default async function TodayPage() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') redirect('/onboarding');

  const block = sendBlockFor(user);
  const [companies] = await query<{ n: number }>('SELECT count(*) AS n FROM company');

  return (
    <>
      <h1>Today</h1>

      {block.blocked && block.reason === 'not_connected' && (
        <div className="notice warn">
          <strong>Reconnect your email</strong>
          Nothing is lost. Everything picks up where it left off.
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            <a className="button primary" href="/api/gmail/start">
              Reconnect
            </a>
          </p>
        </div>
      )}

      {block.blocked && block.reason !== 'not_connected' && (
        <div className="notice info">{block.userMessage}</div>
      )}

      <div className="card">
        <strong>Nothing to send yet</strong>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          We are working through {companies?.n ?? 0} companies to find the right person at each one
          and something real to say to them. Your first emails appear here as they are ready.
        </p>
      </div>

      <p className="muted">
        When they do arrive, each one comes with the reason it was written beside it. You read it,
        you decide, you send. Nothing goes out on its own.
      </p>

      <p>
        <a className="linkish" href="/dashboard">
          See everything in play
        </a>
      </p>
    </>
  );
}
