'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, create, list, patch, remove } from '@/lib/client';
import { PLATFORM_DEFS, getPlatform } from '@/lib/ats';
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
  skipped: number;
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
  const [extra, setExtra] = useState<Record<string, string>>({});

  const [discoverName, setDiscoverName] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState<Discovered[] | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [err, setErr] = useState('');

  const [aggregators, setAggregators] = useState<
    Array<{ id: string; label: string; configured: boolean; envKeys: string[]; signupUrl: string; freeTier: string }>
  >([]);
  const [aggId, setAggId] = useState('themuse');
  const [aggQuery, setAggQuery] = useState('');
  const [aggLocation, setAggLocation] = useState('Dubai, United Arab Emirates');
  const [aggBusy, setAggBusy] = useState(false);
  const [aggMsg, setAggMsg] = useState('');

  const [sweeping, setSweeping] = useState(false);
  const [sweepLog, setSweepLog] = useState<string[]>([]);
  // A ref, not state: the sweep loop closes over its variables once, so a
  // state value would stay false for the whole run and the button would do
  // nothing.
  const stopRequested = useRef(false);
  const [needsSetup, setNeedsSetup] = useState<string[]>([]);

  useEffect(() => {
    list<JobSource>('jobSources').then(setSources);
    list<Company>('companies').then(setCompanies);
    api<{ aggregators: typeof aggregators }>('/api/aggregators')
      .then((r) => {
        setAggregators(r.aggregators);
        const firstReady = r.aggregators.find((a) => a.configured);
        if (firstReady) setAggId(firstReady.id);
      })
      .catch(() => {});
  }, []);

  async function addSource(fields: Partial<JobSource>) {
    const item = await create<JobSource>('jobSources', { enabled: true, ...fields });
    setSources((prev) => [item, ...prev]);
    return item;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.companyName || !form.slug) return;
    const def = getPlatform(form.platform);
    const missing = (def?.fields || []).filter((f) => f.required && !extra[f.key]);
    if (missing.length) {
      setErr(`${def?.label} also needs: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setErr('');
    await addSource({ ...form, config: Object.keys(extra).length ? extra : undefined });
    setForm({ companyName: '', platform: 'greenhouse', slug: '', keywords: '' });
    setExtra({});
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

  /** Walks the company list in batches, registering every board it finds. */
  async function sweepAll() {
    setSweeping(true);
    stopRequested.current = false;
    setSweepLog([]);
    setErr('');
    let offset = 0;
    let totalFound = 0;
    let totalScanned = 0;

    try {
      for (;;) {
        const res = await api<{
          scanned: number;
          found: Array<{ company: string; platform: string; slug: string; jobCount: number }>;
          nextOffset: number;
          remaining: number;
        }>('/api/discover/bulk', { method: 'POST', body: JSON.stringify({ offset, limit: 8 }) });

        totalScanned += res.scanned;
        totalFound += res.found.length;
        for (const f of res.found) {
          setSweepLog((l) => [`✓ ${f.company} — ${f.platform}/${f.slug} (${f.jobCount} roles)`, ...l]);
        }
        setSweepLog((l) => [
          `… scanned ${totalScanned}, found ${totalFound}, ${res.remaining} left`,
          ...l.filter((x) => !x.startsWith('…')),
        ]);

        if (res.scanned === 0 || res.remaining === 0) break;
        if (stopRequested.current) {
          setSweepLog((l) => ['— stopped', ...l]);
          break;
        }
        // Companies that matched became sources, so they drop out of the
        // queue the server recomputes — rewind past exactly those.
        offset = res.nextOffset - res.found.length;
      }
      setSources(await list<JobSource>('jobSources'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sweep failed');
    } finally {
      setSweeping(false);
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
              {report.skipped > 0 && (
                <span className="muted">
                  {' '}
                  · {report.skipped} left for the next run (time budget)
                </span>
              )}
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
        <h2 style={{ marginTop: 0 }}>Auto-discover boards for every company</h2>
        <p className="muted mb">
          Sweeps your whole <Link href="/companies">company list</Link>, probing all six ATS
          platforms for each one, and registers every board it finds. Companies already tracked are
          skipped. Runs in batches — leave the page open while it works.
        </p>
        <div className="flex">
          <button
            className="primary"
            disabled={sweeping}
            onClick={async () => {
              setErr('');
              try {
                const r = await api<{ added: number; unsupported: string[] }>(
                  '/api/sources/from-companies',
                  { method: 'POST' }
                );
                setNeedsSetup(r.unsupported);
                setSweepLog([`✓ Registered ${r.added} sources from known ATS data`]);
                setSources(await list<JobSource>('jobSources'));
              } catch {
                setErr('Could not register known sources.');
              }
            }}
          >
            Add known boards (instant)
          </button>
          <button onClick={sweepAll} disabled={sweeping}>
            {sweeping ? 'Sweeping…' : 'Probe the rest'}
          </button>
          {sweeping && (
            <button onClick={() => { stopRequested.current = true; }}>Stop after this batch</button>
          )}
        </div>
        {sweepLog.length > 0 && (
          <div
            className="mt"
            style={{ maxHeight: 220, overflowY: 'auto', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
          >
            {sweepLog.map((line, i) => (
              <div key={i} className={line.startsWith('✓') ? 'success' : 'muted'}>
                {line}
              </div>
            ))}
          </div>
        )}
        {needsSetup.length > 0 && (
          <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <p style={{ fontSize: 13 }}>
              <strong>{needsSetup.length} companies need a few details added by hand.</strong>{' '}
              These run on enterprise systems where the board address can&apos;t be derived from the
              company name — Workday needs a data-centre number and site name, Oracle needs a host
              and site number, both visible in the careers page URL. Add them below and they poll
              like any other source. Phenom, Taleo, SuccessFactors and iCIMS have no supported
              public feed yet; use their careers link on the{' '}
              <Link href="/companies">Companies</Link> page instead.
            </p>
            <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 12 }} className="muted">
              {needsSetup.map((u) => (
                <div key={u}>{u}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Search job aggregators</h2>
        <p className="muted mb">
          Aggregators cover the whole UAE market rather than one company&apos;s board — they surface
          roles at employers you haven&apos;t thought to track. The Muse works with no setup; the
          others need a free API key set as an environment variable.
        </p>
        <div className="form-row">
          <select className="fixed" value={aggId} onChange={(e) => setAggId(e.target.value)}>
            {aggregators.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.configured}>
                {a.label} {a.configured ? '' : `(needs ${a.envKeys.join(' + ')})`}
              </option>
            ))}
          </select>
          <input
            placeholder="Keywords, e.g. data analyst"
            value={aggQuery}
            onChange={(e) => setAggQuery(e.target.value)}
          />
          <input
            placeholder="Location"
            value={aggLocation}
            onChange={(e) => setAggLocation(e.target.value)}
          />
          <button
            className="primary fixed"
            disabled={aggBusy || !aggregators.find((a) => a.id === aggId)?.configured}
            onClick={async () => {
              setAggBusy(true);
              setErr('');
              setAggMsg('');
              try {
                const r = await api<{ added: number; found: number }>('/api/aggregators', {
                  method: 'POST',
                  body: JSON.stringify({ id: aggId, query: aggQuery, location: aggLocation }),
                });
                setAggMsg(`Found ${r.found}, imported ${r.added} new.`);
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'Search failed');
              } finally {
                setAggBusy(false);
              }
            }}
          >
            {aggBusy ? 'Searching…' : 'Search & import'}
          </button>
        </div>
        {aggMsg && <p className="success">{aggMsg}</p>}
        {aggregators.some((a) => !a.configured) && (
          <p className="muted" style={{ fontSize: 12 }}>
            To enable the rest, get a free key and add it in Vercel → Settings → Environment
            Variables:{' '}
            {aggregators
              .filter((a) => !a.configured)
              .map((a) => (
                <span key={a.id}>
                  <a href={a.signupUrl} target="_blank" rel="noreferrer">
                    {a.label}
                  </a>{' '}
                  ({a.freeTier}){' '}
                </span>
              ))}
          </p>
        )}
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Find one company&apos;s job board</h2>
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
            onChange={(e) => {
              setForm({ ...form, platform: e.target.value });
              setExtra({});
            }}
          >
            {PLATFORM_DEFS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            placeholder="Board slug / tenant"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
          {(getPlatform(form.platform)?.fields || []).map((f) => (
            <input
              key={f.key}
              placeholder={`${f.label} (${f.placeholder})`}
              value={extra[f.key] || ''}
              onChange={(e) => setExtra({ ...extra, [f.key]: e.target.value })}
            />
          ))}
          <input
            placeholder="Filter keywords (optional), e.g. dubai, analyst"
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
          <button className="primary fixed" type="submit">
            Add
          </button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {getPlatform(form.platform)?.hint}
        </p>
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
