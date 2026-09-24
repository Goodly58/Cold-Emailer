import test from 'node:test';
import assert from 'node:assert/strict';

import { estimatePay, nafisTopUp, opportunity, payFor, payLevel, roleFamily } from '../lib/pay';
import type { Application, Company, Profile } from '../lib/types';

const company = (sector: string, tier: Company['tier'] = 'target'): Company => ({
  id: 'c', name: 'X', sector, location: 'Dubai', tier, emiratisation: true, createdAt: '',
});
const role = (roleTitle: string, extra: Partial<Application> = {}): Application => ({
  id: 'a', companyName: 'X', roleTitle, stage: 'found', createdAt: '2026-09-20T00:00:00Z', ...extra,
});
const profile: Profile = { name: '', headline: '', phone: '', linkedinUrl: '', educationLevel: 'bachelor' };

test('the most specific keyword picks the job family', () => {
  assert.equal(roleFamily('Senior Software Engineer'), 'software_engineering', 'not generic engineering');
  assert.equal(roleFamily('Mechanical Engineer'), 'engineering_energy');
  assert.equal(roleFamily('Project Coordinator'), 'project_management', 'not admin "coordinator"');
  assert.equal(roleFamily('Relationship Manager'), 'banking');
  assert.equal(roleFamily('Data Analyst', 'Finance'), 'data_analytics', 'the title outweighs the division');
  // Short keywords only match as whole words: "hr" is not in "three".
  assert.equal(roleFamily('Three Wheeler Driver'), undefined);
  assert.equal(roleFamily('Barista'), undefined);
});

test('seniority for pay treats titled managers as individual contributors', () => {
  assert.equal(payLevel('Summer Intern'), 0);
  assert.equal(payLevel('Graduate Trainee'), 1, 'graduate programmes are salaried');
  assert.equal(payLevel('Relationship Manager'), 2);
  assert.equal(payLevel('Assistant Manager, Finance'), 2);
  assert.equal(payLevel('Finance Manager'), 3);
  assert.equal(payLevel('Head of Data'), 4);
  assert.equal(payLevel('Associate Director'), 3);
});

test('estimates respect the Emirati minimum wage but not for internships', () => {
  const cs = estimatePay(role('Customer Service Agent', { roleTitle: 'Junior Customer Service Agent' }))!;
  assert.ok(cs.low >= 6000, 'an employee estimate never goes below AED 6,000');
  const intern = estimatePay(role('Marketing Intern'))!;
  assert.ok(intern.low < 6000, 'internships are not covered by the minimum wage');
  assert.equal(estimatePay(role('Summer Intern'))?.basis, 'estimate', 'any internship has a going rate');
});

test('employer adjustments apply once', () => {
  const plain = estimatePay(role('Data Analyst'))!;
  const atBank = estimatePay(role('Data Analyst'), company('Banking'))!;
  assert.ok(atBank.mid > plain.mid);
  // A banking role at a bank: the banking table already is the bank rate.
  const rm = estimatePay(role('Risk Analyst'))!;
  const rmAtBank = estimatePay(role('Risk Analyst'), company('Banking'))!;
  assert.equal(rmAtBank.mid, rm.mid);
  const retail = estimatePay(role('Marketing Manager'), company('Retail'))!;
  assert.ok(retail.mid < estimatePay(role('Marketing Manager'))!.mid);
  assert.ok(retail.notes.some((n) => /retail/.test(n)));
});

test('posted pay always beats the estimate', () => {
  const view = payFor(role('Data Analyst', { salaryMin: 15000, salaryMax: 18000, salarySource: 'posted' }))!;
  assert.deepEqual([view.low, view.mid, view.high, view.basis], [15000, 16500, 18000, 'posted']);
});

test('Nafis follows the September 2026 framework', () => {
  assert.equal(nafisTopUp(15000, 'bachelor').amount, 6000);
  assert.equal(nafisTopUp(15000, 'diploma').amount, 5000);
  assert.equal(nafisTopUp(15000, 'high-school').amount, 4000);
  assert.equal(nafisTopUp(15000, 'master').amount, 6000);
  assert.equal(nafisTopUp(25000, 'bachelor').eligible, false, 'over AED 20,000');
  assert.equal(nafisTopUp(5000, 'bachelor').eligible, false, 'under AED 6,000');
  assert.equal(nafisTopUp(15000, 'bachelor', company('Federal Government')).eligible, false, 'private sector only');
  const unknown = nafisTopUp(15000, undefined);
  assert.equal(unknown.eligible, true);
  assert.equal(unknown.amount, undefined, 'no amount without an education level');
});

test('opportunity ranks a fresh, well-paid, relevant role above a stale, poor one', () => {
  const today = '2026-09-24';
  const good = opportunity(
    role('Data Analyst', { score: 80, postedAt: '2026-09-22', salaryMin: 18000, salaryMax: 20000, salarySource: 'posted' }),
    { ...profile, minMonthlySalary: 15000 },
    company('Technology', 'dream'),
    today
  );
  const poor = opportunity(
    // Even with the Nafis top-up, 6–7k is under a 15k minimum.
    role('Data Analyst', { score: 30, postedAt: '2026-06-01', salaryMin: 6000, salaryMax: 7000, salarySource: 'posted' }),
    { ...profile, minMonthlySalary: 15000 },
    undefined,
    today
  );
  assert.ok(good.score > poor.score + 30, `${good.score} vs ${poor.score}`);
  assert.equal(poor.belowMinimum, true);
  assert.equal(good.totalMid, 19000 + 6000, 'Nafis is added for an eligible private-sector role');
  assert.equal(good.parts.reduce((s, p) => s + p.points, 0), good.score);
});

test('a closed role sinks', () => {
  const open = opportunity(role('Data Analyst', { score: 80 }), profile, undefined, '2026-09-24');
  const closed = opportunity(role('Data Analyst', { score: 80, closed: true }), profile, undefined, '2026-09-24');
  assert.ok(closed.score < open.score / 2);
});
