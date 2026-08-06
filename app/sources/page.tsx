'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, create, list, patch, remove } from '@/lib/client';
import { PLATFORMS } from '@/lib/ats';
import type { Company, JobSource } from '@/lib/types';

interface Discovered {
  platform: string;
  slug: string;
  jobCount: number;
}

interface RefreshReport {
  checked: number;
  added: number;
  closed: number;
  failed: number;
  ranAt: string;
  details: Array<{ company: string; added: number; total: number; error?: string }>;
}

function ago(iso?: string): string {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isStale(s: JobSource): boolean {
  if (!s.lastCheckedAt) return true;
  return Date.now() - new Date(s.lastCheckedAt).getTime() > 26 * 3600_000;
}

export default function Sources() {
  const [sources, setSources] = useState<JobSource[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({ companyName: '', platform: 'greenhouse', slug: '', keywords: '' });

  const [discoverName, setDiscoverName] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState<Discovered[] | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    list<JobSource>('jobSources').then(setSources);
    list<Company>('companies').then(setCompanies);
  }, []);

  async function addSource(fields: Partial<JobSource>) {
    const item = await create<JobSource>('jobSources', { enabled: true, ...fields });
    setSources((prev) => [item, ...prev]);
    return item;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.companyName || !form.slug) return;
    await addSource(form);
    setForm({ companyName: '', platform: 'greenhouse', slug: '', keywords: '' });
  }

  async function runDiscover(e: React.FormEvent) {
    e.preventDefault();
    setDiscovering(true);
    setFound(null);
    setErr('');
    try {
      const { boards } = await api<{ boards: Discovered[] }>(
        `/api/discover?company=${encodeURIComponent(discoverName)}`
      );
      setFound(boards);
    } catch {
      setErr('Discovery failed.');
    } finally {
      setDiscovering(false);
    }
  }

  async function refresh(sourceId?: string) {
    setRefreshing(true);
    setErr('');
    setReport(null);
    try {
      const data = await api<RefreshReport>(
        `/api/cron/refresh${sourceId ? `?sourceId=${sourceId}` : ''}`,
        { method: 'POST' }
      );
      setReport(data);
      setSources(await list<JobSource>('jobSources'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function toggle(s: JobSource) {
    const updated = await patch<JobSource>('jobSources', s.id, { enabled: !s.enabled });
    setSources((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
  }

  async function del(id: string) {
    await remove('jobSources', id);
    setSources((prev) => prev.filter((s) => s.id !== id));
  }

  const staleCount = sources.filter((s) => s.enabled && isStale(s)).length;

  return (
    <div>
      <h1>Job sources</h1>
      <p className="subtitle">
        Each source is a company&apos;s live job board. They refresh automatically every day at
        08:00 UAE time, adding new roles to your <Link href="/pipeline">pipeline</Link> and marking
        filled ones closed.
      </p>

      <div className="card mb">
        <div className="flex spread">
          <div>
            <div className="stat-value">{sources.filter((s) => s.enabled).length}</div>
            <div className="stat-label">Active sources</div>
          </div>
          <div>
            <div className="stat-value" style={{ color: staleCount ? 'var(--amber)' : 'var(--green)' }}>
              {staleCount}
            </div>
            <div className="stat-label">Stale (&gt;26h)</div>
          </div>
          <div className="flex">
            <button className="primary" onClick={() => refresh()} disabled={refreshing || !sources.length}>
              {refreshing ? 'Refreshing…' : 'Refresh all now'}
            </button>
          </div>
        </div>
        {err && <p className="error mt">{err}</p>}
        {report && (
          <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <p>
              <span className="success">
                Checked {report.checked} · added {report.added} new roles
              </span>
              {report.closed > 0 && <span className="muted"> · {report.closed} closed</span>}
              {report.failed > 0 && <span className="error"> · {report.failed} failed</span>}
            </p>
            <ul style={{ paddingLeft: 18, marginTop: 6 }}>
              {report.details.map((d, i) => (
                <li key={i} className="muted" style={{ fontSize: 13 }}>
                  {d.company}: {d.error ? <span className="error">{d.error}</span> : `${d.total} open, ${d.added} new`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Find a company&apos;s job board</h2>
        <p className="muted mb">
          Don&apos;t know which system a company uses? Type the name and this tries all six
          platforms to find their board automatically.
        </p>
        <form onSubmit={runDiscover} className="form-row">
          <input
            list="company-names"
            placeholder="Company name, e.g. Careem"
            value={discoverName}
            onChange={(e) => setDiscoverName(e.target.value)}
          />
          <datalist id="company-names">
            {companies.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <button className="primary fixed" type="submit" disabled={discovering || !discoverName}>
            {discovering ? 'Searching…' : 'Find board'}
          </button>
        </form>
        {found && (
          <div className="mt">
            {found.length === 0 ? (
              <p className="muted">
                No public board found. Big UAE corporates (banks, ADNOC) run Oracle/SAP portals with
                no public feed — use their careers link on the{' '}
                <Link href="/companies">Companies</Link> page instead.
              </p>
            ) : (
              found.map((b) => (
                <div key={`${b.platform}-${b.slug}`} className="flex mb">
                  <span className="badge badge-uae">{b.platform}</span>
                  <code>{b.slug}</code>
                  <span className="muted">{b.jobCount} open roles</span>
                  <button
                    className="small"
                    onClick={async () => {
                      await addSource({
                        companyName: discoverName,
                        platform: b.platform,
                        slug: b.slug,
                      });
                      setFound(found.filter((x) => x !== b));
                    }}
                  >
                    + Track this
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Add a source manually</h2>
        <form onSubmit={handleAdd} className="form-row">
          <input
            list="company-names"
            placeholder="Company"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
          <select
            className="fixed"
            value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            placeholder="Board slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
          <input
            placeholder="Filter keywords (optional), e.g. dubai, analyst"
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
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
              <th>Company</th>
              <th>Platform</th>
              <th>Slug</th>
              <th>Filter</th>
              <th>Last checked</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No sources yet. Use &ldquo;Find board&rdquo; above to add your first.
                </td>
              </tr>
            )}
            {sources.map((s) => (
              <tr key={s.id} style={{ opacity: s.enabled ? 1 : 0.5 }}>
                <td>
                  <strong>{s.companyName}</strong>
                </td>
                <td className="muted">{s.platform}</td>
                <td>
                  <code style={{ fontSize: 12 }}>{s.slug}</code>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{s.keywords || 'all'}</td>
                <td className={s.enabled && isStale(s) ? 'error' : 'muted'} style={{ fontSize: 12 }}>
                  {ago(s.lastCheckedAt)}
                </td>
                <td style={{ fontSize: 12 }}>
                  {s.lastError ? (
                    <span className="error">{s.lastError}</span>
                  ) : (
                    <span className="muted">{s.lastResult || '—'}</span>
                  )}
                </td>
                <td>
                  <div className="flex">
                    <button className="small" onClick={() => refresh(s.id)} disabled={refreshing}>
                      ↻
                    </button>
                    <button className="small" onClick={() => toggle(s)}>
                      {s.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button className="small danger" onClick={() => del(s.id)}>
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
