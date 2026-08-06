import { redirect } from 'next/navigation';

import { currentUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * There is no home screen and no sign-up. A first-time user lands on the first
 * unfinished onboarding step; a returning one lands on today's queue. Anything
 * else is a decision we would be asking them to make for no reason.
 */
export default async function Home() {
  const user = await currentUser();
  redirect(user.onboardingStep === 'done' ? '/today' : '/onboarding');
}
