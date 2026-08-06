import { NextRequest, NextResponse } from 'next/server';
import { discoverBoards } from '@/lib/ats';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Works out which ATS a company uses by trying its name across all platforms. */
export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company')?.trim();
  if (!company) {
    return NextResponse.json({ error: 'company is required' }, { status: 400 });
  }
  try {
    const boards = await discoverBoards(company);
    return NextResponse.json({ boards });
  } catch {
    return NextResponse.json({ error: 'discovery failed' }, { status: 502 });
  }
}
