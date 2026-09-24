import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { updateDb } from '@/lib/store';
import { nextFollowUp } from '@/lib/outreach';
import { sanitize, ValidationError } from '@/lib/validate';
import { CONTACT_STATUSES, OUTREACH_STATUSES, type ContactStatus, type Db, type Outreach, type OutreachStatus } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Outreach bookkeeping that has to touch more than one record: logging a
 * send schedules the follow-ups and marks the contact emailed; a reply stops
 * the sequence and marks the contact replied. Done server-side in one write
 * so the Outreach and Contacts pages can't drift apart.
 */

/** The browser's local date (the UAE is UTC+4), trusted within a day of the server's. */
function dayFrom(raw: unknown): string {
  const server = new Date().toISOString().slice(0, 10);
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return server;
  const gap = Math.abs(Date.parse(raw) - Date.parse(server)) / 86_400_000;
  return gap <= 1 ? raw : server;
}

/** Contacts only move forward: a reply never gets knocked back to "emailed". */
function advanceContact(db: Db, contactId: string | undefined, to: ContactStatus) {
  if (!contactId) return;
  const c = db.contacts.find((x) => x.id === contactId);
  if (c && CONTACT_STATUSES.indexOf(c.status) < CONTACT_STATUSES.indexOf(to)) c.status = to;
}

function markSent(db: Db, o: Outreach, today: string) {
  o.status = 'sent';
  o.sentAt = o.sentAt || today;
  o.nextFollowUpAt = nextFollowUp(o.sentAt, o.followUps || 0);
  advanceContact(db, o.contactId, 'emailed');
}

const FIELDS = ['toName', 'toEmail', 'companyName', 'subject', 'body', 'contactId', 'applicationId', 'role', 'templateId', 'language', 'aiAssisted'] as const;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = sanitize(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e instanceof ValidationError ? e.message : 'body was not valid JSON' }, { status: 400 });
  }
  const action = String(body.action || '');
  const today = dayFrom(body.today);

  if (action === 'send' || action === 'queue') {
    if (!body.toName || !body.subject) {
      return NextResponse.json({ error: 'a recipient name and subject are needed' }, { status: 400 });
    }
    const item = await updateDb((db) => {
      const o = { id: randomUUID(), status: 'ready', followUps: 0, companyName: '', body: '', createdAt: new Date().toISOString() } as Outreach;
      for (const k of FIELDS) if (body[k] !== undefined) (o as unknown as Record<string, unknown>)[k] = body[k];
      if (action === 'send') markSent(db, o, today);
      db.outreach.unshift(o);
      return o;
    });
    return NextResponse.json(item, { status: 201 });
  }

  const id = String(body.id || '');
  const result = await updateDb((db) => {
    const o = db.outreach.find((x) => x.id === id);
    if (!o) return null;

    if (action === 'followup') {
      o.followUps = (o.followUps || 0) + 1;
      o.lastFollowUpAt = today;
      o.nextFollowUpAt = nextFollowUp(today, o.followUps);
      return o;
    }

    if (action === 'status') {
      const status = String(body.status) as OutreachStatus;
      if (!OUTREACH_STATUSES.includes(status)) return 'bad-status' as const;
      if (status === 'sent') {
        markSent(db, o, today);
      } else {
        o.status = status;
        if (status === 'replied') {
          o.repliedAt = today;
          o.nextFollowUpAt = undefined;
          advanceContact(db, o.contactId, 'replied');
        } else if (status === 'no-reply') {
          o.nextFollowUpAt = undefined;
        }
      }
      return o;
    }
    return 'bad-action' as const;
  });

  if (result === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (result === 'bad-status') return NextResponse.json({ error: 'unknown status' }, { status: 400 });
  if (result === 'bad-action') return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  return NextResponse.json(result);
}
