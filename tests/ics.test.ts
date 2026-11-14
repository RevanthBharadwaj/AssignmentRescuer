import { parseIcs, splitSummary } from '../src/core/extract/ics';
import { runImport } from '../src/core/pipeline';
import { detectFormat } from '../src/core/input/formatDetection';
import { approveAll, fixture, fixtureBytes, makeService } from './helpers';

const TZ = 'America/Chicago';
const iso = (v: unknown) => (v as { iso: string | null } | null)?.iso ?? null;
const courses = [{ code: 'DSC 6400', name: 'Data Ethics' }, { code: 'STA 6166', name: 'Statistical Methods' }];

describe('calendar files and feeds', () => {
  it('unfolds lines, unescapes text and converts UTC to the local day and time', () => {
    const ev = parseIcs(fixture('canvas-feed.ics'), TZ);
    expect(ev).toHaveLength(5);
    // 04:59 UTC on Sep 7 is 11:59 PM on Sep 6 in Chicago.
    expect(ev[0].start).toMatchObject({ iso: '2026-09-06', time: '23:59', timeZone: 'CDT' });
    expect(ev[1].description).toBe('Write a 900 word reflection.\nUse APA 7, with a title page.');
    expect(ev[2]).toMatchObject({ allDay: true, start: { iso: '2026-12-12', time: null } });
    expect(ev[3].summary).toBe('Live Session: Office Hours with Dr. Patel and the teaching assistants [Statistical Methods]');
  });

  it('reads the course from the bracket, by code or by course name', () => {
    expect(splitSummary('Paper 1 [2026FA DSC-6400-7AB12]', courses)).toEqual({ title: 'Paper 1', course: 'DSC 6400' });
    expect(splitSummary('Problem Set 3 [Statistical Methods]', courses)).toEqual({ title: 'Problem Set 3', course: 'STA 6166' });
    expect(splitSummary('Club meeting', courses)).toEqual({ title: 'Club meeting', course: null });
  });

  it('turns assignments and calendar events into records with times and links', async () => {
    expect(detectFormat('feed.ics', fixtureBytes('canvas-feed.ics'))).toBe('ics');
    const r = await runImport([{ kind: 'file', name: 'feed.ics', bytes: fixtureBytes('canvas-feed.ics') }], {
      existingSourceHashes: new Map(), confirmedRecords: [], context: { timeZone: TZ, knownCourses: courses },
    });
    const recs = r.sources[0].records;
    const dq = recs.find((x) => x.fields.title === 'Week 1: Discussion Question 1')!;
    expect(dq.entityType).toBe('assignment');
    expect(dq.fields).toMatchObject({ courseCode: 'DSC 6400', type: 'discussion', unit: 'Week 1', lmsUrl: 'https://school.instructure.com/courses/111/assignments/90001' });
    expect(dq.provenance.extractionMethod).toBe('structured_parser');
    const exam = recs.find((x) => x.fields.title === 'Final Exam')!;
    expect([exam.entityType, exam.fields.kind, iso(exam.fields.date)]).toEqual(['timeline_event', 'exam', '2026-12-12']);
    expect(recs.find((x) => x.fields.title?.toString().startsWith('Live Session'))?.entityType).toBe('timeline_event');
    expect(recs.find((x) => x.fields.title === 'Problem Set 3')?.fields.courseCode).toBe('STA 6166');
  });

  it('keeps only the chosen course when a feed is dropped onto a course', async () => {
    const r = await runImport([{ kind: 'file', name: 'feed.ics', bytes: fixtureBytes('canvas-feed.ics'), hints: { course: 'DSC 6400' } }], {
      existingSourceHashes: new Map(), confirmedRecords: [], context: { timeZone: TZ, knownCourses: courses },
    });
    expect(r.sources[0].records.every((x) => x.fields.courseCode === 'DSC 6400')).toBe(true);
  });
});

describe('feed sync', () => {
  async function setupWithModules() {
    const { service, repo } = await makeService();
    await service.saveSemester({ name: 'Fall 2026', start: null, end: null });
    await service.addCourse({ code: 'DSC 6400', name: 'Data Ethics', instructor: null });
    await service.addCourse({ code: 'STA 6166', name: 'Statistical Methods', instructor: null });
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);
    return { service, repo };
  }

  it('adds due times to items already saved, adds new ones, and skips exact repeats on the next sync', async () => {
    const { service, repo } = await setupWithModules();
    await service.saveCalendarFeed('https://school.instructure.com/feeds/calendars/user_x.ics');
    let calls = 0;
    const fetcher = async (url: string) => { calls++; expect(url).toContain('/feeds/'); return fixture('canvas-feed.ics'); };
    const first = await service.syncCalendarFeed(fetcher, '2026-09-01T12:00:00Z');
    expect(first.newItems).toBeGreaterThanOrEqual(2); // Problem Set 3, office hours
    const pending = await repo.listProposals('pending');
    const dq = pending.find((p) => p.candidate.fields.title === 'Week 1: Discussion Question 1')!;
    expect(dq.kind).toBe('update');
    expect(dq.changes.map((c) => c.field)).toContain('dueDate');
    await approveAll(service);
    const saved = await repo.findRecordByKey('assignment', 'DSC 6400|week 1 discussion question 1');
    expect(saved?.fields.dueDate).toMatchObject({ iso: '2026-09-06', time: '23:59' });

    const second = await service.syncCalendarFeed(fetcher, '2026-09-02T12:00:00Z');
    expect(second).toMatchObject({ newItems: 0, changedItems: 0 });
    expect(second.unchanged).toBe(second.events);
    expect(await repo.listProposals('pending')).toHaveLength(0);
    expect(calls).toBe(2);
    expect((await service.calendarFeed())?.lastResult).toBe(`0 new, 0 changed, ${second.unchanged} already saved`);
  });

  it('reports a changed deadline from the feed for review', async () => {
    const { service, repo } = await setupWithModules();
    await service.saveCalendarFeed('https://school.instructure.com/feeds/calendars/user_x.ics');
    await service.syncCalendarFeed(async () => fixture('canvas-feed.ics'));
    await approveAll(service);
    const moved = fixture('canvas-feed.ics').replace('DTSTART:20260914T045900Z', 'DTSTART:20260916T045900Z');
    const r = await service.syncCalendarFeed(async () => moved);
    expect(r.changedItems).toBe(1);
    const p = (await repo.listProposals('pending'))[0];
    expect(p.candidate.fields.title).toBe('Week 2: Writing Assignment');
    expect(p.changes[0].newValue).toMatchObject({ iso: '2026-09-15' });
  });
});
