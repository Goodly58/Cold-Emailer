'use client';

import { useState } from 'react';

type Props =
  | { kind: 'resolve'; id: string }
  | { kind: 'conflict'; id: string }
  | { kind: 'global'; paused: boolean; placed: boolean };

/**
 * Every control here states its consequence before it is pressed.
 *
 * The user is on a phone, once a day, and is not going to explore. A button
 * whose effect is unclear does not get used — and two of these ("I got the job",
 * "going with this one") are irreversible enough that a wrong tap costs a real
 * relationship.
 */
export default function DashboardControls(props: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      setMessage(result.message ?? result.error ?? null);
      if (response.ok) setDone(true);
      // A state change the server made needs the page to agree with it.
      if (response.ok && body.action !== 'resolve') setTimeout(() => window.location.reload(), 1200);
    } catch {
      setMessage('That did not go through. Nothing changed — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (props.kind === 'resolve') {
    if (done) return <p className="muted" style={{ margin: 0 }}>Done.</p>;
    return (
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void post({ action: 'resolve', id: props.id })}
      >
        {busy ? 'One moment…' : 'I have handled this'}
      </button>
    );
  }

  if (props.kind === 'conflict') {
    if (done) return <p className="muted" style={{ margin: 0 }}>{message}</p>;
    return (
      <div className="stack">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() =>
            void post({ action: 'reply_conflict', companyId: props.id, choice: 'going_with_reply' })
          }
        >
          I am going with the person who replied
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void post({ action: 'reply_conflict', companyId: props.id, choice: 'reply_was_dead_end' })
          }
        >
          That one was a dead end — carry on with the other
        </button>
        <p className="help" style={{ margin: 0 }}>
          Either way, only one sequence stays live. Nobody gets a retraction; the other thread
          simply stops.
        </p>
      </div>
    );
  }

  if (props.placed) {
    return (
      <div className="notice info">
        <strong>You marked yourself as placed.</strong> Nothing will send. If that changes, say so
        and everything can be picked back up.
      </div>
    );
  }

  return (
    <div className="stack">
      {message && <div className="notice info">{message}</div>}

      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void post({ action: props.paused ? 'resume' : 'pause' })}
      >
        {props.paused ? 'Start again' : 'Pause everything'}
      </button>
      <p className="help" style={{ margin: 0 }}>
        {props.paused
          ? 'Nothing is sending. When you start again the dates recompute from that day, so nothing arrives late-and-wrong.'
          : 'Exams, a wedding, or just a bad week. Nothing sends and nothing is lost.'}
      </p>

      {!confirming ? (
        <button type="button" className="button secondary" onClick={() => setConfirming(true)}>
          I got the job
        </button>
      ) : (
        <div className="notice info">
          <strong>Congratulations — really.</strong>
          <p style={{ margin: '8px 0 12px' }}>
            The quiet sequences will close without a word to anyone. People who actually replied to
            you will show up in your queue for a short thank-you, because this is a small market and
            they will remember being ghosted.
          </p>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void post({ action: 'placed' })}
          >
            {busy ? 'One moment…' : 'Yes, I accepted an offer'}
          </button>{' '}
          <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
            Not yet
          </button>
        </div>
      )}
    </div>
  );
}
