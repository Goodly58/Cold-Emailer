'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, create, list, patch, remove } from '@/lib/client';
import { todayLocal } from '@/lib/events';
import { findByName, indexByName } from '@/lib/names';
import type { Fit, Prep } from '@/lib/ai-role';
import { opportunity, type Opportunity } from '@/lib/pay';
import { formatMonthly } from '@/lib/salary';
import { scoreBand } from '@/lib/scoring';
import {
  EMPLOYMENT_LABELS,
  STAGES,
  STAGE_LABELS,
  WORKPLACE_LABELS,
  type Application,
  type Company,
  type Profile,
  type Stage,
  type Workplace,
} from '@/lib/types';

/** Cards rendered per column before "show more" — the scraper can import
 *  hundreds of roles and rendering them all makes the board unusable. */
const PAGE = 25;
const RANKED_PAGE = 50;

type View = 'ranked' | 'board';
type SortKey = 'opportunity' | 'total' | 'pay' | 'newest' | 'fit' | 'employer';

const SORTS: Array<[SortKey, string]> = [
  ['opportunity', 'Best opportunity'],
  ['total', 'Highest pay incl. Nafis'],
  ['pay', 'Highest pay'],
  ['newest', 'Newest'],
  ['fit', 'Best fit'],
  ['employer', 'Best employer'],
];

interface ImportedJob {
  title: string;
  location: string;
  url: string;
  postedAt?: string;
  workplace?: Workplace;
  salary?: { minMonthlyAed?: number; maxMonthlyAed?: number };
}

interface Row {
  app: Application;
  company?: Company;
  opp: Opportunity;
}

const TIER_RANK = { dream: 3, target: 2, backup: 1 } as const;

function remember<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

function ago(days?: number): string {
  if (days === undefined) return '—';
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export default function Pipeline() {
  const [apps, setApps] = useState<Application[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [view, setView] = useState<View>('ranked');
  const [sort, setSort] = useState<SortKey>('opportunity');

  const [query, setQuery] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyUae, setOnlyUae] = useState(false);
  const [hideClosed, setHideClosed] = useState(true);
  const [openOnly, setOpenOnly] = useState(true);
  const [minPay, setMinPay] = useState('');
  const [postedWithin, setPostedWithin] = useState('');
  const [workplace, setWorkplace] = useState<'' | Workplace>('');
  const [statedPayOnly, setStatedPayOnly] = useState(false);
  const [hideInternships, setHideInternships] = useState(false);

  const [shown, setShown] = useState<Record<string, number>>({});
  const [rankedShown, setRankedShown] = useState(RANKED_PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setView(remember<View>('pipeline.view', 'ranked'));
    setSort(remember<SortKey>('pipeline.sort', 'opportunity'));
    // ?open=<id> (from Overview's next actions) pins and expands one role.
    const open = new URLSearchParams(window.location.search).get('open');
    if (open) {
      setFocusId(open);
      setExpanded(open);
      setView('ranked');
    }
    (async () => {
      const [a, c, p, ai] = await Promise.all([
        list<Application>('applications'),
        list<Company>('companies'),
        api<Profile>('/api/profile'),
        api<{ configured: boolean }>('/api/ai/status').catch(() => ({ configured: false })),
      ]);
      setApps(a);
      setCompanies(c);
      setProfile(p);
      setAiOn(ai.configured);
      if (p.minMonthlySalary) setMinPay(String(p.minMonthlySalary));
      setLoaded(true);
    })();
  }, []);

  const today = todayLocal();
  const companyIndex = useMemo(() => indexByName(companies), [companies]);

  const rows: Row[] = useMemo(() => {
    if (!profile) return [];
    return apps
      .filter((a) => !a.dismissed)
      .map((app) => {
        const company = findByName(companyIndex, app.companyName);
        return { app, company, opp: opportunity(app, profile, company, today) };
      });
  }, [apps, companyIndex, profile, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const floor = Number(minPay) || 0;
    const within = Number(postedWithin) || 0;
    return rows.filter(({ app: a, opp }) => {
      if (onlyNew && !a.isNew) return false;
      if (onlyUae && !a.emiratiAngle) return false;
      if (hideClosed && a.closed) return false;
      if (workplace && a.workplace !== workplace) return false;
      if (statedPayOnly && (!opp.pay || opp.pay.basis === 'estimate')) return false;
      if (hideInternships && (a.employmentType === 'internship' || opp.pay?.level === 0)) return false;
      if (within && (opp.ageDays === undefined || opp.ageDays > within)) return false;
      // Unknown pay passes the floor: most UAE postings don't state it.
      if (floor && opp.pay) {
        const best = opp.pay.high + (opp.nafis.eligible ? opp.nafis.amount ?? 0 : 0);
        if (best < floor) return false;
      }
      if (!q) return true;
      return (
        a.roleTitle.toLowerCase().includes(q) ||
        a.companyName.toLowerCase().includes(q) ||
        (a.division || '').toLowerCase().includes(q) ||
        (a.location || '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, onlyNew, onlyUae, hideClosed, workplace, statedPayOnly, hideInternships, postedWithin, minPay]);

  const ranked = useMemo(() => {
    const open = openOnly ? filtered.filter((r) => r.app.stage === 'found' || r.app.stage === 'tailored') : filtered;
    const key = (r: Row): number => {
      switch (sort) {
        case 'total':
          return r.opp.totalMid ?? -1;
        case 'pay':
          return r.opp.pay?.mid ?? -1;
        case 'newest':
          return r.opp.ageDays === undefined ? -1e9 : -r.opp.ageDays;
        case 'fit':
          return r.app.score ?? -1;
        case 'employer':
          return (r.company ? TIER_RANK[r.company.tier] * 10 : 0) + (r.company?.emiratisation ? 5 : 0) + r.opp.score / 100;
        default:
          return r.opp.score;
      }
    };
    const sorted = [...open].sort((a, b) => key(b) - key(a) || b.opp.score - a.opp.score);
    const pinned = focusId ? rows.find((r) => r.app.id === focusId) : undefined;
    return pinned ? [pinned, ...sorted.filter((r) => r.app.id !== focusId)] : sorted;
  }, [filtered, sort, openOnly, focusId, rows]);

  const newCount = apps.filter((a) => a.isNew && !a.dismissed).length;

  function replace(updated: Application) {
    setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function setStage(app: Application, next: Stage) {
    const patchFields: Partial<Application> = { stage: next, isNew: false };
    if (next === 'applied' && !app.appliedAt) {
      patchFields.appliedAt = today;
      patchFields.nextActionAt = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    }
    replace(await patch<Application>('applications', app.id, patchFields));
  }

  async function move(app: Application, dir: 1 | -1) {
    const next = STAGES[STAGES.indexOf(app.stage) + dir];
    if (next) await setStage(app, next);
  }

  /** Scraped roles are hidden rather than deleted, so the next refresh doesn't bring them back. */
  async function dismiss(app: Application) {
    if (app.sourceId) {
      await patch<Application>('applications', app.id, { dismissed: true, isNew: false });
      setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, dismissed: true } : a)));
    } else {
      await remove('applications', app.id);
      setApps((prev) => prev.filter((a) => a.id !== app.id));
    }
  }

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Application pipeline</h1>
      <p className="subtitle">
        Every open role, ranked by what it&apos;s worth to you: fit, pay (with your Nafis top-up),
        freshness and employer. Moving a role to Applied sets a follow-up 3 days out.
      </p>

      <div className="card mb">
        <div className="form-row" style={{ marginBottom: 8 }}>
          <div className="fixed flex" role="tablist">
            <button className={view === 'ranked' ? 'primary small' : 'small'} onClick={() => { setView('ranked'); store('pipeline.view', 'ranked'); }}>
              Ranked
            </button>
            <button className={view === 'board' ? 'primary small' : 'small'} onClick={() => { setView('board'); store('pipeline.view', 'board'); }}>
              Board
            </button>
          </div>
          <input
            placeholder="Search role, company, division or location…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {view === 'ranked' && (
            <select className="fixed" style={{ width: 'auto' }} value={sort} onChange={(e) => { setSort(e.target.value as SortKey); store('pipeline.sort', e.target.value); }}>
              {SORTS.map(([k, label]) => (
                <option key={k} value={k}>
                  Sort: {label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex" style={{ fontSize: 13 }}>
          <label className="flex" style={{ marginBottom: 0 }} title="Hides roles whose pay (plus any Nafis top-up) is clearly below this. Roles with unknown pay stay visible.">
            Min AED/mo
            <input type="number" step={1000} min={0} value={minPay} onChange={(e) => setMinPay(e.target.value)} placeholder="any" style={{ width: 100 }} />
          </label>
          <label className="flex" style={{ marginBottom: 0 }}>
            Posted
            <select value={postedWithin} onChange={(e) => setPostedWithin(e.target.value)} style={{ width: 'auto' }}>
              <option value="">any time</option>
              <option value="3">last 3 days</option>
              <option value="7">last week</option>
              <option value="14">last 2 weeks</option>
              <option value="30">last month</option>
            </select>
          </label>
          <label className="flex" style={{ marginBottom: 0 }}>
            Work
            <select value={workplace} onChange={(e) => setWorkplace(e.target.value as '' | Workplace)} style={{ width: 'auto' }}>
              <option value="">any</option>
              <option value="remote">remote</option>
              <option value="hybrid">hybrid</option>
              <option value="onsite">on-site</option>
            </select>
          </label>
          <Check label="Stated pay only" checked={statedPayOnly} onChange={setStatedPayOnly} />
          <Check label="Hide internships" checked={hideInternships} onChange={setHideInternships} />
          <Check label="New only" checked={onlyNew} onChange={setOnlyNew} />
          <Check label="UAE only" checked={onlyUae} onChange={setOnlyUae} />
          <Check label="Hide closed" checked={hideClosed} onChange={setHideClosed} />
          {view === 'ranked' && <Check label="Not yet applied" checked={openOnly} onChange={setOpenOnly} />}
          <span className="muted">
            {view === 'ranked' ? ranked.length : filtered.length} of {rows.length}
          </span>
          {newCount > 0 && (
            <button
              className="small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const targets = apps.filter((a) => a.isNew);
                await Promise.all(targets.map((a) => patch<Application>('applications', a.id, { isNew: false })));
                setApps((prev) => prev.map((a) => (a.isNew ? { ...a, isNew: false } : a)));
                setBusy(false);
              }}
            >
              Mark {newCount} seen
            </button>
          )}
        </div>
        {!profile?.educationLevel && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Set your education on your <Link href="/profile">Profile</Link> to see your exact Nafis
            top-up on each role.
          </p>
        )}
      </div>

      {view === 'ranked' ? (
        <div className="card mb" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th title="Fit (45) + pay (25) + freshness (15) + employer (15). Hover a score for the breakdown.">Score</th>
                <th>Role</th>
                <th title="AED a month. Stated = in the posting; est. = benchmark for the role family and level.">Pay / month</th>
                <th title="Nafis salary top-up for Emiratis in private-sector jobs (framework from Sept 2026)">+ Nafis</th>
                <th>Posted</th>
                <th>Stage</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Nothing matches. Loosen the filters, or add job boards on the{' '}
                    <Link href="/sources">Sources</Link> page.
                  </td>
                </tr>
              )}
              {ranked.slice(0, rankedShown).map((row) => (
                <RankedRow
                  key={row.app.id}
                  row={row}
                  open={expanded === row.app.id}
                  onToggle={() => setExpanded(expanded === row.app.id ? null : row.app.id)}
                  onStage={(s) => setStage(row.app, s)}
                  onDismiss={() => dismiss(row.app)}
                  onUpdate={replace}
                  aiOn={aiOn}
                />
              ))}
            </tbody>
          </table>
          {ranked.length > rankedShown && (
            <div style={{ padding: 12 }}>
              <button className="small" onClick={() => setRankedShown((n) => n + RANKED_PAGE)}>
                Show {Math.min(RANKED_PAGE, ranked.length - rankedShown)} more of {ranked.length - rankedShown}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="kanban mb">
          {STAGES.map((stage) => {
            const all = filtered.filter((r) => r.app.stage === stage).sort((a, b) => b.opp.score - a.opp.score);
            const limit = shown[stage] ?? PAGE;
            const cards = all.slice(0, limit);
            return (
              <div className="kanban-col" key={stage}>
                <h3>
                  {STAGE_LABELS[stage]} <span>{all.length}</span>
                </h3>
                {cards.map(({ app: a, opp }) => (
                  <div className="kanban-card" key={a.id}>
                    <div className="flex spread" style={{ alignItems: 'flex-start', gap: 6 }}>
                      <div className="role">
                        {a.jobUrl ? (
                          <a href={a.jobUrl} target="_blank" rel="noreferrer">
                            {a.roleTitle}
                          </a>
                        ) : (
                          a.roleTitle
                        )}
                      </div>
                      <ScoreBadge opp={opp} />
                    </div>
                    <div className="company">
                      {a.companyName}
                      {a.division ? ` · ${a.division}` : ''}
                      {a.location ? ` · ${a.location}` : ''}
                    </div>
                    <PayLine opp={opp} />
                    {a.isNew && <span className="badge badge-dream">NEW</span>}
                    {a.closed && (
                      <span className="badge badge-backup" title="No longer on the company's board">
                        closed
                      </span>
                    )}
                    {a.emiratiAngle && <span className="badge badge-uae">Emirati advantage</span>}
                    {a.nextActionAt && <div className="muted" style={{ fontSize: 12 }}>Next: {a.nextActionAt}</div>}
                    <div className="actions">
                      <button className="small" disabled={stage === STAGES[0]} onClick={() => move(a, -1)}>
                        ◀
                      </button>
                      <button className="small" disabled={stage === STAGES[STAGES.length - 1]} onClick={() => move(a, 1)}>
                        ▶
                      </button>
                      <button className="small danger" title={a.sourceId ? 'Hide (it won’t be re-imported)' : 'Delete'} onClick={() => dismiss(a)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                {all.length > cards.length && (
                  <button className="small" style={{ width: '100%' }} onClick={() => setShown((s) => ({ ...s, [stage]: limit + PAGE }))}>
                    Show {Math.min(PAGE, all.length - cards.length)} more of {all.length - cards.length}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AddRoles onAdded={(added) => setApps((prev) => [...added, ...prev])} />
    </div>
  );
}

/* ------------------------------------------------------------ components */

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex" style={{ marginBottom: 0, gap: 4 }}>
      <input type="checkbox" style={{ width: 'auto' }} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function ScoreBadge({ opp }: { opp: Opportunity }) {
  const band = scoreBand(opp.score);
  return (
    <span
      className={`badge badge-${band === 'strong' ? 'uae' : band === 'good' ? 'target' : 'backup'}`}
      title={opp.parts.map((p) => `${p.label}: ${p.points}`).join('\n')}
    >
      {opp.score}
    </span>
  );
}

function PayLine({ opp }: { opp: Opportunity }) {
  if (!opp.pay) return null;
  const stated = opp.pay.basis !== 'estimate';
  return (
    <div style={{ fontSize: 12 }} title={opp.pay.notes.join('\n')} className={stated ? 'success' : 'muted'}>
      {stated ? '' : '~'}
      {formatMonthly(opp.pay.low, opp.pay.high)}
      {opp.nafis.eligible && opp.nafis.amount ? ` + Nafis ${opp.nafis.amount.toLocaleString('en-US')}` : ''}
      {stated ? '' : ' est.'}
    </div>
  );
}

function RankedRow({
  row,
  open,
  onToggle,
  onStage,
  onDismiss,
  onUpdate,
  aiOn,
}: {
  row: Row;
  open: boolean;
  onToggle: () => void;
  onStage: (s: Stage) => void;
  onDismiss: () => void;
  onUpdate: (a: Application) => void;
  aiOn: boolean;
}) {
  const { app: a, company, opp } = row;
  const stated = opp.pay && opp.pay.basis !== 'estimate';
  return (
    <>
      <tr style={{ opacity: a.closed ? 0.55 : 1 }}>
        <td>
          <ScoreBadge opp={opp} />
        </td>
        <td style={{ minWidth: 240 }}>
          <div style={{ fontWeight: 600 }}>
            {a.jobUrl ? (
              <a href={a.jobUrl} target="_blank" rel="noreferrer">
                {a.roleTitle}
              </a>
            ) : (
              a.roleTitle
            )}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {a.companyName}
            {company && <span className={`badge badge-${company.tier}`} style={{ marginLeft: 6 }}>{company.tier}</span>}
            {a.location ? ` · ${a.location}` : ''}
          </div>
          <div className="chips" style={{ marginTop: 4 }}>
            {a.isNew && <span className="badge badge-dream">NEW</span>}
            {a.closed && <span className="badge badge-backup">closed</span>}
            {a.workplace && a.workplace !== 'onsite' && <span className="badge badge-target">{WORKPLACE_LABELS[a.workplace]}</span>}
            {a.employmentType && a.employmentType !== 'full-time' && (
              <span className="badge badge-soon">{EMPLOYMENT_LABELS[a.employmentType]}</span>
            )}
            {opp.belowMinimum && <span className="badge badge-backup">below your minimum</span>}
            {a.aiFit !== undefined && (
              <span className={`badge ${a.aiFit >= 70 ? 'badge-uae' : a.aiFit >= 50 ? 'badge-target' : 'badge-backup'}`} title="AI fit against your CV">
                CV fit {a.aiFit}
              </span>
            )}
          </div>
        </td>
        <td style={{ whiteSpace: 'nowrap' }} title={opp.pay?.notes.join('\n')}>
          {opp.pay ? (
            <>
              <div className={stated ? 'success' : ''} style={{ fontSize: 13 }}>
                {formatMonthly(opp.pay.low, opp.pay.high)}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {opp.pay.basis === 'posted' ? 'posted' : opp.pay.basis === 'text' ? 'in the ad' : opp.pay.basis === 'manual' ? 'yours' : 'estimate'}
              </div>
            </>
          ) : (
            <span className="muted">unknown</span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap' }} title={opp.nafis.reason}>
          {opp.nafis.eligible ? (
            opp.nafis.amount ? (
              <span className="success">+{opp.nafis.amount.toLocaleString('en-US')}</span>
            ) : (
              <span className="muted">+4–6k</span>
            )
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="muted" style={{ whiteSpace: 'nowrap' }}>{ago(opp.ageDays)}</td>
        <td>
          <select value={a.stage} onChange={(e) => onStage(e.target.value as Stage)} style={{ width: 'auto', padding: '4px 6px', fontSize: 12 }}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="small" onClick={onToggle}>
            {open ? 'Close' : 'Details'}
          </button>{' '}
          <button className="small danger" title={a.sourceId ? 'Hide (it won’t be re-imported)' : 'Delete'} onClick={onDismiss}>
            ✕
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--panel-2)' }}>
            <RoleDetails row={row} onUpdate={onUpdate} />
            <RoleAi app={row.app} aiOn={aiOn} onUpdate={onUpdate} />
          </td>
        </tr>
      )}
    </>
  );
}

function RoleDetails({ row, onUpdate }: { row: Row; onUpdate: (a: Application) => void }) {
  const { app: a, opp } = row;
  const [jd, setJd] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [payMin, setPayMin] = useState(a.salarySource === 'manual' ? String(a.salaryMin ?? '') : '');
  const [payMax, setPayMax] = useState(a.salarySource === 'manual' ? String(a.salaryMax ?? '') : '');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<{ text: string | null }>(`/api/jd/${a.id}`)
      .then((r) => setJd(r.text))
      .catch(() => setJd(null));
  }, [a.id]);

  async function saveJd() {
    const r = await api<{ application: Application }>(`/api/jd/${a.id}`, {
      method: 'PUT',
      body: JSON.stringify({ text: draft }),
    });
    setJd(draft.trim() || null);
    onUpdate(r.application);
    setMsg('Description saved.');
  }

  async function savePay() {
    const min = Number(payMin) || undefined;
    const max = Number(payMax) || min;
    const updated = await patch<Application>(
      'applications',
      a.id,
      min
        ? { salaryMin: min, salaryMax: max, salarySource: 'manual' }
        : { salaryMin: null, salaryMax: null, salarySource: null, salaryText: null }
    );
    onUpdate(updated);
    setMsg(min ? 'Pay saved.' : 'Cleared.');
  }

  return (
    <div className="split">
      <div>
        <h3 style={{ marginTop: 0 }}>Job description</h3>
        {jd === undefined ? (
          <p className="muted">Loading…</p>
        ) : jd ? (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, maxHeight: 360, overflowY: 'auto', margin: 0 }}>{jd}</pre>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13 }}>
              {a.sourceId
                ? 'Not saved yet — the next refresh fetches it from the board. Or paste it now:'
                : 'Paste the description to get pay picked up and to use AI tailoring on this role:'}
            </p>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} placeholder="Paste the full job description…" />
            <button className="small primary mt" disabled={draft.trim().length < 50} onClick={saveJd}>
              Save description
            </button>
          </>
        )}
      </div>
      <div style={{ fontSize: 13 }}>
        <h3 style={{ marginTop: 0 }}>Why it ranks here</h3>
        <ul style={{ paddingLeft: 18, margin: '0 0 12px' }}>
          {opp.parts.map((p) => (
            <li key={p.label}>
              {p.label}: <strong>{p.points}</strong>
            </li>
          ))}
        </ul>
        {opp.pay && (
          <p className="muted">
            Pay: {opp.pay.notes.join('; ')}.
          </p>
        )}
        <p className="muted">Nafis: {opp.nafis.reason}.</p>
        {a.scoreReasons?.length ? <p className="muted">Fit: {a.scoreReasons.join(' · ')}</p> : null}
        {a.altUrls?.length ? (
          <p className="muted">
            Also listed at:{' '}
            {a.altUrls.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>
                link {i + 1}
              </a>
            ))}
          </p>
        ) : null}
        <label className="mt" style={{ display: 'block' }}>
          Know the real pay? (AED/month)
        </label>
        <div className="flex">
          <input type="number" placeholder="min" value={payMin} onChange={(e) => setPayMin(e.target.value)} style={{ width: 90 }} />
          <input type="number" placeholder="max" value={payMax} onChange={(e) => setPayMax(e.target.value)} style={{ width: 90 }} />
          <button className="small" onClick={savePay}>
            Save
          </button>
        </div>
        {msg && <p className="success">{msg}</p>}
      </div>
    </div>
  );
}

function AddRoles({ onAdded }: { onAdded: (apps: Application[]) => void }) {
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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!company || !role) return;
    const item = await create<Application>('applications', {
      stage: 'found',
      emiratiAngle: emirati,
      companyName: company,
      roleTitle: role,
      jobUrl: url || undefined,
      division: division || undefined,
      source: 'manual',
    });
    onAdded([item]);
    setCompany('');
    setRole('');
    setUrl('');
    setDivision('');
  }

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setImportError('');
    setImportJobs(null);
    setImporting(true);
    try {
      const data = await api<{ jobs: ImportedJob[] }>(`/api/import?source=${importSource}&slug=${encodeURIComponent(importSlug)}`);
      setImportJobs(data.jobs);
      if (!importCompany) setImportCompany(importSlug);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function addImported(jobs: ImportedJob[]) {
    setImportError('');
    try {
      const r = await api<{ added: Application[]; existing: number }>('/api/import', {
        method: 'POST',
        body: JSON.stringify({ source: importSource, slug: importSlug, companyName: importCompany || importSlug, urls: jobs.map((j) => j.url) }),
      });
      onAdded(r.added);
      const done = new Set(jobs.map((j) => j.url));
      setImportJobs((prev) => (prev ? prev.filter((j) => !done.has(j.url)) : prev));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <details className="card mb">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add roles by hand or from one board</summary>
      <h3>Add a role</h3>
      <form onSubmit={handleAdd} className="form-row">
        <input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
        <input placeholder="Role title" value={role} onChange={(e) => setRole(e.target.value)} />
        <input placeholder="Division (optional)" value={division} onChange={(e) => setDivision(e.target.value)} />
        <input placeholder="Job URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <label className="fixed flex" style={{ marginBottom: 0 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={emirati} onChange={(e) => setEmirati(e.target.checked)} />
          UAE / Emirati angle
        </label>
        <button className="primary fixed" type="submit">
          Add
        </button>
      </form>

      <h3>Import from one board</h3>
      <p className="muted mb" style={{ fontSize: 13 }}>
        For a one-off look at a company&apos;s board. To keep a board polled every day, add it on
        the <Link href="/sources">Sources</Link> page instead. The slug is the company part of the
        careers URL: <code>boards.greenhouse.io/X</code>, <code>jobs.lever.co/X</code>,{' '}
        <code>jobs.ashbyhq.com/X</code>, <code>apply.workable.com/X</code>,{' '}
        <code>jobs.smartrecruiters.com/X</code>.
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
        <input placeholder="Board slug, e.g. careem" value={importSlug} onChange={(e) => setImportSlug(e.target.value)} />
        <input placeholder="Company display name (optional)" value={importCompany} onChange={(e) => setImportCompany(e.target.value)} />
        <button className="primary fixed" type="submit" disabled={importing || !importSlug}>
          {importing ? 'Fetching…' : 'Fetch jobs'}
        </button>
      </form>
      {importError && <p className="error">{importError}</p>}
      {importJobs && (
        <div className="mt" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {importJobs.length === 0 ? (
            <p className="muted">No open roles on that board.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Pay</th>
                  <th>
                    <button className="small" onClick={() => addImported(importJobs)}>
                      + Add all {importJobs.length}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {importJobs.map((j) => (
                  <tr key={j.url}>
                    <td>
                      <a href={j.url} target="_blank" rel="noreferrer">
                        {j.title}
                      </a>
                      {j.postedAt && <div className="muted" style={{ fontSize: 11 }}>posted {j.postedAt}</div>}
                    </td>
                    <td className="muted">
                      {j.location}
                      {j.workplace && j.workplace !== 'onsite' ? ` · ${WORKPLACE_LABELS[j.workplace]}` : ''}
                    </td>
                    <td className="muted">{formatMonthly(j.salary?.minMonthlyAed, j.salary?.maxMonthlyAed) || '—'}</td>
                    <td>
                      <button className="small" onClick={() => addImported([j])}>
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
    </details>
  );
}

/* ------------------------------------------------------------- AI panel */

type Saved<T> = T & { generatedAt: string; usage?: { costUsd: number }; usedCv?: boolean; usedJd?: boolean; searches?: number };

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

function RoleAi({ app, aiOn, onUpdate }: { app: Application; aiOn: boolean; onUpdate: (a: Application) => void }) {
  const [fit, setFit] = useState<Saved<Fit> | null>(null);
  const [prep, setPrep] = useState<Saved<Prep> | null>(null);
  const [busy, setBusy] = useState<'' | 'fit' | 'prep'>('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ result: Saved<Fit> | null }>(`/api/ai/role?applicationId=${app.id}&kind=fit`).then((r) => setFit(r.result)).catch(() => undefined);
    api<{ result: Saved<Prep> | null }>(`/api/ai/role?applicationId=${app.id}&kind=prep`).then((r) => setPrep(r.result)).catch(() => undefined);
  }, [app.id]);

  async function run(kind: 'fit' | 'prep') {
    setBusy(kind);
    setError('');
    try {
      const r = await api<{ result: Saved<Fit> & Saved<Prep>; application?: Application }>('/api/ai/role', {
        method: 'POST',
        body: JSON.stringify({ applicationId: app.id, kind }),
      });
      if (kind === 'fit') setFit(r.result);
      else setPrep(r.result);
      if (r.application) onUpdate(r.application);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed');
    } finally {
      setBusy('');
    }
  }

  const meta = (r: Saved<unknown>) =>
    `${r.generatedAt.slice(0, 10)}${r.usage ? ` · ~$${r.usage.costUsd.toFixed(3)}` : ''}${r.usedJd === false ? ' · no job description, so rough' : ''}${r.usedCv === false ? ' · no CV on file' : ''}`;

  return (
    <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="flex">
        <strong>AI help for this role</strong>
        {aiOn ? (
          <>
            <button className="small" disabled={Boolean(busy)} onClick={() => run('fit')}>
              {busy === 'fit' ? 'Analysing… (up to a minute)' : fit ? '↻ Re-check fit' : '✨ Check fit & tailor CV'}
            </button>
            <button className="small" disabled={Boolean(busy)} onClick={() => run('prep')}>
              {busy === 'prep' ? 'Preparing… (1–2 minutes)' : prep ? '↻ Rebuild prep kit' : '✨ Interview prep kit'}
            </button>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            Off. <Link href="/profile">Add an Anthropic API key</Link> to get fit analysis, tailored bullets, a cover letter and interview prep.
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {fit && (
        <div className="mt" style={{ fontSize: 13 }}>
          <div className="flex">
            <span className={`badge ${fit.fitScore >= 70 ? 'badge-uae' : fit.fitScore >= 50 ? 'badge-target' : 'badge-backup'}`}>
              Fit {fit.fitScore} · {fit.verdict}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>{meta(fit)}</span>
          </div>
          <p className="mt">{fit.summary}</p>
          <p><strong>How to apply:</strong> {fit.applyAdvice}</p>
          <div className="split mt">
            <div>
              <strong>Where you match</strong>
              <ul style={{ paddingLeft: 18 }}>
                {fit.matches.map((m) => (
                  <li key={m.requirement}>
                    {m.requirement} <span className="muted">— {m.evidence}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Gaps, and how to handle them</strong>
              <ul style={{ paddingLeft: 18 }}>
                {fit.gaps.map((g) => (
                  <li key={g.requirement}>
                    {g.requirement} <span className="muted">— {g.howToAddress}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex mt">
            <strong>CV bullets tailored to this role</strong>
            <CopyButton text={fit.tailoredBullets.map((b) => `• ${b}`).join('\n')} />
          </div>
          <ul style={{ paddingLeft: 18 }}>
            {fit.tailoredBullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: 12 }}>
            Rewritten from your CV only. Fill any [placeholders] with real numbers, and drop a bullet
            rather than claim something you didn&apos;t do.
          </p>
          <strong>Keywords the screening software will look for</strong>
          <div className="chips">
            {fit.keywords.map((k) => (
              <span className="chip" key={k}>
                {k}
              </span>
            ))}
          </div>
          <details className="mt">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Cover letter</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginTop: 8 }}>{fit.coverLetter}</pre>
            <CopyButton text={fit.coverLetter} />
          </details>
        </div>
      )}

      {prep && (
        <details className="mt" open={app.stage === 'interview'} style={{ fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Interview prep kit <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{meta(prep)}</span>
          </summary>
          <p className="mt">{prep.companyBrief}</p>
          {prep.recentNews.length > 0 && (
            <ul style={{ paddingLeft: 18 }}>
              {prep.recentNews.map((n) => (
                <li key={n.url + n.fact}>
                  {n.fact}{' '}
                  <a href={n.url} target="_blank" rel="noreferrer">
                    source
                  </a>
                </li>
              ))}
            </ul>
          )}
          <strong>Questions to expect</strong>
          {prep.likelyQuestions.map((q) => (
            <details key={q.question} style={{ margin: '6px 0' }}>
              <summary style={{ cursor: 'pointer' }}>{q.question}</summary>
              <p className="muted" style={{ margin: '4px 0' }}>Testing: {q.why}</p>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{q.answerOutline}</pre>
            </details>
          ))}
          <strong>Questions to ask them</strong>
          <ul style={{ paddingLeft: 18 }}>
            {prep.questionsToAsk.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p>
            <strong>Being a UAE National:</strong> {prep.emiratisationAngle}
          </p>
          <p>
            <strong>Salary:</strong> {prep.salaryTalk}
          </p>
          <strong>The day before</strong>
          <ul className="checklist">
            {prep.checklist.map((c) => (
              <li key={c}>☐ {c}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
