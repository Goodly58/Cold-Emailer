'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { list, patch } from '@/lib/client';
import { statsByTemplate, type TemplateStats } from '@/lib/outreach';
import type { Outreach, Template } from '@/lib/types';

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [stats, setStats] = useState<Map<string, TemplateStats>>(new Map());

  useEffect(() => {
    list<Template>('templates').then(setTemplates);
    list<Outreach>('outreach').then((o) => setStats(statsByTemplate(o)));
  }, []);

  async function saveTemplate(t: Template) {
    const updated = await patch<Template>('templates', t.id, { subject: t.subject, body: t.body });
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
    setEditing(null);
  }

  function updateLocal(id: string, field: 'subject' | 'body', value: string) {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }

  return (
    <div>
      <h1>Email templates</h1>
      <p className="subtitle">
        Merge fields: <code>{'{{firstName}}'}</code> <code>{'{{company}}'}</code>{' '}
        <code>{'{{role}}'}</code> <code>{'{{hook}}'}</code> <code>{'{{myName}}'}</code>{' '}
        <code>{'{{headline}}'}</code> <code>{'{{linkedin}}'}</code> <code>{'{{phone}}'}</code>{' '}
        <code>{'{{event}}'}</code>
      </p>

      <p className="muted mb" style={{ fontSize: 13 }}>
        Your name, headline, LinkedIn and phone come from your{' '}
        <Link href="/profile">Profile</Link>.
      </p>

      {templates.map((t) => (
        <div className="card mb" key={t.id}>
          <div className="flex spread">
            <h2 style={{ margin: 0 }}>
              {t.name} <span className="badge badge-status">{t.category}</span>{' '}
              {stats.get(t.id) && (
                <span
                  className={`badge ${stats.get(t.id)!.rate >= 15 ? 'badge-uae' : 'badge-backup'}`}
                  title="Replies out of emails sent from this template"
                >
                  {stats.get(t.id)!.rate}% replies · {stats.get(t.id)!.sent} sent
                </span>
              )}
            </h2>
            {editing === t.id ? (
              <button className="primary small" onClick={() => saveTemplate(t)}>
                Save
              </button>
            ) : (
              <button className="small" onClick={() => setEditing(t.id)}>
                Edit
              </button>
            )}
          </div>
          {editing === t.id ? (
            <div className="mt">
              <label>Subject</label>
              <input value={t.subject} onChange={(e) => updateLocal(t.id, 'subject', e.target.value)} />
              <label className="mt" style={{ display: 'block' }}>
                Body
              </label>
              <textarea value={t.body} onChange={(e) => updateLocal(t.id, 'body', e.target.value)} />
            </div>
          ) : (
            <div className="mt">
              <p>
                <strong>Subject:</strong> {t.subject}
              </p>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  color: 'var(--muted)',
                  marginTop: 8,
                }}
              >
                {t.body}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
