import { CV_BLOB_KEY } from './cv';
import { INTERESTS } from './interests';
import { jdKey } from './importer';
import { findByName, indexByName } from './names';
import { getBlob, getBlobs } from './store';
import type { Application, Company, Contact, Db, Profile } from './types';

/**
 * The facts every AI feature works from, gathered in one place and wrapped
 * in tags so the prompts can say exactly which facts may be used. Whatever
 * isn't in here, the model is told not to claim.
 */

const CV_PROMPT_CHARS = 16_000;
const JD_PROMPT_CHARS = 12_000;

function lines(entries: Array<[string, unknown]>): string {
  return entries
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join('\n');
}

export function candidateBlock(profile: Profile, cv: string | null): string {
  const facts = lines([
    ['Name', profile.name],
    ['Headline', profile.headline],
    ['Nationality', 'UAE National (Emirati)'],
    ['Education', profile.educationLevel],
    ['Years of experience', profile.yearsExperience],
    ['Skills', profile.skills],
    ['Languages', profile.languages],
    ['Looking for', profile.targetTitles],
    ['Fields of interest', (profile.interests || []).map((id) => INTERESTS[id].label)],
    ['LinkedIn', profile.linkedinUrl],
    ['Phone', profile.phone],
  ]);
  const cvText = cv?.trim()
    ? cv.length > CV_PROMPT_CHARS
      ? `${cv.slice(0, CV_PROMPT_CHARS)}\n[CV truncated]`
      : cv
    : 'No CV on file. Use only the profile facts above.';
  return `<candidate>\n${facts}\n\n<cv>\n${cvText}\n</cv>\n</candidate>`;
}

export function companyBlock(company: Company | undefined, name: string): string {
  if (!company) return `<company>\nName: ${name}\n(Not in the tracked company list; nothing else is known.)\n</company>`;
  return `<company>\n${lines([
    ['Name', company.name],
    ['Sector', company.sector],
    ['Location', company.location],
    ['Emiratisation-liable', company.emiratisation ? 'yes' : undefined],
    ['Emiratisation notes', company.emiratisationNotes],
    ['Divisions', company.divisions],
    ['Your notes', company.notes],
  ])}\n</company>`;
}

export function contactBlock(contact: Contact): string {
  return `<recipient>\n${lines([
    ['Name', contact.name],
    ['Role', contact.role],
    ['Division', contact.division],
    ['Type', contact.kind],
    ['Background', contact.background],
    ['Recent activity', contact.recentActivity],
    ['Hook you noted', contact.hook],
    ['Your notes', contact.notes],
  ])}\n</recipient>`;
}

export function roleBlock(app: Application, jd: string | null): string {
  const facts = lines([
    ['Title', app.roleTitle],
    ['Company', app.companyName],
    ['Division', app.division],
    ['Location', app.location],
    ['Posted', app.postedAt],
  ]);
  const text = jd?.trim()
    ? jd.length > JD_PROMPT_CHARS
      ? `${jd.slice(0, JD_PROMPT_CHARS)}\n[truncated]`
      : jd
    : 'No job description saved. Work from the title only and say so where it matters.';
  return `<role>\n${facts}\n\n<job_description>\n${text}\n</job_description>\n</role>`;
}

export interface Context {
  profile: Profile;
  cv: string | null;
  app?: Application;
  jd: string | null;
  contact?: Contact;
  company?: Company;
  companyName: string;
}

/** Loads the CV, and the role's description when there is one, in one round trip. */
export async function loadContext(
  db: Db,
  ids: { applicationId?: string; contactId?: string; companyName?: string }
): Promise<Context> {
  const app = ids.applicationId ? db.applications.find((a) => a.id === ids.applicationId) : undefined;
  const contact = ids.contactId ? db.contacts.find((c) => c.id === ids.contactId) : undefined;
  const companyName = ids.companyName || app?.companyName || contact?.companyName || '';
  const company = companyName ? findByName(indexByName(db.companies), companyName) : undefined;

  const keys = [CV_BLOB_KEY, ...(app?.hasDescription ? [jdKey(app.id)] : [])];
  const blobs = await getBlobs(keys);
  return {
    profile: db.profile,
    cv: blobs.get(CV_BLOB_KEY) ?? null,
    app,
    jd: app ? blobs.get(jdKey(app.id)) ?? null : null,
    contact,
    company,
    companyName,
  };
}

export async function loadCv(): Promise<string | null> {
  return getBlob(CV_BLOB_KEY);
}

/** The rule every prompt carries about facts. */
export const FACTS_RULE = `Use only facts stated inside <candidate>, <cv>, <role>, <job_description>, <company> and <recipient>. Never invent employers, job titles, dates, numbers, degrees, certifications, projects or results for the candidate, and never claim knowledge of the recipient or company that isn't given. Where a strong answer needs a fact you don't have, write a short [bracketed placeholder] so the candidate fills it in.`;
