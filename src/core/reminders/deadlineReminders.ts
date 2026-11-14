import type { AcademicDate, ConfirmedRecord } from '../types';
import { addDays } from '../extract/dates';

/**
 * Deadline reminder schedule: 7, 3, 1 and 0 days before by default, all
 * customisable. Only due dates and exams get reminders, never
 * availability dates. Delivery is in app while the app is open; closed app
 * notifications are not implemented.
 */

export const DEFAULT_OFFSETS = [7, 3, 1, 0];
export const DEFAULT_REMIND_AT = '09:00';

export interface ReminderSettings {
  offsetsDays: number[];
  remindAt: string; // HH:MM local
  enabled: boolean;
}

export interface ScheduledReminder {
  recordId: string;
  title: string;
  courseCode: string | null;
  kind: 'due' | 'exam';
  dueDate: string;
  dueTime: string | null;
  offsetDays: number;
  remindOn: string; // YYYY-MM-DD
  remindAt: string; // HH:MM
}

function dateOf(r: ConfirmedRecord): { date: AcademicDate; kind: 'due' | 'exam' } | null {
  if (r.entityType === 'assignment') {
    const d = r.fields.dueDate as AcademicDate | null;
    return d?.iso ? { date: d, kind: r.fields.type === 'exam' ? 'exam' : 'due' } : null;
  }
  if (r.entityType === 'timeline_event') {
    const k = r.fields.kind;
    if (k !== 'due' && k !== 'exam' && k !== 'milestone') return null;
    const d = r.fields.date as AcademicDate | null;
    return d?.iso ? { date: d, kind: k === 'exam' ? 'exam' : 'due' } : null;
  }
  return null;
}

export function buildDeadlineReminders(
  records: ConfirmedRecord[],
  settings: ReminderSettings,
  today: string,
): ScheduledReminder[] {
  if (!settings.enabled) return [];
  const offsets = [...new Set(settings.offsetsDays.filter((o) => Number.isInteger(o) && o >= 0 && o <= 60))].sort((a, b) => b - a);
  const out: ScheduledReminder[] = [];
  for (const r of records) {
    if (r.fields.status === 'submitted') continue;
    const d = dateOf(r);
    if (!d || !d.date.iso) continue;
    for (const off of offsets) {
      const remindOn = addDays(d.date.iso, -off);
      if (remindOn < today) continue;
      let remindAt = settings.remindAt;
      // On the day itself, never remind after the deadline time.
      if (off === 0 && d.date.time && d.date.time <= remindAt) {
        const [h, m] = d.date.time.split(':').map(Number);
        const earlier = Math.max(0, h * 60 + m - 120);
        remindAt = `${String(Math.floor(earlier / 60)).padStart(2, '0')}:${String(earlier % 60).padStart(2, '0')}`;
      }
      out.push({
        recordId: r.id,
        title: String(r.fields.title ?? 'Deadline'),
        courseCode: (r.fields.courseCode as string | null) ?? null,
        kind: d.kind,
        dueDate: d.date.iso,
        dueTime: d.date.time,
        offsetDays: off,
        remindOn,
        remindAt,
      });
    }
  }
  return out.sort((a, b) => (a.remindOn + a.remindAt).localeCompare(b.remindOn + b.remindAt) || a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'));
}

export function remindersDueToday(all: ScheduledReminder[], today: string): ScheduledReminder[] {
  return all.filter((r) => r.remindOn === today);
}
