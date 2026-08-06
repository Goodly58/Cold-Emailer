import { NextResponse, type NextRequest } from 'next/server';

import { approveCv, currentCv, cvContent, generateCv, storeCv } from '@/lib/cv';
import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Downloads the current CV so the user can look at the real file before approving. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  const cvId = request.nextUrl.searchParams.get('id') ?? (await currentCv(user.id))?.id;
  if (!cvId) return NextResponse.json({ error: 'No CV yet.' }, { status: 404 });

  const file = await cvContent(user.id, cvId);
  if (!file) return NextResponse.json({ error: 'No CV yet.' }, { status: 404 });

  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      'content-type': file.mimeType,
      'content-disposition': `inline; filename="${file.filename.replace(/"/g, '')}"`,
      'cache-control': 'no-store',
    },
  });
}

/**
 * Three actions on one route: generate from the interview answers, take an
 * upload, or approve what is there.
 *
 * Generation never invents a line — every section comes from an answer the
 * user gave, and a field they skipped simply does not appear.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Pick a file to upload.' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'That file is bigger than 5MB. A one-page CV is usually well under that.' },
        { status: 400 }
      );
    }
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'We can take a PDF or a Word document. Other formats often will not open for the recipient.' },
        { status: 400 }
      );
    }

    const id = await storeCv(user.id, {
      origin: 'uploaded',
      filename: file.name || 'cv.pdf',
      mimeType: file.type,
      content: Buffer.from(await file.arrayBuffer()),
    });
    await approveCv(user.id, id);
    return NextResponse.json({ id, approved: true });
  }

  let payload: { action?: string; id?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'That did not work. Try once more.' }, { status: 400 });
  }

  if (payload.action === 'approve') {
    const cv = payload.id ? { id: payload.id } : await currentCv(user.id);
    if (!cv) return NextResponse.json({ error: 'There is no CV to approve yet.' }, { status: 400 });
    await approveCv(user.id, cv.id);
    return NextResponse.json({ id: cv.id, approved: true });
  }

  const generated = await generateCv(user.id, user.canonicalName ?? user.name);
  const id = await storeCv(user.id, {
    origin: 'generated',
    filename: `${(user.canonicalName ?? 'cv').replace(/[^\w\s-]/g, '').trim() || 'cv'} CV.pdf`,
    mimeType: 'application/pdf',
    content: generated.pdf,
  });

  return NextResponse.json({
    id,
    preview: generated.plainText,
    // Non-Latin characters cannot be drawn in the built-in font. Saying so is
    // the honest move; silently dropping a user's Arabic name is not.
    unencodable: generated.unencodable,
    warning:
      generated.unencodable.length > 0
        ? 'Some letters in your details could not be included in the file we made. Upload your own CV instead, or write your name in English above.'
        : null,
  });
}
