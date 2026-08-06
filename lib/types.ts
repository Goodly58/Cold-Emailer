export type Stage =
  | 'found'
  | 'tailored'
  | 'applied'
  | 'followup'
  | 'interview'
  | 'offer'
  | 'rejected';

export const STAGES: Stage[] = [
  'found',
  'tailored',
  'applied',
  'followup',
  'interview',
  'offer',
  'rejected',
];

export const STAGE_LABELS: Record<Stage, string> = {
  found: 'Found',
  tailored: 'Tailored',
  applied: 'Applied',
  followup: 'Follow-up',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

export type Tier = 'dream' | 'target' | 'backup';

export interface Company {
  id: string;
  name: string;
  sector: string;
  location: string;
  tier: Tier;
  emiratisation: boolean;
  emiratisationNotes?: string;
  careersUrl?: string;
  notes?: string;
  /** Email domain, e.g. bankfab.com — drives email pattern generation. */
  domain?: string;
  /** Which pattern this company uses, e.g. "first.last". */
  emailPattern?: string;
  /** Business units / departments that hire separately. */
  divisions?: string[];
  createdAt: string;
}

export type ContactStatus = 'identified' | 'emailed' | 'replied' | 'meeting' | 'closed';

export const CONTACT_STATUSES: ContactStatus[] = [
  'identified',
  'emailed',
  'replied',
  'meeting',
  'closed',
];

/** Why this person matters — drives which template to use. */
export type ContactKind = 'hiring-manager' | 'ta-recruiter' | 'emiratisation-lead' | 'exec' | 'peer';

export const CONTACT_KINDS: ContactKind[] = [
  'hiring-manager',
  'ta-recruiter',
  'emiratisation-lead',
  'exec',
  'peer',
];

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  'hiring-manager': 'Hiring manager',
  'ta-recruiter': 'TA / Recruiter',
  'emiratisation-lead': 'Emiratisation lead',
  exec: 'Exec / Leadership',
  peer: 'Peer / Referral',
};

export type EmailStatus = 'unknown' | 'guessed' | 'verified' | 'bounced';

export interface Contact {
  id: string;
  companyName: string;
  name: string;
  role: string;
  email?: string;
  linkedin?: string;
  status: ContactStatus;
  notes?: string;
  /** Which division/business unit they sit in. */
  division?: string;
  kind?: ContactKind;
  emailStatus?: EmailStatus;
  /** Other pattern guesses, kept so you can try the next one after a bounce. */
  emailCandidates?: string[];
  /** Research: prior employers, education, tenure. */
  background?: string;
  /** Research: recent post, promotion, funding round, launch. */
  recentActivity?: string;
  /** The one personalized sentence that goes in the email. */
  hook?: string;
  createdAt: string;
}

export interface Application {
  id: string;
  companyName: string;
  roleTitle: string;
  jobUrl?: string;
  source?: string;
  location?: string;
  /** Which division is hiring — big employers hire per business unit. */
  division?: string;
  stage: Stage;
  emiratiAngle?: boolean;
  appliedAt?: string;
  nextActionAt?: string;
  notes?: string;
  /** Auto-import bookkeeping. */
  sourceId?: string;
  isNew?: boolean;
  lastSeenAt?: string;
  /** Posting disappeared from the board — likely filled or pulled. */
  closed?: boolean;
  createdAt: string;
}

export type OutreachStatus = 'draft' | 'ready' | 'sent' | 'replied' | 'no-reply';

export const OUTREACH_STATUSES: OutreachStatus[] = [
  'draft',
  'ready',
  'sent',
  'replied',
  'no-reply',
];

export interface Outreach {
  id: string;
  toName: string;
  toEmail?: string;
  companyName: string;
  subject: string;
  body: string;
  status: OutreachStatus;
  sentAt?: string;
  followUps: number;
  createdAt: string;
}

/** A company's job board, polled on a schedule to keep the pipeline fresh. */
export interface JobSource {
  id: string;
  companyName: string;
  platform: string;
  slug: string;
  enabled: boolean;
  /** Comma-separated filter, e.g. "dubai, abu dhabi, analyst". Blank = all. */
  keywords?: string;
  lastCheckedAt?: string;
  lastResult?: string;
  lastError?: string;
  totalFound?: number;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  category: string;
  subject: string;
  body: string;
}

export interface Profile {
  name: string;
  headline: string;
  phone: string;
  linkedinUrl: string;
}

export interface Db {
  profile: Profile;
  companies: Company[];
  contacts: Contact[];
  applications: Application[];
  outreach: Outreach[];
  templates: Template[];
  jobSources: JobSource[];
}

export type CollectionName =
  | 'companies'
  | 'contacts'
  | 'applications'
  | 'outreach'
  | 'templates'
  | 'jobSources';

export const COLLECTIONS: CollectionName[] = [
  'companies',
  'contacts',
  'applications',
  'outreach',
  'templates',
  'jobSources',
];
