import { isOauthConfigured } from '@/lib/gmail/oauth';
import { HYGIENE_FIELDS, INTERVIEW_FIELDS } from '@/lib/interview';
import { currentCv } from '@/lib/cv';
import { listAnswers, gateStatus } from '@/lib/profile';
import { currentUser } from '@/lib/user';

import OnboardingClient from './onboarding-client';

export const dynamic = 'force-dynamic';

/**
 * Screen 1 — Onboard. Once, under ten minutes, on a phone.
 *
 * The step is read from the database rather than held in the URL or in
 * component state, so closing the tab and coming back two days later resumes
 * exactly where they stopped. For this user that is not a nicety: a flow that
 * restarts is a flow that gets abandoned.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  const [answers, gate, cv] = await Promise.all([
    listAnswers(user.id),
    gateStatus(user.id),
    currentCv(user.id),
  ]);

  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return (
    <OnboardingClient
      user={{
        name: user.name,
        gmailAddress: user.gmailAddress,
        connectionState: user.connectionState,
        sendAsEmail: user.sendAsEmail,
        canonicalName: user.canonicalName,
        signatureBlock: user.signatureBlock,
        onboardingStep: user.onboardingStep,
      }}
      interviewFields={INTERVIEW_FIELDS}
      hygieneFields={HYGIENE_FIELDS}
      answers={answers.map((a) => ({
        field: a.field,
        value: a.value,
        specificity: a.specificity,
        followupQuestion: a.followupQuestion,
        followupAnswer: a.followupAnswer,
        verificationFraming: a.verificationFraming,
      }))}
      gate={gate}
      cv={cv}
      oauthConfigured={isOauthConfigured()}
      problem={first('problem') ?? null}
      justConnected={first('connected') === '1'}
    />
  );
}
