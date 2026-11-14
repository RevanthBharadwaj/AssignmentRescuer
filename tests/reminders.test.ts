import { firstPromptDate, nextSubjectPromptDate, shouldPromptForSubjects, type SemesterReminderState } from '../src/core/reminders/semesterReminders';
import { buildDeadlineReminders, DEFAULT_OFFSETS } from '../src/core/reminders/deadlineReminders';
import type { ConfirmedRecord } from '../src/core/types';
import { approveAll, fixture, makeService } from './helpers';

const base = (over: Partial<SemesterReminderState> = {}): SemesterReminderState => ({
  currentSemester: { start: '2026-08-24', end: '2026-12-11' },
  breaks: [],
  nextSemesterSubjectsConfirmed: false,
  skippingNextSemester: false,
  remindersEnabled: true,
  snoozedUntil: null,
  lastPromptedOn: null,
  ...over,
});

describe('next semester subject reminders', () => {
  it('first asks 14 days before the semester ends', () => {
    expect(firstPromptDate({ start: '2026-08-24', end: '2026-12-11' })).toBe('2026-11-27');
    expect(shouldPromptForSubjects(base(), '2026-11-26')).toBe(false);
    expect(shouldPromptForSubjects(base(), '2026-11-27')).toBe(true);
    expect(nextSubjectPromptDate(base(), '2026-10-01')).toBe('2026-11-27');
  });

  it('repeats every 14 days while subjects are unknown', () => {
    const shown = base({ lastPromptedOn: '2026-11-27' });
    expect(shouldPromptForSubjects(shown, '2026-11-27')).toBe(false);
    expect(shouldPromptForSubjects(shown, '2026-12-10')).toBe(false);
    expect(shouldPromptForSubjects(shown, '2026-12-11')).toBe(true);
    expect(nextSubjectPromptDate(base({ lastPromptedOn: '2026-12-11' }), '2026-12-12')).toBe('2026-12-25');
  });

  it('catches up once if the app was closed on the prompt date', () => {
    expect(shouldPromptForSubjects(base(), '2026-12-03')).toBe(true);
    expect(nextSubjectPromptDate(base({ lastPromptedOn: '2026-12-03' }), '2026-12-04')).toBe('2026-12-17');
  });

  it('stops once subjects are confirmed, the student skips a semester, or reminders are off', () => {
    for (const s of [base({ nextSemesterSubjectsConfirmed: true }), base({ skippingNextSemester: true }), base({ remindersEnabled: false })]) {
      expect(nextSubjectPromptDate(s, '2026-11-27')).toBeNull();
      expect(shouldPromptForSubjects(s, '2026-11-27')).toBe(false);
    }
  });

  it('respects snoozes', () => {
    const s = base({ snoozedUntil: '2026-12-02' });
    expect(shouldPromptForSubjects(s, '2026-11-27')).toBe(false);
    expect(nextSubjectPromptDate(s, '2026-11-27')).toBe('2026-12-02');
    expect(shouldPromptForSubjects(s, '2026-12-02')).toBe(true);
  });

  it('moves a prompt that lands inside an academic break to after the break', () => {
    const s = base({ breaks: [{ start: '2026-11-25', end: '2026-11-29' }] });
    expect(nextSubjectPromptDate(s, '2026-11-01')).toBe('2026-11-30');
    expect(shouldPromptForSubjects(s, '2026-11-27')).toBe(false);
  });

  it('follows semester date changes automatically', () => {
    const moved = base({ currentSemester: { start: '2026-08-24', end: '2026-12-18' } });
    expect(nextSubjectPromptDate(moved, '2026-11-01')).toBe('2026-12-04');
    // A prompt shown under the old dates does not suppress the new first prompt.
    expect(shouldPromptForSubjects({ ...moved, lastPromptedOn: '2026-11-27' }, '2026-12-04')).toBe(true);
  });

  it('handles semesters shorter than 14 days', () => {
    expect(firstPromptDate({ start: '2027-06-01', end: '2027-06-10' })).toBe('2027-06-01');
  });

  it('needs a known semester', () => {
    expect(nextSubjectPromptDate(base({ currentSemester: null }), '2026-11-27')).toBeNull();
  });

  it('works end to end from imported material and resets for a new semester', async () => {
    const { service } = await makeService();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    await approveAll(service);
    const st = await service.reminderState();
    expect(st.currentSemester).toEqual({ start: '2026-08-24', end: '2026-12-11' });
    expect(st.breaks).toEqual([{ start: '2026-11-25', end: '2026-11-27' }]);
    // 2026-11-27 is inside Thanksgiving break, so the first prompt moves.
    expect((await service.subjectPrompt('2026-11-27')).show).toBe(false);
    expect((await service.subjectPrompt('2026-11-28')).show).toBe(true);
    await service.markSubjectPromptShown('2026-11-28');
    expect((await service.subjectPrompt('2026-11-29')).show).toBe(false);
    await service.updateNextSemester({ subjectsConfirmed: true, subjects: ['CIS 6940'] });
    expect((await service.subjectPrompt('2026-12-12')).nextDate).toBeNull();

    // New current semester: previous answers no longer count.
    await service.import([{ kind: 'text', text: 'Spring 2027\nClasses begin January 11, 2027\nLast day of classes: April 30, 2027' }]);
    await approveAll(service);
    const st2 = await service.reminderState();
    expect(st2.currentSemester).toEqual({ start: '2027-01-11', end: '2027-04-30' });
    expect(st2.nextSemesterSubjectsConfirmed).toBe(false);
    expect((await service.subjectPrompt('2027-04-16')).show).toBe(true);
  });
});

const rec = (id: string, fields: ConfirmedRecord['fields'], entityType: ConfirmedRecord['entityType'] = 'assignment'): ConfirmedRecord => ({
  id, entityType, key: id, fields, unknownFields: [], evidence: [], confirmedAt: '', updatedAt: '',
});
const d = (iso: string, time: string | null = null) => ({ iso, month: Number(iso.slice(5, 7)), day: Number(iso.slice(8)), year: Number(iso.slice(0, 4)), yearSource: 'explicit' as const, time, timeZone: null, raw: iso });

describe('deadline reminders', () => {
  const settings = { offsetsDays: DEFAULT_OFFSETS, remindAt: '09:00', enabled: true };

  it('schedules 7, 3, 1 and 0 days before', () => {
    const r = buildDeadlineReminders([rec('a', { title: 'Essay', dueDate: d('2026-10-20', '23:59') })], settings, '2026-10-01');
    expect(r.map((x) => x.remindOn)).toEqual(['2026-10-13', '2026-10-17', '2026-10-19', '2026-10-20']);
  });

  it('skips past reminders, availability dates, and records without a known date', () => {
    const r = buildDeadlineReminders([
      rec('a', { title: 'Essay', dueDate: d('2026-10-20') }),
      rec('b', { kind: 'availability', title: 'Quiz opens', date: d('2026-10-15') }, 'timeline_event'),
      rec('c', { title: 'No year', dueDate: { ...d('2026-10-25'), iso: null, year: null } }),
    ], settings, '2026-10-18');
    expect(r.map((x) => [x.recordId, x.offsetDays])).toEqual([['a', 1], ['a', 0]]);
  });

  it('includes exams and moves a same day reminder before an early deadline', () => {
    const r = buildDeadlineReminders([rec('e', { kind: 'exam', title: 'Midterm', date: d('2026-10-14', '08:00') }, 'timeline_event')], { ...settings, offsetsDays: [0] }, '2026-10-01');
    expect(r[0]).toMatchObject({ kind: 'exam', remindAt: '06:00' });
  });

  it('allows custom offsets and can be disabled', () => {
    const one = [rec('a', { title: 'Essay', dueDate: d('2026-10-20') })];
    expect(buildDeadlineReminders(one, { ...settings, offsetsDays: [14, 2, 2, -1] }, '2026-10-01').map((x) => x.offsetDays)).toEqual([14, 2]);
    expect(buildDeadlineReminders(one, { ...settings, enabled: false }, '2026-10-01')).toEqual([]);
  });
});
