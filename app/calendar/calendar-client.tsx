'use client';

import { useState } from 'react';

import type { StoredWindow } from '@/lib/calendar-store';
import type { CadencePreview } from '@/lib/derived-dates';

interface Props {
  initialWindows: StoredWindow[];
  initialVersion: number;
  today: string;
  initialPreview: CadencePreview[];
}

const BLANK = {
  name: '',
  kind: 'public_holiday' as const,
  start: '',
  end: '',
  confirmed: false,
  note: '',
};

export default function CalendarClient(props: Props) {
  const [windows, setWindows] = useState(props.initialWindows);
  const [version, setVersion] = useState(props.initialVersion);
  const [preview, setPreview] = useState(props.initialPreview);
  const [from, setFrom] = useState(props.today);
  const [draft, setDraft] = useState({ ...BLANK });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastRecompute, setLastRecompute] = useState<string | null>(null);

  async function refresh(sentFrom = from) {
    const response = await fetch(`/api/calendar?from=${encodeURIComponent(sentFrom)}`);
    const payload = await response.json();
    setWindows(payload.windows);
    setVersion(payload.version);
    setPreview(payload.preview.steps);
  }

  async function send(method: 'POST' | 'PUT' | 'DELETE', body?: unknown, id?: string) {
    setBusy(true);
    setError(null);
    try {
      const url = method === 'DELETE' ? `/api/calendar?id=${encodeURIComponent(id!)}` : '/api/calendar';
      const response = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'That did not save.');
        return false;
      }
      if (payload.recompute) {
        setLastRecompute(
          `${payload.recompute.changed} scheduled date(s) moved, ` +
            `${payload.recompute.flaggedForRegeneration} draft(s) flagged to regenerate at send.`
        );
      }
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>UAE calendar</h1>
      <p className="lede">
        Every countdown in the product is measured against this. An unconfirmed window counts as
        fully non-working, so a date we are unsure of always delays a send rather than risking one.
      </p>
      <p className="muted">Calendar version {version}. Edits recompute derived dates immediately.</p>

      {error && <div className="notice danger">{error}</div>}
      {lastRecompute && <div className="notice info">{lastRecompute}</div>}

      <h2>Windows</h2>
      {windows.map((w) => (
        <div className="card" key={w.id}>
          <strong>{w.name}</strong>
          <p className="muted" style={{ margin: '4px 0' }}>
            {w.start} → {w.end} · {w.kind === 'ramadan_pause' ? 'send pause' : 'public holiday'}
          </p>
          {w.note && (
            <p className="help" style={{ marginTop: 0 }}>
              {w.note}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button
              className="chip"
              aria-pressed={w.confirmed}
              disabled={busy}
              onClick={() =>
                send('PUT', {
                  id: w.id,
                  name: w.name,
                  kind: w.kind,
                  start: w.start,
                  end: w.end,
                  confirmed: !w.confirmed,
                  note: w.note,
                })
              }
            >
              {w.confirmed ? 'Confirmed' : 'Not confirmed yet'}
            </button>
            <button className="chip" disabled={busy} onClick={() => send('DELETE', undefined, w.id)}>
              Remove
            </button>
          </div>
        </div>
      ))}

      <h2>Add a window</h2>
      <div className="card">
        <div className="field">
          <label htmlFor="w-name">Name</label>
          <input
            id="w-name"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Eid al-Fitr"
          />
        </div>
        <div className="field">
          <label htmlFor="w-start">First day (YYYY-MM-DD)</label>
          <input
            id="w-start"
            type="text"
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            placeholder="2027-03-09"
          />
        </div>
        <div className="field">
          <label htmlFor="w-end">Last day (YYYY-MM-DD)</label>
          <input
            id="w-end"
            type="text"
            value={draft.end}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            placeholder="2027-03-11"
          />
        </div>
        <div className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={draft.kind === 'public_holiday'}
            onClick={() => setDraft({ ...draft, kind: 'public_holiday' })}
          >
            Public holiday
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={draft.kind !== 'public_holiday'}
            onClick={() => setDraft({ ...draft, kind: 'ramadan_pause' as never })}
          >
            Send pause
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={draft.confirmed}
            onClick={() => setDraft({ ...draft, confirmed: !draft.confirmed })}
          >
            {draft.confirmed ? 'Dates confirmed' : 'Dates not confirmed'}
          </button>
        </div>
        <button
          className="primary"
          disabled={busy || !draft.name || !draft.start || !draft.end}
          onClick={async () => {
            if (await send('POST', draft)) setDraft({ ...BLANK });
          }}
        >
          Add
        </button>
      </div>

      <h2>What the cadence does</h2>
      <div className="card">
        <div className="field">
          <label htmlFor="from">If an email were sent on</label>
          <input
            id="from"
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={() => refresh(from)}
          />
        </div>
        {preview.map((step) => (
          <p key={step.step} className="muted" style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--ink)' }}>{step.label}</strong> (+{step.workingDays} working
            days) lands <strong style={{ color: 'var(--ink)' }}>{step.dueDate}</strong>
            {step.crossesUnconfirmed && ' — crosses an unconfirmed window, so its opener regenerates at send'}
            {step.gapWorkingDays > 10 && ' — gap over 10 working days, so it regenerates as a re-introduction'}
          </p>
        ))}
      </div>
    </>
  );
}
