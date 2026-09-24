import { NextRequest, NextResponse } from 'next/server';
import { aiErrorResponse } from '@/lib/ai';
import { loadContext } from '@/lib/ai-context';
import { analyseFit, prepareInterview } from '@/lib/ai-role';
import { getBlob, putBlob, readDb, updateDb } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Fit & tailoring (kind=fit) and interview prep (kind=prep) for one role.
 * GET returns the saved result; POST generates a fresh one.
 */

const KEY = { fit: (id: string) => `fit:${id}`, prep: (id: string) => `kit:${id}` } as const;
type Kind = keyof typeof KEY;

function parseKind(v: unknown): Kind | null {
  return v === 'fit' || v === 'prep' ? v : null;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('applicationId') || '';
  const kind = parseKind(req.nextUrl.searchParams.get('kind'));
  if (!id || !kind) return NextResponse.json({ error: 'applicationId and kind are required' }, { status: 400 });
  const raw = await getBlob(KEY[kind](id));
  return NextResponse.json({ result: raw ? JSON.parse(raw) : null });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.applicationId || '');
  const kind = parseKind(body.kind);
  if (!id || !kind) return NextResponse.json({ error: 'applicationId and kind are required' }, { status: 400 });

  const db = await readDb();
  if (!db.applications.some((a) => a.id === id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const ctx = await loadContext(db, { applicationId: id });
  const today = new Date().toISOString().slice(0, 10);

  try {
    const generatedAt = new Date().toISOString();
    if (kind === 'fit') {
      const { data, usage } = await analyseFit(ctx);
      const result = { ...data, generatedAt, usage, usedCv: Boolean(ctx.cv), usedJd: Boolean(ctx.jd) };
      await putBlob(KEY.fit(id), JSON.stringify(result));
      // The score rides on the role so the pipeline can show and sort by it.
      const app = await updateDb((live) => {
        const a = live.applications.find((x) => x.id === id);
        if (a) {
          a.aiFit = data.fitScore;
          a.aiVerdict = data.verdict;
        }
        return a;
      });
      return NextResponse.json({ result, application: app });
    }
    const { data, usage, searches } = await prepareInterview(ctx, today);
    const result = { ...data, generatedAt, usage, searches, usedCv: Boolean(ctx.cv), usedJd: Boolean(ctx.jd) };
    await putBlob(KEY.prep(id), JSON.stringify(result));
    return NextResponse.json({ result });
  } catch (e) {
    const { status, body: err } = aiErrorResponse(e);
    return NextResponse.json(err, { status });
  }
}
