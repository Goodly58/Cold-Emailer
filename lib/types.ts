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

export interface Contact {
  id: string;
  companyName: string;
  name: string;
  role: string;
  email?: string;
  linkedin?: string;
  status: ContactStatus;
  notes?: string;
  createdAt: string;
}

export interface Application {
  id: string;
  companyName: string;
  roleTitle: string;
  jobUrl?: string;
  source?: string;
  location?: string;
  stage: Stage;
  emiratiAngle?: boolean;
  appliedAt?: string;
  nextActionAt?: string;
  notes?: string;
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
}

export type CollectionName = 'companies' | 'contacts' | 'applications' | 'outreach' | 'templates';

export const COLLECTIONS: CollectionName[] = [
  'companies',
  'contacts',
  'applications',
  'outreach',
  'templates',
];
