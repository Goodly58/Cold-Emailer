import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readDb, updateDb } from '@/lib/store';
import { discoverBoards } from '@/lib/ats';
import { mapWithConcurrency } from '@/lib/http';
import type { JobSource } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Sweeps a batch of companies looking for public job boards and registers any
 * it finds as sources.
 *
 * Runs in batches rather than over the whole list at once: each company costs
 * a couple of dozen probe requests, and serverless functions have a hard
 * execution ceiling. The UI walks through the list a batch at a time.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const offset = Math.max(0, Number(body.offset) || 0);
  const limit = Math.min(Math.max(1, Number(body.limit) || 8), 15);

  const db = await readDb();
  const tracked = new Set(db.jobSources.map((s) => s.companyName.trim().toLowerCase()));

  // Skip companies that already have a source; work through the rest in order.
  const queue = db.companies.filter((c) => !tracked.has(c.name.trim().toLowerCase()));
  const batch = queue.slice(offset, offset + limit);

  const found = await mapWithConcurrency(batch, 3, async (company) => {
    try {
      const boards = await discoverBoards(company.name, 6);
      return boards.length ? { company: company.name, board: boards[0] } : null;
    } catch {
      return null;
    }
  });

  const hits = found.filter((f): f is NonNullable<typeof f> => f !== null);

  if (hits.length > 0) {
    await updateDb((live) => {
      const already = new Set(live.jobSources.map((s) => `${s.platform}:${s.slug}`));
      for (const hit of hits) {
        const key = `${hit.board.platform}:${hit.board.slug}`;
        if (already.has(key)) continue;
        already.add(key);
        const source: JobSource = {
          id: randomUUID(),
          companyName: hit.company,
          platform: hit.board.platform,
          slug: hit.board.slug,
          enabled: true,
          createdAt: new Date().toISOString(),
        };
        live.jobSources.push(source);
      }
    });
  }

  return NextResponse.json({
    scanned: batch.length,
    found: hits.map((h) => ({
      company: h.company,
      platform: h.board.platform,
      slug: h.board.slug,
      jobCount: h.board.jobCount,
    })),
    nextOffset: offset + batch.length,
    remaining: Math.max(0, queue.length - (offset + batch.length)),
  });
}
