'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { create, list, patch, remove, api } from '@/lib/client';
import { gmailComposeUrl, mergeTemplate } from '@/lib/merge';
import {
  OUTREACH_STATUSES,
  type Outreach,
  type OutreachStatus,
  type Profile,
  type Template,
} from '@/lib/types';

function Composer() {
  const search = useSearchParams();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [outreach, setOutreach] = useState<Outreach[]>([]);

  const [templateId, setTemplateId] = useState('');
  const [toName, setToName] = useState(search.get('to') || '');
  const [toEmail, setToEmail] = useState(search.get('email') || '');
  const [company, setCompany] = useState(search.get('company') || '');
  const [role, setRole] = useState('');
  const [hook, setHook] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    list<Template>('templates').then((t) => {
      setTemplates(t);
      if (t.length) setTemplateId(t[0].id);
    });
    api<Profile>('/api/profile').then(setProfile);
    list<Outreach>('outreach').then(setOutreach);
  }, []);

  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId]);

  function applyTemplate() {
    if (!template || !profile) return;
    const fields = { firstName: toName.split(' ')[0], company, role, hook };
    setSubject(mergeTemplate(template.subject, fields, profile));
    setBody(mergeTemplate(template.body, fields, profile));
  }

  async function saveDraft(status: OutreachStatus) {
    if (!toName || !subject) return;
    const item = await create<Outreach>('outreach', {
      toName,
      toEmail: toEmail || undefined,
      companyName: company,
      subject,
      body,
      status,
      followUps: 0,
      sentAt: status === 'sent' ? new Date().toISOString().slice(0, 10) : undefined,
    });
    setOutreach((prev) => [item, ...prev]);
  }

  async function copyEmail() {
    await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function cycleStatus(o: Outreach) {
    const next = OUTREACH_STATUSES[(OUTREACH_STATUSES.indexOf(o.status) + 1) % OUTREACH_STATUSES.length];
    const fields: Partial<Outreach> = { status: next };
    if (next === 'sent' && !o.sentAt) fields.sentAt = new Date().toISOString().slice(0, 10);
    const updated = await patch<Outreach>('outreach', o.id, fields);
    setOutreach((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
  }

  async function bumpFollowUp(o: Outreach) {
    const updated = await patch<Outreach>('outreach', o.id, { followUps: o.followUps + 1 });
    setOutreach((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
  }

  async function del(id: string) {
    await remove('outreach', id);
    setOutreach((prev) => prev.filter((o) => o.id !== id));
  }

  return (
    <div>
      <h1>Cold outreach</h1>
      <p className="subtitle">
        Compose from a template, personalize the hook, then open pre-filled in Gmail. 10–20 truly
        tailored emails a day beats 200 generic ones — and keeps your Gmail reputation clean.
      </p>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Compose</h2>
        <div className="form-row">
          <div>
            <label>Template</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>To (name)</label>
            <input value={toName} onChange={(e) => setToName(e.target.value)} placeholder="Sara Al Mansoori" />
          </div>
          <div>
            <label>To (email)</label>
            <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="sara.almansoori@company.ae" />
          </div>
          <div>
            <label>Company</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <label>Role</label>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Data Analyst" />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label>Personal hook (the sentence that proves this isn&apos;t a mass email)</label>
            <input
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              placeholder="e.g. Your team's launch of X caught my eye because I built something similar at Y…"
            />
          </div>
          <button className="fixed" type="button" onClick={applyTemplate} style={{ alignSelf: 'flex-end' }}>
            Fill from template
          </button>
        </div>
        <div className="form-row">
          <div>
            <label>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>
        <div>
          <label>Body</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="flex mt">
          <a
            className={`btn primary${toEmail && subject ? '' : ' muted'}`}
            href={toEmail && subject ? gmailComposeUrl(toEmail, subject, body) : undefined}
            target="_blank"
            rel="noreferrer"
            onClick={() => saveDraft('sent')}
          >
            Open in Gmail ↗ (logs as sent)
          </a>
          <button onClick={copyEmail}>{copied ? 'Copied ✓' : 'Copy email'}</button>
          <button onClick={() => saveDraft('ready')}>Save to queue</button>
        </div>
      </div>

      <h2>Outreach log</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>To</th>
              <th>Company</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Follow-ups</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {outreach.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nothing yet. Compose above, or draft from a contact on the Contacts page.
                </td>
              </tr>
            )}
            {outreach.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{o.toName}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{o.toEmail}</div>
                </td>
                <td className="muted">{o.companyName}</td>
                <td className="muted" style={{ maxWidth: 260 }}>{o.subject}</td>
                <td>
                  <span className="badge badge-status" onClick={() => cycleStatus(o)} title="Click to advance">
                    {o.status}
                  </span>
                </td>
                <td className="muted">{o.sentAt || '—'}</td>
                <td>
                  {o.followUps}{' '}
                  <button className="small" onClick={() => bumpFollowUp(o)} title="Log a follow-up">
                    +1
                  </button>
                </td>
                <td>
                  <button className="small danger" onClick={() => del(o.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OutreachPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Composer />
    </Suspense>
  );
}
