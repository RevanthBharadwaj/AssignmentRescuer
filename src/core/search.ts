import type { CourseSource } from './courseContent';

export interface SearchHit {
  sourceId: string;
  name: string;
  course: string | null;
  /** 1 based page for PDFs, when known. */
  page: number | null;
  snippet: string;
  /** Terms found, for highlighting. */
  terms: string[];
  score: number;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const WORDS = (q: string) => [...new Set(norm(q).match(/[a-z0-9]{2,}/g) ?? [])];

function pageOf(source: CourseSource, index: number): number | null {
  const offs = (source as { pageOffsets?: number[] }).pageOffsets;
  if (!offs?.length) return null;
  let page = 1;
  for (let i = 0; i < offs.length; i++) if (offs[i] <= index) page = i + 1;
  return page;
}

/**
 * Search the text of everything imported, including PDFs. A file matches when it has every word; the best
 * matches come first, a word in the file name counts extra, and each hit shows the sentence around the first
 * match with its page number. Case and accents are ignored. Quote a phrase to search it exactly.
 */
export function searchSources(sources: CourseSource[], query: string, limit = 30): SearchHit[] {
  const phrase = /"([^"]{2,})"/.exec(query)?.[1];
  const terms = phrase ? [norm(phrase).trim()] : WORDS(query);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const s of sources) {
    const text = norm(s.text);
    const name = norm(s.originalName);
    let score = 0;
    let first = -1;
    let ok = true;
    for (const t of terms) {
      const inName = name.includes(t);
      let count = 0;
      for (let i = text.indexOf(t); i >= 0 && count < 50; i = text.indexOf(t, i + t.length)) { if (first < 0 || i < first) first = i; count++; }
      if (!count && !inName) { ok = false; break; }
      score += Math.min(count, 10) + (inName ? 8 : 0);
    }
    if (!ok) continue;
    // Positions in the lower-cased copy line up with the original text, except for rare accent expansions.
    const at = first < 0 ? 0 : Math.min(first, s.text.length - 1);
    const raw = s.text.slice(Math.max(0, at - 80), at + 200).replace(/\s+/g, ' ').trim();
    hits.push({ sourceId: s.id, name: s.originalName, course: s.hints.course ?? null, page: first < 0 ? null : pageOf(s, first), snippet: raw, terms, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
