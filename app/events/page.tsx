'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, create, list, patch, remove } from '@/lib/client';
import {
  checklistFor,
  checklistProgress,
  eventTiming,
  formatEventDates,
  googleCalendarUrl,
  sortEvents,
  todayLocal,
} from '@/lib/events';
import { findByName, indexByName } from '@/lib/names';
import { INTERESTS, INTEREST_IDS, eventInterests, type InterestId } from '@/lib/interests';
import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  EVENT_KIND_LABELS,
  EVENT_STATUSES,
  type CareerEvent,
  type Company,
  type Contact,
  type ContactKind,
  type EventKind,
  type EventStatus,
} from '@/lib/types';

interface DiscoveryStatus {
  configured: boolean;
  last: { at: string; added: number; updated: number; searches: number; costUsd: number } | null;
}

/** Seeded events have stable ids; anything you add gets a UUID. */
const isSeeded = (e: CareerEvent) => e.id.startsWith('ev-');

const EMPTY_FORM = {
  name: '',
  kind: 'emirati-fair' as EventKind,
  startDate: '',
  endDate: '',
  venue: '',
  city: '',
  url: '',
};

export default function Events() {
  const [events, setEvents] = useState<CareerEvent[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryStatus | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryMsg, setDiscoveryMsg] = useState('');
  const [fieldFilter, setFieldFilter] = useState<InterestId[]>([]);
  const today = todayLocal();

  async function load() {
    const [e, c, k] = await Promise.all([
      list<CareerEvent>('events'),
      list<Company>('companies'),
      list<Contact>('contacts'),
    ]);
    setEvents(e);
    setCompanies(c);
    setContacts(k);
  }

  useEffect(() => {
    (async () => {
      // Pull in any events added to the starter set since this database was
      // created. Idempotent, so running it on every visit is harmless.
      await api('/api/sync-seed', { method: 'POST' }).catch(() => undefined);
      await load();
      setLoaded(true);
      api<DiscoveryStatus>('/api/events-discover').then(setDiscovery).catch(() => undefined);
    })();
  }, []);

  async function discover() {
    setDiscovering(true);
    setDiscoveryMsg('');
    try {
      const r = await api<{ added: string[]; updated: Array<{ name: string; fields: string[] }>; searches: number; usage: { costUsd: number } }>(
        '/api/events-discover',
        { method: 'POST' }
      );
      await load();
      const parts = [
        r.added.length ? `Added ${r.added.join(', ')}.` : 'No new events.',
        r.updated.length ? `Updated ${r.updated.map((u) => `${u.name} (${u.fields.join(', ')})`).join('; ')}.` : '',
        `${r.searches} searches, about $${r.usage.costUsd.toFixed(2)}.`,
      ];
      setDiscoveryMsg(parts.filter(Boolean).join(' '));
      setDiscovery(await api<DiscoveryStatus>('/api/events-discover'));
    } catch (e) {
      setDiscoveryMsg(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setDiscovering(false);
    }
  }

  async function addContact(fields: Partial<Contact>) {
    const item = await create<Contact>('contacts', { ...fields, status: 'identified' });
    setContacts((prev) => [item, ...prev]);
  }

  const companyIndex = useMemo(() => indexByName(companies), [companies]);

  async function save(id: string, fields: Partial<CareerEvent>) {
    const updated = await patch<CareerEvent>('events', id, fields);
    setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
  }

  async function del(id: string) {
    await remove('events', id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return setFormError('Give the event a name.');
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
      return setFormError('The end date is before the start date.');
    }
    const item = await create<CareerEvent>('events', {
      ...form,
      name: form.name.trim(),
      startDate: form.startDate || undefined,
      endDate: form.endDate || form.startDate || undefined,
      url: form.url || undefined,
      status: 'interested',
      exhibitors: [],
    });
    setEvents((prev) => [...prev, item]);
    setForm(EMPTY_FORM);
  }

  const visible = events.filter(
    (e) =>
      (showHidden || !e.hidden) &&
      // Fields narrow to events tagged with them; career fairs for nationals stay, since every sector recruits there.
      (!fieldFilter.length || e.kind === 'emirati-fair' || fieldFilter.some((f) => eventInterests(e).includes(f)))
  );
  const withTiming = visible.map((e) => ({ event: e, timing: eventTiming(e, today) }));
  const current = sortEvents(
    withTiming.filter((x) => x.timing.state === 'upcoming' || x.timing.state === 'live').map((x) => x.event)
  );
  const undated = sortEvents(withTiming.filter((x) => x.timing.state === 'tbc').map((x) => x.event));
  const past = sortEvents(withTiming.filter((x) => x.timing.state === 'ended').map((x) => x.event)).reverse();
  const hiddenCount = events.filter((e) => e.hidden).length;

  if (!loaded) return <p className="muted">Loading…</p>;

  const card = (e: CareerEvent) => (
    <EventCard
      key={e.id}
      event={e}
      today={today}
      companyIndex={companyIndex}
      met={contacts.filter((c) => c.metAtEventId === e.id)}
      onAddContact={addContact}
      onSave={(fields) => save(e.id, fields)}
      onDelete={() => del(e.id)}
    />
  );

  return (
    <div>
      <h1>Career events</h1>
      <p className="subtitle">
        Emirati-only career fairs are the highest-density hiring opportunity of the year: every
        employer in the room is there specifically to hire UAE Nationals, and hiring managers attend
        in person. Email recruiters at the exhibiting companies <em>before</em> you go. Walking up to
        a stand where they&apos;re expecting you beats walking up cold.
      </p>

      <div className="card mb flex spread" style={{ fontSize: 13 }}>
        <div>
          <strong>Keeping this list current</strong>
          <div className="muted">
            {discovery?.configured
              ? discovery.last
                ? `Checked the web on ${discovery.last.at.slice(0, 10)}: ${discovery.last.added} added, ${discovery.last.updated} updated. It checks again every Monday.`
                : 'Every Monday the app searches the web for new UAE career fairs and newly announced dates.'
              : 'With an Anthropic API key, the app searches the web every Monday for new UAE career fairs and newly announced dates.'}
          </div>
          {discoveryMsg && <div className="mt">{discoveryMsg}</div>}
        </div>
        {discovery?.configured ? (
          <button className="fixed" disabled={discovering} onClick={discover}>
            {discovering ? 'Searching… (1–2 minutes)' : '🔎 Check for new events now'}
          </button>
        ) : (
          <Link className="btn small" href="/profile">
            Set up AI
          </Link>
        )}
      </div>

      <div className="flex mb" style={{ fontSize: 13 }}>
        <span className="muted">Fields:</span>
        {INTEREST_IDS.map((id) => {
          const on = fieldFilter.includes(id);
          const n = events.filter((e) => !e.hidden && eventInterests(e).includes(id)).length;
          return (
            <button
              key={id}
              className={on ? 'small primary' : 'small'}
              title={INTERESTS[id].description}
              onClick={() => setFieldFilter(on ? fieldFilter.filter((f) => f !== id) : [...fieldFilter, id])}
            >
              {INTERESTS[id].label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          );
        })}
        {fieldFilter.length > 0 && <span className="muted">Emirati career fairs always show: every sector recruits there.</span>}
      </div>

      {/* One shared list for every card's "add exhibitor" box — a copy per
          card would be thousands of DOM nodes. */}
      <datalist id="event-company-names">
        {companies.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      <h2>Coming up</h2>
      {current.length === 0 && <div className="card muted">Nothing scheduled. Add an event below.</div>}
      {current.map(card)}

      {undated.length > 0 && (
        <>
          <h2>Dates not announced yet</h2>
          <p className="muted mb" style={{ fontSize: 13 }}>
            Recurring events worth watching for. Add dates when the organiser announces them and
            they&apos;ll move up into the countdown.
          </p>
          {undated.map(card)}
        </>
      )}

      {past.length > 0 && (
        <>
          <h2>
            <button className="small" onClick={() => setShowPast(!showPast)}>
              {showPast ? '▾' : '▸'} Past events ({past.length})
            </button>
          </h2>
          {showPast && past.map(card)}
        </>
      )}

      <div className="card mt">
        <h2 style={{ marginTop: 0 }}>Add an event</h2>
        <form onSubmit={addEvent}>
          <div className="form-row">
            <input
              placeholder="Event name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              className="fixed"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as EventKind })}
            >
              {(Object.keys(EVENT_KIND_LABELS) as EventKind[]).map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div>
              <label>Starts</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div>
              <label>Ends</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
            <div>
              <label>Venue</label>
              <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
            </div>
            <div>
              <label>City</label>
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <input
              placeholder="Website (optional)"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
            <button className="primary fixed" type="submit">
              Add event
            </button>
          </div>
          {formError && <p className="error">{formError}</p>}
        </form>
      </div>

      {hiddenCount > 0 && (
        <p className="muted mt" style={{ fontSize: 13 }}>
          {hiddenCount} hidden event{hiddenCount === 1 ? '' : 's'}.{' '}
          <button className="small" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Hide them again' : 'Show'}
          </button>
        </p>
      )}
    </div>
  );
}

function EventCard({
  event,
  today,
  companyIndex,
  met,
  onAddContact,
  onSave,
  onDelete,
}: {
  event: CareerEvent;
  today: string;
  companyIndex: Map<string, Company>;
  met: Contact[];
  onAddContact: (fields: Partial<Contact>) => Promise<void>;
  onSave: (fields: Partial<CareerEvent>) => void;
  onDelete: () => void;
}) {
  const [notes, setNotes] = useState(event.notes || '');
  const [newExhibitor, setNewExhibitor] = useState('');
  const [startDate, setStartDate] = useState(event.startDate || '');
  const [endDate, setEndDate] = useState(event.endDate || '');

  const timing = eventTiming(event, today);
  const progress = checklistProgress(event);
  const calendarUrl = googleCalendarUrl(event);
  const exhibitors = event.exhibitors || [];
  const ended = timing.state === 'ended';

  const timingBadge =
    timing.state === 'live' ? 'badge-uae' : timing.soon ? 'badge-soon' : 'badge-status';

  // After the event the useful email is the follow-up; before it, the intro.
  const emailTemplate = ended ? 't8' : 't7';
  const emailLabel = ended ? '✉ Follow-up' : '✉ Pre-event email';

  function addExhibitor() {
    const name = newExhibitor.trim();
    if (!name) return;
    const already = exhibitors.some((x) => x.toLowerCase() === name.toLowerCase());
    if (!already) onSave({ exhibitors: [...exhibitors, name] });
    setNewExhibitor('');
  }

  return (
    <div className="card mb" style={{ opacity: event.hidden ? 0.55 : 1 }}>
      <div className="flex spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>{event.name}</h2>
          <div className="flex" style={{ gap: 6, marginTop: 6 }}>
            <span className={`badge ${event.kind === 'emirati-fair' ? 'badge-uae' : 'badge-target'}`}>
              {EVENT_KIND_LABELS[event.kind]}
            </span>
            <span className={`badge ${timingBadge}`}>{timing.label}</span>
            {event.hidden && <span className="badge badge-backup">hidden</span>}
            {eventInterests(event).map((id) => (
              <span key={id} className="badge badge-target" title={INTERESTS[id].label}>
                {INTERESTS[id].short}
              </span>
            ))}
            {event.discovered && (
              <span className="badge badge-status" title="Found by the weekly web search. Check the source before relying on it.">
                found online
              </span>
            )}
          </div>
        </div>
        <select
          className="fixed"
          style={{ width: 'auto' }}
          value={event.status}
          onChange={(e) => onSave({ status: e.target.value as EventStatus })}
          aria-label="Your status for this event"
        >
          {EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <p className="mt" style={{ fontSize: 13 }}>
        <strong>{formatEventDates(event)}</strong>
        {event.hours ? ` · ${event.hours}` : ''} · {[event.venue, event.city].filter(Boolean).join(', ')}
      </p>
      {event.description && (
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {event.description}
        </p>
      )}

      <div className="flex mt" style={{ gap: 6 }}>
        {event.registerUrl && !ended && (
          <a
            className={`btn small${event.status === 'interested' ? ' primary' : ''}`}
            href={event.registerUrl}
            target="_blank"
            rel="noreferrer"
          >
            Register ↗
          </a>
        )}
        {event.url && (
          <a className="btn small" href={event.url} target="_blank" rel="noreferrer">
            {isSeeded(event) && event.url.includes('gulfnews') ? 'Coverage ↗' : 'Website ↗'}
          </a>
        )}
        {calendarUrl && !ended && (
          <a className="btn small" href={calendarUrl} target="_blank" rel="noreferrer">
            Add to Google Calendar ↗
          </a>
        )}
        {event.sourceUrl && event.sourceUrl !== event.url && (
          <a className="btn small" href={event.sourceUrl} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        )}
        {isSeeded(event) ? (
          <button className="small" onClick={() => onSave({ hidden: !event.hidden })}>
            {event.hidden ? 'Unhide' : 'Hide'}
          </button>
        ) : (
          <button className="small danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>

      {timing.state === 'tbc' && (
        <div className="form-row mt">
          <div>
            <label>Starts (once announced)</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label>Ends</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button
            className="fixed"
            style={{ alignSelf: 'flex-end' }}
            disabled={!startDate || (Boolean(endDate) && endDate < startDate)}
            onClick={() => onSave({ startDate, endDate: endDate || startDate })}
          >
            Set dates
          </button>
        </div>
      )}

      <details className="mt" open={timing.soon && !ended}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          Prep checklist · {progress.done}/{progress.total}
        </summary>
        <ul className="checklist">
          {checklistFor(event.kind).map((item) => {
            const done = Boolean(event.checklist?.[item.id]);
            return (
              <li key={item.id}>
                <input
                  type="checkbox"
                  id={`${event.id}-${item.id}`}
                  checked={done}
                  onChange={() =>
                    onSave({ checklist: { ...(event.checklist || {}), [item.id]: !done } })
                  }
                />
                <label htmlFor={`${event.id}-${item.id}`} className={done ? 'done' : ''} style={{ margin: 0, color: 'inherit', fontSize: 13 }}>
                  {item.label}
                </label>
              </li>
            );
          })}
        </ul>
      </details>

      <details className="mt" open={exhibitors.length > 0 && !ended}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          {ended ? 'Exhibitors' : 'Likely exhibitors'} · {exhibitors.length}
        </summary>
        {event.exhibitorsNote && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {event.exhibitorsNote}
          </p>
        )}
        <div className="chips">
          {exhibitors.map((name) => {
            const company = findByName(companyIndex, name);
            const query = `"${company?.name || name}" recruiter OR "talent acquisition" OR emiratisation`;
            return (
              <span key={name} className="chip">
                <strong>{company?.name || name}</strong>
                {company && <span className={`badge badge-${company.tier}`}>{company.tier}</span>}
                <a
                  href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Find recruiters and Emiratisation leads on LinkedIn"
                >
                  in: people ↗
                </a>
                <Link
                  href={`/outreach?company=${encodeURIComponent(company?.name || name)}&event=${encodeURIComponent(
                    event.name
                  )}&template=${emailTemplate}`}
                >
                  {emailLabel}
                </Link>
                <span
                  style={{ cursor: 'pointer', opacity: 0.6 }}
                  title="Remove"
                  onClick={() => onSave({ exhibitors: exhibitors.filter((x) => x !== name) })}
                >
                  ✕
                </span>
              </span>
            );
          })}
        </div>
        <div className="form-row mt">
          <input
            list="event-company-names"
            placeholder="Add an exhibitor…"
            value={newExhibitor}
            onChange={(e) => setNewExhibitor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addExhibitor();
              }
            }}
          />
          <button className="fixed" onClick={addExhibitor}>
            Add
          </button>
        </div>
      </details>

      {ended && (event.status === 'registered' || event.status === 'attending' || event.status === 'interested') && (
        <div className="flex mt" style={{ fontSize: 13 }}>
          <span>Did you go?</span>
          <button className="small primary" onClick={() => onSave({ status: 'attended' })}>
            Yes
          </button>
          <button className="small" onClick={() => onSave({ status: 'skipped' })}>
            No
          </button>
        </div>
      )}

      {(timing.state === 'live' || event.status === 'attending' || event.status === 'attended') && (
        <MetPeople event={event} met={met} onAdd={onAddContact} />
      )}

      <div className="flex mt" style={{ fontSize: 12, gap: 6 }}>
        <span className="muted">Fields:</span>
        {INTEREST_IDS.map((id) => {
          const current = eventInterests(event);
          const on = current.includes(id);
          return (
            <button
              key={id}
              className={on ? 'small primary' : 'small'}
              title={event.interests ? 'Click to change' : 'Guessed from the name — click to set it yourself'}
              onClick={() =>
                onSave({ interests: on ? current.filter((f) => f !== id) : INTEREST_IDS.filter((f) => f === id || current.includes(f)) })
              }
            >
              {INTERESTS[id].short}
            </button>
          );
        })}
      </div>

      <div className="mt">
        <label>Notes: who you met, what they said, what to follow up</label>
        <textarea
          style={{ minHeight: 70 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (event.notes || '')) onSave({ notes });
          }}
        />
      </div>
    </div>
  );
}

/** People met at an event: captured on the day, followed up within 48 hours. */
function MetPeople({
  event,
  met,
  onAdd,
}: {
  event: CareerEvent;
  met: Contact[];
  onAdd: (fields: Partial<Contact>) => Promise<void>;
}) {
  const [f, setF] = useState({ name: '', role: '', companyName: '', email: '', note: '', kind: 'ta-recruiter' as ContactKind });
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !f.companyName.trim()) return;
    setBusy(true);
    await onAdd({
      name: f.name.trim(),
      role: f.role.trim(),
      companyName: f.companyName.trim(),
      email: f.email.trim() || undefined,
      emailStatus: f.email.trim() ? 'verified' : 'unknown',
      kind: f.kind,
      metAtEventId: event.id,
      notes: f.note.trim() || undefined,
      // The follow-up template already says where you met; the hook adds what you talked about.
      hook: f.note.trim() ? `You mentioned ${f.note.trim()}, and I'd love to hear more about it.` : undefined,
    });
    setF({ ...f, name: '', role: '', email: '', note: '' });
    setBusy(false);
  }

  return (
    <details className="mt" open>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>People you met · {met.length}</summary>
      {met.length > 0 && (
        <table className="mt" style={{ fontSize: 13 }}>
          <tbody>
            {met.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="muted">
                    {c.role ? `${c.role}, ` : ''}
                    {c.companyName}
                  </div>
                </td>
                <td className="muted">{c.status}</td>
                <td>
                  {c.status === 'identified' ? (
                    <Link
                      className="btn small primary"
                      href={`/outreach?contactId=${encodeURIComponent(c.id)}&to=${encodeURIComponent(c.name)}&email=${encodeURIComponent(c.email || '')}&company=${encodeURIComponent(c.companyName)}&hook=${encodeURIComponent(c.hook || '')}&event=${encodeURIComponent(event.name)}&template=t8`}
                    >
                      ✉ Follow up
                    </Link>
                  ) : (
                    <span className="success">✓ followed up</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={add} className="mt">
        <div className="form-row">
          <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
          <input list="event-company-names" placeholder="Company" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
          <input placeholder="Email (from their card)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </div>
        <div className="form-row">
          <input placeholder="What you talked about (becomes the hook in your follow-up)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <select className="fixed" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ContactKind })}>
            {CONTACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {CONTACT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <button className="fixed" type="submit" disabled={busy || !f.name.trim() || !f.companyName.trim()}>
            Add person
          </button>
        </div>
      </form>
    </details>
  );
}
