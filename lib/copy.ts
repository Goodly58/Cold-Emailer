/**
 * User-facing copy that both the server and the browser need.
 *
 * It lives apart from the modules that own the behaviour because those reach
 * for SQLite and the filesystem, and a client component that imports one of
 * them drags the whole server surface into the browser bundle.
 */

/**
 * Coaching shown beside the CV step.
 *
 * The Emirates ID line is not general advice. It is the single document a UAE
 * job seeker is most often asked for by a scam impersonating an employer, and
 * the answer is always no — so it ships with the product rather than living in
 * a help page nobody opens.
 */
export const CV_COACHING = [
  'Never send your Emirates ID, passport, or bank details by email. A real employer asks for those in person or through their own portal, after an offer.',
  'One page is right for now. Nobody expects a long CV from a student.',
  'We attach this only when someone asks for it. Cold emails go out with no attachment at all.',
] as const;
