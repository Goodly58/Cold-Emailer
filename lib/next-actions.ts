/**
 * What to do next, worked out from the state of the search rather than
 * asked of a model: it's instant, free, and always consistent with what the
 * rest of the app shows. Ordered by how much each step moves the search
 * forward; the Overview shows the top few.
 */

import { findByName, indexByName } from './names';
import { opportunity } from './pay';
import type { Application, CareerEvent, Company, Contact, JobSource, Outreach, Profile } from './types';

export interface NextAction {
  id: string;
  /** Higher first. */
  weight: number;
  title: string;
  detail?: string;
  href: string;
  cta: string;
}

export interface ActionState {
  profile: Profile;
  hasCv: boolean;
  applications: Application[];
  companies: Company[];
  contacts: Contact[];
  outreach: Outreach[];
  jobSources: JobSource[];
  events: CareerEvent[];
  today: string;
}

const enc = encodeURIComponent;

export function nextActions(s: ActionState): NextAction[] {
  const out: NextAction[] = [];
  const index = indexByName(s.companies);
  const companyOf = (name: string) => findByName(index, name);

  // Foundations: without these, everything downstream is weaker.
  if (!s.hasCv) {
    out.push({
      id: 'cv',
      weight: 100,
      title: 'Add your CV',
      detail: 'Fit analysis, tailored bullets, cover letters and AI-drafted emails all work from it.',
      href: '/profile',
      cta: 'Add CV',
    });
  }
  if (!s.profile.targetTitles?.trim()) {
    out.push({
      id: 'targets',
      weight: 95,
      title: 'Say which roles you want',
      detail: 'Target titles and keywords rank every scraped role for you.',
      href: '/profile',
      cta: 'Set targets',
    });
  }
  if (!s.profile.interests?.length) {
    out.push({
      id: 'fields',
      weight: 92,
      title: 'Pick your fields: investing, banking & finance, cybersecurity, AI',
      detail: 'Roles in them rank higher, and every list can be filtered to them.',
      href: '/profile',
      cta: 'Pick',
    });
  }
  if (!s.profile.educationLevel) {
    out.push({
      id: 'education',
      weight: 60,
      title: 'Set your education level',
      detail: 'It sets your Nafis top-up, which is added to each role’s pay.',
      href: '/profile',
      cta: 'Set it',
    });
  }

  const enabled = s.jobSources.filter((j) => j.enabled);
  if (enabled.length === 0) {
    out.push({
      id: 'sources',
      weight: 90,
      title: 'Connect job boards',
      detail: '“Sweep all companies” finds which of the 1,200+ tracked employers have a public board.',
      href: '/sources',
      cta: 'Add sources',
    });
  }
  const broken = enabled.filter((j) => (j.consecutiveFailures || 0) >= 3);
  if (broken.length) {
    out.push({
      id: 'broken-sources',
      weight: 40,
      title: `Fix or disable ${broken.length} failing job board${broken.length > 1 ? 's' : ''}`,
      detail: broken.slice(0, 3).map((b) => b.companyName).join(', '),
      href: '/runs',
      cta: 'Review',
    });
  }

  // Fresh, strong roles not yet acted on: applying early matters.
  const open = s.applications.filter((a) => !a.dismissed && !a.closed && a.stage === 'found');
  const strong = open
    .map((a) => ({ a, o: opportunity(a, s.profile, companyOf(a.companyName), s.today) }))
    .filter((x) => x.o.score >= 65 && (x.o.ageDays === undefined || x.o.ageDays <= 10))
    .sort((x, y) => y.o.score - x.o.score)
    .slice(0, 3);
  for (const { a, o } of strong) {
    out.push({
      id: `apply-${a.id}`,
      weight: 80 + o.score / 10,
      title: `Apply: ${a.roleTitle} at ${a.companyName}`,
      detail: `Scores ${o.score}${o.ageDays !== undefined ? `, posted ${o.ageDays}d ago` : ''}. Check the fit and tailor your CV first.`,
      href: `/pipeline?open=${enc(a.id)}`,
      cta: 'Open',
    });
  }

  // The combination that works: apply, then email someone at the company.
  const emailedCompanies = new Set(
    s.outreach.filter((o) => o.status !== 'draft').map((o) => o.companyName.trim().toLowerCase())
  );
  const appliedNoOutreach = s.applications
    .filter((a) => (a.stage === 'applied' || a.stage === 'followup') && !emailedCompanies.has(a.companyName.trim().toLowerCase()))
    .slice(0, 3);
  for (const a of appliedNoOutreach) {
    const contact = s.contacts.find((c) => c.companyName.trim().toLowerCase() === a.companyName.trim().toLowerCase() && c.email);
    out.push({
      id: `nudge-${a.id}`,
      weight: 75,
      title: `You applied to ${a.companyName}. Now email someone there`,
      detail: contact
        ? `${contact.name} (${contact.role || 'contact'}) is in your contacts.`
        : 'A hiring manager or TA lead. Applications with a direct note get read.',
      href: contact
        ? `/outreach?contactId=${enc(contact.id)}&to=${enc(contact.name)}&email=${enc(contact.email || '')}&company=${enc(a.companyName)}&applicationId=${enc(a.id)}&template=t5`
        : `/contacts`,
      cta: contact ? 'Write it' : 'Find a contact',
    });
  }

  // Interviews: preparation is where AI help pays off most.
  for (const a of s.applications.filter((x) => x.stage === 'interview').slice(0, 2)) {
    out.push({
      id: `prep-${a.id}`,
      // An interview on the calendar beats everything except having no CV at all.
      weight: 98,
      title: `Prepare for your ${a.companyName} interview`,
      detail: `${a.roleTitle}: likely questions with answers from your CV, questions to ask, and pay to expect.`,
      href: `/pipeline?open=${enc(a.id)}`,
      cta: 'Prep kit',
    });
  }

  // Dream employers with nobody to write to.
  const withContacts = new Set(s.contacts.map((c) => c.companyName.trim().toLowerCase()));
  const dreamNoContact = s.companies.filter((c) => c.tier === 'dream' && !withContacts.has(c.name.trim().toLowerCase()));
  if (dreamNoContact.length) {
    out.push({
      id: 'dream-contacts',
      weight: 50,
      title: `Find a decision-maker at ${dreamNoContact.length} dream compan${dreamNoContact.length > 1 ? 'ies' : 'y'}`,
      detail: dreamNoContact.slice(0, 4).map((c) => c.name).join(', ') + (dreamNoContact.length > 4 ? '…' : ''),
      href: '/contacts',
      cta: 'Add contacts',
    });
  }

  const noEmail = s.contacts.filter((c) => c.status === 'identified' && !c.email);
  if (noEmail.length) {
    out.push({
      id: 'emails',
      weight: 45,
      title: `Find emails for ${noEmail.length} contact${noEmail.length > 1 ? 's' : ''}`,
      href: '/contacts',
      cta: 'Find',
    });
  }

  const ready = s.contacts.filter(
    (c) => c.status === 'identified' && c.email && c.emailStatus !== 'bounced' && !c.metAtEventId
  );
  if (ready.length) {
    out.push({
      id: 'write',
      weight: 55,
      title: `${ready.length} contact${ready.length > 1 ? 's have' : ' has'} an email but no message yet`,
      detail: ready.slice(0, 3).map((c) => `${c.name} (${c.companyName})`).join(', '),
      href: '/outreach',
      cta: 'Write',
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
