'use client';

import { useEffect, useState } from 'react';
import { api, create, list, patch, remove } from '@/lib/client';
import type { Company, Tier } from '@/lib/types';

const TIERS: Tier[] = ['dream', 'target', 'backup'];

// LinkedIn deep links — open pre-filled searches in the user's own browser
// session. This is the ToS-clean way to "connect" LinkedIn: no automation,
// no scraping, just one-click navigation.
function linkedinPeopleUrl(company: string): string {
  const keywords = `"${company}" talent acquisition OR recruiter OR "hiring manager" OR emiratisation`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

function linkedinJobsUrl(company: string): string {
  return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(company)}&location=${encodeURIComponent('United Arab Emirates')}`;
}

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [location, setLocation] = useState('');
  const [tier, setTier] = useState<Tier>('target');
  const [emiratisation, setEmiratisation] = useState(true);
  const [filter, setFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => {
    list<Company>('companies').then(setCompanies);
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    const item = await create<Company>('companies', { name, sector, location, tier, emiratisation });
    setCompanies((prev) => [item, ...prev]);
    setName('');
    setSector('');
    setLocation('');
  }

  async function cycleTier(c: Company) {
    const next = TIERS[(TIERS.indexOf(c.tier) + 1) % TIERS.length];
    const updated = await patch<Company>('companies', c.id, { tier: next });
    setCompanies((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
  }

  async function del(id: string) {
    await remove('companies', id);
    setCompanies((prev) => prev.filter((c) => c.id !== id));
  }

  async function syncStarterList() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { added } = await api<{ added: number }>('/api/sync-companies', { method: 'POST' });
      setSyncMsg(added ? `Added ${added} companies.` : 'Already up to date.');
      if (added) setCompanies(await list<Company>('companies'));
    } catch {
      setSyncMsg('Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const shown = companies.filter((c) => {
    const q = filter.toLowerCase();
    const matchesText =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.sector.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q);
    return matchesText && (!tierFilter || c.tier === tierFilter);
  });

  return (
    <div>
      <h1>Target companies</h1>
      <p className="subtitle">
        120 UAE employers that are quota-liable or run active Emiratisation programs. Click a tier
        badge to cycle Dream → Target → Backup, and use the LinkedIn links to find who to email.
      </p>

      <div className="card mb">
        <form onSubmit={handleAdd} className="form-row">
          <input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Sector" value={sector} onChange={(e) => setSector(e.target.value)} />
          <input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <select className="fixed" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="fixed flex" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={emiratisation}
              onChange={(e) => setEmiratisation(e.target.checked)}
            />
            Emiratisation priority
          </label>
          <button className="primary fixed" type="submit">
            Add
          </button>
        </form>
      </div>

      <div className="form-row mb">
        <input
          placeholder="Filter by name, sector or location…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select className="fixed" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All tiers</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t} ({companies.filter((c) => c.tier === t).length})
            </option>
          ))}
        </select>
        <button className="fixed" onClick={syncStarterList} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync starter list'}
        </button>
        <span className="fixed muted" style={{ alignSelf: 'center' }}>
          {syncMsg || `${shown.length} of ${companies.length}`}
        </span>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Sector</th>
              <th>Location</th>
              <th>Tier</th>
              <th>Emiratisation</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {c.careersUrl && (
                      <a href={c.careersUrl} target="_blank" rel="noreferrer">
                        careers ↗
                      </a>
                    )}
                    <a href={linkedinPeopleUrl(c.name)} target="_blank" rel="noreferrer" title="LinkedIn: find TA/recruiters/hiring managers here">
                      in: people ↗
                    </a>
                    <a href={linkedinJobsUrl(c.name)} target="_blank" rel="noreferrer" title="LinkedIn: this company's UAE jobs">
                      in: jobs ↗
                    </a>
                  </div>
                </td>
                <td className="muted">{c.sector}</td>
                <td className="muted">{c.location}</td>
                <td>
                  <span
                    className={`badge badge-${c.tier}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => cycleTier(c)}
                    title="Click to change tier"
                  >
                    {c.tier}
                  </span>
                </td>
                <td>{c.emiratisation ? <span className="badge badge-uae">quota-liable</span> : <span className="muted">—</span>}</td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 280 }}>
                  {c.emiratisationNotes || c.notes || ''}
                </td>
                <td>
                  <button className="small danger" onClick={() => del(c.id)}>
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
