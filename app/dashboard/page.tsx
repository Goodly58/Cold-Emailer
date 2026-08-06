import { redirect } from 'next/navigation';

import { query } from '@/lib/db/client';
import { listBlocked } from '@/lib/blocklist';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Screen 3 — Dashboard.
 *
 * Week 1 shows what is genuinely known: companies in play, what is blocked and
 * why, and the shape of the cadence. It deliberately does not render a reply
 * count. The cadence guarantees most replies arrive days 5-12, so a big "0
 * replies" in week one is a statistically normal state displayed as failure —
 * the single strongest abandonment driver in the register.
 */
export default async function DashboardPage() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') redirect('/onboarding');

  const [[companies], [withLadder], blocked] = await Promise.all([
    query<{ n: number }>(`SELECT count(*) AS n FROM company WHERE segment = 'private'`),
    query<{ n: number }>('SELECT count(DISTINCT company_id) AS n FROM ladder_slot'),
    listBlocked(user.id),
  ]);

  return (
    <>
      <h1>In play</h1>

      <div className="card">
        <strong>{companies?.n ?? 0} companies</strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {withLadder?.n ?? 0} have a plan for who to approach and in what order.
        </p>
      </div>

      <div className="card">
        <strong>First replies expected around day 5 to day 12</strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          That is after the first follow-up lands, not after the first email. Quiet before then is
          what normal looks like.
        </p>
      </div>

      {blocked.length > 0 && (
        <>
          <h2>Left alone</h2>
          <div className="card">
            {blocked.map((b) => (
              <p key={b.domain} className="muted" style={{ marginBottom: 6 }}>
                <strong style={{ color: 'var(--ink)' }}>{b.domain}</strong> — {b.note ?? b.reason.replace(/_/g, ' ')}
              </p>
            ))}
          </div>
        </>
      )}

      <p>
        <a className="linkish" href="/today">
          Back to today
        </a>
      </p>
    </>
  );
}
