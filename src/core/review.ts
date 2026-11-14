import type { AcademicDate, ConfirmedRecord, FieldValue } from './types';
import type { CourseSource } from './courseContent';
import { buildAssignmentContext, sourcesForCourse } from './courseContent';
import { analyseAssignment } from './assignments/checklist';
import { detectRepeats, seriesName, type Repeat } from './repeats';

/**
 * Review of the whole semester. Cheap checks run here on plain rules, without any AI. Every finding is a
 * suggestion with one fix; nothing changes until the student presses the button, and each change can be undone.
 */

export type Fix =
  | { type: 'set_fields'; recordId: string; fields: Record<string, FieldValue>; label: string }
  | { type: 'delete_record'; recordId: string; label: string }
  | { type: 'remove_course'; recordId: string; label: string }
  | { type: 'add_repeat'; repeat: Repeat; label: string }
  | { type: 'open'; target: 'assignment' | 'course' | 'course_add' | 'setup'; id: string; label: string };

export interface Suggestion {
  id: string;
  kind: 'duplicate' | 'date' | 'missing' | 'cleanup' | 'finished' | 'mismatch' | 'repeat';
  title: string;
  detail: string;
  fix: Fix;
  by: 'rules' | 'ai';
}

const dueOf = (r: ConfirmedRecord) => (r.fields.dueDate ?? null) as AcademicDate | null;

/** Title without unit or week numbers, so "Unit 5: Reflection" and "Reflection" compare equal. */
const norm = (t: unknown) => String(t ?? '').toLowerCase().replace(/^\s*(unit|week|module)\s*\d+\s*[:\-–]?\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();

export interface ReviewInput {
  records: ConfirmedRecord[];
  sources: CourseSource[];
  semester: { start: string | null; end: string | null } | null;
  today: string;
  repeats: Repeat[];
}

export function ruleSuggestions(input: ReviewInput): Suggestion[] {
  const { records, sources, semester, today, repeats } = input;
  const out: Suggestion[] = [];
  const courses = records.filter((r) => r.entityType === 'course');
  const assignments = records.filter((r) => r.entityType === 'assignment');
  const codes = new Set(courses.map((c) => String(c.fields.code)));

  // Duplicates: same course, same due moment, same title apart from unit numbers.
  const seen = new Map<string, ConfirmedRecord>();
  for (const a of [...assignments].sort((x, y) => x.confirmedAt.localeCompare(y.confirmedAt))) {
    const d = dueOf(a);
    if (!d?.iso) continue;
    const k = `${String(a.fields.courseCode ?? '')}|${d.iso}|${d.time ?? ''}|${norm(a.fields.title)}`;
    const first = seen.get(k);
    if (!first) { seen.set(k, a); continue; }
    out.push({
      id: `duplicate|${a.id}`, kind: 'duplicate', by: 'rules',
      title: `“${String(a.fields.title)}” is saved twice`,
      detail: `Same course and due date as “${String(first.fields.title)}”. Remove the second copy.`,
      fix: { type: 'delete_record', recordId: a.id, label: 'Remove the copy' },
    });
  }

  // Due dates outside the semester.
  if (semester?.start || semester?.end) {
    for (const a of assignments) {
      const iso = dueOf(a)?.iso;
      if (!iso) continue;
      if ((semester.start && iso < semester.start) || (semester.end && iso > semester.end)) {
        out.push({
          id: `date|${a.id}`, kind: 'date', by: 'rules',
          title: `“${String(a.fields.title)}” is due outside your semester`,
          detail: `Its date is ${iso}; the semester runs ${semester.start ?? '?'} to ${semester.end ?? '?'}. The year may be wrong.`,
          fix: { type: 'open', target: 'assignment', id: a.id, label: 'Check the date' },
        });
      }
    }
  }

  // Work filed under another course: the title names a different course you have.
  for (const a of assignments) {
    const own = String(a.fields.courseCode ?? '');
    const title = String(a.fields.title ?? '').toUpperCase().replace(/\s+/g, ' ');
    const other = [...codes].find((c) => c !== own && title.includes(c.toUpperCase().replace(/\s+/g, ' ')));
    if (other) {
      out.push({
        id: `mismatch|${a.id}`, kind: 'mismatch', by: 'rules',
        title: `“${String(a.fields.title)}” may belong to ${other}`,
        detail: `Its title names ${other}, but it is saved under ${own}.`,
        fix: { type: 'set_fields', recordId: a.id, fields: { courseCode: other }, label: `Move to ${other}` },
      });
    }
  }

  // Missing things.
  for (const c of courses) {
    const code = String(c.fields.code);
    const gaps = [!c.fields.name && 'its name', !c.fields.instructor && 'the professor'].filter(Boolean) as string[];
    if (gaps.length) {
      out.push({
        id: `missing|course|${c.id}`, kind: 'missing', by: 'rules',
        title: `${code} is missing ${gaps.join(' and ')}`,
        detail: 'Reminders and Chat show the course name and the professor when they are saved.',
        fix: { type: 'open', target: 'setup', id: code, label: 'Add it in Semester setup' },
      });
    }
  }
  for (const a of assignments) {
    if (!dueOf(a)?.iso && a.fields.status !== 'submitted') {
      out.push({
        id: `missing|date|${a.id}`, kind: 'missing', by: 'rules',
        title: `“${String(a.fields.title)}” has no due date`,
        detail: typeof a.fields.dueNote === 'string' ? `The course says: ${a.fields.dueNote}` : 'It was mentioned but no date was found.',
        fix: { type: 'open', target: 'assignment', id: a.id, label: 'Set the date' },
      });
    }
  }

  // Cleanup: courses with nothing in them.
  for (const c of courses) {
    const code = String(c.fields.code);
    const items = records.filter((r) => r.entityType !== 'course' && r.fields.courseCode === code);
    if (items.length === 0 && sourcesForCourse(code, sources, records.filter((r) => r.entityType !== 'course')).length === 0) {
      out.push({
        id: `cleanup|course|${c.id}`, kind: 'cleanup', by: 'rules',
        title: `${code} has nothing in it`,
        detail: 'No assignments, dates or imported material. Remove it, or paste its Canvas pages.',
        fix: { type: 'remove_course', recordId: c.id, label: 'Remove the course' },
      });
    }
  }

  // Finished by your own checklist: every requirement ticked but not marked submitted.
  for (const a of assignments) {
    if (a.fields.status === 'submitted') continue;
    const done = Array.isArray(a.fields.checklistDone) ? (a.fields.checklistDone as string[]) : [];
    const ctx = buildAssignmentContext(a, records, sources);
    const list = analyseAssignment(a, ctx.rubric).checklist;
    if (list.length >= 2 && list.every((i) => done.includes(i.id))) {
      out.push({
        id: `finished|${a.id}`, kind: 'finished', by: 'rules',
        title: `You ticked every requirement for “${String(a.fields.title)}”`,
        detail: 'It is not marked as submitted yet.',
        fix: { type: 'set_fields', recordId: a.id, fields: { status: 'submitted' }, label: 'Mark as submitted' },
      });
    }
  }

  // Repeating work found in what the course already listed.
  for (const r of detectRepeats(assignments, today, semester?.end ?? null, repeats)) {
    out.push({
      id: `repeat|${r.key}`, kind: 'repeat', by: 'rules',
      title: `“${r.label}” comes every week in ${r.courseCode}`,
      detail: `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][r.weekday]}${r.time ? ` at ${r.time}` : ''}. Add a repeating reminder for the weeks the course has not listed yet.`,
      fix: { type: 'add_repeat', repeat: r, label: 'Add a repeating reminder' },
    });
  }
  return out;
}

export { seriesName };
