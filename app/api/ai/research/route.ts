import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aiErrorResponse, aiResearch } from '@/lib/ai';
import { candidateBlock, loadCv } from '@/lib/ai-context';
import { findByName, indexByName } from '@/lib/names';
import { readDb, updateDb } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Researches a company (and the person you're writing to, professionally)
 * with live web search, and suggests opening lines that reference something
 * real and recent. Findings are saved to the contact so the email drafter
 * can use them.
 */

const Findings = z.object({
  facts: z
    .array(
      z.object({
        fact: z.string().describe('One recent, specific fact, in one sentence'),
        date: z.string().describe('YYYY-MM when known, else ""'),
        url: z.string().describe('The source page'),
      })
    )
    .describe('Up to 6 facts, most recent and most useful for outreach first'),
  personNotes: z
    .string()
    .describe("Professional facts about the person: current role, time in role, previous employers, public talks or posts. \"\" if nothing was found or no person was named."),
  hooks: z
    .array(z.string())
    .describe('Up to 3 opening sentences for a cold email from the candidate, each under 35 words, each referencing one of the facts and linking it to the candidate'),
});

const SYSTEM = `You research UAE employers so an Emirati job seeker can write a specific, well-informed cold email.
Search for recent (last 12 months) news: launches, expansion, funding, partnerships, awards, leadership changes, hiring drives and Emiratisation initiatives. If a person is named, look only for professional information: their current role, career history, and public talks, interviews or posts. Never collect personal details such as family, home, health or religion.
Only report what a source you found actually says, with its URL. Prefer the company's own site, WAM, The National, Khaleej Times, Gulf News, Arabian Business and Zawya. If the search turns up nothing useful, record empty lists rather than guessing.
Opening lines must connect a real fact to the candidate using only what the candidate block says.`;

const Input = z.object({
  companyName: z.string().min(1).max(200),
  contactId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  const { companyName, contactId } = parsed.data;

  const db = await readDb();
  const contact = contactId ? db.contacts.find((c) => c.id === contactId) : undefined;
  const company = findByName(indexByName(db.companies), companyName);
  const cv = await loadCv();

  const who = contact ? `The person: ${contact.name}, ${contact.role || 'role unknown'} at ${companyName}.` : 'No specific person.';
  const prompt = `${candidateBlock(db.profile, cv)}

Company: ${company?.name ?? companyName}${company?.sector ? ` (${company.sector})` : ''}${company?.location ? `, ${company.location}` : ''}.
${who}

Research them and record what you find.`;

  try {
    const { data, usage, searches } = await aiResearch({
      system: SYSTEM,
      prompt,
      schema: Findings,
      recordTool: { name: 'record_findings', description: 'Record the research findings and suggested opening lines.' },
      maxSearches: 5,
      effort: 'medium',
    });

    // Keep the useful parts on the contact, without overwriting your own notes.
    let saved = false;
    if (contact && (data.facts.length || data.personNotes || data.hooks.length)) {
      await updateDb((live) => {
        const c = live.contacts.find((x) => x.id === contact.id);
        if (!c) return;
        const factLines = data.facts.map((f) => `${f.date ? `${f.date}: ` : ''}${f.fact} (${f.url})`).join('\n');
        if (factLines) c.recentActivity = (c.recentActivity ? `${c.recentActivity}\n${factLines}` : factLines).slice(-4000);
        if (data.personNotes && !c.background) c.background = data.personNotes;
        if (data.hooks[0] && !c.hook) c.hook = data.hooks[0];
        saved = true;
      });
    }
    return NextResponse.json({ ...data, usage, searches, saved });
  } catch (e) {
    const { status, body } = aiErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}
