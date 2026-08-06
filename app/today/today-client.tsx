'use client';

import { useCallback, useEffect, useState } from 'react';

interface QueueItem {
  outreachId: string;
  personId: string;
  personName: string;
  companyId: string;
  companyName: string;
  contactType: string;
  step: number;
  subject: string | null;
  body: string | null;
  status: string;
  dueInWorkingDays: number | null;
  sendable: boolean;
  blockedReason: string | null;
}

interface OpenAction {
  id: string;
  kind: string;
  message: string;
  url: string | null;
  personName: string | null;
  companyName: string | null;
}

interface Queue {
  followUps: QueueItem[];
  firstEmails: QueueItem[];
  needsFact: Array<{ outreachId: string; personName: string; companyName: string; request: string }>;
  budget: { ceiling: number; sentToday: number; target: number; rampNote: string };
  headline: string;
  actions: OpenAction[];
  welcome: { show: boolean; headline: string; awayWorkingDays: number };
  sendBlock: { reason: string; message: string } | null;
  paused: boolean;
  error?: string;
}

interface EvidenceRow {
  id: string;
  tier: number;
  quote: string;
  quote_translated: string | null;
  language: string;
  source_url: string;
  context_snippet: string | null;
  captured_at: string;
  usable: number;
  unusable_reason: string | null;
}

interface DraftDetail {
  outreach: { id: string; step: number; subject: string | null; body: string | null; status: string; premise_tier: number | null };
  person: { full_name_raw: string; role_title: string | null; anchor_source_url: string | null; freshness_date: string | null; email: string | null; contact_type: string };
  company: { name: string; domain: string };
  evidence: EvidenceRow[];
  alsoFound: EvidenceRow[];
  permission: { allowed: boolean; message?: string };
}

export default function TodayClient({ firstName }: { firstName: string }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [justSent, setJustSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/queue');
    setQueue(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!queue) return <p className="muted">Checking for replies first…</p>;
  if (queue.error) return <div className="notice warn">{queue.error}</div>;

  if (openId) {
    return (
      <Review
        outreachId={openId}
        onClose={() => {
          setOpenId(null);
          void load();
        }}
        onSent={(name) => {
          setSentCount((n) => n + 1);
          setJustSent(name);
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  const total = queue.followUps.length + queue.firstEmails.length;

  return (
    <>
      <h1>Today</h1>

      {justSent && (
        <div className="notice info" role="status">
          <strong>Sent to {justSent}.</strong>
          {sentCount === 1
            ? 'That is the hard one done. Replies usually land between five and twelve days from now.'
            : `${sentCount} sent today.`}
        </div>
      )}

      {queue.paused && (
        <div className="notice info">
          <strong>Everything is paused</strong>
          Nothing goes out until you resume. Countdowns keep running so nothing is lost.
        </div>
      )}

      {queue.sendBlock && queue.sendBlock.reason === 'not_connected' && (
        <div className="notice warn">
          <strong>Reconnect your email</strong>
          Nothing is lost — everything picks up where it left off.
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            <a className="button primary" href="/api/gmail/start">Reconnect</a>
          </p>
        </div>
      )}

      {queue.sendBlock && queue.sendBlock.reason === 'poll_stale' && (
        <div className="notice info">{queue.sendBlock.message}</div>
      )}

      {queue.welcome?.show && (
        // Never a backlog, and never a count of one. The number is the part
        // that does the damage to someone coming back after a bad fortnight.
        <div className="notice info" role="status">
          <strong>Welcome back</strong>
          {queue.welcome.headline}
        </div>
      )}

      {/*
        A real person said something. This sits above every draft, every count
        and every heading on the screen, because the reply is the climax of the
        whole product and the moment the user freezes.
      */}
      {queue.actions?.length > 0 && (
        <>
          <h2>Waiting on you</h2>
          {queue.actions.map((action) => (
            <div className="card" key={action.id} style={{ borderColor: 'var(--accent)' }}>
              <strong>
                {action.personName ?? 'Someone'}
                {action.companyName ? ` at ${action.companyName}` : ''}
              </strong>
              <p style={{ margin: '6px 0 0' }}>{action.message}</p>
              {action.url && (
                <p style={{ margin: '10px 0 0' }}>
                  <a className="linkish" href={action.url} target="_blank" rel="noreferrer">
                    Open it
                  </a>
                </p>
              )}
            </div>
          ))}
        </>
      )}

      <p className="lede">{total === 0 ? queue.headline : `${queue.headline}`}</p>

      {queue.budget.rampNote && <p className="help">{queue.budget.rampNote}</p>}

      {/* Warm above cold, always: a follow-up has a deadline and a cold email does not. */}
      {queue.followUps.length > 0 && (
        <>
          <h2>Following up</h2>
          {queue.followUps.map((item) => (
            <Card key={item.outreachId} item={item} onOpen={() => setOpenId(item.outreachId)} />
          ))}
        </>
      )}

      {queue.firstEmails.length > 0 && (
        <>
          <h2>{queue.followUps.length > 0 ? 'New' : 'Ready to send'}</h2>
          {queue.firstEmails.map((item, i) => (
            <Card
              key={item.outreachId}
              item={item}
              first={i === 0 && sentCount === 0}
              onOpen={() => setOpenId(item.outreachId)}
            />
          ))}
        </>
      )}

      {total === 0 && queue.needsFact.length === 0 && (
        <div className="card">
          <strong>Nothing to send right now</strong>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            We only write when there is something real to say. More will be ready shortly.
          </p>
        </div>
      )}

      {total === 0 && sentCount > 0 && (
        <div className="card">
          <strong>Done for today.</strong>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {sentCount} sent. Come back tomorrow — there is nothing else you need to do.
          </p>
        </div>
      )}

      {queue.needsFact.length > 0 && (
        <>
          <h2>Needs one fact</h2>
          {queue.needsFact.map((n) => (
            <div className="card" key={n.outreachId}>
              <strong>{n.personName} at {n.companyName}</strong>
              <p className="muted" style={{ margin: '6px 0 0' }}>{n.request}</p>
              <p className="help">
                We would rather write nothing than write something generic, so this one is waiting.
              </p>
            </div>
          ))}
        </>
      )}

      <p style={{ marginTop: 28 }}>
        <a className="linkish" href="/dashboard">See everything in play</a>
      </p>
    </>
  );
}

function Card({ item, first, onOpen }: { item: QueueItem; first?: boolean; onOpen: () => void }) {
  const overdue = item.step > 1 && (item.dueInWorkingDays ?? 0) < 0;

  return (
    <button className="card" style={{ width: '100%', textAlign: 'left', minHeight: 0 }} onClick={onOpen}>
      <strong>{item.personName}</strong>
      <p className="muted" style={{ margin: '4px 0 0' }}>
        {item.companyName}
        {item.step > 1 && ` · follow-up ${item.step - 1}`}
        {overdue && ' · due now'}
      </p>
      {first && item.contactType === 'emiratisation_lead' && (
        <p className="help" style={{ color: 'var(--accent)', marginTop: 6 }}>
          This person&rsquo;s job is to want this email.
        </p>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------

/**
 * The Review screen.
 *
 * The evidence panel is the only mechanism standing between a personalization
 * error and a stranger's inbox, and on a phone it stacks below the fold where
 * it never gets seen. So the claims are highlighted inline, tapping one opens
 * the source in a sheet, and Send stays inactive until at least one has been
 * opened. Two seconds, once per draft.
 */
function Review({
  outreachId,
  onClose,
  onSent,
}: {
  outreachId: string;
  onClose: () => void;
  onSent: (name: string) => void;
}) {
  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(false);
  const [checkedEvidence, setCheckedEvidence] = useState(false);
  const [sheet, setSheet] = useState<EvidenceRow | null>(null);
  const [lint, setLint] = useState<Array<{ rule: string; message: string; excerpt?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [interlockAnswered, setInterlockAnswered] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/draft?id=${encodeURIComponent(outreachId)}`);
      const payload = await response.json();
      setDetail(payload);
      setBody(payload.outreach?.body ?? '');
    })();
  }, [outreachId]);

  if (!detail?.outreach) return <p className="muted">Opening…</p>;

  const isFollowUp = detail.outreach.step > 1;
  const needsInterlock = isFollowUp && !interlockAnswered;
  const canSend = checkedEvidence && !needsInterlock && detail.permission.allowed && !busy;

  async function runLint(next: string) {
    setBody(next);
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'lint', outreachId, edited: next }),
    });
    const payload = await response.json();
    setLint(payload.findings ?? []);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'send', outreachId, edited: editing ? body : undefined }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? payload.error ?? 'That did not send.');
        return;
      }
      onSent(detail!.person.full_name_raw.split(' ')[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="linkish" onClick={onClose}>← Back</button>

      <h1 style={{ fontSize: 22 }}>
        To {detail.person.full_name_raw}
      </h1>
      <p className="muted">
        {detail.company.name}
        {detail.person.freshness_date && ` · last confirmed there ${detail.person.freshness_date}`}
      </p>

      {error && <div className="notice danger" role="status">{error}</div>}

      {!detail.permission.allowed && (
        <div className="notice info">{detail.permission.message}</div>
      )}

      <div className="card">
        <p className="help" style={{ marginTop: 0 }}>Subject</p>
        <strong>{detail.outreach.subject}</strong>
      </div>

      {editing ? (
        <div className="field">
          <textarea value={body} rows={14} onChange={(e) => void runLint(e.target.value)} />
        </div>
      ) : (
        <div className="card">
          <Highlighted body={body} evidence={detail.evidence} onTap={(row) => { setSheet(row); setCheckedEvidence(true); }} />
        </div>
      )}

      {lint.map((f) => (
        <div className="notice warn" key={f.rule + (f.excerpt ?? '')}>
          {f.message}
          {f.excerpt && <p className="help" style={{ marginBottom: 0 }}>&ldquo;{f.excerpt}&rdquo;</p>}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '0 0 20px' }}>
        <button className="chip" onClick={() => setEditing(!editing)}>
          {editing ? 'Done editing' : 'Edit'}
        </button>
        <button
          className="chip"
          onClick={async () => {
            await fetch('/api/draft', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'skip', outreachId, reason: 'user_skip' }),
            });
            onClose();
          }}
        >
          Skip this company
        </button>
      </div>

      <h2>Why this email</h2>
      {detail.evidence.length === 0 && <p className="muted">No outside evidence — this one is written from your own profile.</p>}
      {detail.evidence.map((row) => (
        <button
          key={row.id}
          className="card"
          style={{ width: '100%', textAlign: 'left', minHeight: 0 }}
          onClick={() => { setSheet(row); setCheckedEvidence(true); }}
        >
          <strong>Tier {row.tier}</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {(row.quote_translated ?? row.quote).slice(0, 160)}
            {(row.quote_translated ?? row.quote).length > 160 ? '…' : ''}
          </p>
          <p className="help">Tap to see where this came from</p>
        </button>
      ))}

      {detail.person.anchor_source_url && (
        <div className="card">
          <strong>Why we believe this is the right person</strong>
          <p className="muted" style={{ margin: '6px 0 0', wordBreak: 'break-all' }}>
            <a href={detail.person.anchor_source_url} target="_blank" rel="noreferrer">
              {detail.person.anchor_source_url}
            </a>
          </p>
        </div>
      )}

      {detail.alsoFound.filter((r) => !r.usable).length > 0 && (
        <>
          <h2>Found but not used</h2>
          {detail.alsoFound.filter((r) => !r.usable).map((row) => (
            <div className="card" key={row.id} style={{ opacity: 0.6 }}>
              <p style={{ margin: 0 }}>{row.quote.slice(0, 140)}…</p>
              <p className="help">{row.unusable_reason}</p>
            </div>
          ))}
        </>
      )}

      {needsInterlock && (
        <div className="notice warn">
          <strong>Any contact from {detail.person.full_name_raw.split(' ')[0]} outside email?</strong>
          A message on LinkedIn, a phone call, anything. We cannot see those, and following up on
          someone who already answered reads as a bot.
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="chip" onClick={() => setInterlockAnswered(true)}>
              No — send it
            </button>
            <button
              className="chip"
              onClick={async () => {
                await fetch('/api/draft', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action: 'replied_elsewhere', outreachId }),
                });
                onClose();
              }}
            >
              Yes — stop
            </button>
          </div>
        </div>
      )}

      <button className="primary" disabled={!canSend} onClick={() => void send()}>
        {busy ? 'Sending…' : canSend ? 'Send' : !checkedEvidence ? 'Check one source first' : 'Send'}
      </button>
      {!checkedEvidence && (
        <p className="help">
          Tap one of the highlighted bits above to see exactly where it came from. Ten seconds, and
          it is the only thing standing between you and an email that gets a detail wrong.
        </p>
      )}
      <p className="help">No attachment goes with this. Them asking for your CV is the goal, not the payload.</p>

      {sheet && <Sheet row={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}

/** Claims that trace to evidence are underlined and tappable. */
function Highlighted({
  body,
  evidence,
  onTap,
}: {
  body: string;
  evidence: EvidenceRow[];
  onTap: (row: EvidenceRow) => void;
}) {
  const sentences = body.split(/(?<=[.!?])\s+/);

  return (
    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
      {sentences.map((sentence, i) => {
        const row = evidence.find((e) => {
          const source = (e.quote_translated ?? e.quote).toLowerCase();
          const keywords = source.split(/\W+/).filter((w) => w.length > 5);
          return keywords.filter((w) => sentence.toLowerCase().includes(w)).length >= 2;
        });

        if (!row) return <span key={i}>{sentence} </span>;

        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => onTap(row)}
            onKeyDown={(e) => e.key === 'Enter' && onTap(row)}
            style={{
              textDecoration: 'underline',
              textDecorationStyle: 'dotted',
              textUnderlineOffset: 4,
              cursor: 'pointer',
              color: 'var(--accent)',
            }}
          >
            {sentence}{' '}
          </span>
        );
      })}
    </p>
  );
}

/** The bottom sheet. On a phone this is the evidence panel. */
function Sheet({ row, onClose }: { row: EvidenceRow; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          borderRadius: '16px 16px 0 0',
          padding: '20px 20px 32px',
        }}
      >
        <p className="help" style={{ marginTop: 0 }}>
          Captured {row.captured_at.slice(0, 10)}
          {row.language !== 'en' && ` · translated from ${row.language}`}
        </p>

        {/* The translation leads. The user has to be able to read what they
            are approving; the original sits beneath it. */}
        <p style={{ fontSize: 17 }}>{row.quote_translated ?? row.quote}</p>
        {row.quote_translated && (
          <p className="muted" dir="auto" style={{ fontSize: 15 }}>{row.quote}</p>
        )}

        {row.context_snippet && (
          <div className="card">
            <p className="help" style={{ marginTop: 0 }}>What was around it when we found it</p>
            <p className="muted" style={{ margin: 0 }}>{row.context_snippet}</p>
          </div>
        )}

        <p style={{ wordBreak: 'break-all' }}>
          <a href={row.source_url} target="_blank" rel="noreferrer">{row.source_url}</a>
        </p>

        <button className="secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
