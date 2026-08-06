import { currentUser, sendBlockFor } from '@/lib/user';

/**
 * The reconnect banner, on every screen.
 *
 * Google expires a testing-status refresh token after seven days, and a user
 * can revoke access from their Google account at any time — or a worried
 * relative can, on their behalf. When that happens polling goes blind and every
 * send is blocked, while the countdowns keep deriving forward.
 *
 * The failure mode this exists to prevent is not the block. It is the *silence*:
 * a user who opens the app, sees nothing to send, and concludes it is finished
 * with them. So the banner is full width, on all three screens, and says the
 * one thing they need to hear before anything else — nothing is lost.
 */
export default async function ConnectionBanner() {
  const user = await currentUser();
  if (user.onboardingStep !== 'done') return null;

  const block = sendBlockFor(user);
  if (!block.blocked) return null;

  // A stale poll clears itself within a minute of opening the queue, and the
  // queue screen already says so in its own words. A banner about it on every
  // screen would be alarm without an action.
  if (block.reason === 'poll_stale') return null;

  if (block.reason === 'placed') {
    return (
      <div className="notice info">
        <strong>You marked yourself as placed.</strong> Nothing is sending. Everything is still
        here if that changes.
      </div>
    );
  }

  if (block.reason === 'paused') {
    return (
      <div className="notice info">
        <strong>Everything is paused.</strong> Nothing goes out until you start again, and no
        dates are lost — they recompute from the day you come back.
      </div>
    );
  }

  return (
    <div className="notice warn">
      <strong>Reconnect your email</strong>
      Your connection to Gmail lapsed, which happens routinely and is not something you did wrong.
      Nothing is lost: every draft, date and thread is exactly where you left it, and follow-ups
      resume the moment you reconnect.
      <p style={{ marginTop: 12, marginBottom: 0 }}>
        <a className="button primary" href="/api/gmail/start">
          Reconnect
        </a>
      </p>
    </div>
  );
}
