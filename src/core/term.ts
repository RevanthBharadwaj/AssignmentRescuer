/**
 * Academic terms found in pasted text and screenshots ("2026 Fall", "Fall 2026",
 * "2026FA"). The app never trusts one silently: it compares what the material says
 * with the student's saved semester and asks when they differ.
 */

export type Season = 'Winter' | 'Spring' | 'Summer' | 'Fall';

const SEASONS: Season[] = ['Winter', 'Spring', 'Summer', 'Fall'];
const CODES: Record<string, Season> = { WI: 'Winter', SP: 'Spring', SU: 'Summer', FA: 'Fall' };
const word = (s: string): Season => (s[0].toUpperCase() + s.slice(1).toLowerCase()) as Season;

export const termLabel = (season: Season, year: number | string): string => `${season} ${year}`;

/** Chronological sort key: Spring 2027 sorts after Fall 2026. */
export function termOrder(label: string): number {
  const m = /^(\w+)\s+(\d{4})$/.exec(label.trim());
  return m ? Number(m[2]) * 10 + Math.max(0, SEASONS.indexOf(word(m[1]))) : 0;
}

export function sameTerm(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Distinct terms the text mentions, most mentioned first. */
export function findTerms(text: string): string[] {
  const counts = new Map<string, number>();
  const add = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const m of text.matchAll(/\b(fall|spring|summer|winter)\s+(20\d{2})\b/gi)) add(termLabel(word(m[1]), m[2]));
  for (const m of text.matchAll(/\b(20\d{2})\s+(fall|spring|summer|winter)\b/gi)) add(termLabel(word(m[2]), m[1]));
  for (const m of text.matchAll(/\b(20\d{2})(FA|SP|SU|WI)\b/g)) add(termLabel(CODES[m[2]], m[1]));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || termOrder(a[0]) - termOrder(b[0])).map(([t]) => t);
}

/** The terms in `text` when none of them is the saved semester; null when there is nothing to ask. */
export function termMismatch(text: string, semester: string | null | undefined): { found: string[]; semester: string } | null {
  if (!semester) return null;
  const found = findTerms(text);
  if (!found.length || found.some((t) => sameTerm(t, semester))) return null;
  return { found, semester };
}
