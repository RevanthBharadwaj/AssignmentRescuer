import type { AcademicDate, ConfirmedRecord } from './types';
import { addDays } from './extract/dates';
import { gradeRowFor, type SyllabusFacts } from './syllabus';

/**
 * Milestones and reminders. A milestone is a moment the student must act:
 * a discussion's first post (often earlier in the week than the due date), or
 * the due date itself. Each milestone gets reminders: the day before and the
 * day of, and every day for five days when the work is big.
 */

export interface Milestone {
  key: string;
  recordId: string;
  assignmentKey: string;
  kind: 'initial_post' | 'due';
  /** YYYY-MM-DD */
  date: string;
  time: string | null;
  timeZone: string | null;
  title: string;
  courseCode: string;
  unit: string | null;
  points: number | null;
  heavy: boolean;
  /** Share of the final grade, when the syllabus gives one. */
  percent: number | null;
  /** What the student does on this date. */
  action: string;
}

export interface Reminder {
  id: string;
  /** YYYY-MM-DD the reminder goes out. */
  sendOn: string;
  /** Days before the milestone (0 is the day itself). */
  daysBefore: number;
  milestone: Milestone;
}

export interface PushSettings {
  enabled: boolean;
  /** How the email greets the student. Stays on this computer. */
  name: string;
  /** The Gmail address reminders are sent from. */
  gmail: string;
  /** Where to send them. Empty means the same Gmail address. */
  email: string;
  /** Send reminder emails. */
  mail: boolean;
  desktop: boolean;
  /** Also send the emails while this app is closed, through a job the computer runs every 15 minutes. */
  background: boolean;
  /** Hour of day (0 to 23, local time) when reminders go out. */
  hour: number;
}

export const DEFAULT_PUSH: PushSettings = { enabled: false, name: '', gmail: '', email: '', mail: false, desktop: true, background: true, hour: 9 };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function prettyDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(iso)].slice(0, 3)} ${MONTHS[m - 1]} ${d}`;
}

export function prettyTime(hhmm: string | null): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const dueOf = (r: ConfirmedRecord) => (r.fields.dueDate ?? null) as AcademicDate | null;

/** Big work: 100 points or more, or a tenth of the grade. */
export function isHeavy(points: number | null, totalPoints: number | null): boolean {
  if (points === null) return false;
  return points >= 100 || (totalPoints !== null && totalPoints > 0 && points / totalPoints >= 0.1);
}

export function milestonesFor(records: ConfirmedRecord[], factsByCourse: Record<string, SyllabusFacts | undefined>): Milestone[] {
  const out: Milestone[] = [];
  for (const r of records) {
    if (r.entityType !== 'assignment' || r.fields.status === 'submitted') continue;
    const due = dueOf(r);
    if (!due?.iso) continue;
    const code = String(r.fields.courseCode ?? '');
    const facts = factsByCourse[code];
    const title = String(r.fields.title ?? 'Assignment');
    const points = typeof r.fields.pointsPossible === 'number' ? r.fields.pointsPossible : null;
    const row = facts ? gradeRowFor(title, facts) : null;
    const percent = row ? (row.each && facts?.totalPoints ? Math.round((row.each / facts.totalPoints) * 1000) / 10 : row.percent) : (points && facts?.totalPoints ? Math.round((points / facts.totalPoints) * 1000) / 10 : null);
    const base = {
      recordId: r.id, assignmentKey: r.key, title, courseCode: code, unit: r.fields.unit ? String(r.fields.unit) : null,
      points, heavy: isHeavy(points, facts?.totalPoints ?? null), percent, timeZone: due.timeZone ?? facts?.rules.timeZone ?? null,
    };
    const dueTime = due.time ?? (facts?.rules.dueTime ? to24(facts.rules.dueTime) : null);
    const isDiscussion = /discussion/i.test(title);
    const initialDay = facts?.rules.initialPostDay;
    if (isDiscussion && initialDay) {
      const target = WEEKDAYS.indexOf(initialDay);
      const delta = (weekdayOf(due.iso) - target + 7) % 7;
      if (delta > 0) {
        out.push({
          ...base, key: `${r.key}|initial_post`, kind: 'initial_post', date: addDays(due.iso, -delta),
          time: to24(facts?.rules.initialPostTime ?? '') ?? dueTime,
          action: `Post your first answer (${facts?.rules.wordMin ?? 250} to ${facts?.rules.wordMax ?? 500} words${facts?.rules.referencesRequired ? ', with references' : ''})`,
          heavy: false,
        });
      }
      out.push({
        ...base, key: `${r.key}|due`, kind: 'due', date: due.iso, time: dueTime,
        action: `Reply to ${facts?.rules.replies ?? 2} classmates${facts?.rules.referencesRequired ? ', with references' : ''}`, heavy: false,
      });
      continue;
    }
    out.push({ ...base, key: `${r.key}|due`, kind: 'due', date: due.iso, time: dueTime, action: 'Submit' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function to24(s: string): string | null {
  const m = /(\d{1,2}):(\d{2})\s*([AP])M?/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function remindersFor(milestones: Milestone[]): Reminder[] {
  const out: Reminder[] = [];
  for (const m of milestones) {
    const offsets = m.heavy ? [5, 4, 3, 2, 1, 0] : [1, 0];
    for (const n of offsets) out.push({ id: `${m.key}|-${n}`, sendOn: addDays(m.date, -n), daysBefore: n, milestone: m });
  }
  return out.sort((a, b) => a.sendOn.localeCompare(b.sendOn));
}

/** Reminders that should go out now: today's, at or after the chosen hour, not sent before. */
export function dueReminders(plan: Reminder[], now: Date, today: string, hour: number, sent: ReadonlySet<string>): Reminder[] {
  if (now.getHours() < hour) return [];
  return plan.filter((r) => r.sendOn === today && !sent.has(r.id));
}

/* ---------- message ---------- */

export interface CourseInfo { name: string | null; instructor: string | null }

function when(n: number, kind: Milestone['kind']): string {
  if (n === 0) return kind === 'initial_post' ? 'First post due TODAY' : 'Due TODAY';
  if (n === 1) return kind === 'initial_post' ? 'First post due tomorrow' : 'Due tomorrow';
  return `${n} days left`;
}

function oneLine(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
}

/** The desktop notification text for one day: grouped by course, short, with a line of context per item. */
export function formatDigest(reminders: Reminder[], courses: Record<string, CourseInfo>, contextFor: (m: Milestone) => string | null): string[] {
  const byCourse = new Map<string, Reminder[]>();
  for (const r of reminders) byCourse.set(r.milestone.courseCode, [...(byCourse.get(r.milestone.courseCode) ?? []), r]);
  const messages: string[] = [];
  for (const [code, list] of byCourse) {
    const info = courses[code];
    const header = [code, info?.name, info?.instructor].filter(Boolean).join(' · ');
    const lines = list.map((r) => {
      const m = r.milestone;
      const num = m.unit ? `${m.unit} · ` : '';
      const pts = m.points !== null ? ` (${m.points} pts${m.percent !== null ? `, ${m.percent}% of grade` : ''})` : '';
      const dl = `${prettyDate(m.date)}${m.time ? `, ${prettyTime(m.time)}${m.timeZone ? ` ${m.timeZone}` : ''}` : ''}`;
      const ctx = contextFor(m);
      return [
        `${when(r.daysBefore, m.kind)}: ${num}${m.title.replace(/^Unit \d+:\s*/i, '')}${pts}`,
        `${m.kind === 'initial_post' ? 'Initial post' : 'Due'} ${dl}. ${m.action}.`,
        ctx ? `About: ${oneLine(ctx, 130)}` : '',
      ].filter(Boolean).join('\n');
    });
    messages.push(`Assignment Rescue\n${header}\n\n${lines.join('\n\n')}`);
  }
  return messages;
}

/* ---------- email ---------- */

export interface Email { subject: string; body: string }

function dueWord(n: number, kind: Milestone['kind']): string {
  const what = kind === 'initial_post' ? 'first post due' : 'due';
  return n === 0 ? `${what} today` : n === 1 ? `${what} tomorrow` : `${what} in ${n} days`;
}

/**
 * One email for a day's reminders. The subject names the assignment, course and
 * professor; the body lists each one as short bullets. No nagging about next steps.
 */
export function formatEmail(reminders: Reminder[], courses: Record<string, CourseInfo>, name: string): Email | null {
  if (!reminders.length) return null;
  const list = [...reminders].sort((a, b) => a.milestone.date.localeCompare(b.milestone.date) || a.milestone.title.localeCompare(b.milestone.title));
  const who = (r: Reminder) => [r.milestone.courseCode, courses[r.milestone.courseCode]?.instructor].filter(Boolean).join(', ');
  const first = list[0];
  const lead = `${first.milestone.title} ${dueWord(first.daysBefore, first.milestone.kind)}${who(first) ? ` (${who(first)})` : ''}`;
  const subject = list.length === 1 ? lead : `${list.length} due soon: ${lead} and ${list.length - 1} more`;
  const items = list.map((r) => {
    const m = r.milestone;
    const info = courses[m.courseCode];
    const when = `${prettyDate(m.date)}${m.time ? `, ${prettyTime(m.time)}${m.timeZone ? ` ${m.timeZone}` : ''}` : ''}`;
    return [
      `• Assignment: ${m.title}`,
      `• Course: ${[m.courseCode, info?.name].filter(Boolean).join(' ')}`,
      info?.instructor ? `• Professor: ${info.instructor}` : '',
      `• ${m.kind === 'initial_post' ? 'First post due' : 'Due'}: ${when}`,
    ].filter(Boolean).join('\n');
  });
  return { subject, body: `Hi${name.trim() ? ` ${name.trim()}` : ''},\n\n${items.join('\n\n')}\n` };
}

/** One email per day, as the closed-app job needs it. The id is per day so a day is never sent twice. */
export interface ScheduledEmail { id: string; sendOn: string; subject: string; body: string }

export function scheduleEmails(plan: Reminder[], courses: Record<string, CourseInfo>, name: string, today: string, days: number, sent: ReadonlySet<string>): ScheduledEmail[] {
  const last = addDays(today, days);
  const byDay = new Map<string, Reminder[]>();
  for (const r of plan) {
    if (r.sendOn < today || r.sendOn > last || sent.has(r.id)) continue;
    byDay.set(r.sendOn, [...(byDay.get(r.sendOn) ?? []), r]);
  }
  const out: ScheduledEmail[] = [];
  for (const [day, list] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    const email = formatEmail(list, courses, name);
    if (email) out.push({ id: `mail:${day}`, sendOn: day, ...email });
  }
  return out;
}
