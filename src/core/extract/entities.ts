import type {
  AcademicDate,
  AssignmentType,
  Classification,
  ExtractedRecord,
  EntityType,
  FieldValue,
  Provenance,
  ReviewFlag,
  SourceDocument,
  TimelineEventKind,
} from '../types';
import { hasLabel } from '../classify/classifier';
import { findDates, type DateContext, type DateMention } from './dates';
import { fnv1a, normaliseCourseCode, normaliseKey, parseCount } from '../util';

/**
 * Deterministic academic entity extraction from text.
 * Every record carries provenance down to the line and character span.
 * Fields that the text does not state are null and listed as unknown.
 */

export interface ExtractionContext extends DateContext {
  /** Course to use when the text never names one. */
  defaultCourseCode?: string | null;
}

interface Line {
  no: number;
  text: string;
  start: number;
  end: number;
}

const COURSE_CODE_RE = /\b([A-Z]{2,4})\s?-?(\d{3,4}[A-Z]?)\b/g;
const COURSE_CODE_STOP = new Set(['AM', 'PM', 'ET', 'EST', 'EDT', 'CST', 'CDT', 'PST', 'PDT', 'UTC', 'GMT', 'APA', 'MLA', 'DOI', 'ISBN', 'WEEK', 'UNIT', 'PAGE', 'ROOM', 'FALL', 'YEAR']);

const ASSIGNMENT_TYPES: [RegExp, AssignmentType][] = [
  [/\b(peer\s+(replies|reply|responses?)|reply\s+to\s+(\w+\s+)?(peers?|classmates?))\b/i, 'peer_reply'],
  [/\b(discussion|initial\s+post)\b/i, 'discussion'],
  [/\bessay\b/i, 'essay'],
  [/\b(research\s+)?paper\b/i, 'paper'],
  [/\b(project|capstone)\b/i, 'project'],
  [/\bquiz\b/i, 'quiz'],
  [/\blab\b/i, 'lab'],
  [/\breport\b/i, 'report'],
  [/\bpresentation\b/i, 'presentation'],
  [/\b(reflection|journal)\b/i, 'reflection'],
  [/\b(homework|problem\s+set|hw)\b/i, 'homework'],
  [/\b(assignment|case\s+study|worksheet|exercise)\b/i, 'assignment'],
];

const EXAM_RE = /\b(exam|midterm|final\s+exam|test)\b/i;
const MILESTONE_RE = /\b(milestone|proposal|draft|checkpoint|outline)\b/i;
const READING_RE = /\b(read|reading|readings|chapters?|ch\.\s*\d)\b/i;
const AVAILABLE_RE = /\b(available|opens?|unlocks?|released?)\b/i;
const DUE_RE = /\b(due|deadline|submit(ted)?\s+by|no\s+later\s+than|closes?)\b/i;
const MODULE_RE = /^\s*[-*•]?\s*(week|unit|module)\s+(\d+)\b/i;

const SEMESTER_NAME_RE = /\b(spring|summer|fall|winter)\s+(?:semester\s+|term\s+)?(\d{4})\b/i;
const SEMESTER_START_RE = /\b((semester|term|classes|instruction)\s+(begins?|starts?)|first\s+day\s+of\s+(classes|class|the\s+semester)|start\s+date)\b/i;
const SEMESTER_END_RE = /\b((semester|term|classes|instruction)\s+ends?|last\s+day\s+of\s+(classes|class|the\s+semester)|end\s+date|semester\s+closes)\b/i;
const BREAK_RE = /\b((spring|fall|winter|thanksgiving|mid-?term)\s+break|holiday|no\s+class(es)?|recess|campus\s+closed)\b/i;
const UNIVERSITY_RE = /\b((?:University|College|Institute)\s+of\s+(?:[A-Z][\w.&'-]*\s?){1,5}|(?:[A-Z][\w.&'-]*\s){1,4}(?:University|College|Institute))/;
const PROGRAM_RE = /\b((?:Master|Bachelor|Doctor)\s+of\s+[A-Z][\w ]+?|M\.?S\.?\s+in\s+[A-Z][\w ]+?|B\.?S\.?\s+in\s+[A-Z][\w ]+?|Ph\.?D\.?\s+in\s+[A-Z][\w ]+?)(?=[,.;\n]|$)/;
const INSTRUCTOR_RE = /\b(?:instructor|professor|faculty|taught\s+by)\s*:?\s*((?:Dr\.|Prof\.|Professor)?\s*[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})/i;

const POINTS_RE = /\b(\d{1,4}(?:\.\d+)?)\s*(points|pts|pt)\b/i;
const WORDS_RE = /\b(\d[\d,]*)\s*(?:(?:-|–|to)\s*(\d[\d,]*)\s*)?words\b/i;
const PAGES_RE = /\b(\d{1,3})\s*(?:(?:-|–|to)\s*(\d{1,3})\s*)?(?:double[-\s]spaced\s+)?pages?\b/i;
const SOURCES_RE = /\b(?:at\s+least|minimum\s+(?:of\s+)?|min\.?\s+|a\s+minimum\s+of\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?(scholarly|peer[-\s]reviewed|academic|credible|professional)\s+(?:\w+\s+)?(sources|references|articles|journal\s+articles|resources)\b/i;
const CITATION_RE = /\b(APA(?:\s*(?:7(?:th)?|6(?:th)?)(?:\s+edition)?)?|MLA|Chicago|IEEE|Harvard|AMA)\b(?:\s+(?:style|format|formatting|citations?))?/;
const SUBMISSION_RE = /\b(submit|upload|turnitin|file\s+format|\.docx|\.pdf|double[-\s]spaced|font|title\s+page|reference\s+page|margins?)\b/i;
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/;

const LEVEL_WORDS = ['Exemplary', 'Exceeds', 'Proficient', 'Meets', 'Accomplished', 'Developing', 'Approaching', 'Beginning', 'Emerging', 'Unsatisfactory', 'Does Not Meet', 'Excellent', 'Good', 'Fair', 'Poor'];
const LEVEL_RE = new RegExp(`\\b(${LEVEL_WORDS.join('|')})\\b`, 'gi');

function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let offset = 0;
  text.split('\n').forEach((t, i) => {
    out.push({ no: i + 1, text: t, start: offset, end: offset + t.length });
    offset += t.length + 1;
  });
  return out;
}

function stripBullet(s: string): string {
  return s.replace(/^\s*([-*•▪◦·]|\d+[.)]|[a-z][.)])\s+/i, '').trim();
}

function findCourseCodes(text: string): { code: string; index: number; length: number }[] {
  const out: { code: string; index: number; length: number }[] = [];
  COURSE_CODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COURSE_CODE_RE.exec(text)) !== null) {
    if (COURSE_CODE_STOP.has(m[1])) continue;
    // Four digit numbers that look like years with a season are not courses.
    if (/^(19|20)\d{2}$/.test(m[2]) && m[1].length > 3) continue;
    out.push({ code: normaliseCourseCode(`${m[1]} ${m[2]}`), index: m.index, length: m[0].length });
  }
  return out;
}

function assignmentTypeOf(s: string): AssignmentType | null {
  for (const [re, t] of ASSIGNMENT_TYPES) if (re.test(s)) return t;
  return null;
}

/** Assign each date on a line to the keyword that most closely precedes it. */
function roleOfDate(line: string, mention: DateMention, lineStart: number): 'due' | 'available' | 'other' {
  const before = line.slice(0, mention.start - lineStart);
  const dueAt = lastIndexOfRe(before, DUE_RE);
  const availAt = lastIndexOfRe(before, AVAILABLE_RE);
  if (dueAt < 0 && availAt < 0) return 'other';
  return availAt > dueAt ? 'available' : 'due';
}

function lastIndexOfRe(s: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = g.exec(s)) !== null) last = m.index;
  return last;
}

function cleanTitle(lineText: string, firstCut: number): string {
  let t = lineText.slice(0, firstCut >= 0 ? firstCut : undefined);
  // Keep only the clause that names the item: "Hi all, Essay 1 is moved. Essay 1 due" -> "Essay 1"
  t = t.split(/(?<=[.!?;])\s+/).filter((x) => x.trim()).pop() ?? t;
  t = stripBullet(t);
  t = t.replace(MODULE_RE, '').replace(/^\s*[:\-–|]\s*/, '');
  t = t.replace(/\b(is\s+)?(due|deadline|available|opens?|submit(ted)?\s+by)\b.*$/i, '');
  t = t.replace(/[\s,:;\-–|(]+$/g, '').replace(/^[\s,:;\-–|)]+/g, '');
  t = t.replace(/\s+(by|on|at|before|until)$/i, '');
  return t.trim();
}

function dateFlags(d: AcademicDate | null): ReviewFlag[] {
  if (!d) return [];
  const f: ReviewFlag[] = [];
  if (d.year === null) f.push('missing_year');
  if (d.time !== null && d.timeZone === null) f.push('ambiguous_time_zone');
  return f;
}

export interface EntityExtractionResult {
  records: ExtractedRecord[];
  /** Semester window found in this source, used as date context. */
  semesterWindow: { start: string | null; end: string | null };
}

export function extractEntities(
  source: SourceDocument,
  classifications: Classification[],
  ctx: ExtractionContext = {},
): EntityExtractionResult {
  const text = source.text;
  const lines = splitLines(text);
  const records: ExtractedRecord[] = [];
  const injectionLines = new Set(
    source.securityFlags.filter((f) => f.kind === 'prompt_injection_pattern' && f.line !== null).map((f) => f.line as number),
  );

  const prov = (line: Line | null, method: Provenance['extractionMethod'] = 'deterministic_text'): Provenance => ({
    sourceId: source.id,
    sourceType: source.sourceType,
    originalName: source.originalName,
    importedAt: source.importedAt,
    page: null,
    imageRegion: null,
    textLocation: line ? { line: line.no, start: line.start, end: line.end } : null,
    excerpt: line ? line.text.trim().slice(0, 300) : text.trim().slice(0, 300),
    extractionMethod: method,
    verificationStatus: 'unverified',
    confirmationStatus: 'pending',
  });

  const push = (
    entityType: EntityType,
    key: string,
    fields: Record<string, FieldValue>,
    line: Line | null,
    flags: ReviewFlag[] = [],
  ) => {
    const unknownFields = Object.entries(fields)
      .filter(([, v]) => v === null || (Array.isArray(v) && v.length === 0))
      .map(([k]) => k);
    const allFlags = new Set(flags);
    if (line && injectionLines.has(line.no)) allFlags.add('possible_prompt_injection');
    records.push({
      id: `rec_${fnv1a(`${source.id}|${entityType}|${key}|${line?.no ?? 0}`)}`,
      entityType,
      key,
      fields,
      unknownFields,
      flags: [...allFlags],
      provenance: prov(line),
    });
  };

  // ---------- Pass 1: university, program, semester window ----------
  let semesterName: string | null = source.hints.semester ?? null;
  let semesterLine: Line | null = null;
  let semStart: AcademicDate | null = null;
  let semEnd: AcademicDate | null = null;
  let university: string | null = null;
  let universityLine: Line | null = null;
  let program: string | null = null;

  for (const line of lines) {
    if (!semesterName) {
      const m = SEMESTER_NAME_RE.exec(line.text);
      if (m) {
        semesterName = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
        semesterLine = line;
      }
    }
    if (!university) {
      const m = UNIVERSITY_RE.exec(line.text);
      if (m) {
        university = m[1].trim();
        universityLine = line;
      }
    }
    if (!program) {
      const m = PROGRAM_RE.exec(line.text);
      if (m) program = m[1].trim();
    }
    const dates = findDates(line.text);
    if (dates.length === 0) continue;
    const isSemesterLine = SEMESTER_NAME_RE.test(line.text) || /\bsemester|term\b/i.test(line.text);
    if (!semStart && SEMESTER_START_RE.test(line.text)) {
      semStart = dates[0].date;
      semesterLine ??= line;
    } else if (!semEnd && SEMESTER_END_RE.test(line.text)) {
      semEnd = dates[dates.length - 1].date;
      semesterLine ??= line;
    } else if (isSemesterLine && dates.length >= 2 && !semStart && !semEnd && !BREAK_RE.test(line.text)) {
      // "Fall 2026: August 24 – December 11, 2026"
      semStart = dates[0].date;
      semEnd = dates[1].date;
      semesterLine ??= line;
    }
  }
  // A range like "Aug 24 – Dec 11, 2026" carries one year; share it.
  if (semStart && semEnd && semStart.year === null && semEnd.year !== null) {
    const y = semStart.month > semEnd.month ? semEnd.year - 1 : semEnd.year;
    semStart = { ...semStart, year: y, yearSource: 'explicit', iso: `${y}-${String(semStart.month).padStart(2, '0')}-${String(semStart.day).padStart(2, '0')}` };
  }

  const dateCtx: DateContext = {
    semesterStart: ctx.semesterStart ?? semStart?.iso ?? null,
    semesterEnd: ctx.semesterEnd ?? semEnd?.iso ?? null,
  };

  if (university || source.hints.university) {
    const name = source.hints.university ?? (university as string);
    push('university', normaliseKey(name), { name, program, academicYear: source.hints.academicYear ?? null }, universityLine);
  }

  if (semesterName || semStart || semEnd) {
    const startIso = semStart?.iso ?? null;
    const endIso = semEnd?.iso ?? null;
    const flags: ReviewFlag[] = [...dateFlags(semStart), ...dateFlags(semEnd)].filter((f) => f !== 'ambiguous_time_zone');
    if (startIso && endIso && startIso > endIso) flags.push('date_range_inverted');
    push(
      'semester',
      normaliseKey(semesterName ?? `semester ${startIso ?? ''}`),
      {
        name: semesterName,
        startDate: semStart,
        endDate: semEnd,
        durationWeeks: startIso && endIso ? Math.round(((Date.parse(endIso) - Date.parse(startIso)) / 86_400_000 + 1) / 7) : null,
      },
      semesterLine,
      flags,
    );
  }

  // ---------- Pass 2: courses ----------
  const courses = new Map<string, { name: string | null; line: Line; instructor: string | null }>();
  for (const line of lines) {
    for (const c of findCourseCodes(line.text)) {
      const after = line.text.slice(c.index + c.length).replace(/^\s*[:\-–|]?\s*/, '');
      const nameMatch = /^([A-Z][A-Za-z&,'/ ]{2,80}?)(?=\s*[([|,;]|\s+-\s|\s+–\s|\s+(?:due|week|unit|section)\b|$)/.exec(after);
      const name = nameMatch ? nameMatch[1].trim() : null;
      const existing = courses.get(c.code);
      if (!existing) courses.set(c.code, { name, line, instructor: null });
      else if (!existing.name && name) existing.name = name;
    }
    const im = INSTRUCTOR_RE.exec(line.text);
    if (im) {
      const last = [...courses.values()].pop();
      if (last && !last.instructor) last.instructor = im[1].trim();
      else if (!last && source.hints.course) {
        courses.set(normaliseCourseCode(source.hints.course), { name: null, line, instructor: im[1].trim() });
      }
    }
  }
  if (courses.size === 0 && source.hints.course) {
    courses.set(normaliseCourseCode(source.hints.course), { name: null, line: lines[0], instructor: null });
  }
  for (const [code, c] of courses) {
    push('course', code, { code, name: c.name, instructor: c.instructor, semester: semesterName }, c.line);
  }

  const singleCourse = courses.size === 1 ? [...courses.keys()][0] : null;
  const hintedCourse = source.hints.course ? normaliseCourseCode(source.hints.course) : null;
  const fallbackCourse = hintedCourse ?? singleCourse ?? (ctx.defaultCourseCode ? normaliseCourseCode(ctx.defaultCourseCode) : null);

  // ---------- Pass 3: breaks, modules, assignments, events, rubric ----------
  let currentCourse: string | null = null;
  let currentUnit: { kind: string; number: number } | null = null;
  const assignments: ExtractedRecord[] = [];
  const rubricMode = hasLabel(classifications, 'grading_rubric');
  let inRubricSection = false;
  let rubricFor: string | null = null;

  for (const line of lines) {
    const raw = line.text;
    if (!raw.trim()) continue;

    const codesHere = findCourseCodes(raw);
    // A line that is mostly a course header switches course context.
    if (codesHere.length > 0 && findDates(raw).length === 0) currentCourse = codesHere[0].code;

    if (/\brubric\b/i.test(raw)) {
      inRubricSection = true;
      const h = /^(?:grading\s+)?rubric\s*[:\-–]\s*(.+)$/i.exec(stripBullet(raw)) ?? /^(.+?)\s+(?:grading\s+)?rubric\s*$/i.exec(stripBullet(raw));
      if (h) rubricFor = h[1].trim();
    }

    const lineCourse = codesHere[0]?.code ?? currentCourse ?? fallbackCourse;
    const courseFlags: ReviewFlag[] = [];
    if (!lineCourse) courseFlags.push('course_unassigned');
    if (hintedCourse && codesHere[0] && codesHere[0].code !== hintedCourse) courseFlags.push('course_mismatch');

    const mod = MODULE_RE.exec(raw);
    const dates = findDates(raw, dateCtx).map((d) => ({ ...d, start: d.start + line.start, end: d.end + line.start }));

    if (mod) {
      currentUnit = { kind: mod[1].toLowerCase(), number: Number(mod[2]) };
      const isOnlyHeader = !assignmentTypeOf(raw) && !EXAM_RE.test(raw) && !READING_RE.test(raw);
      if (isOnlyHeader) {
        const label = `${mod[1][0].toUpperCase()}${mod[1].slice(1).toLowerCase()} ${mod[2]}`;
        const titleRest = cleanTitle(raw.replace(MODULE_RE, ''), findDates(raw.replace(MODULE_RE, ''))[0]?.start ?? -1);
        push(
          'timeline_event',
          `${lineCourse ?? '-'}|module|${normaliseKey(label)}`,
          {
            kind: 'module',
            title: titleRest ? `${label}: ${titleRest}` : label,
            courseCode: lineCourse,
            unit: label,
            startDate: dates[0]?.date ?? null,
            endDate: dates[1]?.date ?? null,
          },
          line,
          [...courseFlags, ...dateFlags(dates[0]?.date ?? null)],
        );
        continue;
      }
    }
    const unitLabel = currentUnit ? `${currentUnit.kind[0].toUpperCase()}${currentUnit.kind.slice(1)} ${currentUnit.number}` : null;

    // Semester boundary lines were handled in pass 1.
    if (line === semesterLine && (SEMESTER_START_RE.test(raw) || SEMESTER_END_RE.test(raw) || dates.length >= 2)) continue;
    if (SEMESTER_START_RE.test(raw) || SEMESTER_END_RE.test(raw)) continue;

    if (BREAK_RE.test(raw) && dates.length > 0) {
      const name = cleanTitle(raw, dates[0].start - line.start) || 'Academic break';
      push(
        'academic_break',
        `${normaliseKey(semesterName ?? '')}|${normaliseKey(name)}`,
        { name, startDate: dates[0].date, endDate: dates[1]?.date ?? dates[0].date, semester: semesterName },
        line,
        dateFlags(dates[0].date).filter((f) => f !== 'ambiguous_time_zone'),
      );
      continue;
    }

    // Rubric criteria.
    if (rubricMode || inRubricSection) {
      const crit = parseRubricLine(raw);
      if (crit) {
        const levels = [...new Set((raw.match(LEVEL_RE) ?? []).map((l) => l[0].toUpperCase() + l.slice(1).toLowerCase()))];
        push(
          'rubric_criterion',
          rubricKey(lineCourse, rubricFor, crit.criterion),
          {
            criterion: crit.criterion,
            description: crit.description || null,
            maxPoints: crit.points,
            performanceLevels: levels,
            courseCode: lineCourse,
            assignmentTitle: rubricFor,
            assignmentKey: null,
          },
          line,
          courseFlags,
        );
        continue;
      }
    }

    // Research sources (DOI only; metadata stays unverified).
    const doi = DOI_RE.exec(raw);
    if (doi) {
      const yearM = /\((\d{4})\)/.exec(raw);
      push(
        'research_source',
        doi[1].toLowerCase().replace(/[.,;]+$/, ''),
        {
          doi: doi[1].replace(/[.,;]+$/, ''),
          title: null,
          authors: [],
          year: yearM ? Number(yearM[1]) : null,
          journal: null,
          publicationType: null,
          citationText: raw.trim(),
        },
        line,
      );
      continue;
    }

    if (dates.length === 0) continue;

    const aType = assignmentTypeOf(raw);
    const isExam = EXAM_RE.test(raw) && !aType;
    const due = dates.find((d) => roleOfDate(raw, { ...d, start: d.start }, line.start) === 'due') ?? null;
    const avail = dates.find((d) => roleOfDate(raw, d, line.start) === 'available') ?? null;
    const firstCut = dates[0].start - line.start;

    // "Discussion 2: initial post due Wed Jan 14, replies due Sun Jan 18"
    const replyAt = raw.search(/\b(peer\s+)?(replies|reply|responses?)\b/i);
    if (aType === 'discussion' && replyAt >= 0 && dates.length >= 2) {
      const base = cleanTitle(raw, Math.min(firstCut, raw.search(/\binitial\s+post\b/i) >= 0 ? raw.search(/\binitial\s+post\b/i) : firstCut)) || 'Discussion';
      const initial = dates.find((d) => d.start - line.start < replyAt) ?? dates[0];
      const reply = dates.find((d) => d.start - line.start > replyAt) ?? dates[dates.length - 1];
      push('assignment', `${lineCourse ?? '-'}|${normaliseKey(base)}`, {
        title: base, type: 'discussion', courseCode: lineCourse, unit: unitLabel,
        dueDate: initial.date, availableDate: null, pointsPossible: null,
      }, line, [...courseFlags, ...dateFlags(initial.date)]);
      assignments.push(records[records.length - 1]);
      push('assignment', `${lineCourse ?? '-'}|${normaliseKey(`${base} peer replies`)}`, {
        title: `${base} peer replies`, type: 'peer_reply', courseCode: lineCourse, unit: unitLabel,
        dueDate: reply.date, availableDate: null, pointsPossible: null,
      }, line, [...courseFlags, ...dateFlags(reply.date)]);
      assignments.push(records[records.length - 1]);
      continue;
    }

    if (aType && (due || !avail)) {
      const title = cleanTitle(raw, firstCut) || aType[0].toUpperCase() + aType.slice(1);
      const dueDate = (due ?? (!avail ? dates[0] : null))?.date ?? null;
      const pts = POINTS_RE.exec(raw);
      const rec = {
        title,
        type: aType,
        courseCode: lineCourse,
        unit: unitLabel,
        dueDate,
        availableDate: avail?.date ?? null,
        pointsPossible: pts ? Number(pts[1]) : null,
      };
      push('assignment', `${lineCourse ?? '-'}|${normaliseKey(title)}`, rec, line, [...courseFlags, ...dateFlags(dueDate)]);
      assignments.push(records[records.length - 1]);
      continue;
    }

    let kind: TimelineEventKind;
    if (isExam) kind = 'exam';
    else if (avail && !due) kind = 'availability';
    else if (MILESTONE_RE.test(raw)) kind = 'milestone';
    else if (READING_RE.test(raw)) kind = 'reading';
    else if (/\b(course|class)\s+(begins|starts|start)\b/i.test(raw)) kind = 'course_start';
    else if (/\b(course|class)\s+(ends|end)\b/i.test(raw)) kind = 'course_end';
    else if (due) kind = 'due';
    else continue; // a date with no academic meaning on this line

    const cleaned = cleanTitle(raw, firstCut);
    // A bare "Due: <date>" line belongs to the surrounding assignment text.
    if (!cleaned && kind === 'due') continue;
    const title = cleaned || kind;
    const d = (kind === 'availability' ? avail : due ?? dates[0])?.date ?? null;
    push(
      'timeline_event',
      `${lineCourse ?? '-'}|${kind}|${normaliseKey(title)}`,
      { kind, title, courseCode: lineCourse, unit: unitLabel, date: d },
      line,
      [...courseFlags, ...dateFlags(d)],
    );
  }

  // ---------- Pass 4: whole document assignment details ----------
  const isInstructions = hasLabel(classifications, 'assignment_instructions') || hasLabel(classifications, 'project_requirements') || hasLabel(classifications, 'discussion_question');
  if (isInstructions && assignments.length <= 1) {
    const details = documentAssignmentDetails(text, lines);
    let target = assignments[0];
    if (!target) {
      const titleLine = lines.find((l) => l.text.trim().length > 0);
      if (titleLine) {
        const titleText = stripBullet(titleLine.text).replace(/^(assignment|title|project)\s*:\s*/i, '').trim().slice(0, 140);
        const course = findCourseCodes(text)[0]?.code ?? fallbackCourse;
        const dueM = lines.map((l) => ({ l, ds: findDates(l.text, dateCtx) })).find((x) => x.ds.length > 0 && DUE_RE.test(x.l.text));
        const dueDate = dueM?.ds[0].date ?? null;
        push(
          'assignment',
          `${course ?? '-'}|${normaliseKey(titleText)}`,
          {
            title: titleText,
            type: assignmentTypeOf(text) ?? 'assignment',
            courseCode: course,
            unit: null,
            dueDate,
            availableDate: null,
            pointsPossible: null,
          },
          titleLine,
          [...(course ? [] : (['course_unassigned'] as ReviewFlag[])), ...(dueDate ? dateFlags(dueDate) : (['missing_date'] as ReviewFlag[]))],
        );
        target = records[records.length - 1];
      }
    }
    if (target) {
      Object.assign(target.fields, {
        instructions: text.trim(),
        pointsPossible: target.fields.pointsPossible ?? details.points,
        wordCountMin: details.wordMin,
        wordCountMax: details.wordMax,
        pageCountMin: details.pageMin,
        pageCountMax: details.pageMax,
        requiredScholarlySources: details.sources,
        citationStyle: details.citation,
        submissionRequirements: details.submission,
      });
      target.unknownFields = Object.entries(target.fields)
        .filter(([, v]) => v === null || (Array.isArray(v) && v.length === 0))
        .map(([k]) => k);
    }
  }

  // Assignments without a due date need student attention.
  for (const r of records) {
    if (r.entityType === 'assignment' && r.fields.dueDate === null && !r.flags.includes('missing_date')) r.flags.push('missing_date');
  }

  return { records, semesterWindow: { start: dateCtx.semesterStart ?? null, end: dateCtx.semesterEnd ?? null } };
}

export function parseRubricLine(raw: string): { criterion: string; points: number | null; description: string } | null {
  const line = stripBullet(raw);
  // Table row: Criterion | 20 | description   or tab separated
  const cells = line.includes('|') ? line.split('|') : line.includes('\t') ? line.split('\t') : null;
  if (cells) {
    const c = cells.map((x) => x.trim()).filter(Boolean);
    if (c.length >= 2) {
      const ptsIdx = c.findIndex((x, i) => i > 0 && /^\d{1,3}(\.\d+)?\s*(points|pts)?$/i.test(x));
      if (ptsIdx > 0 && /[A-Za-z]/.test(c[0]) && !/^(criteri(a|on)|category)$/i.test(c[0])) {
        return {
          criterion: c[0],
          points: Number(c[ptsIdx].replace(/[^\d.]/g, '')),
          description: c.filter((_, i) => i !== 0 && i !== ptsIdx).join(' | '),
        };
      }
    }
    return null;
  }
  // Criterion (20 points): description   |  Criterion – 20 pts – description
  const m = /^([A-Z][A-Za-z0-9&,'/ ]{2,70}?)\s*(?:\(\s*(\d{1,3}(?:\.\d+)?)\s*(?:points|pts)\s*\)|[-–:]\s*(\d{1,3}(?:\.\d+)?)\s*(?:points|pts))\s*[:\-–.]?\s*(.*)$/i.exec(line);
  if (!m) return null;
  return { criterion: m[1].trim(), points: Number(m[2] ?? m[3]), description: m[4].trim() };
}

export function rubricKey(course: string | null, assignmentTitle: string | null, criterion: string): string {
  return `${course ?? '-'}|${assignmentTitle ? `${normaliseKey(assignmentTitle)}|` : ''}${normaliseKey(criterion)}`;
}

export function normaliseCitationStyle(raw: string): string {
  const m = /^APA\s*(\d)?/i.exec(raw.trim());
  if (m) return m[1] ? `APA ${m[1]}` : 'APA';
  return raw.trim();
}

function documentAssignmentDetails(text: string, lines: Line[]) {
  const pts = POINTS_RE.exec(text);
  const words = WORDS_RE.exec(text);
  const pages = PAGES_RE.exec(text);
  const src = SOURCES_RE.exec(text);
  const cite = CITATION_RE.exec(text);
  const toNum = (s: string | undefined) => (s ? Number(s.replace(/,/g, '')) : null);
  const submission = lines
    .map((l) => stripBullet(l.text))
    .filter((t) => t && SUBMISSION_RE.test(t))
    .slice(0, 10);
  return {
    points: pts ? Number(pts[1]) : null,
    wordMin: words ? toNum(words[1]) : null,
    wordMax: words ? toNum(words[2] ?? words[1]) : null,
    pageMin: pages ? toNum(pages[1]) : null,
    pageMax: pages ? toNum(pages[2] ?? pages[1]) : null,
    sources: src ? parseCount(src[1]) : null,
    citation: cite ? normaliseCitationStyle(cite[1]) : null,
    submission,
  };
}
