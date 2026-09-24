import { z } from 'zod';
import { aiResearch, aiStructured, type AiUsage } from './ai';
import { FACTS_RULE, candidateBlock, companyBlock, roleBlock, type Context } from './ai-context';
import { opportunity } from './pay';
import { formatMonthly } from './salary';

/**
 * Per-role AI help: how well you fit and how to tailor for it, and an
 * interview prep kit. Results are cached in the blob store (fit:<id>,
 * kit:<id>) so they cost once and can be re-read for free.
 */

export const Fit = z.object({
  fitScore: z.number().describe('0-100: how well the CV matches what the role requires'),
  verdict: z.enum(['strong', 'good', 'stretch', 'long-shot']),
  summary: z.string().describe('Two or three sentences a friend would say: should you apply, and why'),
  matches: z
    .array(z.object({ requirement: z.string(), evidence: z.string().describe('Where the CV shows it, quoting or closely paraphrasing') }))
    .describe('The role’s requirements the CV clearly meets, most important first'),
  gaps: z
    .array(z.object({ requirement: z.string(), howToAddress: z.string().describe('Honest framing, transferable experience, or a quick way to close it') }))
    .describe('Requirements the CV does not show'),
  tailoredBullets: z
    .array(z.string())
    .describe('5-8 CV bullet points rewritten from the candidate’s REAL experience to mirror this job’s language. Never add achievements, numbers or tools that are not in the CV; use [placeholder] where a number would help'),
  keywords: z.array(z.string()).describe('Terms from the job description an applicant-tracking system will look for, which the CV should contain where true'),
  coverLetter: z.string().describe('Under 250 words, plain text, specific to this role and company, using only CV facts'),
  applyAdvice: z.string().describe('One or two sentences: how to apply for the best chance, e.g. who to email alongside the application and what to lead with'),
});
export type Fit = z.infer<typeof Fit>;

export const Prep = z.object({
  companyBrief: z.string().describe('What the company does and what matters to it right now, in 3-4 sentences'),
  recentNews: z.array(z.object({ fact: z.string(), url: z.string() })).describe('Up to 5 recent facts worth mentioning in the interview, with sources'),
  likelyQuestions: z
    .array(
      z.object({
        question: z.string(),
        why: z.string().describe('What the interviewer is testing'),
        answerOutline: z.string().describe('A STAR-style outline built only from the CV; [placeholder] where the candidate must add detail'),
      })
    )
    .describe('8-10 questions: role-specific, behavioural, and "why us / why you"'),
  questionsToAsk: z.array(z.string()).describe('5 sharp questions for the candidate to ask'),
  emiratisationAngle: z.string().describe('How to handle being a UAE National in this interview, naturally and without overplaying it'),
  salaryTalk: z.string().describe('How to answer the salary question, using ONLY the pay figures provided in <pay>'),
  checklist: z.array(z.string()).describe('Practical things to prepare the day before'),
});
export type Prep = z.infer<typeof Prep>;

const FIT_SYSTEM = `You are a sharp, honest career coach helping an Emirati job seeker in the UAE decide whether to apply for a role and how to tailor the application.

${FACTS_RULE}

Be candid: a long-shot is a long-shot. Scoring: 80+ means the CV meets nearly every requirement; 60-79 most, with gaps that can be framed; 40-59 a stretch; below 40 a long shot. If there is no job description, judge from the title and say that the score is rough.`;

const PREP_SYSTEM = `You prepare an Emirati job seeker for an interview at a UAE employer.

${FACTS_RULE}

You may search the web for recent news about the company to make the prep specific; report only what sources say, with URLs. Answer outlines must come from the CV. For salary, use only the figures in <pay>; don't state market rates from memory.`;

function payBlock(ctx: Context, today: string): string {
  if (!ctx.app) return '';
  const o = opportunity(ctx.app, ctx.profile, ctx.company, today);
  if (!o.pay) return '<pay>\nUnknown: the posting states no pay and the role could not be benchmarked.\n</pay>';
  return `<pay>\n${o.pay.basis === 'estimate' ? 'Estimated' : 'Stated'}: ${formatMonthly(o.pay.low, o.pay.high)} (${o.pay.notes.join('; ')})\nNafis: ${o.nafis.reason}\n</pay>`;
}

export async function analyseFit(ctx: Context): Promise<{ data: Fit; usage: AiUsage }> {
  if (!ctx.app) throw new Error('no role');
  const content = [candidateBlock(ctx.profile, ctx.cv), companyBlock(ctx.company, ctx.companyName), roleBlock(ctx.app, ctx.jd)].join('\n\n');
  const { data, usage } = await aiStructured({
    system: FIT_SYSTEM,
    content: `${content}\n\nAssess the fit and tailor the application.`,
    schema: Fit,
    effort: 'high',
    maxTokens: 16_000,
  });
  return { data: { ...data, fitScore: Math.max(0, Math.min(100, Math.round(data.fitScore))) }, usage };
}

export async function prepareInterview(ctx: Context, today: string): Promise<{ data: Prep; usage: AiUsage; searches: number }> {
  if (!ctx.app) throw new Error('no role');
  const prompt = [
    candidateBlock(ctx.profile, ctx.cv),
    companyBlock(ctx.company, ctx.companyName),
    roleBlock(ctx.app, ctx.jd),
    payBlock(ctx, today),
    'Build the interview prep kit.',
  ].join('\n\n');
  return aiResearch({
    system: PREP_SYSTEM,
    prompt,
    schema: Prep,
    recordTool: { name: 'record_prep_kit', description: 'Record the finished interview prep kit.' },
    maxSearches: 4,
    effort: 'high',
  });
}
