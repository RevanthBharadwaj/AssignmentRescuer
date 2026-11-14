/**
 * Facts read from a syllabus: how the grade is made up, which articles and
 * texts belong to which unit, the posting rules (for example "initial post by
 * Wednesday, replies by Saturday"), and the prompt and requirements the
 * syllabus gives for each unit's discussion and writing items. Everything is
 * read with plain rules, so each fact can be traced to a line of the syllabus.
 */

export interface GradeRow {
  label: string;
  /** "11 @ 20 points each" gives count 11 and each 20. */
  count: number | null;
  each: number | null;
  points: number;
  percent: number;
}

export interface Reading {
  citation: string;
  url: string | null;
}

export interface PostingRules {
  /** Day writing work and replies are due, for example "Saturday". */
  dueDay: string | null;
  dueTime: string | null;
  timeZone: string | null;
  /** Day the first discussion post is due, for example "Wednesday". */
  initialPostDay: string | null;
  initialPostTime: string | null;
  wordMin: number | null;
  wordMax: number | null;
  replies: number | null;
  referencesRequired: boolean;
  apa: boolean;
}

export interface UnitItem {
  name: string;
  kind: 'discussion' | 'writing';
  prompt: string;
  requirements: string;
}

export interface SyllabusFacts {
  grading: GradeRow[];
  totalPoints: number | null;
  texts: string[];
  /** Articles listed for each unit number. */
  articles: Record<number, Reading[]>;
  rules: PostingRules;
}

const WORD_NUM: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12 };
const BULLET = '[•▪◦\\u2022\\u25AA\\u25E6\\uF0B7\\uF0A7]';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const isPageNumber = (l: string) => /^\s*\d{1,3}\s*$/.test(l);

/* ---------- grading ---------- */

function parseGrading(lines: string[]): { rows: GradeRow[]; total: number | null } {
  const rows: GradeRow[] = [];
  let total: number | null = null;
  const start = lines.findIndex((l) => /^\s*Assignment\s+Points/i.test(l));
  if (start < 0) return { rows, total };
  for (const line of lines.slice(start + 1, start + 20)) {
    const m = /^\s*(.+?)\s+(\d{2,4})\s+(\d{1,3})\s*%\s*$/.exec(line);
    if (!m) {
      if (rows.length && !/^\s*$/.test(line) && !/^\s*[A-D][+-]?\s/.test(line)) continue;
      if (rows.length) break;
      continue;
    }
    const [, rawLabel, pts, pct] = m;
    if (/^total$/i.test(rawLabel.trim())) { total = Number(pts); break; }
    const per = /\((\d+)\s*@\s*(\d+)\s*points?\s*each\)/i.exec(rawLabel);
    rows.push({
      label: clean(rawLabel.replace(/\([^)]*\)/g, '')),
      count: per ? Number(per[1]) : null,
      each: per ? Number(per[2]) : null,
      points: Number(pts),
      percent: Number(pct),
    });
  }
  return { rows, total };
}

/* ---------- texts and articles ---------- */

function parseTexts(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^\s*Resource Inventory/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    const m = /^([A-Z][\w'’-]+),.*?\((\d{4})\)\.\s*(.+?)\.\s/.exec(`${cur} `);
    if (m) out.push(`${m[1]} (${m[2]}), ${m[3]}`);
    cur = '';
  };
  for (const line of lines.slice(start + 1, start + 40)) {
    if (/^\s*UNIT\s+\d+\s+ARTICLE/i.test(line)) break;
    if (/^\s*ISBN/i.test(line) || !line.trim()) { flush(); continue; }
    if (/^\s*The Holy Bible/i.test(line)) { flush(); continue; }
    cur += `${cur ? ' ' : ''}${line.trim()}`;
  }
  flush();
  return out;
}

function parseArticles(lines: string[]): Record<number, Reading[]> {
  const out: Record<number, Reading[]> = {};
  let unit: number | null = null;
  let cur: string[] = [];
  const flush = () => {
    if (unit === null || !cur.length) { cur = []; return; }
    const text = cur.join(' ');
    const url = /https?:\/\/\S+/.exec(text)?.[0] ?? null;
    const citation = clean(text.replace(/https?:\/\/\S+/g, '').replace(/&amp;/g, '&'));
    if (/^[A-Z][\w'’-]+,\s+[A-Z]\./.test(citation) || /\(\d{4}\)/.test(citation)) {
      const list = (out[unit] ??= []);
      const existing = list.find((r) => r.citation === citation);
      if (!existing) list.push({ citation, url });
    }
    cur = [];
  };
  for (const raw of lines) {
    const h = /^\s*UNIT\s+(\d+)\s+ARTICLES?:/i.exec(raw);
    if (h) { flush(); unit = Number(h[1]); continue; }
    if (unit === null) continue;
    if (/^\s*(Research Articles|Summary of Assignments|Course Schedule)/i.test(raw)) { flush(); unit = null; continue; }
    if (isPageNumber(raw)) continue;
    if (!raw.trim()) { flush(); continue; }
    // A new citation starts with "Surname, I." at the start of a line.
    if (/^\s*[A-Z][\w'’-]+,\s+[A-Z]\./.test(raw) && cur.length && !/^\s*https?:/.test(raw) && /(?:\)\.|https?:\/\/\S+)\s*$/.test(cur.join(' ').slice(-200)) && /\(\d{4}\)/.test(cur.join(' '))) flush();
    cur.push(raw.trim());
  }
  flush();
  return out;
}

/* ---------- posting rules ---------- */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const tidyTime = (s: string) => s.replace(/\./g, '').replace(/\s+/g, ' ').trim().toUpperCase().replace(/(\d)(AM|PM)/, '$1 $2');

function parseRules(text: string): PostingRules {
  const flat = clean(text);
  const due = /due no later than (\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s*(?:\((\w+)\))?\s*on (\w+day)/i.exec(flat);
  const initial = /initial post\(?s?\)?[^.]{0,80}?before (\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s*on (\w+day)/i.exec(flat);
  const words = /within a range of (\d+)\s*[-–]\s*(\d+)\s*words/i.exec(flat);
  const replies = /at least (two|three|one|\d+) other posts/i.exec(flat);
  const num: Record<string, number> = { one: 1, two: 2, three: 3 };
  return {
    dueDay: due ? cap(due[3]) : null,
    dueTime: due ? tidyTime(due[1]) : null,
    timeZone: due?.[2] ? due[2].toUpperCase() : null,
    initialPostDay: initial ? cap(initial[2]) : null,
    initialPostTime: initial ? tidyTime(initial[1]) : null,
    wordMin: words ? Number(words[1]) : null,
    wordMax: words ? Number(words[2]) : null,
    replies: replies ? (num[replies[1].toLowerCase()] ?? Number(replies[1])) : null,
    referencesRequired: /(?:post and reply|posts?) must contain references/i.test(flat),
    apa: /APA[- ]compliant|APA 7/i.test(flat),
  };
}

/* ---------- unit sections ---------- */

/** The text of "UNIT FIVE: ..." up to the next unit heading. */
export function unitText(text: string, unit: number): string | null {
  const lines = text.split('\n');
  const heading = (l: string) => {
    const m = /^\s*UNIT\s+([A-Z]+)\s*:/.exec(l);
    return m && WORD_NUM[m[1]] ? WORD_NUM[m[1]] : null;
  };
  const start = lines.findIndex((l) => heading(l) === unit);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (heading(lines[i]) !== null || /^\s*APPENDIX\b/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

/** The discussion and writing items of one unit, each with its prompt and requirements. */
export function unitItems(section: string): UnitItem[] {
  const items: UnitItem[] = [];
  let kind: UnitItem['kind'] | null = null;
  let cur: UnitItem | null = null;
  let field: 'prompt' | 'requirements' | null = null;
  const push = (to: 'prompt' | 'requirements', s: string) => {
    if (!cur) return;
    cur[to] = `${cur[to]}${cur[to] ? ' ' : ''}${s}`.trim();
  };
  const close = () => { if (cur) { cur.prompt = clean(cur.prompt); cur.requirements = clean(cur.requirements); items.push(cur); } cur = null; field = null; };
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (!line || isPageNumber(raw)) continue;
    if (/^(Discussion Questions?)\b/i.test(line)) { close(); kind = 'discussion'; continue; }
    if (/^(Writing Assignments?|Written Assignments?|Final\b.*Paper)\b/i.test(line)) { close(); kind = 'writing'; continue; }
    if (/^(Reminder|Reading Assignments?|Unit Activities|Unit Learning|Upon completion|Zoom|Attend)\b/i.test(line)) { close(); kind = null; continue; }
    if (!kind) continue;
    const f = new RegExp(`^(?:${BULLET}|o)?\\s*(Prompt|Requirements?)\\s*:\\s*(.*)$`, 'i').exec(line);
    if (f && cur) {
      field = /^prompt/i.test(f[1]) ? 'prompt' : 'requirements';
      push(field, f[2]);
      continue;
    }
    const b = new RegExp(`^${BULLET}\\s+(.+)$`).exec(line);
    if (b && !/^(Prompt|Requirements?)\b/i.test(b[1])) {
      // A bullet directly under a field line that is not a new item (for example a sub list) keeps filling that field.
      const looksLikeItem = /^(Discussion Question|Project|Assignment|NO WRITTEN|Final|Major)/i.test(b[1]) || !cur;
      if (looksLikeItem) {
        close();
        cur = { name: clean(b[1]), kind, prompt: '', requirements: '' };
        continue;
      }
    }
    if (cur && field) push(field, line.replace(new RegExp(`^${BULLET}\\s*`), '').trim());
  }
  close();
  return items.filter((i) => i.prompt || i.requirements || !/^NO WRITTEN/i.test(i.name));
}

/** Pick the unit item that an assignment title refers to. */
export function matchUnitItem(title: string, items: UnitItem[]): UnitItem | null {
  const t = title.toLowerCase();
  const n = /question\s*(\d+)/.exec(t)?.[1];
  if (/discussion/.test(t)) {
    const disc = items.filter((i) => i.kind === 'discussion');
    if (n) return disc.find((i) => new RegExp(`question\\s*${n}\\b`, 'i').test(i.name)) ?? null;
    return disc.length === 1 ? disc[0] : (disc.find((i) => !/\d/.test(i.name)) ?? null);
  }
  const writing = items.filter((i) => i.kind === 'writing' && !/^NO WRITTEN/i.test(i.name));
  if (/writ|paper|project|essay|assignment/.test(t)) return writing.length >= 1 ? writing[0] : null;
  return null;
}

export function parseSyllabus(text: string): SyllabusFacts {
  const lines = text.split('\n');
  const { rows, total } = parseGrading(lines);
  return { grading: rows, totalPoints: total, texts: parseTexts(lines), articles: parseArticles(lines), rules: parseRules(text) };
}

/** Which grade group an assignment belongs to, by its title. */
export function gradeRowFor(title: string, facts: SyllabusFacts): GradeRow | null {
  const t = title.toLowerCase();
  if (/discussion/.test(t)) return facts.grading.find((g) => /discussion/i.test(g.label)) ?? null;
  if (/final|major project|presenting leadership/.test(t)) return facts.grading.find((g) => /major|final/i.test(g.label)) ?? null;
  return null;
}

/** The "Reading Assignments" bullets of one unit ("Text: ...", "Article: ..."). */
export function unitReadingLines(section: string): string[] {
  const lines = section.split('\n');
  const start = lines.findIndex((l) => /^\s*Reading Assignments?\b/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (!line || isPageNumber(raw)) { if (out.length) continue; else continue; }
    if (/^(Discussion Questions?|Writing Assignments?|Written Assignments?|Reminder|Unit Activities|Final\b)/i.test(line)) break;
    const b = new RegExp(`^${BULLET}\\s+(.+)$`).exec(line);
    if (b) out.push(clean(b[1]));
    else if (out.length) out[out.length - 1] = clean(`${out[out.length - 1]} ${line}`);
  }
  return out.filter((l) => !/^no reading/i.test(l));
}
