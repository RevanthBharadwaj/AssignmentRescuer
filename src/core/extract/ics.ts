import type { AcademicDate, ExtractedRecord, FieldValue, ReviewFlag, SourceDocument } from '../types';
import { fnv1a, normaliseCourseCode, normaliseKey } from '../util';

/**
 * iCalendar (.ics) import, including a Canvas or Blackboard calendar feed.
 *
 * Canvas feeds name each event "Title [Course]" where Course is the
 * course's short name, for example "2026FA BUS-610-7AB12". Assignment
 * events have UIDs like "event-assignment-123"; other events are
 * calendar entries. Times arrive in UTC and are shown in the student's
 * own time zone.
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  url: string | null;
  start: AcademicDate | null;
  allDay: boolean;
  line: number;
  start_offset: number;
  end_offset: number;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function unescape(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** The local calendar date and time of a UTC instant in a given time zone. */
export function toZone(utcMs: number, timeZone: string): { y: number; m: number; d: number; time: string; abbr: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), time: `${get('hour')}:${get('minute')}`, abbr: get('timeZoneName') };
}

function parseDate(params: string, value: string, timeZone: string): { date: AcademicDate; allDay: boolean } | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || /VALUE=DATE(?!-)/i.test(params)) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { allDay: true, date: { iso: `${m[1]}-${m[2]}-${m[3]}`, year: y, month: mo, day: d, yearSource: 'explicit', time: null, timeZone: null, raw: v } };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, hh, mm] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  let zoned;
  if (m[7]) {
    zoned = toZone(Date.UTC(y, mo - 1, d, hh, mm), timeZone);
  } else {
    // Floating or TZID time: keep the wall clock time as written.
    const tzid = /TZID=([^;:]+)/i.exec(params)?.[1] ?? null;
    zoned = { y, m: mo, d, time: `${m[4]}:${m[5]}`, abbr: tzid ?? '' };
  }
  const iso = `${zoned.y}-${String(zoned.m).padStart(2, '0')}-${String(zoned.d).padStart(2, '0')}`;
  return {
    allDay: false,
    date: { iso, year: zoned.y, month: zoned.m, day: zoned.d, yearSource: 'explicit', time: zoned.time, timeZone: zoned.abbr || null, raw: v },
  };
}

export function parseIcs(text: string, timeZone: string): IcsEvent[] {
  // Unfold continuation lines, remembering where each logical line starts.
  const physical = text.replace(/\r\n?/g, '\n').split('\n');
  const logical: { text: string; line: number; start: number; end: number }[] = [];
  let offset = 0;
  physical.forEach((raw, i) => {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && logical.length) {
      const last = logical[logical.length - 1];
      last.text += raw.slice(1);
      last.end = offset + raw.length;
    } else {
      logical.push({ text: raw, line: i + 1, start: offset, end: offset + raw.length });
    }
    offset += raw.length + 1;
  });

  const events: IcsEvent[] = [];
  let cur: IcsEvent | null = null;
  for (const l of logical) {
    if (/^BEGIN:VEVENT$/i.test(l.text)) {
      cur = { uid: '', summary: '', description: '', url: null, start: null, allDay: false, line: l.line, start_offset: l.start, end_offset: l.end };
      continue;
    }
    if (!cur) continue;
    if (/^END:VEVENT$/i.test(l.text)) {
      cur.end_offset = l.end;
      events.push(cur);
      cur = null;
      continue;
    }
    const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/i.exec(l.text);
    if (!m) continue;
    const [, name, params, value] = m;
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value.trim(); break;
      case 'SUMMARY': cur.summary = unescape(value).trim(); break;
      case 'DESCRIPTION': cur.description = unescape(value).trim(); break;
      case 'URL': cur.url = value.trim(); break;
      case 'DTSTART': {
        const p = parseDate(params, value, timeZone);
        if (p) { cur.start = p.date; cur.allDay = p.allDay; }
        break;
      }
    }
  }
  return events;
}

const TERM_COURSE_RE = /([A-Z]{2,4})[-\s]?(\d{3,4}[A-Z]?)/;
const ASSIGNMENT_TYPES: [RegExp, string][] = [
  [/peer|repl(y|ies)/i, 'peer_reply'],
  [/discussion/i, 'discussion'],
  [/quiz/i, 'quiz'],
  [/exam|midterm|final test/i, 'exam'],
  [/final paper|research paper|paper/i, 'paper'],
  [/writing|written|essay/i, 'essay'],
  [/project|capstone/i, 'project'],
  [/reflection|journal/i, 'reflection'],
  [/presentation/i, 'presentation'],
  [/lab\b/i, 'lab'],
];

/** "Title [2026FA BUS-610-7AB12]" → { title, course } */
export function splitSummary(summary: string, knownCourses: { code: string; name: string | null }[]): { title: string; course: string | null } {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(summary);
  const title = (m ? m[1] : summary).trim();
  const tag = m?.[2] ?? '';
  const code = TERM_COURSE_RE.exec(tag);
  if (code) return { title, course: normaliseCourseCode(`${code[1]} ${code[2]}`) };
  if (tag) {
    const byName = knownCourses.find((c) => c.name && normaliseKey(c.name) === normaliseKey(tag.replace(/^20\d{2}(FA|SP|SU|WI)\s+/, '')));
    if (byName) return { title, course: byName.code };
  }
  return { title, course: null };
}

export interface IcsContext {
  timeZone: string;
  knownCourses: { code: string; name: string | null }[];
  /** Only keep events from these courses, when set. */
  onlyCourse?: string | null;
}

export function icsToRecords(source: SourceDocument, ctx: IcsContext): ExtractedRecord[] {
  const out: ExtractedRecord[] = [];
  const seen = new Set<string>();
  for (const ev of parseIcs(source.text, ctx.timeZone)) {
    if (!ev.summary) continue;
    const { title, course } = splitSummary(ev.summary, ctx.knownCourses);
    const courseCode = course ?? (ctx.onlyCourse ? normaliseCourseCode(ctx.onlyCourse) : null);
    if (ctx.onlyCourse && course && course !== normaliseCourseCode(ctx.onlyCourse)) continue;
    // The UID says what Canvas thinks it is; the title decides only when it does not.
    const uidSaysAssignment = /assignment|quiz|discussion_topic/i.test(ev.uid);
    const uidSaysEvent = /calendar-event|calendar_event/i.test(ev.uid);
    const looksGraded = ASSIGNMENT_TYPES.some(([re]) => re.test(title)) && !/exam|office hours|class meeting|live session/i.test(title);
    const entityType: ExtractedRecord['entityType'] = uidSaysAssignment || (!uidSaysEvent && looksGraded) ? 'assignment' : 'timeline_event';
    const key = entityType === 'assignment'
      ? `${courseCode ?? '-'}|${normaliseKey(title)}`
      : `${courseCode ?? '-'}|${/exam|midterm/i.test(title) ? 'exam' : 'milestone'}|${normaliseKey(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const flags: ReviewFlag[] = [];
    if (!courseCode) flags.push('course_unassigned');
    if (!ev.start) flags.push('missing_date');
    const fields: Record<string, FieldValue> = entityType === 'assignment'
      ? {
          title,
          type: ASSIGNMENT_TYPES.find(([re]) => re.test(title))?.[1] ?? 'assignment',
          courseCode,
          unit: /^(unit|week|module)\s+(\d+)/i.exec(title)?.slice(1, 3).map((x, i) => (i === 0 ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x)).join(' ') ?? null,
          dueDate: ev.start,
          availableDate: null,
          pointsPossible: null,
          lmsUrl: ev.url,
        }
      : { kind: /exam|midterm/i.test(title) ? 'exam' : 'milestone', title, courseCode, unit: null, date: ev.start };

    out.push({
      id: `rec_${fnv1a(`${source.id}|${key}|${ev.line}`)}`,
      entityType,
      key,
      fields,
      unknownFields: Object.entries(fields).filter(([, v]) => v === null).map(([k]) => k),
      flags,
      provenance: {
        sourceId: source.id,
        sourceType: source.sourceType,
        originalName: source.originalName,
        importedAt: source.importedAt,
        page: null,
        imageRegion: null,
        textLocation: { line: ev.line, start: ev.start_offset, end: ev.end_offset },
        excerpt: `${ev.summary}${ev.start ? ` · ${MONTH_SHORT[ev.start.month - 1]} ${ev.start.day}, ${ev.start.year}${ev.start.time ? ` ${ev.start.time}` : ''}` : ''}`,
        extractionMethod: 'structured_parser',
        verificationStatus: 'unverified',
        confirmationStatus: 'pending',
      },
    });
  }
  return out;
}
