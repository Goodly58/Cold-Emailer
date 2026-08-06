import { redirect } from 'next/navigation';

import { attribution, experimentOne, pricingNumbers, recentEvents } from '@/lib/metrics';
import { currentUser } from '@/lib/user';

import ConnectionBanner from '../connection-banner';

export const dynamic = 'force-dynamic';

/**
 * The founder's screen. Weeks 5-6.
 *
 * Not for the user — for the person deciding whether this is a business. Three
 * pricing numbers, the attribution tables, Experiment 1's pre-registered
 * decision, and the raw log. Each is one query against the log table, which is
 * why the event names were frozen before send #1 rather than being invented as
 * they were needed.
 *
 * Every rate here refuses to render below the signal threshold. A template
 * killed on n=3 is a template killed at random, and the whole value of this
 * page is that it does not let its reader do that.
 */
export default async function NumbersPage() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') redirect('/onboarding');

  const [pricing, byTier, byContact, byTemplate, bySubject, experiment, events] = await Promise.all([
    pricingNumbers(user.id),
    attribution(user.id, 'premise_tier'),
    attribution(user.id, 'contact_type'),
    attribution(user.id, 'template_version'),
    attribution(user.id, 'subject_variant'),
    experimentOne(user.id),
    recentEvents(user.id, 30),
  ]);

  return (
    <>
      <ConnectionBanner />
      <h1>The numbers</h1>
      <p className="lede">
        For the person deciding whether this is a business, not for the person job-hunting.
      </p>

      <h2>Unit economics</h2>
      <div className="card">
        <Number
          label="Minutes per send"
          value={pricing.minutesPerSend}
          format={(v) => v.toFixed(1)}
          basis={`${pricing.basis.minutesLogged} sourcing sessions logged across ${pricing.basis.sends} sends`}
        />
        <Number
          label="Sends per positive reply"
          value={pricing.sendsPerPositiveReply}
          format={(v) => v.toFixed(1)}
          basis={`${pricing.basis.positives} positive replies`}
        />
        <Number
          label="Positive replies per interview"
          value={pricing.repliesPerInterview}
          format={(v) => v.toFixed(1)}
          basis={`${pricing.basis.interviews} interviews booked`}
        />
      </div>

      <h2>Experiment 1 — HR-first vs manager-first</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>{experiment.verdict}</p>
        {experiment.arms.map((arm) => (
          <p key={arm.arm} className="muted" style={{ marginBottom: 4 }}>
            <strong style={{ color: 'var(--ink)' }}>
              {arm.arm === 'A_hr_first' ? 'A — HR first' : 'B — manager first'}
            </strong>{' '}
            — {arm.companies} companies, {arm.sends} sends, {arm.positive} positive,{' '}
            {arm.minutesLogged.toFixed(0)} minutes logged
            {arm.positiveRate !== null ? `, ${(arm.positiveRate * 100).toFixed(1)}%` : ', rate withheld'}
          </p>
        ))}
      </div>

      <h2>What is working</h2>
      <Table title="By evidence tier" rows={byTier} />
      <Table title="By contact type" rows={byContact} />
      <Table title="By template version" rows={byTemplate} />
      <Table title="By subject variant" rows={bySubject} />

      <h2>Log</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        {events.map((e, i) => (
          <p
            key={i}
            className="muted"
            style={{ marginBottom: 4, color: e.level === 'error' ? 'var(--danger)' : undefined }}
          >
            <code>{e.at.slice(0, 19).replace('T', ' ')}</code> {e.event}{' '}
            {e.detail !== '{}' ? e.detail.slice(0, 140) : ''}
          </p>
        ))}
      </div>

      <p style={{ marginTop: 24 }}>
        <a className="linkish" href="/dashboard">
          Back
        </a>
      </p>
    </>
  );
}

function Number({
  label,
  value,
  format,
  basis,
}: {
  label: string;
  value: number | null;
  format: (v: number) => string;
  basis: string;
}) {
  return (
    <p style={{ marginBottom: 12 }}>
      <strong>
        {label}: {value === null ? '—' : format(value)}
      </strong>
      <br />
      <span className="muted">{basis}</span>
    </p>
  );
}

function Table({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ value: string; sent: number; replies: number; positive: number; positiveRate: number | null }>;
}) {
  return (
    <div className="card">
      <strong>{title}</strong>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Nothing sent yet.
        </p>
      ) : (
        rows.map((row) => (
          <p key={row.value} className="muted" style={{ marginBottom: 4 }}>
            <strong style={{ color: 'var(--ink)' }}>{row.value}</strong> — {row.sent} sent,{' '}
            {row.replies} replies, {row.positive} positive
            {row.positiveRate !== null
              ? ` (${(row.positiveRate * 100).toFixed(1)}%)`
              : ' — too few sends for a rate to mean anything'}
          </p>
        ))
      )}
    </div>
  );
}
