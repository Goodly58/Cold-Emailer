'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, list } from '@/lib/client';
import { eventTiming, formatEventDates, sortEvents, todayLocal } from '@/lib/events';
import { findByName, indexByName } from '@/lib/names';
import { nextActions } from '@/lib/next-actions';
import { followUpsDue } from '@/lib/outreach';
import { opportunity } from '@/lib/pay';
import { formatMonthly } from '@/lib/salary';
import {
  STAGE_LABELS,
  type Application,
  type CareerEvent,
  type Company,
  type Contact,
  type JobSource,
  type Outreach,
  type Profile,
} from '@/lib/types';

interface Review {
  headline: string;
  working: string[];
  notWorking: string[];
  thisWeek: Array<{ action: string; why: string }>;
  generatedAt: string;
  usage?: { costUsd: number };
}

export default function Overview() {
  const [apps, setApps] = useState<Application[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [events, setEvents] = useState<CareerEvent[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [aiOn, setAiOn] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // New starter events reach an existing database here too, so the
      // countdown shows even if the Events page has never been opened.
      await api('/api/sync-seed', { method: 'POST' }).catch(() => undefined);
      const [a, co, ct, o, ev, p, js, ai] = await Promise.all([
        list<Application>('applications'),
        list<Company>('companies'),
        list<Contact>('contacts'),
        list<Outreach>('outreach'),
        list<CareerEvent>('events'),
        api<Profile>('/api/profile'),
        list<JobSource>('jobSources'),
        api<{ configured: boolean }>('/api/ai/status').catch(() => ({ configured: false })),
      ]);
      setProfile(p);
      setSources(js);
      setAiOn(ai.configured);
      if (ai.configured) {
        api<{ review: Review | null }>('/api/ai/review').then((r) => setReview(r.review)).catch(() => undefined);
      }
      setApps(a);
      setCompanies(co);
      setContacts(ct);
      setOutreach(o);
      setEvents(ev);
      setLoaded(true);
    })();
  }, []);

  const applied = apps.filter((a) => !['found', 'tailored'].includes(a.stage)).length;
  const interviews = apps.filter((a) => ['interview', 'offer'].includes(a.stage)).length;
  const sent = outreach.filter((o) => ['sent', 'replied', 'no-reply'].includes(o.status)).length;
  const replied = outreach.filter((o) => o.status === 'replied').length;
  const replyRate = sent ? Math.round((replied / sent) * 100) : 0;

  // Local date, not UTC: in the UAE the UTC date is still yesterday until 4am.
  const today = todayLocal();
  const due = apps.filter((a) => a.nextActionAt && a.nextActionAt <= today && !['offer', 'rejected'].includes(a.stage));
  const queuedEmails = outreach.filter((o) => ['draft', 'ready'].includes(o.status));
  const followUps = followUpsDue(outreach, today);
  // People met at an event who haven't had their thank-you email yet.
  const eventById = new Map(events.map((e) => [e.id, e]));
  const metNotFollowed = contacts.filter(
    (c) => c.metAtEventId && c.status === 'identified' && eventById.has(c.metAtEventId)
  );

  const liveEvents = sortEvents(events.filter((e) => !e.hidden && e.status !== 'skipped'))
    .map((e) => ({ event: e, timing: eventTiming(e, today) }))
    .filter((x) => x.timing.state === 'upcoming' || x.timing.state === 'live');
  // Within a week and still not registered: the one event task that can't wait.
  const unregistered = liveEvents.filter(
    (x) => x.event.status === 'interested' && x.timing.daysUntil !== undefined && x.timing.daysUntil <= 7
  );

  // The handful of open roles most worth your time today.
  const companyIndex = indexByName(companies);
  const best = profile
    ? apps
        .filter((a) => !a.dismissed && !a.closed && (a.stage === 'found' || a.stage === 'tailored'))
        .map((a) => {
          const company = findByName(companyIndex, a.companyName);
          return { app: a, opp: opportunity(a, profile, company, today) };
        })
        .sort((x, y) => y.opp.score - x.opp.score)
        .slice(0, 6)
    : [];

  const actions = profile
    ? nextActions({
        profile,
        hasCv: Boolean(profile.cvWords),
        applications: apps,
        companies,
        contacts,
        outreach,
        jobSources: sources,
        events,
        today,
      }).slice(0, 6)
    : [];

  async function runReview() {
    setReviewing(true);
    setReviewError('');
    try {
      setReview((await api<{ review: Review }>('/api/ai/review', { method: 'POST' })).review);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setReviewing(false);
    }
  }

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Overview</h1>
      <p className="subtitle">Your job search at a glance.</p>

      <div className="grid stat-grid">
        <div className="card">
          <div className="stat-value">{apps.length}</div>
          <div className="stat-label">Roles in pipeline</div>
        </div>
        <div className="card">
          <div className="stat-value">{applied}</div>
          <div className="stat-label">Applications sent</div>
        </div>
        <div className="card">
          <div className="stat-value">{interviews}</div>
          <div className="stat-label">Interviews / offers</div>
        </div>
        <div className="card">
          <div className="stat-value">{sent}</div>
          <div className="stat-label">Cold emails sent</div>
        </div>
        <div className="card">
          <div className="stat-value">{replyRate}%</div>
          <div className="stat-label">Reply rate</div>
        </div>
        <div className="card">
          <div className="stat-value">{companies.length}</div>
          <div className="stat-label">Target companies</div>
        </div>
        <div className="card">
          <div className="stat-value">{contacts.length}</div>
          <div className="stat-label">Decision-makers</div>
        </div>
      </div>

      {actions.length > 0 && (
        <>
          <h2>Next best actions</h2>
          <div className="card">
            <table>
              <tbody>
                {actions.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.title}</strong>
                      {x.detail && <div className="muted" style={{ fontSize: 12 }}>{x.detail}</div>}
                    </td>
                    <td style={{ width: 110, textAlign: 'right' }}>
                      <Link className="btn small" href={x.href}>
                        {x.cta} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Due today</h2>
      <div className="card">
        {due.length === 0 &&
        queuedEmails.length === 0 &&
        unregistered.length === 0 &&
        followUps.length === 0 &&
        metNotFollowed.length === 0 ? (
          <p className="muted">
            Nothing due. Add roles in the <Link href="/pipeline">Pipeline</Link> or queue emails in{' '}
            <Link href="/outreach">Outreach</Link>.
          </p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {unregistered.map(({ event, timing }) => (
              <li key={event.id}>
                <strong>Register for {event.name}</strong>:{' '}
                {timing.state === 'live' ? "it's on now" : `it starts ${timing.label.toLowerCase()}`}.{' '}
                {event.registerUrl ? (
                  <a href={event.registerUrl} target="_blank" rel="noreferrer">
                    Register ↗
                  </a>
                ) : (
                  <Link href="/events">Open event</Link>
                )}
              </li>
            ))}
            {due.map((a) => (
              <li key={a.id}>
                <strong>{a.roleTitle}</strong> at {a.companyName} — {STAGE_LABELS[a.stage]}, next action{' '}
                {a.nextActionAt}
              </li>
            ))}
            {metNotFollowed.map((c) => (
              <li key={`met-${c.id}`}>
                Thank <strong>{c.name}</strong> ({c.companyName}) for meeting you at{' '}
                {eventById.get(c.metAtEventId!)?.name} —{' '}
                <Link
                  href={`/outreach?contactId=${encodeURIComponent(c.id)}&to=${encodeURIComponent(c.name)}&email=${encodeURIComponent(c.email || '')}&company=${encodeURIComponent(c.companyName)}&event=${encodeURIComponent(eventById.get(c.metAtEventId!)?.name || '')}&template=t8`}
                >
                  write it
                </Link>
              </li>
            ))}
            {followUps.map((o) => (
              <li key={`fu-${o.id}`}>
                Follow up with <strong>{o.toName}</strong> ({o.companyName}) —{' '}
                <Link href="/outreach">write it</Link>
              </li>
            ))}
            {queuedEmails.map((o) => (
              <li key={o.id}>
                Email to <strong>{o.toName}</strong> ({o.companyName}) is {o.status} —{' '}
                <Link href="/outreach">send it</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2>Best opportunities right now</h2>
      <div className="card">
        {best.length === 0 ? (
          <p className="muted">
            No open roles yet. Add job boards on <Link href="/sources">Sources</Link> and the
            scraper fills this in daily.
          </p>
        ) : (
          <table>
            <tbody>
              {best.map(({ app, opp }) => (
                <tr key={app.id}>
                  <td style={{ width: 48 }}>
                    <span
                      className={`badge ${opp.score >= 65 ? 'badge-uae' : opp.score >= 40 ? 'badge-target' : 'badge-backup'}`}
                      title={opp.parts.map((p) => `${p.label}: ${p.points}`).join('\n')}
                    >
                      {opp.score}
                    </span>
                  </td>
                  <td>
                    {app.jobUrl ? (
                      <a href={app.jobUrl} target="_blank" rel="noreferrer">
                        <strong>{app.roleTitle}</strong>
                      </a>
                    ) : (
                      <strong>{app.roleTitle}</strong>
                    )}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {app.companyName}
                      {app.isNew ? ' · new' : ''}
                    </div>
                  </td>
                  <td style={{ fontSize: 13, whiteSpace: 'nowrap' }} title={opp.pay?.notes.join('\n')}>
                    {opp.pay ? (
                      <span className={opp.pay.basis === 'estimate' ? 'muted' : 'success'}>
                        {opp.pay.basis === 'estimate' ? '~' : ''}
                        {formatMonthly(opp.pay.low, opp.pay.high)}
                      </span>
                    ) : (
                      <span className="muted">pay unknown</span>
                    )}
                    {opp.nafis.eligible && opp.nafis.amount ? (
                      <div className="muted" style={{ fontSize: 11 }} title={opp.nafis.reason}>
                        + up to {opp.nafis.amount.toLocaleString('en-US')} Nafis
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt" style={{ fontSize: 13 }}>
          <Link href="/pipeline">All roles, ranked by pay, fit and freshness →</Link>
        </p>
      </div>

      {aiOn && (
        <>
          <h2>Weekly review</h2>
          <div className="card">
            {review ? (
              <div style={{ fontSize: 14 }}>
                <p>
                  <strong>{review.headline}</strong>{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    ({review.generatedAt.slice(0, 10)})
                  </span>
                </p>
                <div className="split mt">
                  <div>
                    <strong className="success">Working</strong>
                    <ul style={{ paddingLeft: 18 }}>
                      {review.working.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                    <strong className="error">Not working</strong>
                    <ul style={{ paddingLeft: 18 }}>
                      {review.notWorking.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>This week</strong>
                    <ol style={{ paddingLeft: 18 }}>
                      {review.thisWeek.map((t) => (
                        <li key={t.action}>
                          {t.action} <span className="muted">— {t.why}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">
                A coach&apos;s read of your numbers: reply rates by template, applications per week,
                where the funnel leaks, and what to change this week. Uses totals only, not your
                emails.
              </p>
            )}
            <button className="small mt" disabled={reviewing} onClick={runReview}>
              {reviewing ? 'Reviewing…' : review ? '↻ Refresh review' : '✨ Review my search'}
            </button>
            {reviewError && <p className="error">{reviewError}</p>}
          </div>
        </>
      )}

      <h2>Upcoming events</h2>
      <div className="card">
        {liveEvents.length === 0 ? (
          <p className="muted">
            No upcoming events. See <Link href="/events">Events</Link> for fairs with dates still to
            be announced.
          </p>
        ) : (
          <table>
            <tbody>
              {liveEvents.slice(0, 4).map(({ event, timing }) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {formatEventDates(event)} · {event.city}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        timing.state === 'live' ? 'badge-uae' : timing.soon ? 'badge-soon' : 'badge-status'
                      }`}
                    >
                      {timing.label}
                    </span>
                  </td>
                  <td className="muted">{event.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt" style={{ fontSize: 13 }}>
          <Link href="/events">All events, prep checklists and exhibitors →</Link>
        </p>
      </div>

      <h2>Setup checklist</h2>
      <div className="card playbook">
        <ol style={{ paddingLeft: 20 }}>
          <li>
            <strong>Add your CV and job preferences</strong> on the{' '}
            <Link href="/profile">Profile</Link> page. Your details fill merge fields in every
            email, your preferences (titles, keywords, minimum pay) rank incoming roles, and your
            CV is what the AI tailors from.
          </li>
          <li>
            <strong>Sync the company list</strong> on the <Link href="/companies">Companies</Link>{' '}
            page, then set each dream company&apos;s email domain and divisions via its{' '}
            <em>Setup</em> button.
          </li>
          <li>
            <strong>Discover job boards</strong> on the <Link href="/sources">Sources</Link> page —
            &ldquo;Sweep all companies&rdquo; probes six ATS platforms per company automatically.
          </li>
          <li>
            <strong>Add decision-makers</strong> in <Link href="/contacts">Contacts</Link>: hiring
            manager, TA/Emiratisation lead, and one exec per target. Expand a row to find their
            email and capture your hook.
          </li>
          <li>
            <strong>Send</strong> from <Link href="/outreach">Outreach</Link> — 10–20 tailored
            emails a day, tracked with follow-ups.
          </li>
          <li>
            Read the <Link href="/uae">UAE Playbook</Link> before your first send, and check{' '}
            <Link href="/runs">Health</Link> occasionally to confirm the scraper is still running.
          </li>
        </ol>
      </div>
    </div>
  );
}
