import type { Company, Profile } from './types';

/**
 * Ranks incoming roles against what you're actually looking for. Once the
 * scraper is pulling hundreds of postings a week, an unranked list is noise —
 * this is what makes volume useful rather than overwhelming.
 */

export interface ScoreInput {
  roleTitle: string;
  companyName: string;
  location?: string;
  division?: string;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

const SENIORITY_SIGNALS = [
  { words: ['intern', 'internship', 'trainee', 'apprentice'], level: 0 },
  { words: ['graduate', 'junior', 'entry level', 'associate', 'analyst i', 'fresh'], level: 1 },
  { words: ['senior', 'sr.', 'lead', 'principal'], level: 3 },
  { words: ['manager', 'head of', 'director', 'vp', 'vice president', 'chief', 'c-level'], level: 4 },
];

function seniorityOf(title: string): number {
  const t = title.toLowerCase();
  for (const s of SENIORITY_SIGNALS) {
    if (s.words.some((w) => t.includes(w))) return s.level;
  }
  return 2; // mid-level default
}

function splitList(csv?: string): string[] {
  return (csv || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const UAE_WORDS = [
  'uae', 'u.a.e', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah',
  'ajman', 'fujairah', 'ras al khaimah', 'umm al quwain', 'al ain', 'emirat',
];

/**
 * Score 0-100. Weighted so that a role you'd actually want at a company you'd
 * actually join outranks a keyword coincidence.
 */
export function scoreRole(job: ScoreInput, profile: Profile, company?: Company): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  const title = job.roleTitle.toLowerCase();
  const haystack = `${title} ${job.division || ''}`.toLowerCase();
  const location = (job.location || '').toLowerCase();

  const targets = splitList(profile.targetTitles);
  const keywords = splitList(profile.targetKeywords);
  const excludes = splitList(profile.excludeKeywords);

  // Hard exclusions win outright — a wrong-discipline role is never relevant.
  const hit = excludes.find((x) => haystack.includes(x));
  if (hit) {
    return { score: 0, reasons: [`excluded by "${hit}"`] };
  }

  // Title match is the strongest signal.
  const titleHits = targets.filter((t) => title.includes(t));
  let titleRelevant = true;

  if (titleHits.length) {
    score += 40;
    reasons.push(`title matches ${titleHits.map((t) => `"${t}"`).join(', ')}`);
  } else if (targets.length) {
    // Partial credit when individual words of a target title appear.
    const words = targets.flatMap((t) => t.split(/\s+/)).filter((w) => w.length > 3);
    const partial = words.filter((w) => title.includes(w));
    if (partial.length) {
      score += 15;
      reasons.push('partial title match');
    } else {
      titleRelevant = false;
    }
  } else {
    score += 20; // no preferences set — don't punish everything
  }

  const keywordHits = keywords.filter((k) => haystack.includes(k));
  if (keywordHits.length) {
    score += Math.min(20, keywordHits.length * 8);
    reasons.push(`keywords: ${keywordHits.slice(0, 3).join(', ')}`);
  }

  // Location: UAE roles are where the Emiratisation advantage applies.
  if (UAE_WORDS.some((w) => location.includes(w))) {
    score += 20;
    reasons.push('UAE-based');
  } else if (/remote|anywhere/.test(location)) {
    score += 8;
    reasons.push('remote');
  }

  // Company quality and Emiratisation leverage.
  if (company) {
    if (company.tier === 'dream') {
      score += 15;
      reasons.push('dream-tier company');
    } else if (company.tier === 'target') {
      score += 8;
      reasons.push('target-tier company');
    }
    if (company.emiratisation) {
      score += 7;
      reasons.push('Emiratisation-liable employer');
    }
  }

  // Seniority fit.
  if (profile.targetSeniority !== undefined && profile.targetSeniority !== null) {
    const gap = Math.abs(seniorityOf(title) - profile.targetSeniority);
    if (gap === 0) {
      score += 10;
      reasons.push('seniority fits');
    } else if (gap === 1) {
      score += 4;
    } else {
      score -= 8;
      reasons.push('seniority mismatch');
    }
  }

  // A great company in the right city is still the wrong job if the title has
  // nothing to do with what you do. Without this, prestige alone floats
  // irrelevant roles into the "worth a look" band.
  let final = Math.max(0, Math.min(100, Math.round(score)));
  if (!titleRelevant && keywordHits.length === 0) {
    final = Math.min(final, 25);
    reasons.push('no title/keyword relevance');
  }

  return { score: final, reasons };
}

export function scoreBand(score: number): 'strong' | 'good' | 'weak' {
  if (score >= 65) return 'strong';
  if (score >= 40) return 'good';
  return 'weak';
}
