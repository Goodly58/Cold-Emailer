'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { create, list, patch, remove } from '@/lib/client';
import { CONTACT_STATUSES, type Contact, type ContactStatus } from '@/lib/types';

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [form, setForm] = useState({ name: '', role: '', companyName: '', email: '', linkedin: '' });

  useEffect(() => {
    list<Contact>('contacts').then(setContacts);
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.companyName) return;
    const item = await create<Contact>('contacts', { ...form, status: 'identified' });
    setContacts((prev) => [item, ...prev]);
    setForm({ name: '', role: '', companyName: '', email: '', linkedin: '' });
  }

  async function cycleStatus(c: Contact) {
    const next =
      CONTACT_STATUSES[(CONTACT_STATUSES.indexOf(c.status) + 1) % CONTACT_STATUSES.length];
    const updated = await patch<Contact>('contacts', c.id, { status: next as ContactStatus });
    setContacts((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
  }

  async function del(id: string) {
    await remove('contacts', id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div>
      <h1>Decision-makers</h1>
      <p className="subtitle">
        For each dream company, log the hiring manager for your function, the Emiratisation/TA lead,
        and one senior exec. Click a status badge to advance it. UAE corporates mostly use{' '}
        <code>first.last@domain</code> email patterns — verify before sending.
      </p>

      <div className="card mb">
        <form onSubmit={handleAdd} className="form-row">
          <input placeholder="Full name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <input placeholder="Role / title" value={form.role} onChange={(e) => set('role', e.target.value)} />
          <input
            placeholder="Company"
            value={form.companyName}
            onChange={(e) => set('companyName', e.target.value)}
          />
          <input placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <input
            placeholder="LinkedIn URL"
            value={form.linkedin}
            onChange={(e) => set('linkedin', e.target.value)}
          />
          <button className="primary fixed" type="submit">
            Add
          </button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Company</th>
              <th>Email</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No contacts yet. Add the people who can actually hire you.
                </td>
              </tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  {c.linkedin && (
                    <>
                      {' '}
                      <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                        in ↗
                      </a>
                    </>
                  )}
                </td>
                <td className="muted">{c.role}</td>
                <td className="muted">{c.companyName}</td>
                <td className="muted">{c.email || '—'}</td>
                <td>
                  <span className="badge badge-status" onClick={() => cycleStatus(c)} title="Click to advance">
                    {c.status}
                  </span>
                </td>
                <td>
                  <div className="flex">
                    <Link
                      className="btn small"
                      href={`/outreach?to=${encodeURIComponent(c.name)}&email=${encodeURIComponent(
                        c.email || ''
                      )}&company=${encodeURIComponent(c.companyName)}`}
                    >
                      ✉ Draft email
                    </Link>
                    <button className="small danger" onClick={() => del(c.id)}>
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
