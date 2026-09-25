import { z } from 'zod';
import { aiStructured, type AiUsage } from './ai';
import { EDUCATION_LEVELS } from './cv-shared';

export { EDUCATION_LEVELS, EDUCATION_LABELS, type EducationLevel } from './cv-shared';

/**
 * The master CV. Stored as plain text in the blob store (it's too big to ride
 * along on every database read) and used as the factual ground truth for
 * every AI feature: fit analysis, tailoring, email drafting, interview prep.
 * Those prompts are told to use only what's in here, never to invent.
 */

export const CV_BLOB_KEY = 'cv:text';
export const CV_MAX_CHARS = 40_000;
export const CV_MAX_PDF_BYTES = 5 * 1024 * 1024;

const CvFields = z.object({
  name: z.string().describe('Full name as written on the CV, or "" if absent'),
  headline: z
    .string()
    .describe('One line in the form "<current or target role> · <years> yrs · <sector or specialism>"'),
  yearsExperience: z.number().nullable().describe('Total years of professional experience; null if unclear'),
  educationLevel: z.enum([...EDUCATION_LEVELS, 'unknown']),
  skills: z.array(z.string()).describe('The 10-20 most job-relevant skills, most important first'),
  languages: z.array(z.string()).describe('Spoken languages, e.g. "Arabic (native)"'),
  recentRoles: z
    .array(z.object({ title: z.string(), employer: z.string(), period: z.string() }))
    .describe('Most recent first, at most 5'),
  suggestedTargetTitles: z
    .array(z.string())
    .describe('3-6 realistic job titles to search for next, lowercase'),
});

const CvFromPdf = CvFields.extend({
  plainText: z
    .string()
    .describe('The full CV as clean plain text, keeping section headings and bullet structure'),
});

export type CvFields = z.infer<typeof CvFields>;

const SYSTEM = `You read CVs for a UAE job-search tool used by an Emirati job seeker.
Extract only what the document states. Never infer employers, dates, degrees or skills that aren't written. If something is missing, leave it empty (or null / "unknown").
Education level is the highest completed qualification.`;

export async function extractFromPdf(pdfBase64: string): Promise<{ fields: CvFields; text: string; usage: AiUsage }> {
  const { data, usage } = await aiStructured({
    system: SYSTEM,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      {
        type: 'text',
        text: 'Transcribe this CV to plain text in full, then extract the structured fields.',
      },
    ],
    schema: CvFromPdf,
    effort: 'low',
  });
  const { plainText, ...fields } = data;
  return { fields, text: plainText.slice(0, CV_MAX_CHARS), usage };
}

export async function extractFromText(text: string): Promise<{ fields: CvFields; usage: AiUsage }> {
  const { data, usage } = await aiStructured({
    system: SYSTEM,
    content: `Extract the structured fields from this CV.\n\n<cv>\n${text}\n</cv>`,
    schema: CvFields,
    effort: 'low',
  });
  return { fields: data, usage };
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Plain-text cleanup for pasted CVs: normalise line endings, drop runs of
 *  blank lines, strip zero-width characters that sneak in from PDFs. */
export function cleanCvText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CV_MAX_CHARS);
}

/* ------------------------------------------------ without the AI */

/**
 * Text from a PDF CV, read locally with no AI. Works for any CV exported from
 * Word or Google Docs; a scanned image has no text layer and comes back
 * (near) empty, which the caller reports.
 */
export async function pdfToText(pdf: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(pdf);
  const { text } = await extractText(doc, { mergePages: true });
  return cleanCvText(Array.isArray(text) ? text.join('\n') : text);
}

const LANGUAGES = ['Arabic', 'English', 'French', 'Hindi', 'Urdu', 'Spanish', 'German', 'Mandarin', 'Chinese', 'Russian', 'Persian', 'Farsi', 'Turkish', 'Italian', 'Japanese', 'Korean', 'Portuguese', 'Tagalog', 'Malayalam', 'Tamil', 'Bengali'];

/**
 * The profile fields a CV states plainly, found by rules rather than a model:
 * the name on the first line, the highest degree named, and languages from a
 * languages line. Anything less certain is left blank for you to fill.
 */
export function basicFields(text: string): CvFields {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  const name = /^[A-Za-z؀-ۿ' .-]{3,60}$/.test(first) && first.split(/\s+/).length <= 6 ? first : '';

  const t = text.toLowerCase();
  const educationLevel: CvFields['educationLevel'] = /\b(ph\.?d|doctorate|doctor of)\b/.test(t)
    ? 'doctorate'
    : /\b(master'?s?|msc|m\.sc|mba|m\.a\.|master of)\b/.test(t)
      ? 'master'
      : /\b(bachelor'?s?|bsc|b\.sc|b\.a\.|beng|b\.eng|bachelor of)\b/.test(t)
        ? 'bachelor'
        : /\b(diploma|associate degree)\b/.test(t)
          ? 'diploma'
          : /\b(high school|secondary|qce|a[- ]levels?|thanaweya|ib diploma)\b/.test(t)
            ? 'high-school'
            : 'unknown';

  // Every "Languages:" list, since "Programming Languages: Python…" often comes first.
  const lists = [...text.matchAll(/languages?\s*:([^.;\n]*)/gi)].map((m) => m[1]).join(' ');
  const languages = LANGUAGES.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(lists));

  return {
    name,
    headline: '',
    yearsExperience: null,
    educationLevel,
    skills: [],
    languages,
    recentRoles: [],
    suggestedTargetTitles: [],
  };
}
