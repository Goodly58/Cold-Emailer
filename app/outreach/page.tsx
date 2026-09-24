'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, list, patch, remove } from '@/lib/client';
import { todayLocal } from '@/lib/events';
import { gmailComposeUrl, mergeTemplate } from '@/lib/merge';
import {
  MAX_FOLLOW_UPS,
  followUpsDue,
  lintEmail,
  sendTimeHint,
  sentToday,
  statsByTemplate,
  wentQuiet,
} from '@/lib/outreach';
import {
  OUTREACH_STATUSES,
  type Application,
  type Contact,
  type ContactKind,
  type Outreach,
  type OutreachStatus,
  type Profile,
  type Template,
} from '@/lib/types';

/** Which starter template suits which kind of contact. */
const TEMPLATE_FOR_KIND: Partial<Record<ContactKind, string>> = {
  'hiring-manager': 't1',
  exec: 't1',
  'ta-recruiter': 't2',
  'emiratisation-lead': 't2',
  peer: 't6',
};

interface AiDraft {
  subject: string;
  body: string;
  missing: string[];
  rationale: string;
  usage?: { costUsd: number };
  usedCv?: boolean;
  usedJd?: boolean;
}

interface Research {
  facts: Array<{ fact: string; date: string; url: string }>;
  personNotes: string;
  hooks: string[];
  usage?: { costUsd: number };
  searches?: number;
  saved?: boolean;
}

function Composer() {
  const search = useSearchParams();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [aiOn, setAiOn] = useState(false);

  const [templateId, setTemplateId] = useState('');
  const [contactId, setContactId] = useState(search.get('contactId') || '');
  const [applicationId, setApplicationId] = useState(search.get('applicationId') || '');
  const [toName, setToName] = useState(search.get('to') || '');
  const [toEmail, setToEmail] = useState(search.get('email') || '');
  const [company, setCompany] = useState(search.get('company') || '');
  const [role, setRole] = useState(search.get('role') || '');
  const [hook, setHook] = useState(search.get('hook') || '');
  const [eventName, setEventName] = useState(search.get('event') || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [aiAssisted, setAiAssisted] = useState(false);
  /** Set while writing a follow-up: the email being followed up. */
  const [followUpOf, setFollowUpOf] = useState<Outreach | null>(null);
  /** Set when a queued email is opened, so sending it updates that record. */
  const [queuedId, setQueuedId] = useState('');

  const [copied, setCopied] = useState(false);
  const [override, setOverride] = useState(false);
  const [aiBusy, setAiBusy] = useState('');
  const [aiNote, setAiNote] = useState<AiDraft | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
  const [error, setError] = useState('');

  const today = todayLocal();

  useEffect(() => {
    (async () => {
      const [t, p, o, c, a, ai] = await Promise.all([
        list<Template>('templates'),
        api<Profile>('/api/profile'),
        list<Outreach>('outreach'),
        list<Contact>('contacts'),
        list<Application>('applications'),
        api<{ configured: boolean }>('/api/ai/status').catch(() => ({ configured: false })),
      ]);
      setTemplates(t);
      setProfile(p);
      setOutreach(o);
      setContacts(c);
      setApps(a.filter((x) => !x.dismissed));
      setAiOn(ai.configured);

      const contact = c.find((x) => x.id === search.get('contactId'));
      const wanted = search.get('template') || (contact?.kind ? TEMPLATE_FOR_KIND[contact.kind] : undefined);
      setTemplateId((t.find((x) => x.id === wanted) ?? t[0])?.id ?? '');
      // A template named in the link (e.g. the post-event follow-up) wins over the contact's default.
      if (contact) pickContact(contact, Boolean(search.get('template')));
      const app = a.find((x) => x.id === search.get('applicationId'));
      if (app) {
        setRole(app.roleTitle);
        setCompany((prev) => prev || app.companyName);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId]);
  const contact = useMemo(() => contacts.find((c) => c.id === contactId), [contacts, contactId]);
  const stats = useMemo(() => statsByTemplate(outreach), [outreach]);
  const due = useMemo(() => followUpsDue(outreach, today), [outreach, today]);
  const quiet = useMemo(() => outreach.filter((o) => wentQuiet(o, today)), [outreach, today]);
  const sentCount = sentToday(outreach, today);
  const cap = profile?.dailySendCap || 15;
  const hint = sendTimeHint();

  const companyRoles = useMemo(() => {
    const c = company.trim().toLowerCase();
    return c ? apps.filter((a) => a.companyName.toLowerCase() === c) : [];
  }, [apps, company]);

  const issues = useMemo(
    () =>
      lintEmail({
        toEmail,
        toName,
        companyName: company,
        subject,
        body,
        contact,
        history: outreach.filter((o) => o.id !== queuedId),
        isFollowUp: Boolean(followUpOf),
      }),
    // A queued email being sent isn't a double-send of itself.
    [toEmail, toName, company, subject, body, contact, outreach, followUpOf, queuedId]
  );
  const errors = issues.filter((i) => i.level === 'error');
  const blocked = errors.length > 0 && !override;

  function pickContact(c: Contact, keepTemplate = false) {
    setContactId(c.id);
    setToName(c.name);
    setToEmail(c.email || '');
    setCompany(c.companyName);
    setHook(c.hook || '');
    if (!keepTemplate && c.kind && TEMPLATE_FOR_KIND[c.kind]) setTemplateId(TEMPLATE_FOR_KIND[c.kind]!);
  }

  function applyTemplate(t = template) {
    if (!t || !profile) return;
    const fields = { firstName: toName.split(' ')[0], company, role, hook, event: eventName };
    setSubject(mergeTemplate(t.subject, fields, profile));
    setBody(mergeTemplate(t.body, fields, profile));
    setLanguage('en');
    setAiAssisted(false);
  }

  function reset() {
    setFollowUpOf(null);
    setQueuedId('');
    setContactId('');
    setApplicationId('');
    setToName('');
    setToEmail('');
    setCompany('');
    setRole('');
    setHook('');
    setEventName('');
    setSubject('');
    setBody('');
    setAiNote(null);
    setResearch(null);
    setOverride(false);
    setLanguage('en');
    setAiAssisted(false);
  }

  async function runAi(mode: 'draft' | 'improve' | 'arabic' | 'followup') {
    setError('');
    setAiBusy(mode);
    try {
      const r = await api<AiDraft>('/api/ai/draft', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          contactId: contactId || undefined,
          applicationId: applicationId || undefined,
          companyName: company || undefined,
          toName: toName || undefined,
          role: role || undefined,
          hook: hook || undefined,
          eventName: eventName || undefined,
          template: mode === 'draft' && template ? { subject: template.subject, body: template.body } : undefined,
          subject: mode === 'followup' ? followUpOf?.subject : subject,
          body: mode === 'followup' ? followUpOf?.body : body,
          followUpNumber: mode === 'followup' ? (followUpOf?.followUps ?? 0) + 1 : undefined,
        }),
      });
      setSubject(r.subject);
      setBody(r.body);
      setAiNote(r);
      setAiAssisted(true);
      if (mode === 'arabic') setLanguage('ar');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed');
    } finally {
      setAiBusy('');
    }
  }

  async function runResearch() {
    if (!company) return;
    setError('');
    setAiBusy('research');
    try {
      const r = await api<Research>('/api/ai/research', {
        method: 'POST',
        body: JSON.stringify({ companyName: company, contactId: contactId || undefined }),
      });
      setResearch(r);
      if (!hook && r.hooks[0]) setHook(r.hooks[0]);
      if (r.saved) setContacts(await list<Contact>('contacts'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Research failed');
    } finally {
      setAiBusy('');
    }
  }

  async function log(action: 'send' | 'queue') {
    if (!toName || !subject) return;
    const item = await api<Outreach>('/api/outreach-log', {
      method: 'POST',
      body: JSON.stringify({
        action,
        today,
        toName,
        toEmail: toEmail || undefined,
        companyName: company,
        subject,
        body,
        contactId: contactId || undefined,
        applicationId: applicationId || undefined,
        role: role || undefined,
        templateId: templateId || undefined,
        language,
        aiAssisted: aiAssisted || undefined,
      }),
    });
    setOutreach((prev) => [item, ...prev]);
    if (action === 'send' && contactId) {
      setContacts((prev) => prev.map((c) => (c.id === contactId && c.status === 'identified' ? { ...c, status: 'emailed' } : c)));
    }
  }

  async function logFollowUp() {
    if (!followUpOf) return;
    const updated = await api<Outreach>('/api/outreach-log', {
      method: 'POST',
      body: JSON.stringify({ action: 'followup', id: followUpOf.id, today }),
    });
    setOutreach((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function onSend() {
    if (followUpOf) await logFollowUp();
    else if (queuedId) await sendQueued();
    else await log('send');
  }

  async function sendQueued() {
    await patch<Outreach>('outreach', queuedId, {
      toName,
      toEmail: toEmail || undefined,
      companyName: company,
      subject,
      body,
      role: role || undefined,
      applicationId: applicationId || undefined,
      contactId: contactId || undefined,
      language,
    });
    const updated = await api<Outreach>('/api/outreach-log', {
      method: 'POST',
      body: JSON.stringify({ action: 'status', id: queuedId, status: 'sent', today }),
    });
    setOutreach((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setQueuedId('');
  }

  function startFollowUp(o: Outreach) {
    reset();
    setFollowUpOf(o);
    setContactId(o.contactId || '');
    setApplicationId(o.applicationId || '');
    setToName(o.toName);
    setToEmail(o.toEmail || '');
    setCompany(o.companyName);
    setRole(o.role || '');
    const t = templates.find((x) => x.id === (o.followUps >= 1 ? 't4' : 't3'));
    if (t && profile) {
      const fields = { firstName: o.toName.split(' ')[0], company: o.companyName, role: o.role, hook: '' };
      setSubject(o.subject.startsWith('Re:') ? o.subject : `Re: ${o.subject}`);
      setBody(mergeTemplate(t.body, fields, profile));
    } else {
      setSubject(`Re: ${o.subject}`);
      setBody('');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function setStatus(o: Outreach, status: OutreachStatus) {
    const updated = await api<Outreach>('/api/outreach-log', {
      method: 'POST',
      body: JSON.stringify({ action: 'status', id: o.id, status, today }),
    });
    setOutreach((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
  }

  function loadQueued(o: Outreach) {
    reset();
    setQueuedId(o.id);
    setContactId(o.contactId || '');
    setApplicationId(o.applicationId || '');
    setToName(o.toName);
    setToEmail(o.toEmail || '');
    setCompany(o.companyName);
    setRole(o.role || '');
    setSubject(o.subject);
    setBody(o.body);
    setTemplateId(o.templateId || templateId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function copyEmail() {
    await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function del(id: string) {
    await remove('outreach', id);
    setOutreach((prev) => prev.filter((o) => o.id !== id));
  }

  const templateName = (id?: string) => templates.find((t) => t.id === id)?.name;

  return (
    <div>
      <h1>Cold outreach</h1>
      <p className="subtitle">
        Write it from a template or with AI, check it, open it pre-filled in Gmail, and the
        follow-ups schedule themselves on the UAE working week. 10–20 tailored emails a day beats
        200 generic ones and keeps your Gmail reputation clean.
      </p>

      {(due.length > 0 || quiet.length > 0) && (
        <div className="card mb">
          <h2 style={{ marginTop: 0 }}>Follow-ups due ({due.length})</h2>
          <table>
            <tbody>
              {due.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.toName}</strong> · {o.companyName}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {o.subject} — sent {o.sentAt}, follow-up {o.followUps + 1} of {MAX_FOLLOW_UPS} due {o.nextFollowUpAt}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="small primary" onClick={() => startFollowUp(o)}>
                      Write follow-up
                    </button>{' '}
                    <button className="small" onClick={() => setStatus(o, 'replied')}>
                      They replied
                    </button>
                  </td>
                </tr>
              ))}
              {quiet.map((o) => (
                <tr key={o.id}>
                  <td className="muted">
                    {o.toName} · {o.companyName} — no reply after {MAX_FOLLOW_UPS} follow-ups
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="small" onClick={() => setStatus(o, 'no-reply')}>
                      Close as no reply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card mb">
        <div className="flex spread">
          <h2 style={{ margin: 0 }}>{followUpOf ? `Follow-up to ${followUpOf.toName}` : 'Compose'}</h2>
          <div className="flex" style={{ fontSize: 13 }}>
            <span className={sentCount >= cap ? 'error' : 'muted'} title="Set your daily cap on the Profile page">
              Sent today: {sentCount} / {cap}
            </span>
            {(followUpOf || subject || body) && (
              <button className="small" onClick={reset}>
                New email
              </button>
            )}
          </div>
        </div>

        {!followUpOf && (
          <div className="form-row mt">
            <div>
              <label>Contact</label>
              <select
                value={contactId}
                onChange={(e) => {
                  const c = contacts.find((x) => x.id === e.target.value);
                  if (c) pickContact(c);
                  else setContactId('');
                }}
              >
                <option value="">— type details below, or pick a contact —</option>
                {[...contacts]
                  .sort((a, b) => a.companyName.localeCompare(b.companyName))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName} — {c.name}
                      {c.role ? `, ${c.role}` : ''}
                      {c.status !== 'identified' ? ` (${c.status})` : ''}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label>Template</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => {
                  const s = stats.get(t.id);
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {s ? ` — ${s.rate}% replies (${s.sent} sent)` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        <div className="form-row">
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
            {companyRoles.length > 0 ? (
              <select
                value={applicationId}
                onChange={(e) => {
                  setApplicationId(e.target.value);
                  const a = companyRoles.find((x) => x.id === e.target.value);
                  if (a) setRole(a.roleTitle);
                }}
              >
                <option value="">{role ? `${role} (not linked)` : '— pick a role from your pipeline —'}</option>
                {companyRoles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.roleTitle}
                    {a.hasDescription ? ' ✓ JD' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Data Analyst" />
            )}
          </div>
          <div>
            <label>Event (event templates)</label>
            <input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="Ru'ya Careers UAE" />
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
        </div>

        <div className="flex mb">
          {!followUpOf && (
            <button type="button" onClick={() => applyTemplate()}>
              Fill from template
            </button>
          )}
          {aiOn ? (
            <>
              {followUpOf ? (
                <button type="button" disabled={Boolean(aiBusy)} onClick={() => runAi('followup')}>
                  {aiBusy === 'followup' ? 'Writing…' : '✨ Write follow-up with AI'}
                </button>
              ) : (
                <button type="button" disabled={Boolean(aiBusy) || !company} onClick={() => runAi('draft')} title="Uses your CV, the contact's research, the company and the job description">
                  {aiBusy === 'draft' ? 'Writing…' : '✨ Draft with AI'}
                </button>
              )}
              <button type="button" disabled={Boolean(aiBusy) || !body} onClick={() => runAi('improve')}>
                {aiBusy === 'improve' ? 'Improving…' : '✨ Improve'}
              </button>
              <button type="button" disabled={Boolean(aiBusy) || !body} onClick={() => runAi('arabic')}>
                {aiBusy === 'arabic' ? 'Translating…' : '✨ Arabic version'}
              </button>
              {!followUpOf && (
                <button type="button" disabled={Boolean(aiBusy) || !company} onClick={runResearch} title="Searches the web for recent company news and suggests opening lines">
                  {aiBusy === 'research' ? 'Researching… (up to a minute)' : '🔎 Research a hook'}
                </button>
              )}
            </>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              AI drafting is off. <Link href="/profile">Switch it on</Link> with an Anthropic API key.
            </span>
          )}
        </div>
        {error && <p className="error">{error}</p>}

        {research && (
          <div className="card mb" style={{ background: 'var(--panel-2)', fontSize: 13 }}>
            <strong>Research</strong>
            <span className="muted">
              {' '}
              · {research.searches ?? 0} searches{research.usage ? ` · ~$${research.usage.costUsd.toFixed(3)}` : ''}
              {research.saved ? ' · saved to the contact' : ''}
            </span>
            {research.facts.length === 0 && !research.personNotes && <p className="muted">Nothing recent and specific turned up.</p>}
            <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
              {research.facts.map((f) => (
                <li key={f.url + f.fact}>
                  {f.date && <span className="muted">{f.date} · </span>}
                  {f.fact}{' '}
                  <a href={f.url} target="_blank" rel="noreferrer">
                    source
                  </a>
                </li>
              ))}
            </ul>
            {research.personNotes && <p className="muted">{research.personNotes}</p>}
            {research.hooks.map((h) => (
              <div key={h} className="flex" style={{ marginTop: 6 }}>
                <span style={{ flex: 1 }}>&ldquo;{h}&rdquo;</span>
                <button className="small" onClick={() => setHook(h)}>
                  Use
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="form-row">
          <div>
            <label>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} dir={language === 'ar' ? 'rtl' : 'ltr'} />
          </div>
        </div>
        <div>
          <label>Body</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} dir={language === 'ar' ? 'rtl' : 'ltr'} />
        </div>

        {aiNote && (
          <p className="muted" style={{ fontSize: 12 }}>
            AI: {aiNote.rationale}
            {aiNote.missing.length > 0 && <> Fill in: {aiNote.missing.join('; ')}.</>}
            {aiNote.usedCv === false && ' No CV on file, so it could only use your profile.'}
            {aiNote.usage && ` (~$${aiNote.usage.costUsd.toFixed(3)})`}
          </p>
        )}

        {(subject || body) && (
          <div className="mt" style={{ fontSize: 13 }}>
            {issues.length === 0 ? (
              <p className="success">✓ Checks passed.</p>
            ) : (
              <ul className="checklist">
                {issues.map((i) => (
                  <li key={i.message} className={i.level === 'error' ? 'error' : 'muted'}>
                    {i.level === 'error' ? '✕' : '!'} {i.message}
                  </li>
                ))}
              </ul>
            )}
            {errors.length > 0 && (
              <label className="flex" style={{ marginTop: 6 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Send anyway
              </label>
            )}
          </div>
        )}

        {hint && <p className="muted" style={{ fontSize: 12 }}>🕘 {hint}</p>}

        <div className="flex mt">
          <a
            className={`btn primary${toEmail && subject && !blocked ? '' : ' muted'}`}
            href={toEmail && subject && !blocked ? gmailComposeUrl(toEmail, subject, body) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={blocked || !toEmail || !subject}
            style={blocked || !toEmail || !subject ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            title={blocked ? 'Fix the ✕ items above, or tick "Send anyway"' : undefined}
            onClick={(e) => {
              if (blocked || !toEmail || !subject) {
                e.preventDefault();
                return;
              }
              onSend();
            }}
          >
            Open in Gmail ↗ (logs as sent)
          </a>
          <button onClick={copyEmail}>{copied ? 'Copied ✓' : 'Copy email'}</button>
          {!followUpOf && !queuedId && <button onClick={() => log('queue')}>Save to queue</button>}
        </div>
      </div>

      <h2>Outreach log</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>To</th>
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
                <td colSpan={6} className="muted">
                  Nothing yet. Compose above, or draft from a contact on the{' '}
                  <Link href="/contacts">Contacts</Link> page.
                </td>
              </tr>
            )}
            {outreach.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{o.toName}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {o.companyName}
                    {o.toEmail ? ` · ${o.toEmail}` : ''}
                  </div>
                </td>
                <td className="muted" style={{ maxWidth: 280, fontSize: 13 }}>
                  {o.subject}
                  <div style={{ fontSize: 11 }}>
                    {templateName(o.templateId) ?? ''}
                    {o.aiAssisted ? ' · AI-assisted' : ''}
                    {o.language === 'ar' ? ' · Arabic' : ''}
                  </div>
                </td>
                <td>
                  <select value={o.status} onChange={(e) => setStatus(o, e.target.value as OutreachStatus)} style={{ width: 'auto', padding: '4px 6px', fontSize: 12 }}>
                    {OUTREACH_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {o.sentAt || '—'}
                  {o.repliedAt && <div className="success">replied {o.repliedAt}</div>}
                </td>
                <td style={{ fontSize: 13 }}>
                  {o.followUps}/{MAX_FOLLOW_UPS}
                  {o.nextFollowUpAt && (
                    <div className={o.nextFollowUpAt <= today ? 'error' : 'muted'} style={{ fontSize: 11 }}>
                      next {o.nextFollowUpAt}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {(o.status === 'draft' || o.status === 'ready') && (
                    <button className="small" onClick={() => loadQueued(o)}>
                      Open
                    </button>
                  )}
                  {o.status === 'sent' && o.followUps < MAX_FOLLOW_UPS && (
                    <button className="small" onClick={() => startFollowUp(o)}>
                      Follow up
                    </button>
                  )}{' '}
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
