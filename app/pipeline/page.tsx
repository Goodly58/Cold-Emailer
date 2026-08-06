'use client';

import { useEffect, useState } from 'react';
import { create, list, patch, remove } from '@/lib/client';
import { STAGES, STAGE_LABELS, type Application, type Stage } from '@/lib/types';

interface ImportedJob {
  title: string;
  location: string;
  url: string;
}

export default function Pipeline() {
  const [apps, setApps] = useState<Application[]>([]);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [url, setUrl] = useState('');
  const [division, setDivision] = useState('');
  const [emirati, setEmirati] = useState(true);

  const [importSource, setImportSource] = useState('greenhouse');
  const [importSlug, setImportSlug] = useState('');
  const [importCompany, setImportCompany] = useState('');
  const [importJobs, setImportJobs] = useState<ImportedJob[] | null>(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    list<Application>('applications').then(setApps);
  }, []);

  async function addApp(fields: Partial<Application>) {
    const item = await create<Application>('applications', {
      stage: 'found',
      emiratiAngle: emirati,
      ...fields,
    });
    setApps((prev) => [item, ...prev]);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!company || !role) return;
    await addApp({
      companyName: company,
      roleTitle: role,
      jobUrl: url || undefined,
      division: division || undefined,
      source: 'manual',
    });
    setCompany('');
    setRole('');
    setUrl('');
    setDivision('');
  }

  async function move(app: Application, dir: 1 | -1) {
    const idx = STAGES.indexOf(app.stage);
    const next = STAGES[idx + dir];
    if (!next) return;
    const patchFields: Partial<Application> = { stage: next };
    if (next === 'applied' && !app.appliedAt) {
      patchFields.appliedAt = new Date().toISOString().slice(0, 10);
      const followup = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      patchFields.nextActionAt = followup;
    }
    const updated = await patch<Application>('applications', app.id, patchFields);
    setApps((prev) => prev.map((a) => (a.id === app.id ? updated : a)));
  }

  async function del(id: string) {
    await remove('applications', id);
    setApps((prev) => prev.filter((a) => a.id !== id));
  }

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setImportError('');
    setImportJobs(null);
    setImporting(true);
    try {
      const res = await fetch(`/api/import?source=${importSource}&slug=${encodeURIComponent(importSlug)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setImportJobs(data.jobs);
      if (!importCompany) setImportCompany(importSlug);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function addImported(job: ImportedJob) {
    await addApp({
      companyName: importCompany || importSlug,
      roleTitle: job.title,
      jobUrl: job.url,
      location: job.location,
      source: importSource,
    });
    setImportJobs((prev) => (prev ? prev.filter((j) => j.url !== job.url) : prev));
  }

  return (
    <div>
      <h1>Application pipeline</h1>
      <p className="subtitle">
        Found → Tailored → Applied → Follow-up → Interview. Moving a card to Applied auto-sets a
        follow-up date 3 days out.
      </p>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Add a role</h2>
        <form onSubmit={handleAdd} className="form-row">
          <input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input placeholder="Role title" value={role} onChange={(e) => setRole(e.target.value)} />
          <input placeholder="Division (optional)" value={division} onChange={(e) => setDivision(e.target.value)} />
          <input placeholder="Job URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <label className="fixed flex" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={emirati}
              onChange={(e) => setEmirati(e.target.checked)}
            />
            UAE / Emirati angle
          </label>
          <button className="primary fixed" type="submit">
            Add
          </button>
        </form>
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Import live openings (public ATS feeds)</h2>
        <p className="muted mb">
          Most tech/startup careers pages run on one of these six ATS platforms. Enter the board
          slug (the company name in their careers URL, e.g. <code>careem</code>) to pull every open
          role — no scraping, these are public APIs. Not sure which ATS a company uses? Open their
          careers page and look at the URL: <code>boards.greenhouse.io/X</code>,{' '}
          <code>jobs.lever.co/X</code>, <code>jobs.ashbyhq.com/X</code>,{' '}
          <code>apply.workable.com/X</code>, <code>jobs.smartrecruiters.com/X</code> — the{' '}
          <code>X</code> is the slug.
        </p>
        <form onSubmit={runImport} className="form-row">
          <select className="fixed" value={importSource} onChange={(e) => setImportSource(e.target.value)}>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
            <option value="workable">Workable</option>
            <option value="smartrecruiters">SmartRecruiters</option>
            <option value="recruitee">Recruitee</option>
          </select>
          <input
            placeholder="Board slug, e.g. careem"
            value={importSlug}
            onChange={(e) => setImportSlug(e.target.value)}
          />
          <input
            placeholder="Company display name (optional)"
            value={importCompany}
            onChange={(e) => setImportCompany(e.target.value)}
          />
          <button className="primary fixed" type="submit" disabled={importing || !importSlug}>
            {importing ? 'Fetching…' : 'Fetch jobs'}
          </button>
        </form>
        {importError && <p className="error">{importError}</p>}
        {importJobs && (
          <div className="mt" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {importJobs.length === 0 ? (
              <p className="muted">No open roles on that board.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Location</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {importJobs.map((j) => (
                    <tr key={j.url}>
                      <td>
                        <a href={j.url} target="_blank" rel="noreferrer">
                          {j.title}
                        </a>
                      </td>
                      <td className="muted">{j.location}</td>
                      <td>
                        <button className="small" onClick={() => addImported(j)}>
                          + Pipeline
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="kanban">
        {STAGES.map((stage) => {
          const cards = apps.filter((a) => a.stage === stage);
          return (
            <div className="kanban-col" key={stage}>
              <h3>
                {STAGE_LABELS[stage]} <span>{cards.length}</span>
              </h3>
              {cards.map((a) => (
                <div className="kanban-card" key={a.id}>
                  <div className="role">
                    {a.jobUrl ? (
                      <a href={a.jobUrl} target="_blank" rel="noreferrer">
                        {a.roleTitle}
                      </a>
                    ) : (
                      a.roleTitle
                    )}
                  </div>
                  <div className="company">
                    {a.companyName}
                    {a.division ? ` · ${a.division}` : ''}
                    {a.location ? ` · ${a.location}` : ''}
                  </div>
                  {a.emiratiAngle && <span className="badge badge-uae">Emirati advantage</span>}
                  {a.nextActionAt && <div className="muted" style={{ fontSize: 12 }}>Next: {a.nextActionAt}</div>}
                  <div className="actions">
                    <button className="small" disabled={stage === STAGES[0]} onClick={() => move(a, -1)}>
                      ◀
                    </button>
                    <button
                      className="small"
                      disabled={stage === STAGES[STAGES.length - 1]}
                      onClick={() => move(a, 1)}
                    >
                      ▶
                    </button>
                    <button className="small danger" onClick={() => del(a.id)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
