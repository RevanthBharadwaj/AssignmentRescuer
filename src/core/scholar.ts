/**
 * Real source lookup and APA 7 references. Records come from Crossref and
 * OpenAlex (free). Nothing here is invented: a reference is built only from
 * fields a catalogue returned, and anything missing is left out, not guessed.
 */

export interface Author { family: string; given: string }
export interface Work {
  title: string;
  authors: Author[];
  year: number | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url: string | null;
  kind: string;
  publisher: string | null;
  from: 'crossref' | 'openalex';
}
export interface Seg { text: string; italic?: boolean }

export const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
export const extractDoi = (s: string): string | null => {
  const m = DOI_RE.exec(s.trim());
  return m ? m[1].replace(/[.,;)\]]+$/, '').toLowerCase() : null;
};

const enc = encodeURIComponent;
export const crossrefSearchUrl = (q: string, rows = 8) =>
  `https://api.crossref.org/works?query.bibliographic=${enc(q)}&rows=${rows}&select=DOI,title,author,issued,container-title,volume,issue,page,type,URL,publisher`;
export const crossrefDoiUrl = (doi: string) => `https://api.crossref.org/works/${enc(doi).replace(/%2F/gi, '/')}`;
export const openAlexSearchUrl = (q: string, rows = 8) => `https://api.openalex.org/works?search=${enc(q)}&per-page=${rows}`;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const first = (v: unknown): string | null => (Array.isArray(v) ? str(v[0]) : str(v));
const clean = (s: string | null) => (s ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null);

function crossrefItem(x: Record<string, unknown>): Work | null {
  const title = clean(first(x.title));
  if (!title) return null;
  const authors = (Array.isArray(x.author) ? x.author : [])
    .map((a: { family?: string; given?: string; name?: string }) => ({ family: str(a.family) ?? str(a.name) ?? '', given: str(a.given) ?? '' }))
    .filter((a) => a.family);
  const parts = (x.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0];
  return {
    title, authors, year: parts && typeof parts[0] === 'number' ? parts[0] : null,
    journal: clean(first(x['container-title'])), volume: str(x.volume), issue: str(x.issue), pages: str(x.page),
    doi: str(x.DOI)?.toLowerCase() ?? null, url: str(x.URL), kind: str(x.type) ?? 'other', publisher: str(x.publisher), from: 'crossref',
  };
}

export function parseCrossref(json: string): Work[] {
  const data = JSON.parse(json) as { message?: { items?: Record<string, unknown>[] } & Record<string, unknown> };
  const m = data.message;
  if (!m) return [];
  const items = Array.isArray(m.items) ? m.items : m.title ? [m] : [];
  return items.map(crossrefItem).filter((w): w is Work => !!w);
}

export function parseOpenAlex(json: string): Work[] {
  const data = JSON.parse(json) as { results?: Record<string, unknown>[] };
  return (data.results ?? []).map((r): Work | null => {
    const title = clean(str(r.title) ?? str(r.display_name));
    if (!title) return null;
    const authors = (Array.isArray(r.authorships) ? r.authorships : []).map((a: { author?: { display_name?: string } }) => {
      const name = (a.author?.display_name ?? '').trim();
      const bits = name.split(/\s+/);
      return { family: bits.length > 1 ? bits[bits.length - 1] : name, given: bits.length > 1 ? bits.slice(0, -1).join(' ') : '' };
    }).filter((a) => a.family);
    const loc = r.primary_location as { source?: { display_name?: string } } | undefined;
    const bib = r.biblio as { volume?: string; issue?: string; first_page?: string; last_page?: string } | undefined;
    const doiRaw = str(r.doi);
    return {
      title, authors, year: typeof r.publication_year === 'number' ? r.publication_year : null,
      journal: str(loc?.source?.display_name), volume: str(bib?.volume), issue: str(bib?.issue),
      pages: bib?.first_page ? (bib.last_page && bib.last_page !== bib.first_page ? `${bib.first_page}–${bib.last_page}` : bib.first_page) : null,
      doi: doiRaw ? extractDoi(doiRaw) : null, url: doiRaw, kind: str(r.type) ?? 'other', publisher: null, from: 'openalex',
    };
  }).filter((w): w is Work => !!w);
}

/** Merge lists, keeping one entry per DOI (or per title), Crossref first. */
export function mergeWorks(...lists: Work[][]): Work[] {
  const seen = new Set<string>();
  const out: Work[] = [];
  for (const w of lists.flat()) {
    const key = w.doi ?? w.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

const initials = (given: string) =>
  given.split(/[\s.]+/).filter(Boolean).map((p) => (p.includes('-') ? p.split('-').map((q) => `${q[0].toUpperCase()}.`).join('-') : `${p[0].toUpperCase()}.`)).join(' ');
const authorName = (a: Author) => (a.given ? `${a.family}, ${initials(a.given)}` : a.family);

export function authorList(authors: Author[]): string {
  const names = authors.map(authorName);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length <= 20) return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(', ')}, . . . ${names[names.length - 1]}`;
}

const endDot = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** APA 7 reference as styled pieces (journal and volume in italics). */
export function apaSegments(w: Work): Seg[] {
  const segs: Seg[] = [];
  const who = authorList(w.authors);
  const when = w.year ? `(${w.year})` : '(n.d.)';
  const link = w.doi ? `https://doi.org/${w.doi}` : w.url;
  const tail = link ? ` ${link}` : '';
  if (who) segs.push({ text: `${endDot(who)} ${when}. ` });
  else segs.push({ text: `${endDot(w.title)} ${when}. ` });
  if (who) segs.push({ text: `${endDot(w.title)} ` });
  if (w.journal) {
    segs.push({ text: w.journal, italic: true });
    if (w.volume) { segs.push({ text: ', ' }); segs.push({ text: w.volume, italic: true }); }
    if (w.issue) segs.push({ text: `(${w.issue})` });
    if (w.pages) segs.push({ text: `, ${w.pages.replace(/-/g, '–')}` });
    segs.push({ text: `.${tail}` });
  } else {
    if (w.publisher && /book|monograph|report|dissertation/.test(w.kind)) segs.push({ text: `${endDot(w.publisher)}${tail}` });
    else segs.push({ text: tail.trim() });
  }
  return segs;
}
export const apaText = (w: Work) => apaSegments(w).map((s) => s.text).join('').replace(/\s+/g, ' ').trim();

/** In text citation, for example (Rivera, 2021) or (Rivera & Osei, 2021). */
export function inText(w: Work): string {
  const year = w.year ? String(w.year) : 'n.d.';
  const fam = w.authors.map((a) => a.family);
  if (fam.length === 0) return `("${w.title.split(/\s+/).slice(0, 4).join(' ')}," ${year})`;
  if (fam.length === 1) return `(${fam[0]}, ${year})`;
  if (fam.length === 2) return `(${fam[0]} & ${fam[1]}, ${year})`;
  return `(${fam[0]} et al., ${year})`;
}

export type Fetcher = (url: string) => Promise<string>;

/** Search two catalogues; a failing one does not stop the other. */
export async function searchWorks(query: string, get: Fetcher): Promise<{ works: Work[]; notes: string[] }> {
  const notes: string[] = [];
  const run = async (url: string, parse: (j: string) => Work[], name: string) => {
    try { return parse(await get(url)); } catch (e) { notes.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); return []; }
  };
  const [a, b] = await Promise.all([run(crossrefSearchUrl(query), parseCrossref, 'Crossref'), run(openAlexSearchUrl(query), parseOpenAlex, 'OpenAlex')]);
  return { works: mergeWorks(a, b).slice(0, 12), notes };
}

/** Check a DOI exists in Crossref and return its record. */
export async function verifyDoi(doi: string, get: Fetcher): Promise<Work | null> {
  try {
    return parseCrossref(await get(crossrefDoiUrl(doi)))[0] ?? null;
  } catch (e) {
    if (e instanceof Error && e.message === 'NOT_FOUND') return null;
    throw e;
  }
}
