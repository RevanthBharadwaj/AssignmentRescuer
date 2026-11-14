import type { AcademicDate, ConfirmedRecord } from './types';

/**
 * Semester onboarding. Answers are derived from confirmed records, so an
 * answer that came from an imported syllabus counts the same as a typed
 * one, and onboarding resumes exactly where it stopped.
 */

export type OnboardingQuestionId =
  | 'university'
  | 'program'
  | 'semester'
  | 'semester_start'
  | 'semester_end'
  | 'semester_length'
  | 'subjects';

export interface OnboardingQuestion {
  id: OnboardingQuestionId;
  prompt: string;
  answer: string | null;
}

export interface OnboardingStatus {
  questions: OnboardingQuestion[];
  complete: boolean;
  nextQuestion: OnboardingQuestion | null;
  currentSemester: ConfirmedRecord | null;
}

const PROMPTS: Record<OnboardingQuestionId, string> = {
  university: 'What university are you attending?',
  program: 'What degree or program are you studying?',
  semester: 'What is your current semester?',
  semester_start: 'When does the semester start?',
  semester_end: 'When does the semester end?',
  semester_length: 'How long is the semester?',
  subjects: 'What subjects are you taking this semester?',
};

function dateStr(v: unknown): string | null {
  const d = v as AcademicDate | null;
  return d?.iso ?? null;
}

export function pickCurrentSemester(semesters: ConfirmedRecord[], preferredId: string | null): ConfirmedRecord | null {
  if (preferredId) {
    const s = semesters.find((x) => x.id === preferredId);
    if (s) return s;
  }
  // Latest confirmed semester with a start date, else the latest confirmed.
  const dated = semesters.filter((s) => dateStr(s.fields.startDate));
  const pool = dated.length ? dated : semesters;
  return [...pool].sort((a, b) => (dateStr(a.fields.startDate) ?? a.confirmedAt).localeCompare(dateStr(b.fields.startDate) ?? b.confirmedAt)).pop() ?? null;
}

export function onboardingStatus(records: ConfirmedRecord[], currentSemesterId: string | null = null): OnboardingStatus {
  const uni = records.find((r) => r.entityType === 'university') ?? null;
  const sem = pickCurrentSemester(records.filter((r) => r.entityType === 'semester'), currentSemesterId);
  const semName = (sem?.fields.name as string | null) ?? null;
  const courses = records.filter(
    (r) => r.entityType === 'course' && (!semName || !r.fields.semester || r.fields.semester === semName),
  );

  const start = dateStr(sem?.fields.startDate);
  const end = dateStr(sem?.fields.endDate);
  let length: string | null = null;
  if (typeof sem?.fields.durationWeeks === 'number') length = `${sem.fields.durationWeeks} weeks`;
  else if (start && end) length = `${Math.round(((Date.parse(end) - Date.parse(start)) / 86_400_000 + 1) / 7)} weeks`;

  const answers: Record<OnboardingQuestionId, string | null> = {
    university: (uni?.fields.name as string | null) ?? null,
    program: (uni?.fields.program as string | null) ?? null,
    semester: semName,
    semester_start: start,
    semester_end: end,
    semester_length: length,
    subjects: courses.length ? courses.map((c) => [c.fields.code, c.fields.name].filter(Boolean).join(' ')).join(', ') : null,
  };

  const questions = (Object.keys(PROMPTS) as OnboardingQuestionId[]).map((id) => ({ id, prompt: PROMPTS[id], answer: answers[id] }));
  const nextQuestion = questions.find((q) => q.answer === null) ?? null;
  return { questions, complete: nextQuestion === null, nextQuestion, currentSemester: sem };
}
