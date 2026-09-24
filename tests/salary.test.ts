import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMonthly, fromPosted, midpoint, parsePeriod, parseSalaryText, toMonthlyAed } from '../lib/salary';
import { decodeEntities, htmlToText } from '../lib/text';

/* --------------------------------------------------------------- salary */

function range(text: string) {
  const r = parseSalaryText(text);
  return r ? [r.minMonthlyAed, r.maxMonthlyAed, r.period] : undefined;
}

test('reads the common ways UAE postings state pay', () => {
  assert.deepEqual(range('Salary: AED 18,000 - 22,000 per month plus benefits'), [18000, 22000, 'month']);
  assert.deepEqual(range('Package 18-22k AED monthly'), [18000, 22000, 'month']);
  assert.deepEqual(range('Monthly salary: 25,000 AED'), [25000, 25000, 'month']);
  assert.deepEqual(range('Salary range: AED 15k to 20k'), [15000, 20000, 'month']);
  assert.deepEqual(range('Basic salary of Dhs 12,000 + housing allowance'), [12000, 12000, 'month']);
  assert.deepEqual(range('The salary for this role is between 20000 and 25000 AED'), [20000, 25000, 'month']);
});

test('annual and foreign-currency pay is normalised to AED a month', () => {
  // $120k–150k a year at the 3.6725 peg.
  assert.deepEqual(range('Compensation: $120k-$150k per year'), [36700, 45900, 'year']);
  // Six figures with no stated period is an annual figure.
  assert.deepEqual(range('Salary AED 300,000 - 360,000'), [25000, 30000, 'year']);
});

test('numbers that are not pay are ignored', () => {
  assert.equal(parseSalaryText('We manage an AED 2 billion fund and pay competitively'), undefined);
  assert.equal(parseSalaryText('Join our team of 5,000 employees. Competitive salary.'), undefined);
  assert.equal(parseSalaryText('Revenue of $50 million last year; salary is competitive'), undefined);
  // Currency and a plausible number, but nothing says it's a salary.
  assert.equal(parseSalaryText('We raised AED 500,000 in seed funding'), undefined);
  assert.equal(parseSalaryText(''), undefined);
  assert.equal(parseSalaryText(undefined), undefined);
});

test('"and" is only a range after "between"', () => {
  assert.deepEqual(range('Salary AED 20,000 and 5 days of study leave'), [20000, 20000, 'month']);
});

test('board salary fields are normalised, including string values', () => {
  const lever = fromPosted({ min: 120000, max: 150000, currency: 'USD', period: 'per-year-salary' });
  assert.equal(lever?.minMonthlyAed, 36700);
  assert.equal(lever?.source, 'posted');

  const recruitee = fromPosted({ min: '15,000', max: '20000', currency: 'aed', period: 'month' });
  assert.deepEqual([recruitee?.minMonthlyAed, recruitee?.maxMonthlyAed], [15000, 20000]);

  // A period-less board figure is taken as annual.
  assert.equal(fromPosted({ min: 240000, currency: 'AED' })?.minMonthlyAed, 20000);
  // Nonsense (a placeholder 1, an unknown currency) is dropped, not ranked.
  assert.equal(fromPosted({ min: 1, max: 1, currency: 'AED', period: 'year' }), undefined);
  assert.equal(fromPosted({ min: 20000, currency: 'XYZ', period: 'month' }), undefined);
});

test('period labels from every board map to a period', () => {
  assert.equal(parsePeriod('1 YEAR'), 'year');
  assert.equal(parsePeriod('per-month-salary'), 'month');
  assert.equal(parsePeriod('per-hour-wage'), 'hour');
  assert.equal(parsePeriod('annually'), 'year');
  assert.equal(parsePeriod(''), undefined);
  assert.equal(toMonthlyAed(100, 'AED', 'hour'), 17300);
});

test('formatting and the ranking midpoint', () => {
  assert.equal(formatMonthly(18000, 22000), 'AED 18,000–22,000/mo');
  assert.equal(formatMonthly(undefined, 22000), 'AED 22,000/mo');
  assert.equal(formatMonthly(), '');
  assert.equal(midpoint(18000, 22000), 20000);
  assert.equal(midpoint(undefined, 22000), 22000);
  assert.equal(midpoint(), undefined);
});

/* ----------------------------------------------------------------- text */

test('htmlToText unescapes Greenhouse content and keeps list structure', () => {
  const gh = '&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;li&gt;Two&lt;/li&gt;&lt;/ul&gt;';
  assert.equal(htmlToText(gh), 'Hello & welcome\n• One\n• Two');
});

test('htmlToText strips scripts and turns breaks into lines', () => {
  const html = '<div><h2>About</h2><p>We&rsquo;re hiring.<br>Now.</p><script>alert(1)</script></div>';
  assert.equal(htmlToText(html), 'About\nWe’re hiring.\nNow.');
  assert.equal(htmlToText('<p>abcdef</p>', 3), 'abc');
  assert.equal(htmlToText(null), '');
});

test('decodeEntities handles numeric forms and leaves unknown ones', () => {
  assert.equal(decodeEntities('&#65;&#x42; &bogus;'), 'AB &bogus;');
});
