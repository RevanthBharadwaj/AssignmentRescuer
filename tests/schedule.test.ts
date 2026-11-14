import { approveAll, fixture, makeService } from './helpers';
import { summariseUnits } from '../src/core/units';
import { prettyDate, weekdayOf } from '../src/core/schedule';
import type { AcademicDate } from '../src/core/types';

const d = (iso: string): AcademicDate => {
  const [year, month, day] = iso.split('-').map(Number);
  return { iso, year, month, day, yearSource: 'explicit', time: null, timeZone: null, raw: iso };
};

async function course() {
  const { service, repo } = await makeService();
  await service.saveSemester({ name: 'Fall 2026', start: d('2026-08-24'), end: d('2026-12-15') });
  await service.addCourse({ code: 'MGT 6200', name: 'Applied Leadership', instructor: 'Dr. Rivera' });
  const add = (title: string, unit: number, iso: string, pts: number, type = 'assignment') => service.import([{
    kind: 'manual', entityType: 'assignment',
    fields: { title, type, unit: `Unit ${unit}`, courseCode: 'MGT 6200', dueDate: d(iso), pointsPossible: pts },
  }]);
  // 2026-10-24 and 2026-10-17 are Saturdays.
  await add('Unit 1: Discussion Question 1', 1, '2026-10-17', 20, 'discussion');
  await add('Unit 2: Discussion Question', 2, '2026-10-24', 20, 'discussion');
  await add('Unit 2: Writing Assignment', 2, '2026-10-24', 120, 'paper');
  await approveAll(service);
  await service.importForCourse('MGT 6200', [{ kind: 'text', text: fixture('syllabus-units.txt'), hints: { material: 'syllabus' } }]);
  await approveAll(service);
  return { service, repo };
}

describe('reminders', () => {
  it('knows the dates are Saturdays', () => {
    expect(weekdayOf('2026-10-24')).toBe(6);
    expect(prettyDate('2026-10-21')).toBe('Wed Oct 21');
  });

  it('puts the first discussion post on Wednesday and counts down five days for big work', async () => {
    const { service } = await course();
    const ms = await service.milestones();
    const dq = ms.filter((m) => m.title === 'Unit 2: Discussion Question');
    expect(dq.map((m) => [m.kind, m.date, m.time])).toEqual([['initial_post', '2026-10-21', '23:59'], ['due', '2026-10-24', '23:59']]);
    expect(dq[0].action).toMatch(/250 to 500 words, with references/);
    expect(dq[1].action).toBe('Reply to 2 classmates, with references');
    const paper = ms.find((m) => m.title === 'Unit 2: Writing Assignment')!;
    expect(paper).toMatchObject({ heavy: true, points: 120, percent: 30, date: '2026-10-24' });
    const plan = await service.reminderPlan();
    expect(plan.filter((r) => r.milestone.key === paper.key).map((r) => r.sendOn)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    expect(plan.filter((r) => r.milestone.key === dq[0].key).map((r) => r.sendOn)).toEqual(['2026-10-20', '2026-10-21']);
    expect(plan.filter((r) => r.milestone.key === dq[1].key).map((r) => r.sendOn)).toEqual(['2026-10-23', '2026-10-24']);
  });

  it('sends each reminder once, at the chosen hour, only when turned on', async () => {
    const { service } = await course();
    const at = (h: number) => new Date(2026, 9, 21, h, 5);
    expect((await service.dueNow(at(10), '2026-10-21')).reminders).toEqual([]); // off by default
    await service.savePushSettings({ ...(await service.pushSettings()), enabled: true, mail: true, gmail: 'revanth@gmail.com', hour: 9 });
    expect((await service.dueNow(at(8), '2026-10-21')).reminders).toEqual([]); // before 9
    const now = await service.dueNow(at(10), '2026-10-21');
    expect(now.reminders.map((r) => `${r.milestone.title}|${r.daysBefore}`).sort()).toEqual([
      'Unit 2: Discussion Question|0', 'Unit 2: Writing Assignment|3',
    ]);
    expect(now.messages).toHaveLength(1);
    await service.markReminded(now.reminders, '2026-10-21');
    expect((await service.dueNow(at(11), '2026-10-21')).reminders).toEqual([]);
  });

  it('writes one message per course with name, teacher, points and a line about the work', async () => {
    const { service } = await course();
    await service.savePushSettings({ ...(await service.pushSettings()), enabled: true, hour: 9 });
    const now = await service.dueNow(new Date(2026, 9, 21, 10, 0), '2026-10-21');
    const [msg] = now.messages;
    expect(msg).toContain('MGT 6200 · Applied Leadership · Dr. Rivera');
    expect(msg).toContain('First post due TODAY: Unit 2 · Discussion Question (20 pts, 5% of grade)');
    expect(msg).toContain('Initial post Wed Oct 21, 11:59 PM CT. Post your first answer (250 to 500 words, with references).');
    expect(msg).toContain('About: When should a manager use power and when should a manager use influence tactics?');
    expect(msg).toContain('3 days left: Unit 2 · Writing Assignment (120 pts, 30% of grade)');
    expect(msg).toContain('About: In APA 7 format, present a 1500-2000-word document');
  });

  it('stops reminding once the work is submitted', async () => {
    const { service, repo } = await course();
    const paper = (await repo.listRecords('assignment')).find((r) => r.fields.title === 'Unit 2: Writing Assignment')!;
    await repo.correctRecord(paper.id, { ...paper.fields, status: 'submitted' });
    expect((await service.milestones()).some((m) => m.title === 'Unit 2: Writing Assignment')).toBe(false);
  });
});

describe('assignment brief', () => {
  it('collects what is required, the scoring, the reading and the dates, each with its source', async () => {
    const { service, repo } = await course();
    const dq = (await repo.listRecords('assignment')).find((r) => r.fields.title === 'Unit 2: Discussion Question')!;
    const b = (await service.briefFor(dq.id))!;
    const by = (id: string) => b.blocks.find((x) => x.id === id)!.lines;
    expect(by('required')[0]).toMatchObject({ text: expect.stringMatching(/power and when/), source: 'Syllabus, Unit 2' });
    expect(by('required').map((l) => l.text).join(' ')).toMatch(/First post: 250 to 500 words, before 11:59 PM Wednesday/);
    expect(by('required').map((l) => l.text).join(' ')).toMatch(/Reply to at least 2 classmates by Saturday/);
    expect(by('scoring').map((l) => l.text)).toContain('Worth 20 points.');
    expect(by('scoring').map((l) => l.text).join(' ')).toMatch(/Part of Discussions: 4 items at 20 points each, 80 points \(20% of the course grade\)/);
    expect(by('resources').map((l) => l.text).join(' ')).toMatch(/Hartley, M\. \(2020\)/);
    expect(by('resources').map((l) => l.text).join(' ')).toMatch(/Course texts: Marsh \(2010\)/);
    expect(by('dates').map((l) => l.text)).toEqual([
      'First post Wed Oct 21, 23:59 CT: Post your first answer (250 to 500 words, with references).',
      'Due Sat Oct 24, 23:59 CT: Reply to 2 classmates, with references.',
    ]);
  });

  it('does not store the same material twice when it is added again', async () => {
    const { service, repo } = await course();
    const before = (await repo.listSources()).length;
    const again = await service.importForCourse('MGT 6200', [{ kind: 'text', text: fixture('syllabus-units.txt'), hints: { material: 'syllabus' } }]);
    expect((await repo.listSources()).length).toBe(before);
    expect(again.proposals.filter((p) => p.kind === 'create')).toEqual([]);
  });
});

describe('unit blocks', () => {
  it('summarises each unit with points, progress and which one is current', async () => {
    const { service, repo } = await course();
    const recs = await repo.listRecords();
    const u = summariseUnits(recs.filter((r) => r.fields.courseCode === 'MGT 6200'), '2026-10-18');
    expect(u.map((x) => [x.label, x.graded.length, x.points, x.state])).toEqual([['Unit 1', 1, 20, 'overdue'], ['Unit 2', 2, 140, 'current']]);
    expect(u[1].nextDue).toBe('2026-10-24');
    expect((await service.units('MGT 6200', '2026-10-18')).length).toBe(2);
  });
});

describe('reminder email', () => {
  it('names the assignment, course and professor in the subject and lists bullets in the body', async () => {
    const { service } = await course();
    await service.savePushSettings({ ...(await service.pushSettings()), enabled: true, mail: true, gmail: 'revanth@gmail.com', name: 'Revanth', hour: 9 });
    const now = await service.dueNow(new Date(2026, 9, 21, 10, 0), '2026-10-21');
    expect(now.email?.subject).toBe('2 due soon: Unit 2: Discussion Question first post due today (MGT 6200, Dr. Rivera) and 1 more');
    expect(now.email?.body).toContain('Hi Revanth,');
    expect(now.email?.body).toContain('• Assignment: Unit 2: Writing Assignment');
    expect(now.email?.body).toContain('• Course: MGT 6200 Applied Leadership');
    expect(now.email?.body).toContain('• Professor: Dr. Rivera');
    expect(now.email?.body).toMatch(/• Due: Sat Oct 24, 11:59 PM/);
    expect(now.email?.body).not.toMatch(/next step/i);
  });

  it('sends no email unless email reminders are on, and drops old text message settings', async () => {
    const { service, repo } = await course();
    await service.savePushSettings({ ...(await service.pushSettings()), enabled: true, mail: false, hour: 9 });
    expect((await service.dueNow(new Date(2026, 9, 21, 10, 0), '2026-10-21')).email).toBeNull();
    await repo.setSetting('push', { enabled: true, phone: '9135550123', sms: true, twilioSid: 'AC1', mail: true, gmail: 'a@gmail.com' });
    const s = await service.pushSettings();
    expect(s).toMatchObject({ mail: true, gmail: 'a@gmail.com', desktop: true });
    expect(s).not.toHaveProperty('phone');
    expect(s).not.toHaveProperty('twilioSid');
  });
});

describe('chat whats_due tool', () => {
  it('lists what is due on the day with course and professor', async () => {
    const { service } = await course();
    const r = await service.runTool({ id: 'whats_due', arg: 'what is due today' }, { code: null, today: '2026-10-21', fetcher: async () => '' });
    expect(r.note).toBe('1 due today');
    expect(r.text).toContain('Unit 2: Discussion Question');
    expect(r.text).toContain('MGT 6200 Applied Leadership | Professor Dr. Rivera | due Wed Oct 21, 11:59 PM');
    const next = await service.runTool({ id: 'whats_due', arg: 'anything due tomorrow' }, { code: null, today: '2026-10-21', fetcher: async () => '' });
    expect(next.note).toBe('Nothing due tomorrow');
    expect(next.text).toContain('The next one is');
  });
});
