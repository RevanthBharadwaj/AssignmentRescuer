import type { AcademicDate, FieldValue } from '../core/types';

export function isAcademicDate(v: unknown): v is AcademicDate {
  return typeof v === 'object' && v !== null && 'month' in v && 'day' in v && 'yearSource' in v;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(d: AcademicDate | null | undefined): string {
  if (!d) return 'Unknown';
  const year = d.year !== null ? `, ${d.year}` : ' (year unknown)';
  const time = d.time ? ` ${formatTime(d.time)}${d.timeZone ? ` ${d.timeZone}` : ' (no time zone)'}` : '';
  return `${MONTHS[d.month - 1]} ${d.day}${year}${time}`;
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatValue(v: FieldValue | undefined): string {
  if (v === null || v === undefined || v === '') return 'Unknown';
  if (isAcademicDate(v)) return formatDate(v);
  if (Array.isArray(v)) return v.length ? v.join('; ') : 'Unknown';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export const FIELD_LABELS: Record<string, string> = {
  name: 'Name', program: 'Program', academicYear: 'Academic year', startDate: 'Start date', endDate: 'End date',
  durationWeeks: 'Duration (weeks)', code: 'Course code', instructor: 'Instructor', semester: 'Semester',
  title: 'Title', type: 'Type', courseCode: 'Course', unit: 'Unit / week', dueDate: 'Due', availableDate: 'Available',
  pointsPossible: 'Points', wordCountMin: 'Words (min)', wordCountMax: 'Words (max)', pageCountMin: 'Pages (min)',
  pageCountMax: 'Pages (max)', requiredScholarlySources: 'Scholarly sources', citationStyle: 'Citation style',
  submissionRequirements: 'Submission requirements', instructions: 'Instructions', criterion: 'Criterion',
  description: 'Description', maxPoints: 'Max points', performanceLevels: 'Performance levels', kind: 'Kind',
  date: 'Date', doi: 'DOI', authors: 'Authors', year: 'Year', journal: 'Journal', publicationType: 'Publication type',
  citationText: 'Citation text', assignmentTitle: 'Rubric for', assignmentKey: 'Linked assignment',
  dueNote: 'Due (as mentioned)', section: 'Section', lmsUrl: 'Course link', paperTitle: 'Paper title',
};

export const ENTITY_LABELS: Record<string, string> = {
  university: 'University', semester: 'Semester', academic_break: 'Academic break', course: 'Course',
  assignment: 'Assignment', rubric_criterion: 'Rubric criterion', timeline_event: 'Timeline item', research_source: 'Research source',
  course_material: 'Course material',
};

export const FLAG_LABELS: Record<string, string> = {
  missing_year: 'Year not stated',
  ambiguous_time_zone: 'Time zone not stated',
  missing_date: 'No date found',
  course_unassigned: 'Course unknown',
  course_mismatch: 'Course differs from the one you selected',
  possible_prompt_injection: 'Suspicious instructions in source text',
  low_confidence: 'Low confidence',
  date_range_inverted: 'End date is before start date',
};

/** Build an AcademicDate from a date input (YYYY-MM-DD) plus optional time and zone. */
export function dateFromInputs(iso: string, time: string, tz: string): AcademicDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return { iso, year: y, month: m, day: d, yearSource: 'explicit', time: time || null, timeZone: time ? tz || null : null, raw: `${iso}${time ? ` ${time}` : ''}` };
}

/** Errors from Tauri commands arrive as plain strings, not Error objects. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
