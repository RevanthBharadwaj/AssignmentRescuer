import { approveAll, fixture, makeService } from './helpers';

async function course() {
  const { service, repo } = await makeService();
  await service.saveSemester({ name: 'Fall 2026', start: null, end: null });
  await service.addCourse({ code: 'DSC 6400', name: 'Data Ethics', instructor: null });
  await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
  await approveAll(service);
  return { service, repo };
}

describe('announcements', () => {
  it('only links to assignments you already have, and shows a different date as a change', async () => {
    const { service, repo } = await course();
    const before = (await repo.listRecords()).length;
    const r = await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('announcement-week2.txt'), hints: { material: 'announcement' } }]);
    // Discussion Question 1 matches Week 2: Discussion Question 1 on the same date: nothing to review.
    // Writing Assignment matches Week 2: Writing Assignment, but the date moved from Sep 13 to Sep 15.
    expect(r.proposals.map((p) => [p.kind, p.candidate.fields.title])).toEqual([['update', 'Week 2: Writing Assignment']]);
    expect((r.proposals[0].changes[0].newValue as { iso: string }).iso).toBe('2026-09-15');
    expect(r.skippedDuplicates).toBe(1);
    // No modules, courses, semesters or new assignments were proposed.
    await approveAll(service);
    expect((await repo.listRecords()).length).toBe(before);
    // The announcement itself is kept as an announcement for the course.
    const src = (await repo.listSources()).find((s) => s.text.startsWith('Welcome to Week 2!'))!;
    expect(src.hints).toMatchObject({ course: 'DSC 6400', material: 'announcement' });
  });

  it('proposes nothing for an announcement that only restates what is saved', async () => {
    const { service } = await course();
    const r = await service.importForCourse('DSC 6400', [{ kind: 'text', text: 'Reminder\nWeek 2: Discussion Question 1 is due September 13, 2026.', hints: { material: 'announcement' } }]);
    expect(r.proposals).toEqual([]);
  });

  it('does not show course and semester rows that are already saved when adding a syllabus to a course', async () => {
    const { service } = await course();
    const r = await service.importForCourse('DSC 6400', [{ kind: 'text', text: 'DSC 6400: Data Ethics\nFall 2026 Syllabus\nLab 9 due Oct 2, 2026', hints: { material: 'syllabus' } }]);
    expect(r.proposals.every((p) => p.kind !== 'duplicate')).toBe(true);
    expect(r.proposals.map((p) => p.candidate.fields.title).filter(Boolean)).toEqual(['Lab 9']);
  });
});
