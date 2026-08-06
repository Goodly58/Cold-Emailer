'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, create, list, patch, remove } from '@/lib/client';
import { divisionsForSector, researchLinks } from '@/lib/email-finder';
import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  CONTACT_STATUSES,
  type Company,
  type Contact,
  type ContactKind,
  type EmailStatus,
} from '@/lib/types';

interface EmailResult {
  domain: string;
  candidates: string[];
  mx: { ok: boolean; provider?: string; error?: string };
  hunter?: { email?: string; score?: number; error?: string };
}

const EMPTY = {
  name: '',
  role: '',
  companyName: '',
  email: '',
  linkedin: '',
  division: '',
  kind: 'hiring-manager' as ContactKind,
};

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    list<Contact>('contacts').then(setContacts);
    list<Company>('companies').then(setCompanies);
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const companyFor = (name: string) =>
    companies.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.companyName) return;
    const item = await create<Contact>('contacts', {
      ...form,
      status: 'identified',
      emailStatus: form.email ? 'guessed' : 'unknown',
    });
    setContacts((prev) => [item, ...prev]);
    setForm(EMPTY);
    setOpen(item.id);
  }

  async function save(id: string, fields: Partial<Contact>) {
    const updated = await patch<Contact>('contacts', id, fields);
    setContacts((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }

  async function del(id: string) {
    await remove('contacts', id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  const shown = contacts.filter((c) => {
    const q = filter.toLowerCase();
    return (
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.companyName.toLowerCase().includes(q) ||
      (c.division || '').toLowerCase().includes(q) ||
      (c.role || '').toLowerCase().includes(q)
    );
  });

  const formDivisions = useMemo(() => {
    const co = companyFor(form.companyName);
    if (!co) return [];
    return co.divisions?.length ? co.divisions : divisionsForSector(co.sector);
  }, [form.companyName, companies]);

  return (
    <div>
      <h1>Decision-makers</h1>
      <p className="subtitle">
        For each target company log three people: the <strong>hiring manager</strong> for the
        division you want, the <strong>TA / Emiratisation lead</strong>, and one{' '}
        <strong>senior exec</strong>. Expand a row to find their email and research them.
      </p>

      <div className="card mb">
        <form onSubmit={handleAdd}>
          <div className="form-row">
            <input placeholder="Full name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <input placeholder="Job title" value={form.role} onChange={(e) => set('role', e.target.value)} />
            <input
              list="company-list"
              placeholder="Company"
              value={form.companyName}
              onChange={(e) => set('companyName', e.target.value)}
            />
            <datalist id="company-list">
              {companies.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <input
              list="division-list"
              placeholder="Division"
              value={form.division}
              onChange={(e) => set('division', e.target.value)}
            />
            <datalist id="division-list">
              {formDivisions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <select
              className="fixed"
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as ContactKind)}
            >
              {CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONTACT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input placeholder="Email (leave blank to find it below)" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <input placeholder="LinkedIn URL" value={form.linkedin} onChange={(e) => set('linkedin', e.target.value)} />
            <button className="primary fixed" type="submit">
              Add contact
            </button>
          </div>
        </form>
      </div>

      <div className="form-row mb">
        <input
          placeholder="Filter by name, company, division or title…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="fixed muted" style={{ alignSelf: 'center' }}>
          {shown.length} of {contacts.length}
        </span>
      </div>

      {shown.length === 0 && (
        <div className="card muted">
          No contacts yet. Open a company&apos;s <strong>in: people</strong> link on the{' '}
          <Link href="/companies">Companies</Link> page to find who to add.
        </div>
      )}

      {shown.map((c) => (
        <ContactRow
          key={c.id}
          contact={c}
          company={companyFor(c.companyName)}
          expanded={open === c.id}
          onToggle={() => setOpen(open === c.id ? null : c.id)}
          onSave={(fields) => save(c.id, fields)}
          onDelete={() => del(c.id)}
        />
      ))}
    </div>
  );
}

function ContactRow({
  contact,
  company,
  expanded,
  onToggle,
  onSave,
  onDelete,
}: {
  contact: Contact;
  company?: Company;
  expanded: boolean;
  onToggle: () => void;
  onSave: (fields: Partial<Contact>) => void;
  onDelete: () => void;
}) {
  const [domain, setDomain] = useState(company?.domain || '');
  const [result, setResult] = useState<EmailResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState({
    background: contact.background || '',
    recentActivity: contact.recentActivity || '',
    hook: contact.hook || '',
    notes: contact.notes || '',
  });
  const [savedFlag, setSavedFlag] = useState(false);

  useEffect(() => {
    if (company?.domain && !domain) setDomain(company.domain);
  }, [company?.domain]);

  async function findEmail() {
    setErr('');
    setFinding(true);
    setResult(null);
    try {
      const data = await api<EmailResult>('/api/email', {
        method: 'POST',
        body: JSON.stringify({ name: contact.name, domain, pattern: company?.emailPattern }),
      });
      setResult(data);
      if (!contact.email && data.candidates[0]) {
        onSave({ email: data.candidates[0], emailStatus: 'guessed', emailCandidates: data.candidates });
      } else {
        onSave({ emailCandidates: data.candidates });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setFinding(false);
    }
  }

  function saveResearch() {
    onSave(draft);
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 1500);
  }

  const links = researchLinks(contact.name, contact.companyName);
  const statusColor: Record<EmailStatus, string> = {
    unknown: 'badge-backup',
    guessed: 'badge-target',
    verified: 'badge-uae',
    bounced: 'badge-status',
  };

  return (
    <div className="card mb">
      <div className="flex spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong>{contact.name}</strong>
          {contact.kind && (
            <span className="badge badge-target" style={{ marginLeft: 8 }}>
              {CONTACT_KIND_LABELS[contact.kind]}
            </span>
          )}
          {contact.hook && (
            <span className="badge badge-uae" style={{ marginLeft: 6 }} title={contact.hook}>
              hook ready
            </span>
          )}
          <span
            className="badge badge-status"
            style={{ marginLeft: 6 }}
            title="Click to advance"
            onClick={() =>
              onSave({
                status:
                  CONTACT_STATUSES[
                    (CONTACT_STATUSES.indexOf(contact.status) + 1) % CONTACT_STATUSES.length
                  ],
              })
            }
          >
            {contact.status}
          </span>
          <div className="muted" style={{ fontSize: 13 }}>
            {contact.role}
            {contact.division ? ` · ${contact.division}` : ''} — {contact.companyName}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {contact.email ? (
              <>
                {contact.email}{' '}
                <span className={`badge ${statusColor[contact.emailStatus || 'unknown']}`}>
                  {contact.emailStatus || 'unknown'}
                </span>
              </>
            ) : (
              <span className="muted">no email yet</span>
            )}
          </div>
        </div>
        <div className="flex">
          <Link
            className="btn small primary"
            href={`/outreach?to=${encodeURIComponent(contact.name)}&email=${encodeURIComponent(
              contact.email || ''
            )}&company=${encodeURIComponent(contact.companyName)}&hook=${encodeURIComponent(
              contact.hook || ''
            )}`}
          >
            ✉ Draft
          </Link>
          <button className="small" onClick={onToggle}>
            {expanded ? 'Close' : 'Research ▾'}
          </button>
          <button className="small danger" onClick={onDelete}>
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
            1 · Find the email
          </h3>
          <div className="form-row">
            <input
              placeholder="Company email domain, e.g. bankfab.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <button className="fixed" onClick={findEmail} disabled={finding || !domain}>
              {finding ? 'Checking…' : 'Find & verify'}
            </button>
          </div>
          {err && <p className="error">{err}</p>}
          {result && (
            <div className="mt">
              <p style={{ fontSize: 13 }}>
                {result.mx.ok ? (
                  <span className="success">
                    ✓ {result.domain} accepts mail ({result.mx.provider})
                  </span>
                ) : (
                  <span className="error">✕ {result.mx.error}</span>
                )}
              </p>
              {result.hunter?.email && (
                <p style={{ fontSize: 13 }} className="success">
                  ✓ Confirmed by Hunter: <strong>{result.hunter.email}</strong>{' '}
                  {result.hunter.score !== undefined && `(${result.hunter.score}% confidence)`}
                </p>
              )}
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Most likely addresses — click to use. If one bounces, try the next.
              </p>
              <div className="flex" style={{ gap: 6, marginTop: 6 }}>
                {result.candidates.slice(0, 6).map((addr) => (
                  <button
                    key={addr}
                    className="small"
                    style={{
                      borderColor: contact.email === addr ? 'var(--accent)' : undefined,
                    }}
                    onClick={() => onSave({ email: addr, emailStatus: 'guessed' })}
                  >
                    {addr}
                  </button>
                ))}
              </div>
              <div className="flex mt" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Mark current:</span>
                <button className="small" onClick={() => onSave({ emailStatus: 'verified' })}>
                  ✓ verified
                </button>
                <button className="small" onClick={() => onSave({ emailStatus: 'bounced' })}>
                  ✕ bounced
                </button>
              </div>
            </div>
          )}

          <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', margin: '18px 0 8px' }}>
            2 · Research them
          </h3>
          <div className="flex" style={{ gap: 6 }}>
            {links.map((l) => (
              <a key={l.label} className="btn small" href={l.url} target="_blank" rel="noreferrer" title={l.hint}>
                {l.label} ↗
              </a>
            ))}
          </div>

          <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', margin: '18px 0 8px' }}>
            3 · Capture what you found
          </h3>
          <div className="form-row">
            <div>
              <label>Background (past employers, education, tenure)</label>
              <input
                value={draft.background}
                onChange={(e) => setDraft({ ...draft, background: e.target.value })}
                placeholder="12 yrs at ENBD before FAB; AUS grad"
              />
            </div>
            <div>
              <label>Recent activity (post, promotion, launch)</label>
              <input
                value={draft.recentActivity}
                onChange={(e) => setDraft({ ...draft, recentActivity: e.target.value })}
                placeholder="Posted about their new data platform in June"
              />
            </div>
          </div>
          <div>
            <label>The hook — the one sentence that proves this isn&apos;t a mass email</label>
            <input
              value={draft.hook}
              onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
              placeholder="Saw your post on rebuilding the risk data platform — that's exactly the problem I worked on at X."
            />
          </div>
          <div className="mt">
            <label>Other notes</label>
            <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          <div className="flex mt">
            <button className="primary" onClick={saveResearch}>
              Save research
            </button>
            {savedFlag && <span className="success">Saved ✓</span>}
            <span className="muted" style={{ fontSize: 12 }}>
              The hook flows straight into the email composer.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
