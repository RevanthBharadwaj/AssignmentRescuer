import { describe, expect, it } from 'vitest';
import { makeService } from './helpers';

describe('ensureCourses', () => {
  it('creates a course for a code that only appears on an assignment, once', async () => {
    const { service } = await makeService();
    await service.saveTyped('assignment', { title: 'Unit 5: Discussion Question 1', courseCode: 'BUS 719A', dueDate: { iso: '2026-11-14', month: 11, day: 14, year: 2026, time: null, raw: 'Nov 14' } as never }, null);
    expect(await service.ensureCourses()).toBe(1);
    expect(await service.ensureCourses()).toBe(0);
    const courses = (await service.repository.listRecords()).filter((r) => r.entityType === 'course');
    expect(courses.map((c) => c.fields.code)).toEqual(['BUS 719A']);
  });
});

describe('removeCourse', () => {
  it('removes the course and everything saved under it, and it does not come back', async () => {
    const { service } = await makeService();
    const due = { iso: '2026-11-14', month: 11, day: 14, year: 2026, time: null, raw: 'Nov 14' } as never;
    const course = await service.addCourse({ code: 'BUS 719A', name: 'Business Ethics', instructor: 'Dr. Lee' });
    await service.saveTyped('assignment', { title: 'Unit 5', courseCode: 'BUS 719A', dueDate: due }, null);
    await service.addCourse({ code: 'BUS 799', name: null, instructor: null });
    await service.saveTyped('assignment', { title: 'Unit 12', courseCode: 'BUS 799', dueDate: due }, null);
    expect(await service.removeCourse(course.id)).toBe(1);
    await service.ensureCourses();
    const left = await service.repository.listRecords();
    expect(left.filter((r) => r.fields.courseCode === 'BUS 719A' || r.fields.code === 'BUS 719A')).toEqual([]);
    expect(left.some((r) => r.fields.title === 'Unit 12')).toBe(true);
  });
});
