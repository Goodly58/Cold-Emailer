import { serpProvider } from '@/lib/tier3';

import SourceClient from './source-client';

export const dynamic = 'force-dynamic';

/**
 * The sourcing bench — a founder tool, not one of the three user screens.
 *
 * It exists to make one company's worth of work — people, evidence, a verified
 * address — doable in a single sitting, with every minute logged. The gates
 * (anchor source, freshness, namesake, catch-all, suppression) all fire here,
 * where there is a human looking at the source and able to fix it.
 */
export default function SourcePage() {
  return (
    <SourceClient
      serpProvider={serpProvider()}
      verifierConfigured={Boolean(process.env.EMAIL_VERIFIER_API_KEY)}
    />
  );
}
