import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiErrorResponse, aiStructured } from '@/lib/ai';
import { findByName, indexByName } from '@/lib/names';
import { statsByTemplate } from '@/lib/outreach';
import { opportunity } from '@/lib/pay';
import { getBlob, putBlob, readDb } from '@/lib/store';
import { INTERESTS } from '@/lib/interests';
import { roleInterestTags } from '@/lib/scoring';
import { STAGES } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * A weekly look at the whole search: what the numbers say is working, what
 * isn't, and what to do this week. The model sees aggregate numbers only,
 * not your emails or contacts' details.
 */

const Review = z.object({
  headline: z.string().describe('One sentence: where the search stands'),
  working: z.array(z.string()).describe('What the numbers say is working, specific'),
  notWorking: z.array(z.string()).describe('What the numbers say is not working, specific'),
  thisWeek: z
    .array(z.object({ action: z.string(), why: z.string() }))
    .describe('3-5 concrete actions for this week, most important first'),
});

const KEY = 'meta:weekly-review';

const SYSTEM = `You are a pragmatic job-search coach reviewing an Emirati job seeker's UAE search from its numbers.
Base every point on the numbers given; if the data is too thin to judge something, say so rather than guessing. Benchmarks you may use: cold-email reply rates of 10-20% are good for well-targeted outreach and under 5% suggests generic emails or wrong recipients; application-to-interview rates of 5-15% are typical. Recommend small, concrete actions (e.g. "email the TA lead at the three dream companies you applied to"), not generic advice.`;

export async function GET() {
  const raw = await getBlob(KEY);
  return NextResponse.json({ review: raw ? JSON.parse(raw) : null });
}

export async function POST() {
  const db = await readDb();
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (d?: string) => (d ? (Date.parse(today) - Date.parse(d.slice(0, 10))) / 86_400_000 : Infinity);
  const index = indexByName(db.companies);

  const apps = db.applications.filter((a) => !a.dismissed);
  const byStage = Object.fromEntries(STAGES.map((s) => [s, apps.filter((a) => a.stage === s).length]));
  const sent = db.outreach.filter((o) => ['sent', 'replied', 'no-reply'].includes(o.status));
  const templateStats = [...statsByTemplate(db.outreach)].map(([id, s]) => ({
    template: db.templates.find((t) => t.id === id)?.name ?? id,
    ...s,
  }));
  const topOpen = apps
    .filter((a) => a.stage === 'found' && !a.closed)
    .map((a) => ({ a, o: opportunity(a, db.profile, findByName(index, a.companyName), today) }))
    .sort((x, y) => y.o.score - x.o.score)
    .slice(0, 5)
    .map(({ a, o }) => ({ role: a.roleTitle, company: a.companyName, score: o.score }));

  const stats = {
    today,
    profile: {
      targets: db.profile.targetTitles || '(not set)',
      fields: (db.profile.interests || []).map((id) => INTERESTS[id].label),
      hasCv: Boolean(db.profile.cvWords),
      minMonthlyPay: db.profile.minMonthlySalary ?? null,
    },
    pipeline: {
      byStage,
      appliedLast7Days: apps.filter((a) => a.appliedAt && daysAgo(a.appliedAt) <= 7).length,
      appliedLast30Days: apps.filter((a) => a.appliedAt && daysAgo(a.appliedAt) <= 30).length,
      newRolesLast7Days: apps.filter((a) => daysAgo(a.createdAt) <= 7).length,
      topOpenRoles: topOpen,
      byField: Object.fromEntries(
        (db.profile.interests || []).map((id) => {
          const inField = apps.filter((a) => roleInterestTags(a).tags.includes(id));
          return [
            INTERESTS[id].label,
            {
              open: inField.filter((a) => a.stage === 'found' && !a.closed).length,
              applied: inField.filter((a) => !['found', 'tailored'].includes(a.stage)).length,
              interviews: inField.filter((a) => a.stage === 'interview' || a.stage === 'offer').length,
            },
          ];
        })
      ),
    },
    outreach: {
      sentTotal: sent.length,
      sentLast7Days: sent.filter((o) => daysAgo(o.sentAt) <= 7).length,
      replied: sent.filter((o) => o.status === 'replied').length,
      followUpsOverdue: db.outreach.filter((o) => o.status === 'sent' && o.nextFollowUpAt && o.nextFollowUpAt < today).length,
      byTemplate: templateStats,
      aiAssistedReplyRate: (() => {
        const ai = sent.filter((o) => o.aiAssisted);
        return ai.length ? Math.round((ai.filter((o) => o.status === 'replied').length / ai.length) * 100) : null;
      })(),
    },
    contacts: {
      total: db.contacts.length,
      withEmail: db.contacts.filter((c) => c.email).length,
      byStatus: Object.fromEntries(['identified', 'emailed', 'replied', 'meeting', 'closed'].map((s) => [s, db.contacts.filter((c) => c.status === s).length])),
    },
    companies: {
      dream: db.companies.filter((c) => c.tier === 'dream').length,
      dreamWithAContact: db.companies.filter((c) => c.tier === 'dream' && db.contacts.some((k) => k.companyName === c.name)).length,
    },
    sources: {
      enabled: db.jobSources.filter((s) => s.enabled).length,
      failing: db.jobSources.filter((s) => (s.consecutiveFailures || 0) >= 3).length,
    },
    events: db.events
      .filter((e) => !e.hidden && e.startDate && e.startDate >= today)
      .slice(0, 5)
      .map((e) => ({ name: e.name, starts: e.startDate, yourStatus: e.status })),
  };

  try {
    const { data, usage } = await aiStructured({
      system: SYSTEM,
      content: `<numbers>\n${JSON.stringify(stats, null, 1)}\n</numbers>\n\nReview the search.`,
      schema: Review,
      effort: 'medium',
      maxTokens: 8000,
    });
    const review = { ...data, generatedAt: new Date().toISOString(), usage };
    await putBlob(KEY, JSON.stringify(review));
    return NextResponse.json({ review });
  } catch (e) {
    const { status, body } = aiErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}
