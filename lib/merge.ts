import type { Profile } from './types';

export interface MergeFields {
  firstName?: string;
  company?: string;
  role?: string;
  hook?: string;
}

export function mergeTemplate(text: string, fields: MergeFields, profile: Profile): string {
  const map: Record<string, string> = {
    firstName: fields.firstName || '[first name]',
    company: fields.company || '[company]',
    role: fields.role || '[role]',
    hook: fields.hook || '[1-2 sentence personalized hook: why THIS company, why you]',
    myName: profile.name,
    headline: profile.headline,
    phone: profile.phone,
    linkedin: profile.linkedinUrl,
  };
  return text.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in map ? map[key] : m));
}

export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
