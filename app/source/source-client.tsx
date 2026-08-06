'use client';

import { useEffect, useRef, useState } from 'react';

type ContactType = 'hiring_manager' | 'emiratisation_lead' | 'hr' | 'exec';

interface CompanySummary {
  id: string;
  name: string;
  domain: string;
  sector: string | null;
  propensity: number;
  experiment_arm: string | null;
  people: number;
  slots: number;
}

interface Eligibility {
  eligible: boolean;
  blockers: Array<{ code: string; message: string }>;
}

interface PersonView {
  id: string;
  fullNameRaw: string;
  roleTitle: string | null;
  contactType: ContactType;
  sourceTier: number;
  ladderRank: number | null;
  email: string | null;
  emailStatus: string;
  status: string;
  anchorSourceUrl: string | null;
  freshnessDate: string | null;
  sources: number;
  honorific: string | null;
  eligibility: Eligibility;
}

interface EvidenceView {
  id: string;
  tier: number;
  quote: string;
  source_url: string;
  usable: number;
  unusable_reason: string | null;
  person_id: string | null;
  identity_match: string | null;
}

interface Detail {
  company: CompanySummary & { careers_url: string | null; emiratisation_notes: string | null };
  people: PersonView[];
  ladder: Array<{ rank: number; contact_type: string; person_id: string | null }>;
  evidence: EvidenceView[];
  pattern: { pattern: string | null; confidence: string; provenance: string } | null;
  emiratisationPageCandidates: string[];
}

const CONTACT_TYPES: Array<{ value: ContactType; label: string }> = [
  { value: 'emiratisation_lead', label: 'Emiratisation / Nafis lead' },
  { value: 'hr', label: 'HR / talent acquisition' },
  { value: 'hiring_manager', label: 'Hiring manager' },
  { value: 'exec', label: 'Senior exec' },
];

const TIERS = [
  { value: 1, label: 'T1 — something they made' },
  { value: 2, label: 'T2 — something they backed' },
  { value: 3, label: 'T3 — how they describe themselves' },
  { value: 4, label: 'T4 — something that happened to them' },
  { value: 5, label: 'T5 — something the company did' },
  { value: 6, label: 'T6 — junk drawer (banned as an opener)' },
];

/** Minutes on this company, running from the moment it is opened. */
function useTimer(key: string | null) {
  const started = useRef<number | null>(null);
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    if (!key) return;
    started.current = Date.now();
    setMinutes(0);
    const id = setInterval(() => {
      if (started.current) setMinutes(Math.round((Date.now() - started.current) / 60000));
    }, 15000);
    return () => clearInterval(id);
  }, [key]);

  return minutes;
}

export default function SourceClient({
  serpProvider,
  verifierConfigured,
}: {
  serpProvider: string;
  verifierConfigured: boolean;
}) {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'warn' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const minutes = useTimer(selected);

  useEffect(() => {
    void fetch('/api/source/companies')
      .then((r) => r.json())
      .then((p) => setCompanies(p.companies ?? []));
  }, []);

  async function loadDetail(id: string) {
    setSelected(id);
    setDetail(null);
    const response = await fetch(`/api/source/companies?id=${encodeURIComponent(id)}`);
    setDetail(await response.json());
  }

  async function post(url: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage({ tone: 'danger', text: payload.error ?? 'That did not work.' });
        return null;
      }
      if (selected) await loadDetail(selected);
      return payload;
    } finally {
      setBusy(false);
    }
  }

  if (!selected) {
    return (
      <>
        <h1>Sourcing</h1>
        <p className="lede">
          Companies with no people yet, highest hiring propensity first. Work one end to end rather
          than skimming ten.
        </p>
        {serpProvider === 'none' && (
          <div className="notice info">
            <strong>No search API configured</strong>
            The Tier-3 helper will still build the query for you to run by hand. At a few hundred
            lookups that is genuinely competitive, and it carries no account risk at all.
          </div>
        )}
        {!verifierConfigured && (
          <div className="notice warn">
            <strong>No email verifier configured</strong>
            Addresses will stay unverified, and unverified addresses never reach the queue. Set
            EMAIL_VERIFIER_API_KEY.
          </div>
        )}
        {companies.map((c) => (
          <button key={c.id} className="card" style={{ width: '100%', textAlign: 'left', minHeight: 0 }} onClick={() => loadDetail(c.id)}>
            <strong>{c.name}</strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {c.domain} · {c.sector ?? 'sector unknown'} · {c.people} of {c.slots} rungs filled ·
              arm {c.experiment_arm === 'A_hr_first' ? 'A (HR first)' : 'B (manager first)'}
            </p>
          </button>
        ))}
      </>
    );
  }

  if (!detail) return <p className="muted">Loading…</p>;

  return (
    <>
      <button className="linkish" onClick={() => { setSelected(null); setDetail(null); }}>
        ← All companies
      </button>

      <h1>{detail.company.name}</h1>
      <p className="muted">
        {detail.company.domain} · {minutes} minute{minutes === 1 ? '' : 's'} on this company so far
      </p>

      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}

      {detail.company.emiratisation_notes && (
        <div className="notice info">{detail.company.emiratisation_notes}</div>
      )}

      <h2>Start here</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          The company&rsquo;s own Emiratisation or &ldquo;meet our people&rdquo; page is the highest-value source
          there is: it names junior and mid Emirati employees on the company&rsquo;s own domain, published
          for recruitment. Check these before anything else.
        </p>
        {detail.emiratisationPageCandidates.slice(0, 5).map((url) => (
          <p key={url} style={{ margin: '4px 0' }}>
            <a className="linkish" href={url} target="_blank" rel="noreferrer">
              {url.replace('https://www.', '')}
            </a>
          </p>
        ))}
      </div>

      <Ladder ladder={detail.ladder} people={detail.people} />

      <h2>People</h2>
      {detail.people.length === 0 && <p className="muted">Nobody yet.</p>}
      {detail.people.map((p) => (
        <PersonCard key={p.id} person={p} busy={busy} onAction={post} />
      ))}

      <AddPerson companyId={detail.company.id} minutes={minutes} busy={busy} onAction={post} />

      <h2>Addresses</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {detail.pattern?.provenance ?? 'No confirmed address seen at this domain yet.'}
        </p>
        <AddExemplar domain={detail.company.domain} busy={busy} onAction={post} />
      </div>

      <h2>Evidence</h2>
      {detail.evidence.map((e) => (
        <div className="card" key={e.id} style={e.usable ? undefined : { opacity: 0.65 }}>
          <p style={{ margin: 0 }}>
            <strong>T{e.tier}</strong> {e.quote.slice(0, 240)}
            {e.quote.length > 240 ? '…' : ''}
          </p>
          <p className="help">
            <a href={e.source_url} target="_blank" rel="noreferrer">
              source
            </a>
            {e.identity_match && ` · ${e.identity_match}`}
          </p>
          {!e.usable && <p className="help" style={{ color: 'var(--warn)' }}>{e.unusable_reason}</p>}
        </div>
      ))}

      <AddEvidence
        companyId={detail.company.id}
        people={detail.people}
        minutes={minutes}
        busy={busy}
        onAction={post}
      />

      <Tier3 companyName={detail.company.name} serpProvider={serpProvider} />
    </>
  );
}

function Ladder({
  ladder,
  people,
}: {
  ladder: Array<{ rank: number; contact_type: string; person_id: string | null }>;
  people: PersonView[];
}) {
  return (
    <>
      <h2>The ladder</h2>
      <div className="card">
        {ladder.map((slot) => {
          const person = people.find((p) => p.id === slot.person_id);
          return (
            <p key={slot.rank} style={{ margin: '0 0 6px' }}>
              <strong>{slot.rank}.</strong>{' '}
              {CONTACT_TYPES.find((c) => c.value === slot.contact_type)?.label ?? slot.contact_type} —{' '}
              {person ? (
                <span>{person.fullNameRaw}</span>
              ) : (
                <span className="muted">still to find</span>
              )}
            </p>
          );
        })}
        <p className="help">
          One live sequence per company at a time. Rotation only happens after silence, never after
          a no.
        </p>
      </div>
    </>
  );
}

function PersonCard({
  person,
  busy,
  onAction,
}: {
  person: PersonView;
  busy: boolean;
  onAction: (url: string, body: unknown) => Promise<unknown>;
}) {
  const [address, setAddress] = useState(person.email ?? '');

  return (
    <div className="card">
      <strong>{person.fullNameRaw}</strong>
      <p className="muted" style={{ margin: '4px 0' }}>
        {person.roleTitle ?? 'role unknown'} · tier {person.sourceTier} ·{' '}
        {person.sources} source{person.sources === 1 ? '' : 's'}
        {person.freshnessDate ? ` · seen ${person.freshnessDate}` : ''}
      </p>

      <p style={{ margin: '4px 0' }}>
        {person.email ? (
          <>
            {person.email}{' '}
            <span
              className="muted"
              style={{ color: person.emailStatus === 'verified' ? 'var(--accent)' : 'var(--warn)' }}
            >
              ({person.emailStatus.replace('_', '-')})
            </span>
          </>
        ) : (
          <span className="muted">no address yet</span>
        )}
      </p>

      {person.eligibility.eligible ? (
        <p className="muted" style={{ color: 'var(--accent)' }}>Ready to draft.</p>
      ) : (
        <div className="notice warn" style={{ marginTop: 8 }}>
          <strong>Not draftable yet</strong>
          {person.eligibility.blockers.map((b) => (
            <p key={b.code} style={{ margin: '4px 0 0' }}>{b.message}</p>
          ))}
        </div>
      )}

      <div className="field" style={{ margin: '10px 0 0' }}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="address, if you have seen it written down"
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="chip"
          disabled={busy || !address}
          onClick={() => onAction('/api/source/address', { action: 'verify', personId: person.id, address })}
        >
          Verify this address
        </button>
        <button
          className="chip"
          disabled={busy}
          onClick={() => onAction('/api/source/address', { action: 'resolve', personId: person.id })}
        >
          Work it out from the pattern
        </button>
      </div>
    </div>
  );
}

function AddPerson({
  companyId,
  minutes,
  busy,
  onAction,
}: {
  companyId: string;
  minutes: number;
  busy: boolean;
  onAction: (url: string, body: unknown) => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    fullNameRaw: '',
    roleTitle: '',
    contactType: 'emiratisation_lead' as ContactType,
    sourceTier: 2,
    anchorSourceUrl: '',
    freshnessDate: '',
    gender: 'unknown',
    nationalityBucket: 'unknown',
    honorificDeclared: '',
    honorificSourceUrl: '',
  });

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <>
      <h2>Add someone</h2>
      <div className="card">
        <div className="field">
          <label htmlFor="p-name">Their name, exactly as the page renders it</label>
          <input id="p-name" type="text" value={form.fullNameRaw} onChange={(e) => set({ fullNameRaw: e.target.value })} />
          <p className="help">Never tidy the spelling. If the page says Mohd, write Mohd.</p>
        </div>

        <div className="field">
          <label htmlFor="p-role">Job title</label>
          <input id="p-role" type="text" value={form.roleTitle} onChange={(e) => set({ roleTitle: e.target.value })} />
          <p className="help">Targeting only. The generator is forbidden from asserting it in the email.</p>
        </div>

        <div className="chips">
          {CONTACT_TYPES.map((c) => (
            <button key={c.value} type="button" className="chip" aria-pressed={form.contactType === c.value} onClick={() => set({ contactType: c.value })}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="chips">
          {[1, 2, 3, 4].map((tier) => (
            <button key={tier} type="button" className="chip" aria-pressed={form.sourceTier === tier} onClick={() => set({ sourceTier: tier })}>
              Tier {tier}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="p-anchor">Anchor source</label>
          <input id="p-anchor" type="text" value={form.anchorSourceUrl} onChange={(e) => set({ anchorSourceUrl: e.target.value })} placeholder="https://…" />
          <p className="help">
            One URL naming this person and this company together. Without it they cannot be drafted
            to — it is what stops us writing to a different person with the same name.
          </p>
        </div>

        <div className="field">
          <label htmlFor="p-fresh">Date that page confirms them there (YYYY-MM-DD)</label>
          <input id="p-fresh" type="text" value={form.freshnessDate} onChange={(e) => set({ freshnessDate: e.target.value })} placeholder="2026-07-12" />
          <p className="help">Older than 90 days needs a second source. People who left do not update their profiles.</p>
        </div>

        <div className="chips">
          {['unknown', 'M', 'F'].map((g) => (
            <button key={g} type="button" className="chip" aria-pressed={form.gender === g} onClick={() => set({ gender: g })}>
              {g === 'unknown' ? 'Gender unknown' : g === 'M' ? 'He' : 'She'}
            </button>
          ))}
        </div>

        <div className="chips">
          {['unknown', 'emirati', 'gcc_arab', 'levant_egypt_arab', 'south_asian', 'western', 'filipino'].map((n) => (
            <button key={n} type="button" className="chip" aria-pressed={form.nationalityBucket === n} onClick={() => set({ nationalityBucket: n })}>
              {n.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="p-hon">Honorific, only if the page shows one</label>
          <input id="p-hon" type="text" value={form.honorificDeclared} onChange={(e) => set({ honorificDeclared: e.target.value })} placeholder="H.E. / Dr. / Eng." />
          <input
            type="text"
            style={{ marginTop: 8 }}
            value={form.honorificSourceUrl}
            onChange={(e) => set({ honorificSourceUrl: e.target.value })}
            placeholder="the URL that shows it"
          />
          <p className="help">
            Copied, never worked out. Eng. belongs to someone who styles themselves that way, not to
            a job title with &ldquo;engineer&rdquo; in it.
          </p>
        </div>

        <button
          className="primary"
          disabled={busy || !form.fullNameRaw}
          onClick={() =>
            onAction('/api/source/person', {
              companyId,
              ...form,
              honorificDeclared: form.honorificDeclared || null,
              honorificSource: form.honorificDeclared ? 'org_leadership_page' : null,
              honorificSourceUrl: form.honorificSourceUrl || null,
              freshnessDate: form.freshnessDate || null,
              sourceUrls: form.anchorSourceUrl ? [form.anchorSourceUrl] : [],
              minutesSpent: minutes,
            })
          }
        >
          Add them
        </button>
      </div>
    </>
  );
}

function AddExemplar({
  domain,
  busy,
  onAction,
}: {
  domain: string;
  busy: boolean;
  onAction: (url: string, body: unknown) => Promise<unknown>;
}) {
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');

  return (
    <>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="ex-address">An address at {domain} you have seen written down</label>
        <input id="ex-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`someone@${domain}`} />
      </div>
      <div className="field">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="whose address it is" />
      </div>
      <div className="field">
        <input type="text" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="the page you saw it on" />
      </div>
      <button
        className="secondary"
        disabled={busy || !address || !sourceUrl}
        onClick={() => onAction('/api/source/address', { action: 'exemplar', domain, address, fullNameRaw: name, sourceUrl })}
      >
        Record it
      </button>
      <p className="help">
        Two independent examples make a pattern. One is a coincidence, and a group that hires under
        one domain and mails from another will quietly make every contact unreachable.
      </p>
    </>
  );
}

function AddEvidence({
  companyId,
  people,
  minutes,
  busy,
  onAction,
}: {
  companyId: string;
  people: PersonView[];
  minutes: number;
  busy: boolean;
  onAction: (url: string, body: unknown) => Promise<unknown>;
}) {
  const [form, setForm] = useState({ personId: '', tier: 3, quote: '', sourceUrl: '', contextSnippet: '', language: 'en', quoteTranslated: '' });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <>
      <h2>Add evidence</h2>
      <div className="card">
        <div className="field">
          <label htmlFor="e-person">Who it is about</label>
          <select id="e-person" value={form.personId} onChange={(e) => set({ personId: e.target.value })}>
            <option value="">The company, not a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.fullNameRaw}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="e-tier">Tier</label>
          <select id="e-tier" value={form.tier} onChange={(e) => set({ tier: Number(e.target.value) })}>
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="e-quote">What they actually said or did</label>
          <textarea id="e-quote" value={form.quote} onChange={(e) => set({ quote: e.target.value })} rows={3} />
        </div>

        <div className="field">
          <label htmlFor="e-url">Link</label>
          <input id="e-url" type="text" value={form.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://…" />
        </div>

        <div className="field">
          <label htmlFor="e-context">Surrounding text (kept as a snapshot)</label>
          <textarea id="e-context" value={form.contextSnippet} onChange={(e) => set({ contextSnippet: e.target.value })} rows={2} />
          <p className="help">Pages move and posts get deleted. This is what the user reads when the link is gone.</p>
        </div>

        <div className="field">
          <label htmlFor="e-lang">If it is not in English</label>
          <input id="e-lang" type="text" value={form.language} onChange={(e) => set({ language: e.target.value })} placeholder="ar" />
          <textarea
            style={{ marginTop: 8 }}
            value={form.quoteTranslated}
            onChange={(e) => set({ quoteTranslated: e.target.value })}
            rows={2}
            placeholder="translation the user will actually read"
          />
        </div>

        <button
          className="primary"
          disabled={busy || !form.quote || !form.sourceUrl}
          onClick={() =>
            onAction('/api/source/evidence', {
              companyId,
              ...form,
              personId: form.personId || null,
              quoteTranslated: form.quoteTranslated || null,
              minutesSpent: minutes,
            })
          }
        >
          Save it
        </button>
      </div>
    </>
  );
}

function Tier3({ companyName, serpProvider }: { companyName: string; serpProvider: string }) {
  const [title, setTitle] = useState('Head of Emiratisation');
  const [qualifier, setQualifier] = useState('');
  const [result, setResult] = useState<{
    plan: { query: string; advice: string; manualUrl: string };
    hits: Array<{ title: string; url: string; snippet: string; personName: string | null; geographyOk: boolean; geographyNote: string }>;
    note: string;
  } | null>(null);

  return (
    <>
      <h2>Tier 3 — search</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          This reads search results. It never touches LinkedIn itself, at any volume, for any reason.
        </p>
        <div className="field">
          <label htmlFor="t3-title">Job title to look for</label>
          <input id="t3-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="t3-qual">Narrower still (a desk, product or segment)</label>
          <input id="t3-qual" type="text" value={qualifier} onChange={(e) => setQualifier(e.target.value)} />
        </div>
        <button
          className="secondary"
          onClick={async () => {
            const response = await fetch('/api/source/search', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ companyName, title, qualifier }),
            });
            setResult(await response.json());
          }}
        >
          Build the query
        </button>

        {result && (
          <>
            <p className="help" style={{ marginTop: 12 }}>{result.plan.advice}</p>
            <p style={{ fontFamily: 'monospace', fontSize: 14, wordBreak: 'break-all' }}>{result.plan.query}</p>
            <p>
              <a className="linkish" href={result.plan.manualUrl} target="_blank" rel="noreferrer">
                Run it yourself
              </a>
            </p>
            <p className="help">{result.note}</p>
            {result.hits.map((h) => (
              <div key={h.url} className="card" style={h.geographyOk ? undefined : { opacity: 0.6 }}>
                <strong>{h.personName ?? h.title}</strong>
                <p className="muted" style={{ margin: '4px 0' }}>{h.snippet.slice(0, 200)}</p>
                <p className="help" style={{ color: h.geographyOk ? 'var(--accent)' : 'var(--warn)' }}>
                  {h.geographyNote}
                </p>
                <a className="linkish" href={h.url} target="_blank" rel="noreferrer">
                  Open the profile yourself
                </a>
              </div>
            ))}
          </>
        )}

        {serpProvider === 'none' && (
          <p className="help">
            No search API configured, so the query is for you to paste. That is the human path, and
            it is a legitimate answer at this volume.
          </p>
        )}
      </div>
    </>
  );
}
