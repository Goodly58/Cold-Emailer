'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { EDUCATION_LABELS, EDUCATION_LEVELS } from '@/lib/cv-shared';
import type { Profile } from '@/lib/types';

interface AiStatus {
  configured: boolean;
  model: string;
}

interface CvState {
  hasCv: boolean;
  text: string;
  words: number;
}

const EMPTY: Profile = { name: '', headline: '', phone: '', linkedinUrl: '' };

function list(v?: string[]): string {
  return (v || []).join(', ');
}

function parseList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [cv, setCv] = useState<CvState | null>(null);
  const [saved, setSaved] = useState(false);
  const [skillsText, setSkillsText] = useState('');
  const [langText, setLangText] = useState('');

  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [showCv, setShowCv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cvMsg, setCvMsg] = useState('');
  const [cvErr, setCvErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [p, s, c] = await Promise.all([
      api<Profile>('/api/profile'),
      api<AiStatus>('/api/ai/status').catch(() => ({ configured: false, model: '' })),
      api<CvState>('/api/cv').catch(() => ({ hasCv: false, text: '', words: 0 })),
    ]);
    setProfile(p);
    setSkillsText(list(p.skills));
    setLangText(list(p.languages));
    setAi(s);
    setCv(c);
  }

  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const updated = await api<Profile>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ ...profile, skills: parseList(skillsText), languages: parseList(langText) }),
    });
    setProfile(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function uploadCv(body: FormData | string) {
    setBusy(true);
    setCvErr('');
    setCvMsg('');
    try {
      const res = await fetch('/api/cv', {
        method: 'POST',
        body,
        headers: typeof body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const parts = [`Saved your CV (${data.words} words).`];
      if (data.filled?.length) parts.push(`Filled in: ${data.filled.join(', ')}.`);
      else if (data.usedAi) parts.push('Your profile already had those details, so nothing was overwritten.');
      else parts.push('AI is off, so profile fields weren\'t filled automatically.');
      if (data.usage?.costUsd) parts.push(`AI cost ≈ $${data.usage.costUsd.toFixed(3)}.`);
      setCvMsg(parts.join(' '));
      setPasted('');
      setShowPaste(false);
      await load();
    } catch (e) {
      setCvErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeCv() {
    if (!confirm('Remove your saved CV?')) return;
    await api('/api/cv', { method: 'DELETE' });
    setCvMsg('CV removed.');
    await load();
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <h1>Profile & CV</h1>
      <p className="subtitle">
        Everything here feeds the rest of the app: your details fill email merge fields, your
        preferences rank scraped roles, and your CV is the ground truth the AI works from. It
        tailors from what&apos;s in your CV and never invents experience.
      </p>

      {ai && (
        <div className="card mb" style={{ borderColor: ai.configured ? 'var(--green)' : 'var(--amber)' }}>
          {ai.configured ? (
            <p>
              <span className="badge badge-uae">AI on</span>{' '}
              <span className="muted" style={{ fontSize: 13 }}>
                Using <code>{ai.model}</code>. Fit analysis, tailored CVs and cover letters, email
                drafting, interview prep and event discovery are available.
              </span>
            </p>
          ) : (
            <>
              <p>
                <span className="badge badge-soon">AI off</span>{' '}
                <strong>Switch on the AI features with an Anthropic API key.</strong>
              </p>
              <ol className="muted" style={{ fontSize: 13, paddingLeft: 20, marginTop: 8 }}>
                <li>
                  Create a key at{' '}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                    console.anthropic.com ↗
                  </a>{' '}
                  and add a little credit. Typical use costs a few cents per action.
                </li>
                <li>
                  In Vercel → your project → Settings → Environment Variables, add{' '}
                  <code>ANTHROPIC_API_KEY</code>, then redeploy.
                </li>
              </ol>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Everything else works without it: scraping, ranking, templates, events and
                tracking.
              </p>
            </>
          )}
        </div>
      )}

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Your CV</h2>
        {cv?.hasCv ? (
          <p style={{ fontSize: 13 }}>
            <span className="badge badge-uae">saved</span> {cv.words} words
            {profile.cvSource ? `, from ${profile.cvSource === 'pdf' ? 'a PDF' : 'pasted text'}` : ''}
            {profile.cvUpdatedAt ? `, updated ${new Date(profile.cvUpdatedAt).toLocaleDateString()}` : ''}.{' '}
            <button className="small" onClick={() => setShowCv(!showCv)}>
              {showCv ? 'Hide' : 'View'}
            </button>{' '}
            <button className="small danger" onClick={removeCv}>
              Remove
            </button>
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            No CV yet. Add one to unlock fit analysis, tailoring and personalised emails.
          </p>
        )}
        {showCv && cv?.text && (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 12,
              maxHeight: 320,
              overflowY: 'auto',
              background: 'var(--bg)',
              padding: 12,
              borderRadius: 6,
              marginTop: 8,
            }}
          >
            {cv.text}
          </pre>
        )}

        <div className="flex mt">
          <label className="btn primary" style={{ marginBottom: 0, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Reading…' : cv?.hasCv ? 'Replace with a PDF' : 'Upload PDF'}
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append('file', file);
                uploadCv(form);
              }}
            />
          </label>
          <button onClick={() => setShowPaste(!showPaste)} disabled={busy}>
            {showPaste ? 'Cancel' : 'Paste as text'}
          </button>
          {!ai?.configured && (
            <span className="muted" style={{ fontSize: 12 }}>
              PDF reading needs the AI; pasting works without it.
            </span>
          )}
        </div>
        {showPaste && (
          <div className="mt">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste your whole CV here…"
              style={{ minHeight: 200 }}
            />
            <button
              className="primary mt"
              disabled={busy || pasted.trim().length < 200}
              onClick={() => uploadCv(JSON.stringify({ text: pasted }))}
            >
              Save CV
            </button>
          </div>
        )}
        {cvMsg && <p className="success mt">{cvMsg}</p>}
        {cvErr && <p className="error mt">{cvErr}</p>}
      </div>

      <form onSubmit={save}>
        <div className="card mb">
          <h2 style={{ marginTop: 0 }}>About you</h2>
          <p className="muted mb" style={{ fontSize: 13 }}>
            Fills the <code>{'{{myName}}'}</code>, <code>{'{{headline}}'}</code>,{' '}
            <code>{'{{linkedin}}'}</code> and <code>{'{{phone}}'}</code> merge fields in every email.
          </p>
          <div className="form-row">
            <div>
              <label>Name</label>
              <input value={profile.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label>Headline</label>
              <input
                value={profile.headline}
                onChange={(e) => set('headline', e.target.value)}
                placeholder="Data analyst · 4 yrs · banking"
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Phone</label>
              <input value={profile.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label>LinkedIn URL</label>
              <input value={profile.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Highest qualification (sets your Nafis top-up)</label>
              <select
                value={profile.educationLevel || ''}
                onChange={(e) =>
                  set('educationLevel', (e.target.value || undefined) as Profile['educationLevel'])
                }
              >
                <option value="">Not set</option>
                {EDUCATION_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {EDUCATION_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Years of experience</label>
              <input
                type="number"
                min={0}
                max={50}
                value={profile.yearsExperience ?? ''}
                onChange={(e) =>
                  set('yearsExperience', e.target.value === '' ? undefined : Number(e.target.value))
                }
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Skills (comma separated)</label>
              <input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
            </div>
            <div>
              <label>Languages</label>
              <input
                value={langText}
                onChange={(e) => setLangText(e.target.value)}
                placeholder="Arabic (native), English (fluent)"
              />
            </div>
          </div>
        </div>

        <div className="card mb">
          <h2 style={{ marginTop: 0 }}>What you&apos;re looking for</h2>
          <p className="muted mb" style={{ fontSize: 13 }}>
            Every scraped role is scored against this, so the best matches rise to the top of your{' '}
            <Link href="/pipeline">pipeline</Link> instead of drowning in volume.
          </p>
          <div className="form-row">
            <div>
              <label>Target job titles (comma separated)</label>
              <input
                value={profile.targetTitles || ''}
                onChange={(e) => set('targetTitles', e.target.value)}
                placeholder="data analyst, business analyst, data scientist"
              />
            </div>
            <div>
              <label>Bonus keywords</label>
              <input
                value={profile.targetKeywords || ''}
                onChange={(e) => set('targetKeywords', e.target.value)}
                placeholder="python, sql, banking, strategy"
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Exclude anything containing</label>
              <input
                value={profile.excludeKeywords || ''}
                onChange={(e) => set('excludeKeywords', e.target.value)}
                placeholder="sales, nurse, driver, commission"
              />
            </div>
            <div>
              <label>Target seniority</label>
              <select
                value={profile.targetSeniority ?? ''}
                onChange={(e) =>
                  set('targetSeniority', e.target.value === '' ? undefined : Number(e.target.value))
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
            <div>
              <label title="Compared with the role's pay plus any Nafis top-up you'd qualify for">
                Minimum monthly pay (AED, incl. Nafis)
              </label>
              <input
                type="number"
                min={0}
                step={500}
                value={profile.minMonthlySalary ?? ''}
                onChange={(e) =>
                  set('minMonthlySalary', e.target.value === '' ? undefined : Number(e.target.value))
                }
                placeholder="e.g. 20000"
              />
            </div>
          </div>
        </div>

        <div className="card mb">
          <h2 style={{ marginTop: 0 }}>Outreach</h2>
          <div className="form-row">
            <div style={{ maxWidth: 260 }}>
              <label>Cold emails per day</label>
              <input
                type="number"
                min={1}
                max={100}
                value={profile.dailySendCap ?? 15}
                onChange={(e) => set('dailySendCap', Number(e.target.value) || undefined)}
              />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            10–20 a day keeps quality high and your Gmail account out of spam filters. The Outreach
            page counts against this.
          </p>
        </div>

        <div className="flex mb">
          <button className="primary" type="submit">
            Save profile
          </button>
          {saved && <span className="success">Saved ✓</span>}
        </div>
      </form>
    </div>
  );
}
