// One-shot extraction: lifts the target companies out of the v1 dashboard's
// JSON store into seed/companies.json, the format the engine's seeder reads.
//
// Applies the two hard filters research/company-universe.md forces:
//   - government entities go in a separate segment (not quota-subject)
//   - free-zone-only entities are excluded (outside MoHRE's remit)
// and keeps the propensity signals we actually have in the data.
//
// Kept in the repo so the classification is reviewable, not magic.
import { readFileSync, writeFileSync } from 'node:fs';

const db = JSON.parse(readFileSync('data/db.json', 'utf8'));

const GOVERNMENT = /\b(authority|ministry|municipality|police|central bank|regulator|regulatory|customs|court|federal|government|department of|dewa|rta|adnec|etihad rail|securities and commodities)\b/i;
const FREE_ZONE_ONLY = /\b(difc|adgm|dmcc|jafza|dafza|rakez|shams|meydan free|ifza|free zone)\b/i;

// Sectors CBUAE regulates run their own, stricter Emiratisation regime.
const CBUAE_REGULATED = /bank|insurance|reinsurance|takaful|finance compan|exchange house/i;

function segmentOf(c) {
  if (GOVERNMENT.test(c.name) || GOVERNMENT.test(c.sector || '')) return 'government';
  if (FREE_ZONE_ONLY.test(c.name)) return 'free_zone_only';
  return 'private';
}

function normalizedDomain(domain) {
  return domain.toLowerCase().replace(/^www\./, '');
}

// Propensity, not pressure — research/company-universe.md §5.1. We only have a
// subset of the signals in this data, so this is a coarse ordering, not the
// full score.
function propensity(c) {
  let s = 0;
  if (c.tier === 'dream') s += 3;
  else if (c.tier === 'target') s += 1;
  if (c.emiratisation) s += 2;
  if (CBUAE_REGULATED.test(c.sector || '')) s += 2;
  if (c.emiratisationNotes) s += 1;
  if (c.careersUrl) s += 1;
  return s;
}

const seen = new Set();
const rows = [];
for (const c of db.companies) {
  if (!c.domain) continue;
  const segment = segmentOf(c);
  if (segment === 'free_zone_only') continue;

  const domain = normalizedDomain(c.domain);
  if (seen.has(domain)) continue;
  seen.add(domain);

  rows.push({
    name: c.name,
    domain,
    sector: c.sector || null,
    location: c.location || null,
    segment,
    emiratisation_notes: c.emiratisationNotes || null,
    careers_url: c.careersUrl || null,
    email_pattern_hint: c.emailPattern || null,
    propensity: propensity(c),
  });
}

rows.sort((a, b) => b.propensity - a.propensity || a.name.localeCompare(b.name));

// Week 1 seeds a working set, not the whole universe (ULTRAPROMPT §6).
const TAKE = 50;
const privateRows = rows.filter((r) => r.segment === 'private').slice(0, TAKE);

writeFileSync('seed/companies.json', JSON.stringify(privateRows, null, 2) + '\n');
console.log(
  `wrote ${privateRows.length} companies ` +
    `(from ${db.companies.length} rows, ${rows.length} after dedupe/exclusions)`
);
