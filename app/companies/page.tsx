'use client';

import { useEffect, useState } from 'react';
import { api, create, list, patch, remove } from '@/lib/client';
import { PATTERN_ORDER, divisionsForSector, generateCandidates } from '@/lib/email-finder';
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);

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
      const { added, enriched } = await api<{ added: number; enriched: number }>(
        '/api/sync-companies',
        { method: 'POST' }
      );
      const parts = [];
      if (added) parts.push(`added ${added}`);
      if (enriched) parts.push(`enriched ${enriched}`);
      setSyncMsg(parts.length ? `Synced: ${parts.join(', ')}.` : 'Already up to date.');
      if (added || enriched) setCompanies(await list<Company>('companies'));
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
        {companies.length} UAE employers that are quota-liable or run active Emiratisation
        programs, across all seven emirates. Click a tier badge to cycle Dream → Target → Backup,
        use the LinkedIn links to find who to email, and <em>Setup</em> to set a company&apos;s
        email domain and divisions.
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
            {shown.slice(0, limit).map((c) => (
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
                  <div className="flex">
                    <button className="small" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                      {openId === c.id ? 'Close' : 'Setup ▾'}
                    </button>
                    <button className="small danger" onClick={() => del(c.id)}>
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > limit && (
          <button className="mt" style={{ width: '100%' }} onClick={() => setLimit(limit + 60)}>
            Show 60 more of {shown.length - limit}
          </button>
        )}
      </div>

      {openId && (
        <CompanySetup
          company={companies.find((c) => c.id === openId)!}
          onSave={async (fields) => {
            const updated = await patch<Company>('companies', openId, fields);
            setCompanies((prev) => prev.map((x) => (x.id === openId ? updated : x)));
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** Per-company setup: email domain + pattern (unlocks email finding for every
 *  contact there) and the division list (big employers hire per business unit). */
function CompanySetup({
  company,
  onSave,
  onClose,
}: {
  company: Company;
  onSave: (fields: Partial<Company>) => Promise<void>;
  onClose: () => void;
}) {
  const [domain, setDomain] = useState(company.domain || '');
  const [pattern, setPattern] = useState(company.emailPattern || 'first.last');
  const [divisions, setDivisions] = useState<string[]>(company.divisions || []);
  const [newDivision, setNewDivision] = useState('');
  const [saved, setSaved] = useState(false);

  const suggestions = divisionsForSector(company.sector).filter((d) => !divisions.includes(d));
  const preview = domain ? generateCandidates('Sara Al Mansoori', domain, pattern)[0] : '';

  async function persist(next?: Partial<Company>) {
    await onSave({ domain: domain.trim() || undefined, emailPattern: pattern, divisions, ...next });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="card mt" style={{ borderColor: 'var(--accent)' }}>
      <div className="flex spread">
        <h2 style={{ margin: 0 }}>{company.name} — setup</h2>
        <button className="small" onClick={onClose}>
          Close
        </button>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', margin: '14px 0 8px' }}>
        Email domain & pattern
      </h3>
      <p className="muted mb" style={{ fontSize: 13 }}>
        Set these once and every contact at this company gets accurate email guesses. Find the
        pattern from any public address on their website, or from a contact whose email you know.
      </p>
      <div className="form-row">
        <div>
          <label>Email domain</label>
          <input placeholder="bankfab.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </div>
        <div>
          <label>Pattern</label>
          <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
            {PATTERN_ORDER.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Preview</label>
          <input readOnly value={preview || '—'} className="muted" />
        </div>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', margin: '18px 0 8px' }}>
        Divisions ({divisions.length})
      </h3>
      <p className="muted mb" style={{ fontSize: 13 }}>
        Large UAE employers hire per business unit with separate managers and budgets. Track them
        so you email the right person — a Retail Banking manager can&apos;t hire you into Treasury.
      </p>
      <div className="flex mb" style={{ gap: 6 }}>
        {divisions.map((d) => (
          <span key={d} className="badge badge-target">
            {d}{' '}
            <span
              style={{ cursor: 'pointer', opacity: 0.7 }}
              onClick={() => setDivisions(divisions.filter((x) => x !== d))}
            >
              ✕
            </span>
          </span>
        ))}
        {divisions.length === 0 && <span className="muted">None yet.</span>}
      </div>
      <div className="form-row">
        <input
          placeholder="Add a division…"
          value={newDivision}
          onChange={(e) => setNewDivision(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newDivision.trim()) {
              e.preventDefault();
              setDivisions([...divisions, newDivision.trim()]);
              setNewDivision('');
            }
          }}
        />
        <button
          className="fixed"
          onClick={() => {
            if (newDivision.trim()) {
              setDivisions([...divisions, newDivision.trim()]);
              setNewDivision('');
            }
          }}
        >
          Add
        </button>
        <button className="fixed" onClick={() => setDivisions(divisionsForSector(company.sector))}>
          Use {company.sector} preset
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="mt">
          <span className="muted" style={{ fontSize: 12 }}>Suggested: </span>
          {suggestions.slice(0, 8).map((d) => (
            <button
              key={d}
              className="small"
              style={{ margin: '0 4px 4px 0' }}
              onClick={() => setDivisions([...divisions, d])}
            >
              + {d}
            </button>
          ))}
        </div>
      )}

      <div className="flex mt">
        <button className="primary" onClick={() => persist()}>
          Save setup
        </button>
        {saved && <span className="success">Saved ✓</span>}
      </div>
    </div>
  );
}
