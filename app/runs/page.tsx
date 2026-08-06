'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { list } from '@/lib/client';
import type { JobSource, RefreshRun } from '@/lib/types';

function when(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Runs() {
  const [runs, setRuns] = useState<RefreshRun[]>([]);
  const [sources, setSources] = useState<JobSource[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([list<RefreshRun>('runs'), list<JobSource>('jobSources')]).then(([r, s]) => {
      setRuns(r);
      setSources(s);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return <p className="muted">Loading…</p>;

  const last = runs[0];
  const last7 = runs.slice(0, 7);
  const totalAdded = runs.reduce((n, r) => n + r.added, 0);
  const health = last
    ? last.failed === 0
      ? 'healthy'
      : last.failed === last.checked
        ? 'all failing'
        : 'partial failures'
    : 'never run';
  const healthColor =
    health === 'healthy' ? 'var(--green)' : health === 'never run' ? 'var(--muted)' : 'var(--amber)';

  const broken = sources.filter((s) => (s.consecutiveFailures || 0) >= 3);

  return (
    <div>
      <h1>Scraper health</h1>
      <p className="subtitle">
        Every refresh run is logged here — so if the scheduled job silently breaks, you find out
        from this page rather than from an empty pipeline.
      </p>

      <div className="grid stat-grid mb">
        <div className="card">
          <div className="stat-value" style={{ color: healthColor, fontSize: 20 }}>
            {health}
          </div>
          <div className="stat-label">Last run status</div>
        </div>
        <div className="card">
          <div className="stat-value">{when(last?.startedAt)}</div>
          <div className="stat-label">Last run</div>
        </div>
        <div className="card">
          <div className="stat-value">{sources.filter((s) => s.enabled).length}</div>
          <div className="stat-label">Active sources</div>
        </div>
        <div className="card">
          <div className="stat-value">{totalAdded}</div>
          <div className="stat-label">Roles imported (logged runs)</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ color: broken.length ? 'var(--red)' : 'var(--green)' }}>
            {broken.length}
          </div>
          <div className="stat-label">Broken sources</div>
        </div>
      </div>

      {broken.length > 0 && (
        <div className="card mb" style={{ borderColor: 'var(--red)' }}>
          <h2 style={{ marginTop: 0 }}>Needs attention</h2>
          <p className="muted mb">
            These have failed 3+ times in a row — the slug is probably wrong or the board moved.
            Fix or pause them on the <Link href="/sources">Sources</Link> page.
          </p>
          <ul style={{ paddingLeft: 18 }}>
            {broken.map((s) => (
              <li key={s.id}>
                <strong>{s.companyName}</strong> ({s.platform}/{s.slug}) — {s.consecutiveFailures}{' '}
                failures: <span className="error">{s.lastError}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {last7.length > 1 && (
        <div className="card mb">
          <h2 style={{ marginTop: 0 }}>Recent activity</h2>
          <div className="flex" style={{ alignItems: 'flex-end', gap: 10, height: 80 }}>
            {[...last7].reverse().map((r) => {
              const max = Math.max(...last7.map((x) => x.added), 1);
              return (
                <div key={r.id} style={{ textAlign: 'center', flex: 1 }}>
                  <div
                    style={{
                      height: `${Math.max((r.added / max) * 60, 2)}px`,
                      background: r.failed ? 'var(--amber)' : 'var(--accent)',
                      borderRadius: 3,
                    }}
                    title={`${r.added} added, ${r.failed} failed`}
                  />
                  <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                    {r.added}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Backup</h2>
        <p className="muted mb">
          Your data lives in a hosted database. Download a copy periodically — it&apos;s a single
          JSON file you can restore from.
        </p>
        <div className="flex">
          <a className="btn primary" href="/api/backup" download>
            ↓ Download backup
          </a>
          <label className="btn" style={{ marginBottom: 0 }}>
            ↑ Restore from file
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!confirm('Restore will REPLACE all current data. Continue?')) {
                  e.target.value = '';
                  return;
                }
                const text = await file.text();
                const res = await fetch('/api/backup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: text,
                });
                const body = await res.json();
                alert(res.ok ? 'Restored. Reloading.' : `Restore failed: ${body.error}`);
                if (res.ok) window.location.reload();
              }}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Trigger</th>
              <th>Checked</th>
              <th>Added</th>
              <th>Updated</th>
              <th>Closed</th>
              <th>Failed</th>
              <th>Duration</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No runs yet. Add sources on the <Link href="/sources">Sources</Link> page and hit
                  &ldquo;Refresh all now&rdquo;.
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{when(r.startedAt)}</td>
                <td>
                  <span className="badge badge-status">{r.trigger}</span>
                </td>
                <td className="muted">{r.checked}</td>
                <td>
                  {r.added > 0 ? <strong className="success">+{r.added}</strong> : <span className="muted">0</span>}
                </td>
                <td className="muted">{r.updated}</td>
                <td className="muted">{r.closed}</td>
                <td className={r.failed ? 'error' : 'muted'}>{r.failed}</td>
                <td className="muted">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 300 }}>
                  {r.errors?.map((e) => `${e.company}: ${e.error}`).join('; ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
