import { NextRequest, NextResponse } from 'next/server';
import { deleteBlobs, getBlob, putBlob, updateDb } from '@/lib/store';
import { aiConfigured, aiErrorResponse, type AiUsage } from '@/lib/ai';
import {
  CV_BLOB_KEY,
  CV_MAX_CHARS,
  CV_MAX_PDF_BYTES,
  cleanCvText,
  extractFromPdf,
  extractFromText,
  wordCount,
  type CvFields,
} from '@/lib/cv';
import type { Profile } from '@/lib/types';

export const runtime = 'nodejs';
// Reading a PDF with the model can take a while; see DEPLOY.md on limits.
export const maxDuration = 300;

export async function GET() {
  const text = await getBlob(CV_BLOB_KEY);
  return NextResponse.json({ hasCv: Boolean(text), text: text ?? '', words: text ? wordCount(text) : 0 });
}

/**
 * Fill profile fields the CV answers but only where the profile is still
 * blank — anything you've typed yourself wins over the extraction.
 */
function applyFields(profile: Profile, f: CvFields): string[] {
  const filled: string[] = [];
  const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  if (blank(profile.name) && f.name) {
    profile.name = f.name;
    filled.push('name');
  }
  if (blank(profile.headline) && f.headline) {
    profile.headline = f.headline;
    filled.push('headline');
  }
  if (blank(profile.yearsExperience) && typeof f.yearsExperience === 'number') {
    profile.yearsExperience = f.yearsExperience;
    filled.push('years of experience');
  }
  if (blank(profile.educationLevel) && f.educationLevel !== 'unknown') {
    profile.educationLevel = f.educationLevel;
    filled.push('education level');
  }
  if (blank(profile.skills) && f.skills.length) {
    profile.skills = f.skills.slice(0, 25);
    filled.push('skills');
  }
  if (blank(profile.languages) && f.languages.length) {
    profile.languages = f.languages;
    filled.push('languages');
  }
  if (blank(profile.targetTitles) && f.suggestedTargetTitles.length) {
    profile.targetTitles = f.suggestedTargetTitles.join(', ');
    filled.push('target titles');
  }
  return filled;
}

/** Accepts a PDF upload (multipart "file") or pasted text (multipart or JSON "text"). */
export async function POST(req: NextRequest) {
  let text = '';
  let pdf: Buffer | null = null;

  const type = req.headers.get('content-type') || '';
  try {
    if (type.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (file && typeof file !== 'string') {
        if (file.size > CV_MAX_PDF_BYTES) {
          return NextResponse.json({ error: 'That PDF is over 5 MB. Try exporting a smaller one.' }, { status: 400 });
        }
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
          return NextResponse.json({ error: 'Upload a PDF, or paste your CV as text instead.' }, { status: 400 });
        }
        pdf = Buffer.from(await file.arrayBuffer());
      } else {
        text = String(form.get('text') || '');
      }
    } else {
      const body = await req.json();
      text = typeof body?.text === 'string' ? body.text : '';
    }
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 });
  }

  let fields: CvFields | null = null;
  let usage: AiUsage | null = null;

  try {
    if (pdf) {
      if (!aiConfigured()) {
        return NextResponse.json(
          { error: 'Reading PDFs uses the AI, which is off. Paste your CV as text, or add ANTHROPIC_API_KEY.' },
          { status: 503 }
        );
      }
      const out = await extractFromPdf(pdf.toString('base64'));
      text = out.text;
      fields = out.fields;
      usage = out.usage;
    } else {
      text = cleanCvText(text);
      if (text.length < 200) {
        return NextResponse.json({ error: 'That looks too short to be a CV.' }, { status: 400 });
      }
      if (aiConfigured()) {
        const out = await extractFromText(text);
        fields = out.fields;
        usage = out.usage;
      }
    }
  } catch (e) {
    const { status, body } = aiErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  await putBlob(CV_BLOB_KEY, text.slice(0, CV_MAX_CHARS));

  const result = await updateDb((db) => {
    db.profile.cvUpdatedAt = new Date().toISOString();
    db.profile.cvWords = wordCount(text);
    db.profile.cvSource = pdf ? 'pdf' : 'text';
    const filled = fields ? applyFields(db.profile, fields) : [];
    return { profile: db.profile, filled };
  });

  return NextResponse.json({
    ok: true,
    words: wordCount(text),
    usedAi: Boolean(fields),
    filled: result.filled,
    extracted: fields,
    profile: result.profile,
    usage,
  });
}

export async function DELETE() {
  await deleteBlobs([CV_BLOB_KEY]);
  await updateDb((db) => {
    delete db.profile.cvUpdatedAt;
    delete db.profile.cvWords;
    delete db.profile.cvSource;
  });
  return NextResponse.json({ ok: true });
}
