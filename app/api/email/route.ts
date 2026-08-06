import { NextRequest, NextResponse } from 'next/server';
import { promises as dns } from 'dns';
import { generateCandidates } from '@/lib/email-finder';

export const runtime = 'nodejs';

function cleanDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

/** Which mail provider a domain uses — useful colour, and proves MX resolves. */
function providerFor(exchanges: string[]): string {
  const joined = exchanges.join(' ').toLowerCase();
  if (joined.includes('google') || joined.includes('googlemail')) return 'Google Workspace';
  if (joined.includes('outlook') || joined.includes('protection.outlook')) return 'Microsoft 365';
  if (joined.includes('mimecast')) return 'Mimecast';
  if (joined.includes('proofpoint') || joined.includes('pphosted')) return 'Proofpoint';
  if (joined.includes('barracuda')) return 'Barracuda';
  return 'Other / self-hosted';
}

/**
 * Finds likely addresses for a person and checks the domain can receive mail.
 *
 * Note on verification depth: confirming an individual mailbox exists requires
 * SMTP probing, which most corporate mail gateways refuse (catch-all) and which
 * looks like reconnaissance. So we do MX-level verification here — proving the
 * domain is real and routes mail — and optionally query Hunter.io if the user
 * supplies a key, which does the mailbox-level work legitimately.
 */
export async function POST(req: NextRequest) {
  const { name, domain, pattern } = await req.json();
  if (!name || !domain) {
    return NextResponse.json({ error: 'name and domain are required' }, { status: 400 });
  }

  const clean = cleanDomain(domain);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
    return NextResponse.json({ error: 'that domain looks malformed' }, { status: 400 });
  }

  const candidates = generateCandidates(name, clean, pattern);
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'need a first and last name' }, { status: 400 });
  }

  let mx: { ok: boolean; provider?: string; error?: string };
  try {
    const records = await dns.resolveMx(clean);
    if (records.length === 0) {
      mx = { ok: false, error: 'Domain has no mail servers — check the domain.' };
    } else {
      const hosts = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
      mx = { ok: true, provider: providerFor(hosts) };
    }
  } catch {
    mx = { ok: false, error: 'Domain did not resolve — check the spelling.' };
  }

  // Optional: real mailbox-level lookup when the user has configured a key.
  let hunter: { email?: string; score?: number; error?: string } | undefined;
  const key = process.env.HUNTER_API_KEY;
  if (key && mx.ok) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0];
    const last = parts.slice(1).join(' ');
    try {
      const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(clean)}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}&api_key=${key}`;
      const res = await fetch(url, { cache: 'no-store' });
      const body = await res.json();
      if (res.ok && body?.data?.email) {
        hunter = { email: body.data.email, score: body.data.score };
      } else {
        hunter = { error: body?.errors?.[0]?.details || 'No confirmed match found.' };
      }
    } catch {
      hunter = { error: 'Hunter lookup failed.' };
    }
  }

  return NextResponse.json({ domain: clean, candidates, mx, hunter });
}
