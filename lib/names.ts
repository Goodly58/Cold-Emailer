/**
 * Company-name matching. The same employer turns up as "ADIA", "Abu Dhabi
 * Investment Authority (ADIA)" and "Abu Dhabi Investment Authority PJSC"
 * depending on the source, so exact string comparison misses most matches.
 */

const NOISE =
  /\b(the|group|holding|holdings|company|co|corporation|corp|llc|plc|pjsc|psc|limited|ltd|inc|uae)\b/gi;

/** Parentheticals that qualify a location rather than abbreviate a name —
 *  treating "(Dubai)" as an acronym would merge every "X (Dubai)". */
const NOT_ACRONYMS = new Set([
  'uae', 'dubai', 'abudhabi', 'sharjah', 'ajman', 'fujairah', 'rak', 'rasalkhaimah',
  'ummalquwain', 'alain', 'mena', 'middleeast', 'gcc', 'me', 'group', 'holding',
  'international', 'global', 'emirates',
]);

/** Order- and noise-insensitive key: "The ACME Group LLC (AG)" -> "acme". */
export function canonical(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, '');
}

/** Genuine abbreviations: an all-caps parenthetical, or a name that is
 *  nothing but an acronym. */
export function acronymsOf(name: string): string[] {
  const out = new Set<string>();
  for (const m of name.matchAll(/\(([^)]{2,14})\)/g)) {
    const token = m[1].trim();
    if (token !== token.toUpperCase()) continue;
    const a = token.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (a.length >= 2 && !NOT_ACRONYMS.has(a)) out.add(a);
  }
  const bare = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (name === name.toUpperCase() && bare.length >= 2 && bare.length <= 12 && !NOT_ACRONYMS.has(bare)) {
    out.add(bare);
  }
  return [...out];
}

/** Every key a name should be findable under. */
export function nameKeys(name: string): string[] {
  const keys = new Set<string>([canonical(name), ...acronymsOf(name)]);
  keys.delete('');
  return [...keys];
}

/**
 * Index a list by name so lookups tolerate formatting differences.
 * Earlier entries win when two share a key.
 */
export function indexByName<T extends { name: string }>(items: T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) {
    for (const key of nameKeys(item.name)) {
      if (!index.has(key)) index.set(key, item);
    }
  }
  return index;
}

export function findByName<T extends { name: string }>(index: Map<string, T>, name: string): T | undefined {
  for (const key of nameKeys(name)) {
    const hit = index.get(key);
    if (hit) return hit;
  }
  return undefined;
}
