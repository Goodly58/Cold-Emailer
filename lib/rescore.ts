import { findByName, indexByName } from './names';
import { scoreRole } from './scoring';
import type { Db } from './types';

/**
 * Re-ranks every role against the current profile. Scores are worked out at
 * import, so without this a change to your target titles or fields would
 * only affect roles imported afterwards.
 */
export function rescoreAll(db: Db): number {
  const index = indexByName(db.companies);
  let changed = 0;
  for (const app of db.applications) {
    if (app.dismissed) continue;
    const { score, reasons } = scoreRole(
      {
        roleTitle: app.roleTitle,
        companyName: app.companyName,
        location: app.location,
        division: app.division,
        interests: app.interests,
        interestMentions: app.interestMentions,
      },
      db.profile,
      findByName(index, app.companyName)
    );
    if (score !== app.score || (app.scoreReasons ?? []).join('|') !== reasons.join('|')) {
      app.score = score;
      app.scoreReasons = reasons;
      changed += 1;
    }
  }
  return changed;
}

/** Profile fields that change how roles rank. */
export const RANKING_FIELDS = ['targetTitles', 'targetKeywords', 'excludeKeywords', 'targetSeniority', 'interests'] as const;
