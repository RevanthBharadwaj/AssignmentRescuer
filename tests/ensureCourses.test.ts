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
