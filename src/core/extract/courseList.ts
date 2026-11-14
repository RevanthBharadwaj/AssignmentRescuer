import { normaliseCourseCode } from '../util';

/**
 * Parses a course list copied from an LMS, for example Canvas "All Courses":
 *
 *   [2026FA Strategic Management (BUS-610A-7AB12)](https://school.instructure.com/courses/12345)
 *   2026FA Strategic Management (BUS-610A-7AB12)
 *   Term: 2026 Fall
 *
 * and plainer forms such as "BUS 610A Strategic Management" or
 * "BUS-610A: Strategic Management". Each course appears once.
 */

export interface ParsedCourse {
  code: string; // "BUS 610A"
  name: string | null; // "Strategic Management"
  section: string | null; // "7AB12"
  term: string | null; // "Fall 2026"
  url: string | null;
}

const TERM_NAMES: Record<string, string> = { FA: 'Fall', SP: 'Spring', SU: 'Summer', WI: 'Winter' };

// "2026FA Strategic Management (BUS-610A-7AB12)"
const CANVAS_RE = /(?:\b(20\d{2})(FA|SP|SU|WI)\s+)?([^()[\]\n]+?)\s*\(([A-Z]{2,4})[-\s]?(\d{3,4}[A-Z]?)(?:-([A-Z0-9]{2,8}))?\)/;
// "BUS 610A Strategic Management" or "BUS-610A: Strategic Management"
const PLAIN_RE = /^\s*[-*•]?\s*([A-Z]{2,4})[-\s]?(\d{3,4}[A-Z]?)\s*[:\-–]?\s+([A-Za-z][^()\n]{2,80})$/;
const TERM_LINE_RE = /^\s*term\s*:\s*(20\d{2})\s+(spring|summer|fall|winter)\s*$|^\s*term\s*:\s*(spring|summer|fall|winter)\s+(20\d{2})\s*$/i;
const URL_RE = /\((https?:\/\/[^)\s]+\/courses\/\d+)[^)]*\)/;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1).toLowerCase();

export function parseCourseList(text: string): ParsedCourse[] {
  const out = new Map<string, ParsedCourse>();
  let last: ParsedCourse | null = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const term = TERM_LINE_RE.exec(line);
    if (term && last) {
      last.term ??= term[1] ? `${cap(term[2])} ${term[1]}` : `${cap(term[3])} ${term[4]}`;
      continue;
    }

    // Strip Markdown link syntax but keep its URL.
    const url = URL_RE.exec(line)?.[1] ?? null;
    const plain = line.replace(/^\s*[-*•]\s*/, '').replace(/^\[(.*)\]\(.*\)$/, '$1');

    const m = CANVAS_RE.exec(plain);
    if (m) {
      const code = normaliseCourseCode(`${m[4]} ${m[5]}`);
      const existing = out.get(code);
      const name = m[3].trim().replace(/^(20\d{2})(FA|SP|SU|WI)\s+/, '') || null;
      const entry: ParsedCourse = existing ?? { code, name, section: m[6] ?? null, term: m[1] ? `${TERM_NAMES[m[2]]} ${m[1]}` : null, url };
      entry.url ??= url;
      entry.name ??= name;
      out.set(code, entry);
      last = entry;
      continue;
    }

    const p = PLAIN_RE.exec(plain);
    if (p && !/^(term|enrolled|role|published)\b/i.test(plain)) {
      const code = normaliseCourseCode(`${p[1]} ${p[2]}`);
      const entry = out.get(code) ?? { code, name: p[3].trim(), section: null, term: null, url };
      out.set(code, entry);
      last = entry;
    }
  }
  return [...out.values()];
}

/** "BUS 610A" → "BUS-610A", the form used on title pages. */
export function hyphenCode(code: string): string {
  return code.replace(/\s+/, '-');
}
