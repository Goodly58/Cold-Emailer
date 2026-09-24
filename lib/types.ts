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
  /** Known ATS platform and board slug, when research identified one. */
  ats?: string;
  atsSlug?: string;
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
  /** Relevance 0-100, computed on import. */
  score?: number;
  scoreReasons?: string[];
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
  /** Extra identifiers for platforms that need more than a slug
   *  (Workday: dc + site; Oracle: host + site). */
  config?: Record<string, string>;
  enabled: boolean;
  /** Comma-separated filter, e.g. "dubai, abu dhabi, analyst". Blank = all. */
  keywords?: string;
  lastCheckedAt?: string;
  lastResult?: string;
  lastError?: string;
  /** Consecutive failed polls — surfaced so dead slugs get noticed. */
  consecutiveFailures?: number;
  totalFound?: number;
  createdAt: string;
}

/** One execution of the refresh job — kept so failures are visible. */
export interface RefreshRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  trigger: 'cron' | 'manual';
  checked: number;
  added: number;
  updated: number;
  closed: number;
  failed: number;
  /** Left for the next run because the time budget ran out. */
  skipped?: number;
  errors?: Array<{ company: string; error: string }>;
}

/** Emirati-only fairs are where every employer is there to hire nationals;
 *  industry expos are for networking with hiring managers at their stands. */
export type EventKind = 'emirati-fair' | 'career-fair' | 'industry-expo';

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  'emirati-fair': 'Emirati-only career fair',
  'career-fair': 'Career fair',
  'industry-expo': 'Industry expo',
};

export type EventStatus = 'interested' | 'registered' | 'attending' | 'attended' | 'skipped';

export const EVENT_STATUSES: EventStatus[] = [
  'interested',
  'registered',
  'attending',
  'attended',
  'skipped',
];

/** Named CareerEvent rather than Event, which is a DOM global. */
export interface CareerEvent {
  id: string;
  name: string;
  /** Compact label for badges, e.g. "Ru'ya". */
  shortName?: string;
  kind: EventKind;
  /** YYYY-MM-DD. Absent while the organiser hasn't announced dates. */
  startDate?: string;
  endDate?: string;
  /** Shown instead of dates when they're not announced, e.g. "Usually February". */
  dateNote?: string;
  hours?: string;
  venue: string;
  city: string;
  url?: string;
  registerUrl?: string;
  description?: string;
  status: EventStatus;
  /** Company names expected to exhibit — matched against the Companies list. */
  exhibitors?: string[];
  /** Where the exhibitor list came from, and how current it is. */
  exhibitorsNote?: string;
  /** Prep checklist, keyed by item id. */
  checklist?: Record<string, boolean>;
  notes?: string;
  /** Seeded events are hidden rather than deleted, so a re-sync can't bring them back. */
  hidden?: boolean;
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
  /** What you're looking for — drives relevance scoring of scraped roles. */
  targetTitles?: string;
  targetKeywords?: string;
  excludeKeywords?: string;
  /** 0 intern, 1 junior, 2 mid, 3 senior, 4 leadership. */
  targetSeniority?: number;
  /** Highest completed qualification — also sets the Nafis salary top-up. */
  educationLevel?: 'high-school' | 'diploma' | 'bachelor' | 'master' | 'doctorate';
  yearsExperience?: number;
  /** AED per month, total package. Roles clearly below it rank lower. */
  minMonthlySalary?: number;
  skills?: string[];
  languages?: string[];
  /** Emails to send per day before the Outreach page suggests stopping. */
  dailySendCap?: number;
  /** CV bookkeeping; the text itself lives in the blob store. */
  cvUpdatedAt?: string;
  cvWords?: number;
  cvSource?: 'pdf' | 'text';
}

export interface Db {
  profile: Profile;
  companies: Company[];
  contacts: Contact[];
  applications: Application[];
  outreach: Outreach[];
  templates: Template[];
  jobSources: JobSource[];
  runs: RefreshRun[];
  events: CareerEvent[];
}

export type CollectionName =
  | 'companies'
  | 'contacts'
  | 'applications'
  | 'outreach'
  | 'templates'
  | 'jobSources'
  | 'runs'
  | 'events';

export const COLLECTIONS: CollectionName[] = [
  'companies',
  'contacts',
  'applications',
  'outreach',
  'templates',
  'jobSources',
  'runs',
  'events',
];
