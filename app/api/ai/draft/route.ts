import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aiErrorResponse, aiStructured } from '@/lib/ai';
import { FACTS_RULE, candidateBlock, companyBlock, contactBlock, loadContext, roleBlock } from '@/lib/ai-context';
import { readDb } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Writes, improves or translates a cold email from what's actually known:
 * your CV and profile, the recipient's research notes, the company, and the
 * job description when the email is about a specific role.
 */

const Draft = z.object({
  subject: z.string().describe('Under 60 characters, specific to this recipient and role'),
  body: z.string().describe('Plain text email body including greeting and sign-off. No markdown.'),
  missing: z
    .array(z.string())
    .describe('Facts the email needed but the context did not have; each also appears as a [placeholder] in the body'),
  rationale: z.string().describe('One or two sentences on the angle chosen, for the sender'),
});

const SYSTEM = `You write cold emails for an Emirati job seeker in the UAE, to hiring managers, recruiters, Emiratisation leads and executives.

${FACTS_RULE}

How a good one reads:
- A first email is under 150 words; a follow-up under 80. Plain text, no markdown, no emojis, no exclamation marks in the subject.
- Open with why this person or company specifically: the recipient's research, a company fact, or the role. Then one or two proof points from the CV that match what they need. End with one small ask: a 15-minute call, or a pointer to the right person.
- Mention once, briefly, that the candidate is a UAE National. Lead with it only when writing to a talent-acquisition or Emiratisation lead. Don't promise the employer specific subsidies or savings.
- Formal "Dear <first name>" for government, semi-government and senior executives; "Hi <first name>" for private companies, startups and tech.
- Sign off with the candidate's name, then their headline, LinkedIn and phone on their own lines when they're given.
- A template, when provided, shows the structure and tone the candidate likes. Follow it, but replace its generic lines with specifics.`;

const Input = z.object({
  mode: z.enum(['draft', 'improve', 'arabic', 'followup']),
  contactId: z.string().optional(),
  applicationId: z.string().optional(),
  companyName: z.string().max(200).optional(),
  toName: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  hook: z.string().max(2000).optional(),
  eventName: z.string().max(200).optional(),
  template: z.object({ subject: z.string().max(500), body: z.string().max(5000) }).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().max(10000).optional(),
  followUpNumber: z.number().int().min(1).max(2).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  const input = parsed.data;

  const db = await readDb();
  const ctx = await loadContext(db, input);

  const blocks = [
    candidateBlock(ctx.profile, ctx.cv),
    companyBlock(ctx.company, ctx.companyName),
    ctx.contact
      ? contactBlock(ctx.contact)
      : `<recipient>\nName: ${input.toName || '[unknown]'}\n</recipient>`,
    ctx.app ? roleBlock(ctx.app, ctx.jd) : input.role ? `<role>\nTitle: ${input.role}\n</role>` : '',
    input.hook ? `<hook_from_candidate>\n${input.hook}\n</hook_from_candidate>` : '',
    input.eventName ? `<event>\n${input.eventName}\n</event>` : '',
  ].filter(Boolean);

  let task: string;
  switch (input.mode) {
    case 'draft':
      task = input.template
        ? `Write the email, using this template as the structure:\n<template>\nSubject: ${input.template.subject}\n\n${input.template.body}\n</template>`
        : 'Write the email.';
      break;
    case 'improve':
      task = `Improve this draft. Keep every fact it states that the context supports, cut anything generic, fix placeholders the context can fill, and keep the rest as placeholders.\n<draft>\nSubject: ${input.subject ?? ''}\n\n${input.body ?? ''}\n</draft>`;
      break;
    case 'followup':
      task = `Write follow-up number ${input.followUpNumber ?? 1} to this email, which got no reply. ${
        (input.followUpNumber ?? 1) >= 2
          ? 'This is the last one: short, gracious, closing the loop and leaving the door open.'
          : 'Add one new, relevant reason to reply; do not repeat the first email.'
      } Keep the subject as "Re: " plus the original subject.\n<original>\nSubject: ${input.subject ?? ''}\n\n${input.body ?? ''}\n</original>`;
      break;
    case 'arabic':
      task = `Rewrite this email in formal Modern Standard Arabic suitable for business email in the UAE, with the same facts and the same ask. Keep people's and companies' names as they're usually written in Arabic where well known, otherwise in Latin script. Keep URLs, emails and phone numbers unchanged. Return the Arabic subject and body.\n<email>\nSubject: ${input.subject ?? ''}\n\n${input.body ?? ''}\n</email>`;
      break;
  }

  try {
    const { data, usage } = await aiStructured({
      system: SYSTEM,
      content: `${blocks.join('\n\n')}\n\n${task}`,
      schema: Draft,
      effort: input.mode === 'arabic' ? 'low' : 'medium',
      maxTokens: 8000,
    });
    return NextResponse.json({ ...data, usage, usedCv: Boolean(ctx.cv), usedJd: Boolean(ctx.jd) });
  } catch (e) {
    const { status, body } = aiErrorResponse(e);
    return NextResponse.json(body, { status });
  }
}
