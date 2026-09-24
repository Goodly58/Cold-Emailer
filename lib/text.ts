/**
 * HTML to readable plain text, for job descriptions. Boards return HTML (and
 * Greenhouse returns it entity-escaped), but everything downstream — salary
 * parsing, AI fit analysis, storage — wants plain text.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(input: string | undefined | null, maxChars = 20_000): string {
  if (!input) return '';
  // Greenhouse sends HTML with its tags escaped as entities; unescape first
  // if the text looks like it, so the tags can then be stripped.
  let s = /&lt;[a-z/!]/i.test(input) ? decodeEntities(input) : input;

  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s)
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n+• /g, '\n• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s.length > maxChars ? s.slice(0, maxChars) : s;
}
