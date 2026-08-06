import { NextResponse, type NextRequest } from 'next/server';

import { addWindow, deleteWindow, listWindows, loadCalendar, updateWindow } from '@/lib/calendar-store';
import { todayUae } from '@/lib/calendar';
import { previewCadence, recomputeDerivedDates } from '@/lib/derived-dates';

export const dynamic = 'force-dynamic';

/**
 * The calendar the whole state machine counts against.
 *
 * Every write recomputes derived dates immediately, so an edit is never a
 * change that takes effect "next time the sweep runs" — the founder confirms
 * an Eid window and sees the countdowns move in the same response.
 */
export async function GET(request: NextRequest) {
  const calendar = await loadCalendar();
  const from = request.nextUrl.searchParams.get('from') ?? todayUae();

  return NextResponse.json({
    version: calendar.version,
    windows: await listWindows(),
    preview: { sentDate: from, steps: previewCadence(from, calendar) },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const id = await addWindow(body);
    return NextResponse.json({ id, recompute: await recomputeDerivedDates() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not add that.' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, ...rest } = await request.json();
    if (!id) return NextResponse.json({ error: 'Which window?' }, { status: 400 });
    await updateWindow(id, rest);
    return NextResponse.json({ ok: true, recompute: await recomputeDerivedDates() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save that.' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which window?' }, { status: 400 });
    await deleteWindow(id);
    return NextResponse.json({ ok: true, recompute: await recomputeDerivedDates() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not remove that.' }, { status: 400 });
  }
}
