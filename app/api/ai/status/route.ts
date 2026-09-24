import { NextResponse } from 'next/server';
import { AI_MODEL, aiConfigured } from '@/lib/ai';

export const runtime = 'nodejs';

/** Whether AI features are switched on, for the UI to show or explain them. */
export async function GET() {
  return NextResponse.json({ configured: aiConfigured(), model: AI_MODEL });
}
