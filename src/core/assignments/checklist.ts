import type { AcademicDate, ConfirmedRecord, FieldValue } from '../types';

/**
 * Assignment intelligence (deterministic part): a requirements checklist
 * and a list of missing information to confirm with the student.
 */

export interface ChecklistItem {
  id: string;
  text: string;
  source: 'extracted' | 'rubric';
}

export interface AssignmentAnalysis {
  checklist: ChecklistItem[];
  missing: string[];
  questions: string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDate(d: FieldValue): string | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const a = d as AcademicDate;
  const datePart = `${MONTHS[a.month - 1]} ${a.day}${a.year !== null ? `, ${a.year}` : ' (year unknown)'}`;
  const time = a.time ? ` at ${fmtTime(a.time)}${a.timeZone ? ` ${a.timeZone}` : ' (time zone not stated)'}` : '';
  return `${datePart}${time}`;
}

export function analyseAssignment(assignment: ConfirmedRecord, rubric: ConfirmedRecord[] = []): AssignmentAnalysis {
  const f = assignment.fields;
  const checklist: ChecklistItem[] = [];
  const missing: string[] = [];
  const questions: string[] = [];
  const add = (id: string, text: string, source: ChecklistItem['source'] = 'extracted') => checklist.push({ id, text, source });

  const due = fmtDate(f.dueDate ?? null);
  if (due) add('due', `Submit by ${due}`);
  else { missing.push('Due date'); questions.push('When is this assignment due?'); }

  const dueDate = f.dueDate as AcademicDate | null;
  if (dueDate && dueDate.year === null) questions.push('Which year is the due date in?');
  if (dueDate?.time && !dueDate.timeZone) questions.push('Which time zone is the due time in?');

  if (typeof f.wordCountMin === 'number') {
    add('words', f.wordCountMax && f.wordCountMax !== f.wordCountMin ? `Write ${f.wordCountMin} to ${f.wordCountMax} words` : `Write about ${f.wordCountMin} words`);
  }
  if (typeof f.pageCountMin === 'number') {
    add('pages', f.pageCountMax && f.pageCountMax !== f.pageCountMin ? `Length: ${f.pageCountMin} to ${f.pageCountMax} pages` : `Length: ${f.pageCountMin} pages`);
  }
  if (f.wordCountMin == null && f.pageCountMin == null && ['essay', 'paper', 'report', 'reflection'].includes(String(f.type))) {
    missing.push('Length requirement');
    questions.push('Is there a required word or page count?');
  }
  if (typeof f.requiredScholarlySources === 'number') add('sources', `Use at least ${f.requiredScholarlySources} scholarly sources`);
  if (typeof f.citationStyle === 'string') add('citation', `Format citations in ${f.citationStyle}`);
  else if (['essay', 'paper', 'report'].includes(String(f.type))) {
    missing.push('Citation style');
    questions.push('Which citation style is required (for example APA 7)?');
  }
  if (Array.isArray(f.submissionRequirements)) {
    f.submissionRequirements.forEach((s, i) => add(`submit_${i}`, s));
  }
  if (typeof f.pointsPossible !== 'number') missing.push('Points possible');
  if (!f.courseCode) { missing.push('Course'); questions.push('Which course is this assignment for?'); }

  for (const r of rubric) {
    const pts = typeof r.fields.maxPoints === 'number' ? ` (${r.fields.maxPoints} pts)` : '';
    add(`rubric_${r.id}`, `Rubric: ${String(r.fields.criterion)}${pts}`, 'rubric');
  }
  if (rubric.length === 0) missing.push('Grading rubric');

  return { checklist, missing, questions };
}
