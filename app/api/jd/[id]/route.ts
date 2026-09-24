import { NextRequest, NextResponse } from 'next/server';
import { jdKey } from '@/lib/importer';
import { parseSalaryText } from '@/lib/salary';
import { deleteBlobs, getBlob, putBlob, readDb, updateDb } from '@/lib/store';
import { JD_MAX_CHARS } from '@/lib/ats-registry';

export const runtime = 'nodejs';

/**
 * A role's full job description. Scraped roles get theirs from the board;
 * for anything added by hand you can paste it, which is what the AI fit
 * analysis and tailoring work from.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const text = await getBlob(jdKey(id));
  if (text === null) {
    const db = await readDb();
    if (!db.applications.some((a) => a.id === id)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  }
  return NextResponse.json({ text });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || '').replace(/\r\n?/g, '\n').trim().slice(0, JD_MAX_CHARS);

  const app = await updateDb((db) => {
    const found = db.applications.find((a) => a.id === id);
    if (!found) return null;
    found.hasDescription = text.length > 0;
    // Pasted text often states the pay; pick it up unless you've set it yourself.
    const pay = parseSalaryText(text);
    if (pay && found.salarySource !== 'manual' && found.salarySource !== 'posted') {
      found.salaryMin = pay.minMonthlyAed;
      found.salaryMax = pay.maxMonthlyAed;
      found.salarySource = 'text';
      found.salaryText = pay.raw;
    }
    return found;
  });
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (text) await putBlob(jdKey(id), text);
  else await deleteBlobs([jdKey(id)]);
  return NextResponse.json({ ok: true, application: app });
}
