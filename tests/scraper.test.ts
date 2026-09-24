import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichJob,
  getPlatform,
  isoDate,
  normEmployment,
  normWorkplace,
  relativePosted,
  type AtsJob,
} from '../lib/ats-registry';
import { cityOf, titleKey } from '../lib/importer';

/**
 * Parser fixtures, shaped on each vendor's documented or widely observed
 * fields. None of these boards could be called from the build environment, so
 * this pins the parsing to the published shapes — a vendor changing its API
 * still shows up only on the Health page.
 */

function parse(id: string, data: unknown, cfg: Record<string, string> = { slug: 'acme' }): AtsJob[] {
  return getPlatform(id)!.parse(data, cfg).map(enrichJob);
}

test('lever: salary range, workplace, commitment, epoch-ms date, lists', () => {
  const [job] = parse('lever', [
    {
      text: 'Product Analyst',
      hostedUrl: 'https://jobs.lever.co/acme/1',
      categories: { location: 'Dubai', team: 'Product', commitment: 'Full-time' },
      workplaceType: 'hybrid',
      createdAt: Date.UTC(2026, 8, 10),
      salaryRange: { currency: 'AED', interval: 'per-month-salary', min: 20000, max: 26000 },
      descriptionPlain: 'Join our product team.',
      lists: [{ text: 'Requirements', content: '<li>SQL</li><li>Experimentation</li>' }],
    },
  ]);
  assert.equal(job.postedAt, '2026-09-10');
  assert.equal(job.workplace, 'hybrid');
  assert.equal(job.employmentType, 'full-time');
  assert.deepEqual([job.salary?.minMonthlyAed, job.salary?.maxMonthlyAed, job.salary?.source], [20000, 26000, 'posted']);
  assert.match(job.description!, /Requirements\n• SQL\n• Experimentation/);
});

test('ashby: compensation components, unlisted roles skipped, remote flag', () => {
  const jobs = parse('ashby', {
    jobs: [
      {
        title: 'Backend Engineer',
        location: 'Remote - UAE',
        jobUrl: 'https://jobs.ashbyhq.com/acme/1',
        publishedAt: '2026-09-15T10:00:00.000Z',
        employmentType: 'FullTime',
        isRemote: true,
        compensation: {
          compensationTierSummary: '$90K – $120K',
          summaryComponents: [
            { compensationType: 'EquityPercentage', minValue: 0.1, maxValue: 0.2 },
            { compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 90000, maxValue: 120000 },
          ],
        },
        descriptionPlain: 'Build APIs.',
      },
      { title: 'Hidden', jobUrl: 'https://jobs.ashbyhq.com/acme/2', isListed: false },
    ],
  });
  assert.equal(jobs.length, 1, 'isListed:false is not a public role');
  const [job] = jobs;
  assert.equal(job.workplace, 'remote');
  assert.equal(job.employmentType, 'full-time');
  assert.equal(job.postedAt, '2026-09-15');
  // $90k/yr at the peg is ~AED 27,500 a month.
  assert.equal(job.salary?.minMonthlyAed, 27500);
  assert.equal(job.salary?.raw, '$90K – $120K');
});

test('ashby asks for compensation; greenhouse and workable ask for descriptions except in discovery', () => {
  assert.match(getPlatform('ashby')!.build({ slug: 'a' }).url, /includeCompensation=true/);
  assert.match(getPlatform('greenhouse')!.build({ slug: 'a' }).url, /content=true/);
  assert.doesNotMatch(getPlatform('greenhouse')!.build({ slug: 'a' }, 0, { lite: true }).url, /content=true/);
  assert.match(getPlatform('workable')!.build({ slug: 'a' }).url, /details=true/);
  assert.doesNotMatch(getPlatform('workable')!.build({ slug: 'a' }, 0, { lite: true }).url, /details/);
  assert.match(getPlatform('smartrecruiters')!.build({ slug: 'a' }, 200).url, /offset=200/);
});

test('greenhouse: escaped content, first_published over updated_at, pay ranges in cents', () => {
  const [job] = parse('greenhouse', {
    jobs: [
      {
        title: 'Finance Associate',
        location: { name: 'Abu Dhabi' },
        absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
        updated_at: '2026-09-20T12:00:00-04:00',
        first_published: '2026-08-30T09:00:00-04:00',
        content: '&lt;p&gt;Month-end close and reporting.&lt;/p&gt;',
        pay_input_ranges: [{ min_cents: 1800000, max_cents: 2400000, currency_type: 'AED', title: 'Monthly base' }],
      },
    ],
  });
  assert.equal(job.postedAt, '2026-08-30');
  assert.equal(job.description, 'Month-end close and reporting.');
  assert.deepEqual([job.salary?.minMonthlyAed, job.salary?.maxMonthlyAed], [18000, 24000]);
});

test('workable, recruitee and smartrecruiters extra fields', () => {
  const [w] = parse('workable', {
    jobs: [{ title: 'Ops Lead', city: 'Dubai', country: 'UAE', url: 'https://apply.workable.com/j/1', published_on: '2026-09-05', employment_type: 'Contract', telecommuting: true, description: '<p>Run ops</p>' }],
  });
  assert.deepEqual([w.postedAt, w.employmentType, w.workplace, w.description], ['2026-09-05', 'contract', 'remote', 'Run ops']);

  const [r] = parse('recruitee', {
    offers: [{ title: 'Marketer', location: 'Dubai', careers_url: 'https://acme.recruitee.com/o/1', published_at: '2026-09-02 10:00:00 UTC', employment_type_code: 'fulltime', hybrid: true, salary: { min: '15000', max: '19000', currency: 'AED', period: 'month' }, description: '<p>Brand work</p>', requirements: '<ul><li>3 years</li></ul>' }],
  });
  assert.equal(r.workplace, 'hybrid');
  assert.equal(r.employmentType, 'full-time');
  assert.deepEqual([r.salary?.minMonthlyAed, r.salary?.maxMonthlyAed], [15000, 19000]);
  assert.match(r.description!, /Brand work\n\n• 3 years/);

  const [sr] = parse('smartrecruiters', {
    content: [{ id: '99', name: 'Teller', location: { city: 'Dubai', country: 'ae', remote: false }, releasedDate: '2026-09-18T07:00:00.000Z', typeOfEmployment: { label: 'Full-time' } }],
  });
  assert.equal(sr.url, 'https://jobs.smartrecruiters.com/acme/99');
  assert.deepEqual([sr.postedAt, sr.employmentType, sr.workplace], ['2026-09-18', 'full-time', undefined]);
});

test('workday relative posting dates', () => {
  const now = Date.UTC(2026, 8, 24, 12);
  assert.equal(relativePosted('Posted Today', now), '2026-09-24');
  assert.equal(relativePosted('Posted Yesterday', now), '2026-09-23');
  assert.equal(relativePosted('Posted 3 Days Ago', now), '2026-09-21');
  assert.equal(relativePosted('Posted 30+ Days Ago', now), '2026-08-25');
  assert.equal(relativePosted('', now), undefined);
});

test('date, contract and workplace normalisation', () => {
  const now = Date.UTC(2026, 8, 24);
  assert.equal(isoDate(1757462400, now), '2025-09-10', 'epoch seconds');
  assert.equal(isoDate('1757462400000', now), '2025-09-10', 'epoch ms as a string');
  assert.equal(isoDate('1970-01-01', now), undefined, 'placeholder dates are dropped');
  assert.equal(isoDate('2027-01-01', now), undefined, 'future dates are dropped');
  assert.equal(isoDate('not a date', now), undefined);

  assert.equal(normEmployment('FullTime'), 'full-time');
  assert.equal(normEmployment('part_time'), 'part-time');
  assert.equal(normEmployment('Intern'), 'internship');
  assert.equal(normEmployment('Permanent'), 'full-time');
  assert.equal(normEmployment('whatever'), undefined);

  assert.equal(normWorkplace('OnSite'), 'onsite');
  assert.equal(normWorkplace('on-site'), 'onsite');
  assert.equal(normWorkplace('Hybrid'), 'hybrid');
  assert.equal(normWorkplace('unspecified'), undefined);
});

test('enrichment fills blanks from the title, location and description', () => {
  const job = enrichJob({
    title: 'Summer Intern - Finance',
    location: 'Remote (UAE)',
    url: 'https://x.co/1',
    description: 'A paid internship. Monthly stipend AED 5,000.',
  });
  assert.equal(job.employmentType, 'internship');
  assert.equal(job.workplace, 'remote');
  assert.equal(job.salary?.minMonthlyAed, 5000);

  // What a board states is never overridden by a guess.
  const stated = enrichJob({ title: 'Remote Sensing Analyst', location: 'Dubai', url: 'https://x.co/2', workplace: 'onsite' });
  assert.equal(stated.workplace, 'onsite');

  const long = enrichJob({ title: 'x', location: '', url: 'https://x.co/3', description: 'a'.repeat(30_000) });
  assert.equal(long.description!.length, 20_000);
});

test('role identity for cross-source dedupe', () => {
  assert.equal(titleKey('Sr. Data Analyst (Dubai)'), 'senior data analyst');
  assert.equal(titleKey('Senior Data Analyst - Dubai'), 'senior data analyst');
  assert.equal(titleKey('Data & Analytics Lead'), 'data and analytics lead');
  assert.notEqual(titleKey('Data Analyst'), titleKey('Senior Data Analyst'));

  assert.equal(cityOf('Dubai, United Arab Emirates'), 'dubai');
  assert.equal(cityOf('DIFC, Dubai'), 'dubai');
  assert.equal(cityOf('Abu Dhabi - UAE'), 'abu dhabi');
  assert.equal(cityOf('London, UK'), 'london');
  assert.equal(cityOf(''), '');
});
