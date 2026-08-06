import { redirect } from 'next/navigation';

import { currentUser } from '@/lib/user';

import TodayClient from './today-client';

export const dynamic = 'force-dynamic';

/**
 * Screen 2 — Review & Send. The daily core loop.
 *
 * The queue is fetched client-side so the freshness pass runs on every open
 * rather than being cached into a stale render. Everything else about this
 * screen is arranged around one number: the gap between "viewed a draft" and
 * "sent one", which is where this user silently churns.
 */
export default async function TodayPage() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') redirect('/onboarding');
  return <TodayClient firstName={(user.canonicalName ?? user.name).split(' ')[0]} />;
}
