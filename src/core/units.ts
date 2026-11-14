import type { AcademicDate, ConfirmedRecord } from './types';

/**
 * A course is a row of units. Each unit gathers what the course gives for
 * that week: graded items, readings and lectures, points and the next due
 * date, so the home page can show them as blocks that open the unit.
 */

export interface UnitSummary {
  /** 1, 2, 3 ... or null for "Course resources" and other material outside a unit. */
  number: number | null;
  label: string;
  graded: ConfirmedRecord[];
  materials: ConfirmedRecord[];
  points: number;
  submitted: number;
  /** Next unsubmitted due date on or after today, as YYYY-MM-DD. */
  nextDue: string | null;
  nextDueTitle: string | null;
  state: 'done' | 'current' | 'upcoming' | 'overdue' | 'empty';
}

const dueIso = (r: ConfirmedRecord) => ((r.fields.dueDate ?? r.fields.date ?? null) as AcademicDate | null)?.iso ?? null;
const isDone = (r: ConfirmedRecord) => r.fields.status === 'submitted';

export function unitNumber(unit: unknown): number | null {
  const m = /(\d+)/.exec(String(unit ?? ''));
  return m ? Number(m[1]) : null;
}

export function summariseUnits(records: ConfirmedRecord[], today: string): UnitSummary[] {
  const byUnit = new Map<number | null, UnitSummary>();
  const get = (n: number | null, label: string) => {
    let u = byUnit.get(n);
    if (!u) {
      u = { number: n, label, graded: [], materials: [], points: 0, submitted: 0, nextDue: null, nextDueTitle: null, state: 'empty' };
      byUnit.set(n, u);
    }
    return u;
  };
  for (const r of records) {
    if (r.fields.kind === 'module') continue;
    const isGraded = r.entityType === 'assignment';
    const isMaterial = r.entityType === 'course_material' || r.entityType === 'timeline_event';
    if (!isGraded && !isMaterial) continue;
    const n = unitNumber(r.fields.unit);
    const u = n === null ? get(null, 'Course resources') : get(n, `Unit ${n}`);
    if (isGraded) {
      u.graded.push(r);
      u.points += typeof r.fields.pointsPossible === 'number' ? r.fields.pointsPossible : 0;
      if (isDone(r)) u.submitted++;
    } else {
      u.materials.push(r);
    }
  }
  for (const u of byUnit.values()) {
    const open = u.graded.filter((r) => !isDone(r) && dueIso(r));
    const upcoming = open.filter((r) => (dueIso(r) as string) >= today).sort((a, b) => (dueIso(a) as string).localeCompare(dueIso(b) as string));
    const overdue = open.filter((r) => (dueIso(r) as string) < today);
    u.nextDue = upcoming[0] ? dueIso(upcoming[0]) : null;
    u.nextDueTitle = upcoming[0] ? String(upcoming[0].fields.title) : null;
    if (!u.graded.length) u.state = u.materials.length ? 'upcoming' : 'empty';
    else if (u.submitted === u.graded.length) u.state = 'done';
    else if (overdue.length) u.state = 'overdue';
    else {
      // The current unit is the first one that still has open work.
      u.state = 'upcoming';
    }
  }
  const ordered = [...byUnit.values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const firstOpen = ordered.find((u) => u.number !== null && u.state === 'upcoming' && u.graded.length && u.nextDue);
  const soonest = ordered
    .filter((u) => u.number !== null && u.nextDue)
    .sort((a, b) => (a.nextDue as string).localeCompare(b.nextDue as string))[0];
  const current = soonest ?? firstOpen;
  if (current) current.state = 'current';
  return ordered;
}
