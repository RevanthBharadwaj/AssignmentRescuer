import type { AcademicDate, ConfirmedRecord } from './types';
import type { UnitSummary } from './units';

/**
 * Time based helpers: what is finished and what comes first.
 * Nothing here looks at a title or a unit number. "Discussion 3" can be due
 * on Nov 5 and "Discussion 2" on Nov 13, so only the dates and times decide.
 */

export const dueDateOf = (r: ConfirmedRecord): AcademicDate | null =>
  ((r.fields.dueDate ?? r.fields.date ?? null) as AcademicDate | null);

/** Date, then time of day (no time counts as the end of the day), then the order it was imported. */
export function byTime(a: ConfirmedRecord, b: ConfirmedRecord): number {
  const da = dueDateOf(a);
  const db = dueDateOf(b);
  return (da?.iso ?? '9999-99-99').localeCompare(db?.iso ?? '9999-99-99')
    || (da?.time ?? '99:99').localeCompare(db?.time ?? '99:99')
    || a.confirmedAt.localeCompare(b.confirmedAt);
}

/** Marked submitted, or its due date has already passed. Items with no date are never finished by time. */
export function isFinished(r: ConfirmedRecord, today: string): boolean {
  if (r.fields.status === 'submitted') return true;
  const iso = dueDateOf(r)?.iso ?? null;
  return iso !== null && iso < today;
}

/** A unit is finished when every graded item in it is submitted or past its due date. A unit with no graded work is never finished. */
export function unitFinished(u: Pick<UnitSummary, 'graded'>, today: string): boolean {
  return u.graded.length > 0 && u.graded.every((r) => isFinished(r, today));
}
