import type { AcademicDate, ConfirmedRecord } from './types';
import { addDays } from './extract/dates';
import type { Milestone } from './schedule';
import { weekdayOf } from './schedule';

/**
 * Repeating work, found by looking at what the course already listed: if "Work Hour Log" was due every
 * week for the last few weeks, the next weeks are probably due too, even if the course page has not
 * listed them yet. Only dates and times decide; unit numbers and other digits in the title are ignored.
 */

export interface Repeat {
  key: string;
  label: string;
  courseCode: string;
  /** 0 = Sunday. */
  weekday: number;
  time: string | null;
  points: number | null;
}

/** The title without its unit or week number, so every week of the same work groups together. */
export function seriesName(title: string): string {
  return title.toLowerCase()
    .replace(/^\s*(unit|week|module)\s*\d+\s*[:\-–]?\s*/, '')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const dueOf = (r: ConfirmedRecord) => (r.fields.dueDate ?? null) as AcademicDate | null;
const commonest = <T,>(xs: T[]): T | null => {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

interface Series { key: string; label: string; courseCode: string; dates: string[]; time: string | null; points: number | null }

function seriesOf(records: ConfirmedRecord[]): Series[] {
  const groups = new Map<string, ConfirmedRecord[]>();
  for (const r of records) {
    if (r.entityType !== 'assignment' || !dueOf(r)?.iso) continue;
    const name = seriesName(String(r.fields.title ?? ''));
    if (name.length < 4) continue;
    const k = `${String(r.fields.courseCode ?? '')}|${name}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].map(([key, list]) => {
    const first = list[0];
    const points = commonest(list.map((r) => (typeof r.fields.pointsPossible === 'number' ? r.fields.pointsPossible : null)).filter((p): p is number => p !== null));
    return {
      key, courseCode: String(first.fields.courseCode ?? ''),
      label: String(first.fields.title ?? '').replace(/^\s*(unit|week|module)\s*\d+\s*[:\-–]?\s*/i, '').trim() || key,
      dates: [...new Set(list.map((r) => (dueOf(r) as AcademicDate).iso as string))].sort(),
      time: commonest(list.map((r) => dueOf(r)?.time ?? null).filter((t): t is string => t !== null)),
      points,
    };
  });
}

const weekly = (dates: string[]) => dates.length >= 3 && dates.every((d, i) => i === 0 || d === addDays(dates[i - 1], 7));

/** Work that came every week for three or more weeks and has more weeks to run before the semester ends. */
export function detectRepeats(records: ConfirmedRecord[], today: string, semesterEnd: string | null, known: Repeat[] = []): Repeat[] {
  const have = new Set(known.map((r) => r.key));
  const out: Repeat[] = [];
  for (const s of seriesOf(records)) {
    if (have.has(s.key) || !weekly(s.dates)) continue;
    const last = s.dates[s.dates.length - 1];
    if (last < addDays(today, -7)) continue; // stopped a while ago
    const next = addDays(last, 7);
    if (semesterEnd && next > semesterEnd) continue; // the last one was already listed
    out.push({ key: s.key, label: s.label, courseCode: s.courseCode, weekday: weekdayOf(last), time: s.time, points: s.points });
  }
  return out;
}

/** The coming weeks of each repeating item that the course has not listed yet. */
export function repeatMilestones(repeats: Repeat[], records: ConfirmedRecord[], today: string, semesterEnd: string | null): Milestone[] {
  const out: Milestone[] = [];
  const series = new Map(seriesOf(records).map((s) => [s.key, s]));
  for (const rep of repeats) {
    const s = series.get(rep.key);
    const last = s?.dates[s.dates.length - 1];
    if (!last) continue;
    const limit = semesterEnd ?? addDays(last, 7 * 16);
    for (let d = addDays(last, 7), n = 0; d <= limit && n < 20; d = addDays(d, 7), n++) {
      if (d < today) continue;
      out.push({
        key: `repeat:${rep.key}|${d}`, recordId: `repeat:${rep.key}`, assignmentKey: `repeat:${rep.key}`, kind: 'due',
        date: d, time: rep.time, timeZone: null, title: `${rep.label} (repeating)`, courseCode: rep.courseCode, unit: null,
        points: rep.points, heavy: false, percent: null, action: 'Submit',
      });
    }
  }
  return out;
}
