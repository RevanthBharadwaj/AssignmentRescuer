import { addDays } from '../extract/dates';

/**
 * Next semester subject reminders. Fully deterministic, no AI calls.
 *
 * Rules
 *  1. The first prompt is due 14 days before the current semester ends
 *     (or on the semester start date if the semester is shorter than that).
 *  2. While next semester subjects are unknown, the prompt repeats every
 *     14 days after the first prompt date.
 *  3. Prompts stop once subjects are confirmed, the student says they are
 *     skipping next semester, or reminders are disabled.
 *  4. A snooze moves the next prompt to the snooze date.
 *  5. A prompt that lands inside an academic break of the current
 *     semester moves to the day after the break ends (unless that is after
 *     the semester end, in which case the semester end date is used).
 *  6. Everything is derived from the current semester dates on every call,
 *     so editing those dates moves the schedule automatically.
 */

export const REMINDER_LEAD_DAYS = 14;
export const REMINDER_REPEAT_DAYS = 14;

export interface BreakWindow {
  start: string; // YYYY-MM-DD
  end: string;
}

export interface SemesterReminderState {
  currentSemester: { start: string; end: string } | null;
  breaks: BreakWindow[];
  nextSemesterSubjectsConfirmed: boolean;
  skippingNextSemester: boolean;
  remindersEnabled: boolean;
  snoozedUntil: string | null; // YYYY-MM-DD
  /** Last date (YYYY-MM-DD) a prompt was shown, to avoid repeats the same day. */
  lastPromptedOn: string | null;
}

function inBreak(date: string, breaks: BreakWindow[]): BreakWindow | null {
  return breaks.find((b) => date >= b.start && date <= b.end) ?? null;
}

function shiftOutOfBreaks(date: string, breaks: BreakWindow[], semesterEnd: string): string {
  let d = date;
  for (let guard = 0; guard < 20; guard++) {
    const b = inBreak(d, breaks);
    if (!b) return d;
    d = addDays(b.end, 1);
    if (d > semesterEnd) return semesterEnd;
  }
  return d;
}

export function firstPromptDate(semester: { start: string; end: string }): string {
  const lead = addDays(semester.end, -REMINDER_LEAD_DAYS);
  return lead < semester.start ? semester.start : lead;
}

function maxDate(...ds: (string | null)[]): string {
  return ds.filter((d): d is string => d !== null).sort().pop() as string;
}

/**
 * Next date on or after `today` when the prompt should appear, or null when
 * no prompt is needed. If a prompt was missed while the app was closed, the
 * answer is `today` (catch up once, then repeat 14 days from that prompt).
 */
export function nextSubjectPromptDate(state: SemesterReminderState, today: string): string | null {
  const sem = state.currentSemester;
  if (!sem) return null;
  if (!state.remindersEnabled || state.nextSemesterSubjectsConfirmed || state.skippingNextSemester) return null;

  const first = shiftOutOfBreaks(firstPromptDate(sem), state.breaks, sem.end);
  // A prompt shown before the (possibly moved) first date does not count:
  // the semester dates changed after it was shown.
  const last = state.lastPromptedOn && state.lastPromptedOn >= first ? state.lastPromptedOn : null;
  const due = last ? addDays(last, REMINDER_REPEAT_DAYS) : first;
  const snooze = state.snoozedUntil && state.snoozedUntil > today ? state.snoozedUntil : null;
  return maxDate(due, today, snooze);
}

export function shouldPromptForSubjects(state: SemesterReminderState, today: string): boolean {
  if (state.lastPromptedOn === today) return false;
  return nextSubjectPromptDate(state, today) === today;
}
