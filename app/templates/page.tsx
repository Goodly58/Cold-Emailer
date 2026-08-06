'use client';

import { useEffect, useState } from 'react';
import { api, list, patch } from '@/lib/client';
import type { Profile, Template } from '@/lib/types';

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profile, setProfile] = useState<Profile>({ name: '', headline: '', phone: '', linkedinUrl: '' });
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    list<Template>('templates').then(setTemplates);
    api<Profile>('/api/profile').then(setProfile);
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    await api<Profile>('/api/profile', { method: 'PATCH', body: JSON.stringify(profile) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

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
      <h1>Templates & profile</h1>
      <p className="subtitle">
        Merge fields: <code>{'{{firstName}}'}</code> <code>{'{{company}}'}</code>{' '}
        <code>{'{{role}}'}</code> <code>{'{{hook}}'}</code> <code>{'{{myName}}'}</code>{' '}
        <code>{'{{headline}}'}</code> <code>{'{{linkedin}}'}</code> <code>{'{{phone}}'}</code>
      </p>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Your profile (fills merge fields)</h2>
        <form onSubmit={saveProfile}>
          <div className="form-row">
            <div>
              <label>Name</label>
              <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </div>
            <div>
              <label>Headline</label>
              <input
                value={profile.headline}
                onChange={(e) => setProfile({ ...profile, headline: e.target.value })}
              />
            </div>
            <div>
              <label>Phone</label>
              <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </div>
            <div>
              <label>LinkedIn URL</label>
              <input
                value={profile.linkedinUrl}
                onChange={(e) => setProfile({ ...profile, linkedinUrl: e.target.value })}
              />
            </div>
          </div>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', margin: '18px 0 8px' }}>
            What you&apos;re looking for
          </h3>
          <p className="muted mb" style={{ fontSize: 13 }}>
            The scraper scores every imported role against this, so the best matches float to the
            top of your pipeline instead of drowning in volume.
          </p>
          <div className="form-row">
            <div>
              <label>Target job titles (comma separated)</label>
              <input
                value={profile.targetTitles || ''}
                onChange={(e) => setProfile({ ...profile, targetTitles: e.target.value })}
                placeholder="data analyst, business analyst, data scientist"
              />
            </div>
            <div>
              <label>Bonus keywords</label>
              <input
                value={profile.targetKeywords || ''}
                onChange={(e) => setProfile({ ...profile, targetKeywords: e.target.value })}
                placeholder="python, sql, banking, strategy"
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Exclude anything containing</label>
              <input
                value={profile.excludeKeywords || ''}
                onChange={(e) => setProfile({ ...profile, excludeKeywords: e.target.value })}
                placeholder="sales, nurse, driver, commission"
              />
            </div>
            <div>
              <label>Target seniority</label>
              <select
                value={profile.targetSeniority ?? ''}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    targetSeniority: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              >
                <option value="">Any</option>
                <option value="0">Intern</option>
                <option value="1">Graduate / Junior</option>
                <option value="2">Mid-level</option>
                <option value="3">Senior</option>
                <option value="4">Manager / Leadership</option>
              </select>
            </div>
          </div>

          <div className="flex mt">
            <button className="primary" type="submit">
              Save profile
            </button>
            {saved && <span className="success">Saved ✓</span>}
          </div>
        </form>
      </div>

      {templates.map((t) => (
        <div className="card mb" key={t.id}>
          <div className="flex spread">
            <h2 style={{ margin: 0 }}>
              {t.name} <span className="badge badge-status">{t.category}</span>
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
