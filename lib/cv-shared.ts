/**
 * CV constants safe to import from client components. lib/cv.ts pulls in the
 * server-only AI client, so the browser must never import it directly.
 */

export const EDUCATION_LEVELS = ['high-school', 'diploma', 'bachelor', 'master', 'doctorate'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const EDUCATION_LABELS: Record<EducationLevel, string> = {
  'high-school': 'High school',
  diploma: 'Diploma',
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  doctorate: 'Doctorate',
};
