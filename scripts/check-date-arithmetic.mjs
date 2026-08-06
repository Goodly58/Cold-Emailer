/**
 * Hard rule 15: all date math is Asia/Dubai calendar dates computed by
 * lib/calendar.ts. A UTC server doing its own arithmetic anchors day 0 to the
 * wrong day and compares different days than recipients experience, and the
 * bug is invisible until a follow-up lands on a Saturday.
 *
 * So: nothing outside lib/calendar.ts may take a Date apart or add days to one.
 * Reading a timestamp (`new Date()`, `Date.now()`, `.toISOString()`) is fine —
 * those are instants, not calendar dates.
 *
 * Run by `npm run check:dates`, gated in CI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SEARCH_DIRS = ['app', 'lib', 'scripts'];
// lib/durations.ts holds millisecond constants for *elapsed time* — "six hours
// since the last poll", "stuck for a day". Those are instant questions a UTC
// clock answers correctly. Calendar questions (which day is this due? how many
// working days apart?) still belong to lib/calendar.ts, and this guard is what
// keeps the two from blurring.
const ALLOWED = new Set([
  'lib/calendar.ts',
  'lib/durations.ts',
  'scripts/check-date-arithmetic.mjs',
]);

/** Calendar-field access and day arithmetic. Instant handling is not listed. */
const BANNED = [
  { pattern: /\.get(?:UTC)?(?:FullYear|Month|Date|Day)\s*\(/, why: 'reads a calendar field off a Date' },
  { pattern: /\.set(?:UTC)?(?:FullYear|Month|Date|Day|Hours)\s*\(/, why: 'mutates a calendar field on a Date' },
  { pattern: /Date\.UTC\s*\(/, why: 'builds a calendar date by hand' },
  { pattern: /86[_,]?400[_,]?000/, why: 'day-in-milliseconds arithmetic' },
  { pattern: /24\s*\*\s*60\s*\*\s*60/, why: 'day-in-seconds arithmetic' },
  { pattern: /toLocaleDateString|toLocaleString/, why: 'timezone-dependent date rendering' },
  { pattern: /new Intl\.DateTimeFormat/, why: 'timezone-dependent date rendering' },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) yield full;
  }
}

const violations = [];
for (const dir of SEARCH_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      for (const { pattern, why } of BANNED) {
        if (pattern.test(line)) violations.push({ rel, line: i + 1, why, text: line.trim() });
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Date arithmetic outside lib/calendar.ts:\n');
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  ${v.why}\n    ${v.text}`);
  }
  console.error(
    `\n${violations.length} violation(s). Move the logic into lib/calendar.ts and call it from here.`
  );
  process.exit(1);
}

console.log('date arithmetic: clean (lib/calendar.ts is the only date module)');
