/**
 * The one-page CV (register: "Positive replies ask for a CV that doesn't
 * exist", critical).
 *
 * Roughly half of positive replies say "send your CV". A fresh graduate who
 * meets a blank document at that exact moment stalls for days, and the lead
 * moves on. So onboarding produces something real from the interview answers
 * for glance-approval, or takes an upload.
 *
 * The PDF is written by hand rather than pulled from a library: one page of
 * Helvetica needs about a hundred lines, and a dependency that renders
 * arbitrary documents is a bigger surface than this product needs.
 *
 * Known limit, surfaced to the user rather than hidden: the base-14 Helvetica
 * font can only encode Latin-1, so a name written in Arabic script cannot be
 * drawn. When that happens the generator says so and points at the upload path
 * instead of quietly dropping characters.
 */
import { execute, query, queryOne } from './db/client';
import { newId, nowIso } from './ids';
import { logEvent } from './log';
import { generatorProfile } from './profile';

export { CV_COACHING } from './copy';

const PAGE_WIDTH = 595; // A4 at 72dpi
const PAGE_HEIGHT = 842;
const MARGIN = 56;

interface Line {
  text: string;
  size: number;
  bold?: boolean;
  gapBefore?: number;
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Characters Helvetica/WinAnsi cannot draw. Reported, never silently dropped. */
export function unencodableCharacters(value: string): string[] {
  return [...new Set([...value].filter((ch) => ch.charCodeAt(0) > 0xff))];
}

/** Greedy wrap using Helvetica's average advance — good enough for one page. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const perChar = size * 0.5;
  const maxChars = Math.max(12, Math.floor(maxWidth / perChar));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function buildPdf(lines: Line[]): Buffer {
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of lines) {
    y -= line.gapBefore ?? 0;
    const font = line.bold ? '/F2' : '/F1';
    for (const wrapped of wrap(line.text, line.size, contentWidth)) {
      y -= line.size * 1.35;
      if (y < MARGIN) break;
      parts.push(`${font} ${line.size} Tf`, `1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm`, `(${escapePdfText(wrapped)}) Tj`);
    }
  }
  parts.push('ET');

  const content = parts.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

export interface GeneratedCv {
  pdf: Buffer;
  /** Rendered as a preview so the user approves what they can actually read. */
  plainText: string;
  /** Non-empty when characters had to be left out — the user is told, not fooled. */
  unencodable: string[];
}

/**
 * Builds the CV from confirmed profile fields only. Nothing here is invented:
 * every line traces to an answer the user gave, and a field they skipped simply
 * does not appear.
 */
export async function generateCv(userId: string, displayName: string): Promise<GeneratedCv> {
  const profile = await generatorProfile(userId);

  const name = displayName.trim() || 'Your name';
  const lines: Line[] = [
    { text: name, size: 22, bold: true },
    { text: 'UAE national', size: 11, gapBefore: 2 },
  ];

  if (profile.education) {
    lines.push({ text: 'Education', size: 13, bold: true, gapBefore: 16 });
    lines.push({ text: profile.education, size: 11 });
  }

  if (profile.credibility_marker) {
    lines.push({ text: 'Experience', size: 13, bold: true, gapBefore: 16 });
    lines.push({ text: profile.credibility_marker, size: 11 });
  }

  if (profile.roles) {
    lines.push({ text: 'Looking for', size: 13, bold: true, gapBefore: 16 });
    lines.push({ text: profile.roles, size: 11 });
    if (profile.industries) lines.push({ text: `Industries: ${profile.industries}`, size: 11 });
    if (profile.cities) lines.push({ text: `Based in: ${profile.cities}`, size: 11 });
  }

  const availability: string[] = [];
  if (profile.availability) availability.push(`Available: ${profile.availability}`);
  if (profile.nafis_registered === 'Yes') availability.push('Registered with Nafis');
  if (availability.length > 0) {
    lines.push({ text: 'Availability', size: 13, bold: true, gapBefore: 16 });
    for (const item of availability) lines.push({ text: item, size: 11 });
  }

  const plainText = lines.map((l) => l.text).join('\n');
  const unencodable = unencodableCharacters(plainText);

  // Drop what cannot be drawn, having already recorded it for the caller to
  // show. A box of question marks is worse than an honest warning.
  const drawable = lines.map((l) => ({
    ...l,
    text: [...l.text].filter((ch) => ch.charCodeAt(0) <= 0xff).join(''),
  }));

  return { pdf: buildPdf(drawable), plainText, unencodable };
}

export interface CvRecord {
  id: string;
  origin: 'generated' | 'uploaded';
  filename: string;
  mimeType: string;
  approved: boolean;
  createdAt: string;
}

interface CvRow {
  id: string;
  origin: 'generated' | 'uploaded';
  filename: string;
  mime_type: string;
  approved: number;
  created_at: string;
}

export async function storeCv(
  userId: string,
  input: { origin: 'generated' | 'uploaded'; filename: string; mimeType: string; content: Buffer }
): Promise<string> {
  const id = newId('cv');
  await execute('UPDATE cv_version SET is_current = 0 WHERE user_id = ?', [userId]);
  await execute(
    `INSERT INTO cv_version (id, user_id, origin, filename, mime_type, content, approved, is_current, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
    [id, userId, input.origin, input.filename, input.mimeType, input.content, nowIso()]
  );
  await logEvent({
    event: input.origin === 'generated' ? 'cv_generated' : 'cv_uploaded',
    userId,
    entityType: 'cv_version',
    entityId: id,
    detail: { filename: input.filename, bytes: input.content.length },
  });
  return id;
}

export async function approveCv(userId: string, cvId: string): Promise<void> {
  await execute('UPDATE cv_version SET approved = 1 WHERE id = ? AND user_id = ?', [cvId, userId]);
}

export async function currentCv(userId: string): Promise<CvRecord | null> {
  const row = await queryOne<CvRow>(
    'SELECT id, origin, filename, mime_type, approved, created_at FROM cv_version WHERE user_id = ? AND is_current = 1',
    [userId]
  );
  if (!row) return null;
  return {
    id: row.id,
    origin: row.origin,
    filename: row.filename,
    mimeType: row.mime_type,
    approved: row.approved === 1,
    createdAt: row.created_at,
  };
}

export async function cvContent(userId: string, cvId: string): Promise<{ content: Buffer; mimeType: string; filename: string } | null> {
  const rows = await query<{ content: Uint8Array; mime_type: string; filename: string }>(
    'SELECT content, mime_type, filename FROM cv_version WHERE id = ? AND user_id = ?',
    [cvId, userId]
  );
  const row = rows[0];
  if (!row) return null;
  return { content: Buffer.from(row.content), mimeType: row.mime_type, filename: row.filename };
}

