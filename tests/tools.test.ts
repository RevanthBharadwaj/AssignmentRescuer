import { dueRange, pickTools, sourceQuery } from '../src/core/tools';
import { makeService } from './helpers';

describe('chat tool routing', () => {
  it('picks tools from plain wording and none for ordinary questions', () => {
    expect(pickTools('what is due today?', null).map((t) => t.id)).toEqual(['whats_due']);
    expect(pickTools('Find me sources on servant leadership', null)).toEqual([{ id: 'find_sources', arg: 'servant leadership' }]);
    expect(pickTools('is 10.1037/0033-2909.126.1.78 real', null)).toEqual([{ id: 'check_doi', arg: '10.1037/0033-2909.126.1.78' }]);
    expect(pickTools('explain the grading policy', null)).toEqual([]);
  });

  it('falls back to the assignment title when the request names no topic', () => {
    expect(sourceQuery('find sources', 'Unit 2: Writing Assignment')).toBe('Writing Assignment');
    expect(sourceQuery('find me some real sources', null)).toBe('');
  });

  it('turns wording about time into a date range', () => {
    expect(dueRange('what is due today', '2026-11-14')).toMatchObject({ from: '2026-11-14', to: '2026-11-14', label: 'today' });
    expect(dueRange('due tomorrow?', '2026-11-14')).toMatchObject({ from: '2026-11-15', to: '2026-11-15' });
    expect(dueRange('what is due this week', '2026-11-14')).toMatchObject({ from: '2026-11-14', to: '2026-11-20' });
    expect(dueRange('anything overdue', '2026-11-14').overdue).toBe(true);
    expect(dueRange('what is coming up', '2026-11-14').label).toBe('in the next two weeks');
  });
});

describe('whats_due tool', () => {
  it('lists what is due on a day with course and professor, and says when nothing is', async () => {
    const { service } = await makeService();
    await service.saveProfile('Example University', 'MS');
    await service.saveSemester({ name: 'Fall 2026', start: '2026-08-24', end: '2026-12-11' } as never).catch(() => undefined);
    const none = await service.runTool({ id: 'whats_due', arg: 'what is due today' }, { code: null, today: '2026-11-14', fetcher: async () => '' });
    expect(none.note).toBe('Nothing due today');
    expect(none.text).toContain('Nothing is due today');
  });
});
