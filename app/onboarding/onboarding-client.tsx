'use client';

import { useCallback, useState } from 'react';

import type { GateResult, InterviewField, Specificity } from '@/lib/interview';
import { SCOPE_EXPLANATIONS } from '@/lib/gmail/oauth';
import { CV_COACHING } from '@/lib/copy';
import type { OnboardingStep } from '@/lib/user';

/*
 * Every screen in here was walked as the tech-shy user first: phone-width, the
 * biggest text is the thing to read, one action, and no word that would make
 * someone close the tab. Where a screen can fail, the failure is written out in
 * plain language beside it rather than left to a toast that disappears.
 */

interface Answer {
  field: string;
  value: unknown;
  specificity: Specificity;
  followupQuestion: string | null;
  followupAnswer: string | null;
  verificationFraming: string | null;
}

interface Props {
  user: {
    name: string;
    gmailAddress: string | null;
    connectionState: string;
    sendAsEmail: string | null;
    canonicalName: string | null;
    signatureBlock: string | null;
    onboardingStep: OnboardingStep;
  };
  interviewFields: InterviewField[];
  hygieneFields: InterviewField[];
  answers: Answer[];
  gate: GateResult;
  cv: { id: string; origin: string; filename: string; approved: boolean } | null;
  oauthConfigured: boolean;
  problem: string | null;
  justConnected: boolean;
}

const STEP_ORDER: OnboardingStep[] = ['welcome', 'connect', 'identity', 'interview', 'hygiene', 'cv', 'done'];

export default function OnboardingClient(props: Props) {
  const [step, setStep] = useState<OnboardingStep>(
    props.problem ? 'connect' : props.user.onboardingStep
  );
  const [answers, setAnswers] = useState<Answer[]>(props.answers);
  const [gate, setGate] = useState<GateResult>(props.gate);
  const [error, setError] = useState<string | null>(props.problem);

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <>
      <div className="steps" aria-hidden="true">
        {STEP_ORDER.slice(0, -1).map((s, i) => (
          <span key={s} className={i <= stepIndex ? 'done' : ''} />
        ))}
      </div>

      {error && (
        <div className="notice warn" role="status">
          {error}
        </div>
      )}

      {step === 'welcome' && <Welcome onNext={() => setStep('connect')} />}

      {step === 'connect' && (
        <Connect
          configured={props.oauthConfigured}
          connectedAddress={props.user.connectionState === 'connected' ? props.user.gmailAddress : null}
          justConnected={props.justConnected}
          onContinue={() => {
            setError(null);
            setStep('identity');
          }}
        />
      )}

      {step === 'identity' && (
        <Identity
          fallbackName={props.user.canonicalName ?? props.user.name}
          onError={setError}
          onDone={() => {
            setError(null);
            setStep('interview');
          }}
        />
      )}

      {step === 'interview' && (
        <Interview
          fields={props.interviewFields}
          answers={answers}
          gate={gate}
          onError={setError}
          onAnswers={setAnswers}
          onGate={setGate}
          onDone={() => {
            setError(null);
            setStep('hygiene');
          }}
        />
      )}

      {step === 'hygiene' && (
        <Hygiene fields={props.hygieneFields} onError={setError} onDone={() => setStep('cv')} />
      )}

      {step === 'cv' && (
        <Cv
          existing={props.cv}
          onError={setError}
          onDone={async () => {
            const response = await fetch('/api/onboarding/complete', { method: 'POST' });
            const payload = await response.json();
            if (!response.ok) {
              setError(
                [payload.error, ...(payload.missing ?? []), ...(payload.thin ?? [])]
                  .filter(Boolean)
                  .join(' · ')
              );
              setStep('interview');
              return;
            }
            setStep('done');
          }}
        />
      )}

      {step === 'done' && <Done />}
    </>
  );
}

// ---------------------------------------------------------------------------

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h1>Let&rsquo;s get you set up.</h1>
      <p className="lede">
        A few questions, then we start finding the right people to email. About five minutes.
      </p>
      <div className="card">
        <p style={{ margin: 0 }}>
          <strong>Nothing sends without you.</strong> We write the emails. You read each one and
          decide. There is no button anywhere that sends on its own.
        </p>
      </div>
      <button className="primary" onClick={onNext}>
        Start
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The pre-consent explainer.
 *
 * Google will show a red-triangle warning and ask for permission to read email
 * in wording that sounds alarming. A user who meets that screen cold closes the
 * tab and never comes back. So they see it here first, in Google's own words,
 * with what it actually means beside it.
 */
function Connect({
  configured,
  connectedAddress,
  justConnected,
  onContinue,
}: {
  configured: boolean;
  connectedAddress: string | null;
  justConnected: boolean;
  onContinue: () => void;
}) {
  if (connectedAddress) {
    return (
      <>
        <h1>Email connected.</h1>
        <p className="lede">
          {justConnected ? 'That worked.' : 'Already done.'} We will send from{' '}
          <strong>{connectedAddress}</strong>.
        </p>
        <button className="primary" onClick={onContinue}>
          Next
        </button>
      </>
    );
  }

  if (!configured) {
    return (
      <>
        <h1>Connect your email</h1>
        <div className="notice danger">
          <strong>This is on our side, not yours.</strong>
          Email connection has not been switched on for this copy of the app yet. Nothing you did
          caused it.
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Connect your Gmail</h1>
      <p className="lede">
        Emails go out from your own address, so they look like you wrote them. Because you did.
      </p>

      <p>
        Google will show you the screen below next. It uses strong words. Here is what each one
        actually means:
      </p>

      <div className="consent-mock">
        <header>What Google will ask you</header>
        <ul>
          {SCOPE_EXPLANATIONS.map((s) => (
            <li key={s.scope}>
              <span className="google-words">{s.googleWording}</span>
              <span className="plain">{s.whatItMeans}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="notice info">
        <strong>You may see an orange or red warning first.</strong>
        It says this app has not been reviewed by Google yet. That is about us, not about your
        account. Tap <em>Advanced</em>, then continue.
      </div>

      <div className="notice info">
        <strong>Leave both boxes ticked.</strong>
        If you untick one, Google still says yes and then nothing works later. We check, and we will
        bring you straight back here.
      </div>

      <a className="button primary" href="/api/gmail/start">
        Continue to Google
      </a>
      <p className="help" style={{ marginTop: 12 }}>
        We only ever open the email threads this app started. We never delete anything.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

interface SendAsOption {
  email: string;
  displayName: string;
  isDefault: boolean;
  isPrimary: boolean;
  signature: string;
}

/**
 * The identity block.
 *
 * A romanized name shows up three ways — the Gmail from-line, the signature,
 * and whatever they type here — and the recipient sees all three. Putting them
 * on one screen is the only moment the mismatch is noticeable.
 */
function Identity({
  fallbackName,
  onError,
  onDone,
}: {
  fallbackName: string;
  onError: (message: string | null) => void;
  onDone: () => void;
}) {
  const [options, setOptions] = useState<SendAsOption[] | null>(null);
  const [chosen, setChosen] = useState<string>('');
  const [name, setName] = useState(fallbackName === 'you' ? '' : fallbackName);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [failed, setFailed] = useState(false);

  const loadOptions = useCallback(async () => {
    setFailed(false);
    try {
      const response = await fetch('/api/onboarding/identity');
      const payload = await response.json();
      if (!response.ok) {
        onError(payload.error ?? 'We could not read your email settings just now.');
        setFailed(true);
        return;
      }
      setOptions(payload.addresses);
      const preferred =
        payload.addresses.find((a: SendAsOption) => a.isDefault) ?? payload.addresses[0];
      if (preferred) {
        setChosen(preferred.email);
        if (!name && preferred.displayName) setName(preferred.displayName);
      }
    } catch {
      onError('We could not read your email settings just now.');
      setFailed(true);
    }
    // `name` is read but must not re-trigger the fetch when the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError]);

  if (!loaded) {
    setLoaded(true);
    void loadOptions();
  }

  const selected = options?.find((o) => o.email === chosen);

  async function save() {
    if (!chosen || !name.trim()) {
      onError('Pick the address to send from, and check how your name is spelled.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/onboarding/identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sendAsEmail: chosen, canonicalName: name.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) {
        onError(payload.error ?? 'That did not save. Try once more.');
        return;
      }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1>How your emails will look</h1>
      <p className="lede">This is what the person receiving your email sees.</p>

      {options === null && !failed && <p className="muted">Reading your email settings&hellip;</p>}

      {failed && (
        // The fetch is a Gmail call, so it fails for transient reasons — a 429,
        // a 5xx, a token revoked between consenting and landing here. Without a
        // retry this step was a dead end on the way in: onboarding could not be
        // finished and there was nothing on screen to press.
        <div className="notice warn">
          <strong>We could not read your email settings</strong>
          This is usually a passing glitch on Google&rsquo;s side, not something you did.
          <p style={{ marginTop: 12, marginBottom: 0 }}>
            <button type="button" className="button primary" onClick={() => void loadOptions()}>
              Try again
            </button>{' '}
            <a className="button secondary" href="/api/gmail/start">
              Reconnect instead
            </a>
          </p>
        </div>
      )}

      {options && options.length > 0 && (
        <>
          <div className="field">
            <label htmlFor="sendas">Send from</label>
            <select id="sendas" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {options.map((o) => (
                <option key={o.email} value={o.email}>
                  {o.email}
                </option>
              ))}
            </select>
            <p className="help">Only addresses Gmail has confirmed are listed here.</p>
          </div>

          <div className="field">
            <label htmlFor="name">Your name, spelled the way you want it</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mohammed Al Shamsi"
            />
            {selected?.displayName && selected.displayName.trim() !== name.trim() && (
              <p className="help">
                Gmail currently shows you as <strong>{selected.displayName}</strong> in the
                from-line. If that is not how you want to be seen, you can change it in your Google
                account settings — it is worth two minutes.
              </p>
            )}
          </div>

          {selected?.signature && (
            <div className="card">
              <strong>Your sign-off</strong>
              <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
                {selected.signature}
              </p>
              <p className="help">
                This comes from Gmail and goes at the bottom of every email. It does not count
                towards the length.
              </p>
            </div>
          )}
        </>
      )}

      <button className="primary" onClick={save} disabled={loading || !chosen}>
        {loading ? 'Saving…' : 'This looks right'}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function Interview({
  fields,
  answers,
  gate,
  onError,
  onAnswers,
  onGate,
  onDone,
}: {
  fields: InterviewField[];
  answers: Answer[];
  gate: GateResult;
  onError: (message: string | null) => void;
  onAnswers: (answers: Answer[]) => void;
  onGate: (gate: GateResult) => void;
  onDone: () => void;
}) {
  const [index, setIndex] = useState(() => {
    const firstUnanswered = fields.findIndex(
      (f) => f.required && !answers.some((a) => a.field === f.key && a.specificity !== 'unknown')
    );
    return firstUnanswered === -1 ? 0 : firstUnanswered;
  });
  const [busy, setBusy] = useState(false);

  const field = fields[index];
  const answer = answers.find((a) => a.field === field.key);
  const isLast = index === fields.length - 1;

  async function save(value: unknown, verificationFraming?: string) {
    setBusy(true);
    onError(null);
    try {
      const response = await fetch('/api/onboarding/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: field.key, value, verificationFraming }),
      });
      const payload = await response.json();
      if (!response.ok) {
        onError(payload.error ?? 'That did not save. Try once more.');
        return false;
      }
      onAnswers([
        ...answers.filter((a) => a.field !== field.key),
        {
          field: field.key,
          value,
          specificity: payload.specificity,
          followupQuestion: payload.followupQuestion,
          followupAnswer: answer?.followupAnswer ?? null,
          verificationFraming: verificationFraming ?? answer?.verificationFraming ?? null,
        },
      ]);
      onGate(payload.gate);
      return payload.specificity !== 'thin';
    } finally {
      setBusy(false);
    }
  }

  async function saveFollowup(text: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/onboarding/followup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: field.key, answer: text }),
      });
      const payload = await response.json();
      onAnswers([
        ...answers.filter((a) => a.field !== field.key),
        { ...(answer as Answer), followupAnswer: text },
      ]);
      onGate(payload.gate);
      return payload.specificity === 'concrete';
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{field.question}</h1>
      {field.help && <p className="lede">{field.help}</p>}

      {field.kind === 'text' ? (
        <TextAnswer
          key={field.key}
          field={field}
          answer={answer}
          busy={busy}
          onSave={save}
          onSaveFollowup={saveFollowup}
          onNext={() => (isLast ? onDone() : setIndex(index + 1))}
        />
      ) : (
        <ChipAnswer
          key={field.key}
          field={field}
          answer={answer}
          busy={busy}
          onSave={save}
          onNext={() => (isLast ? onDone() : setIndex(index + 1))}
        />
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {index > 0 && (
          <button className="linkish" onClick={() => setIndex(index - 1)}>
            Back
          </button>
        )}
        {!field.required && (
          <button className="linkish" onClick={() => (isLast ? onDone() : setIndex(index + 1))}>
            Skip
          </button>
        )}
      </div>

      {!gate.complete && index === fields.length - 1 && (
        <p className="help">
          {gate.missing.length + gate.thin.length} question
          {gate.missing.length + gate.thin.length === 1 ? '' : 's'} still to finish.
        </p>
      )}
    </>
  );
}

function ChipAnswer({
  field,
  answer,
  busy,
  onSave,
  onNext,
}: {
  field: InterviewField;
  answer: Answer | undefined;
  busy: boolean;
  onSave: (value: unknown) => Promise<boolean>;
  onNext: () => void;
}) {
  const initial = Array.isArray(answer?.value)
    ? (answer!.value as string[])
    : answer?.value
      ? [String(answer.value)]
      : [];
  const [selected, setSelected] = useState<string[]>(initial);
  const [other, setOther] = useState('');

  function toggle(option: string) {
    if (field.multi) {
      setSelected((current) =>
        current.includes(option) ? current.filter((c) => c !== option) : [...current, option]
      );
    } else {
      setSelected([option]);
    }
  }

  const all = other.trim() ? [...selected, other.trim()] : selected;

  return (
    <>
      <div className="chips">
        {(field.options ?? []).map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            aria-pressed={selected.includes(option)}
            onClick={() => toggle(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {field.kind === 'chips_with_other' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="other">Something else?</label>
          <input
            id="other"
            type="text"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Type it here"
          />
        </div>
      )}

      <button
        className="primary"
        disabled={busy || all.length === 0}
        onClick={async () => {
          if (await onSave(all)) onNext();
          else onNext();
        }}
      >
        {busy ? 'Saving…' : 'Next'}
      </button>
    </>
  );
}

/**
 * A free-text answer, plus the two follow-ups the register asks for: exactly
 * one concrete question when the answer is vague, and the "what would you say
 * if they asked?" framing that caps how strongly the claim can be phrased.
 */
function TextAnswer({
  field,
  answer,
  busy,
  onSave,
  onSaveFollowup,
  onNext,
}: {
  field: InterviewField;
  answer: Answer | undefined;
  busy: boolean;
  onSave: (value: unknown, verificationFraming?: string) => Promise<boolean>;
  onSaveFollowup: (text: string) => Promise<boolean>;
  onNext: () => void;
}) {
  const [text, setText] = useState(typeof answer?.value === 'string' ? answer.value : '');
  const [framing, setFraming] = useState(answer?.verificationFraming ?? '');
  const [followupQuestion, setFollowupQuestion] = useState(answer?.followupQuestion ?? null);
  const [followupText, setFollowupText] = useState(answer?.followupAnswer ?? '');
  const [askedFraming, setAskedFraming] = useState(Boolean(answer?.verificationFraming));

  return (
    <>
      <div className="field">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
        />
      </div>

      {followupQuestion && (
        <div className="card">
          <strong>{followupQuestion}</strong>
          <div className="field" style={{ margin: '10px 0 0' }}>
            <textarea
              value={followupText}
              onChange={(e) => setFollowupText(e.target.value)}
              rows={2}
              placeholder="A name, a place, or a number is enough"
            />
          </div>
          <button
            className="secondary"
            disabled={busy || !followupText.trim()}
            onClick={async () => {
              if (await onSaveFollowup(followupText)) setFollowupQuestion(null);
            }}
          >
            Save that
          </button>
        </div>
      )}

      {field.askVerificationFraming && text.trim().length > 0 && askedFraming && (
        <div className="card">
          <strong>If someone replied and asked you about this, what would you say?</strong>
          <p className="help" style={{ marginTop: 4 }}>
            We keep your emails within what you can back up in a conversation. This is the answer
            you would give.
          </p>
          <div className="field" style={{ margin: '10px 0 0' }}>
            <textarea
              value={framing}
              onChange={(e) => setFraming(e.target.value)}
              rows={2}
              placeholder="In your own words"
            />
          </div>
        </div>
      )}

      <button
        className="primary"
        disabled={busy || text.trim().length === 0}
        onClick={async () => {
          const concrete = await onSave(text, framing.trim() || undefined);

          // A vague answer earns exactly one question. If it came back thin and
          // we have not asked yet, stay on this screen and ask.
          if (!concrete && !followupQuestion) {
            const response = await fetch('/api/onboarding/answer', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ field: field.key, value: text }),
            });
            const payload = await response.json();
            if (payload.followupQuestion) {
              setFollowupQuestion(payload.followupQuestion);
              return;
            }
          }

          if (field.askVerificationFraming && !askedFraming) {
            setAskedFraming(true);
            return;
          }
          onNext();
        }}
      >
        {busy ? 'Saving…' : 'Next'}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The hygiene questions. Sourcing runs behind the scenes, so without these the
 * queue can put the user's own employer in front of them on day one.
 */
function Hygiene({
  fields,
  onError,
  onDone,
}: {
  fields: InterviewField[];
  onError: (message: string | null) => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ blocked: string[]; unmatched: string[] } | null>(null);

  if (result) {
    return (
      <>
        <h1>Noted.</h1>
        {result.blocked.length > 0 && (
          <div className="notice info">
            <strong>We will leave these alone</strong>
            {result.blocked.join(', ')}
          </div>
        )}
        {result.unmatched.length > 0 && (
          <div className="notice warn">
            <strong>We could not find these in our list yet</strong>
            {result.unmatched.join(', ')} — we have saved the names, and they stay blocked if those
            companies come up later.
          </div>
        )}
        <button className="primary" onClick={onDone}>
          Next
        </button>
      </>
    );
  }

  return (
    <>
      <h1>Anywhere we should stay away from?</h1>
      <p className="lede">
        The UAE is a small professional world. This is how we avoid an awkward email.
      </p>

      {fields.map((field) => (
        <div className="field" key={field.key}>
          <label htmlFor={field.key}>{field.question}</label>
          {field.help && <p className="help" style={{ marginBottom: 6 }}>{field.help}</p>}
          <input
            id={field.key}
            type="text"
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
          />
        </div>
      ))}

      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          onError(null);
          try {
            const response = await fetch('/api/onboarding/hygiene', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            });
            const payload = await response.json();
            if (!response.ok) {
              onError(payload.error ?? 'That did not save. Try once more.');
              return;
            }
            if (payload.blocked.length === 0 && payload.unmatched.length === 0) onDone();
            else setResult(payload);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Next'}
      </button>
      <button className="linkish" onClick={onDone}>
        Nothing to avoid
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The CV step. Roughly half of positive replies ask for one, and a blank
 * document at that moment is where the momentum dies.
 */
function Cv({
  existing,
  onError,
  onDone,
}: {
  existing: { id: string; origin: string; filename: string; approved: boolean } | null;
  onError: (message: string | null) => void;
  onDone: () => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(existing?.id ?? null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    onError(null);
    try {
      const response = await fetch('/api/onboarding/cv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      });
      const payload = await response.json();
      if (!response.ok) {
        onError(payload.error ?? 'We could not make the file just now.');
        return;
      }
      setId(payload.id);
      setPreview(payload.preview);
      setWarning(payload.warning);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    onError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/onboarding/cv', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) {
        onError(payload.error ?? 'That file did not upload.');
        return;
      }
      setId(payload.id);
      setPreview(null);
      setWarning(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Your CV</h1>
      <p className="lede">
        When someone replies, the next thing they ask for is this. Having it ready now is the
        difference between answering in an hour and answering in four days.
      </p>

      {warning && <div className="notice warn">{warning}</div>}

      {preview && (
        <div className="card">
          <strong>Here is what we made from your answers</strong>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              margin: '10px 0 0',
              fontSize: 15,
            }}
          >
            {preview}
          </pre>
          <a className="linkish" href={`/api/onboarding/cv?id=${id}`} target="_blank" rel="noreferrer">
            Open the file
          </a>
        </div>
      )}

      {existing && !preview && (
        <div className="notice info">
          <strong>You already have one</strong>
          {existing.filename}
        </div>
      )}

      <div className="stack">
        <button className="primary" onClick={generate} disabled={busy}>
          {busy ? 'Working…' : preview ? 'Make it again' : 'Make one from my answers'}
        </button>

        <label
          className="button secondary"
          style={{ cursor: 'pointer' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget.querySelector('input') as HTMLInputElement)?.click();
          }}
        >
          Upload my own instead
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        {CV_COACHING.map((line) => (
          <p key={line} className="muted" style={{ marginBottom: 8 }}>
            {line}
          </p>
        ))}
      </div>

      <button className="primary" onClick={() => void onDone()} disabled={busy || !id}>
        {id ? 'Done — finish setup' : 'Make or upload a CV first'}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function Done() {
  return (
    <>
      <h1>You&rsquo;re set up.</h1>
      <p className="lede">
        We are finding the right people to write to now. Your first emails will be waiting for you
        shortly.
      </p>
      <div className="card">
        <p style={{ margin: 0 }}>
          <strong>What happens next.</strong> Each email arrives with the reason it was written
          beside it — the exact thing we found, and where. You read it, you decide, you send. Most
          replies land between five and twelve days in, so quiet at first is normal.
        </p>
      </div>
      <a className="button primary" href="/today">
        See today
      </a>
    </>
  );
}
