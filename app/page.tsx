'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { list } from '@/lib/client';
import { STAGE_LABELS, type Application, type Company, type Contact, type Outreach } from '@/lib/types';

export default function Overview() {
  const [apps, setApps] = useState<Application[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      list<Application>('applications'),
      list<Company>('companies'),
      list<Contact>('contacts'),
      list<Outreach>('outreach'),
    ]).then(([a, co, ct, o]) => {
      setApps(a);
      setCompanies(co);
      setContacts(ct);
      setOutreach(o);
      setLoaded(true);
    });
  }, []);

  const applied = apps.filter((a) => !['found', 'tailored'].includes(a.stage)).length;
  const interviews = apps.filter((a) => ['interview', 'offer'].includes(a.stage)).length;
  const sent = outreach.filter((o) => ['sent', 'replied', 'no-reply'].includes(o.status)).length;
  const replied = outreach.filter((o) => o.status === 'replied').length;
  const replyRate = sent ? Math.round((replied / sent) * 100) : 0;

  const today = new Date().toISOString().slice(0, 10);
  const due = apps.filter((a) => a.nextActionAt && a.nextActionAt <= today && !['offer', 'rejected'].includes(a.stage));
  const queuedEmails = outreach.filter((o) => ['draft', 'ready'].includes(o.status));

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

      <h2>Due today</h2>
      <div className="card">
        {due.length === 0 && queuedEmails.length === 0 ? (
          <p className="muted">
            Nothing due. Add roles in the <Link href="/pipeline">Pipeline</Link> or queue emails in{' '}
            <Link href="/outreach">Outreach</Link>.
          </p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {due.map((a) => (
              <li key={a.id}>
                <strong>{a.roleTitle}</strong> at {a.companyName} — {STAGE_LABELS[a.stage]}, next action{' '}
                {a.nextActionAt}
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

      <h2>Setup checklist</h2>
      <div className="card playbook">
        <ol style={{ paddingLeft: 20 }}>
          <li>
            <strong>Set your profile and job preferences</strong> on the{' '}
            <Link href="/templates">Templates</Link> page. The profile fills merge fields in every
            email; the preferences (target titles, keywords, exclusions) are what the scraper scores
            incoming roles against.
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
