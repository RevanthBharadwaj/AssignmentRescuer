import type { AcademicDate } from '../types';

/**
 * Deterministic academic date parsing.
 *
 * Supported shapes:
 *   January 15, 2027 | Jan 15 2027 | Jan. 15th | 15 January 2027
 *   1/15/2027 | 1/15/27 | 1/15 (US month/day order)
 *   2027-01-15 (ISO)
 * Optional weekday prefix ("Sunday, Jan 15") and time suffix
 * ("11:59 PM ET", "at 5pm", "noon", "23:59").
 *
 * When the year is missing it is resolved from the semester window if one
 * is supplied, otherwise it is left unknown. The parser never guesses a
 * year from the current date.
 */

export interface DateContext {
  semesterStart?: string | null; // YYYY-MM-DD
  semesterEnd?: string | null;
}

export interface DateMention {
  date: AcademicDate;
  start: number;
  end: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY_RE =
  '(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?\\.?,?\\s+)?';

const TZ_RE =
  '(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|AKST|HST|UTC|GMT|Eastern|Central|Mountain|Pacific)';

// Time: 11:59 PM, 11:59pm, 5 pm, 5p.m., noon, midnight, 23:59
const TIME_RE =
  `(?:\\s*(?:,|at|by|@|-)?\\s*` +
  `((?:\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?))|noon|midnight|(?:[01]?\\d|2[0-3]):[0-5]\\d)` +
  `(?:\\s*\\(?${TZ_RE}\\b\\)?)?)?`;

const PATTERNS: { re: RegExp; kind: 'mdy_name' | 'dmy_name' | 'numeric' | 'iso' }[] = [
  {
    kind: 'iso',
    re: new RegExp(`\\b(\\d{4})-(\\d{2})-(\\d{2})\\b${TIME_RE}`, 'gi'),
  },
  {
    kind: 'mdy_name',
    re: new RegExp(
      `\\b${WEEKDAY_RE}${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?${TIME_RE}`,
      'gi',
    ),
  },
  {
    kind: 'dmy_name',
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+(\\d{4})\\b)?${TIME_RE}`, 'gi'),
  },
  {
    kind: 'numeric',
    re: new RegExp(`(?<![\\d/])(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\d/])${TIME_RE}`, 'gi'),
  },
];

export function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= dim;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '23:59';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3]?.replace(/\./g, '');
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'pm' && h !== 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  if (min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

function normaliseTz(raw: string | undefined): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    eastern: 'ET', central: 'CT', mountain: 'MT', pacific: 'PT',
  };
  return map[raw.toLowerCase()] ?? raw.toUpperCase();
}

/** Resolve a missing year using the semester window (with a small slack). */
export function resolveYear(month: number, day: number, ctx: DateContext): number | null {
  const { semesterStart, semesterEnd } = ctx;
  if (!semesterStart || !semesterEnd) return null;
  const startY = Number(semesterStart.slice(0, 4));
  const endY = Number(semesterEnd.slice(0, 4));
  const slackMs = 21 * 86_400_000;
  const lo = Date.parse(semesterStart) - slackMs;
  const hi = Date.parse(semesterEnd) + slackMs;
  const candidates: number[] = [];
  for (let y = startY; y <= endY; y++) {
    if (!isValidDate(y, month, day)) continue;
    const t = Date.parse(toIso(y, month, day));
    if (t >= lo && t <= hi) candidates.push(y);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function buildDate(
  month: number,
  day: number,
  yearRaw: string | undefined,
  timeRaw: string | undefined,
  tzRaw: string | undefined,
  raw: string,
  ctx: DateContext,
): AcademicDate | null {
  let year: number | null = null;
  let yearSource: AcademicDate['yearSource'] = 'unknown';
  if (yearRaw) {
    year = Number(yearRaw);
    if (yearRaw.length === 2) year += 2000;
    yearSource = 'explicit';
  } else {
    year = resolveYear(month, day, ctx);
    if (year !== null) yearSource = 'semester_context';
  }
  // Validate month/day against the year we have, or a leap year if unknown.
  if (!isValidDate(year ?? 2024, month, day)) return null;
  return {
    iso: year !== null ? toIso(year, month, day) : null,
    month,
    day,
    year,
    yearSource,
    time: parseTime(timeRaw),
    timeZone: normaliseTz(tzRaw),
    raw: raw.trim(),
  };
}

/** Find every date mention in a string. Overlapping matches are dropped. */
export function findDates(text: string, ctx: DateContext = {}): DateMention[] {
  const found: DateMention[] = [];
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      let date: AcademicDate | null = null;
      if (kind === 'iso') {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        date = isValidDate(y, mo, d)
          ? buildDate(mo, d, m[1], m[4], m[5], m[0], ctx)
          : null;
      } else if (kind === 'mdy_name') {
        date = buildDate(MONTHS[m[1].toLowerCase()], Number(m[2]), m[3], m[4], m[5], m[0], ctx);
      } else if (kind === 'dmy_name') {
        date = buildDate(MONTHS[m[2].toLowerCase()], Number(m[1]), m[3], m[4], m[5], m[0], ctx);
      } else {
        date = buildDate(Number(m[1]), Number(m[2]), m[3], m[4], m[5], m[0], ctx);
      }
      if (date) found.push({ date, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Days between two ISO dates (b minus a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
