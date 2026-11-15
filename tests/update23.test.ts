import { describe, expect, it } from 'vitest';
import { makeService } from './helpers';
import { sameCourse } from '../src/core/util';
import { searchSources } from '../src/core/search';
import { zoneLabel, zoneNow } from '../src/core/timezone';
import { attachmentText, pageRange, usedIn } from '../src/core/materials';
import { buildAssignmentContext } from '../src/core/courseContent';

const due = (iso: string, time: string | null = '23:59') => { const [y, m, d] = iso.split('-').map(Number); return { iso, month: m, day: d, year: y, time, raw: iso } as never; };

describe('one course, not two', () => {
  it('knows BUS 719 and BUS 719A are the same course but 719A and 719B are not', () => {
    expect(sameCourse('BUS 719', 'BUS 719A')).toBe(true);
    expect(sameCourse('bus719a', 'BUS 719')).toBe(true);
    expect(sameCourse('BUS 719A', 'BUS 719B')).toBe(false);
    expect(sameCourse('BUS 719', 'MGT 719')).toBe(false);
  });

  it('adding BUS 719A when BUS 719 exists reuses it, and imports under 719A land in 719', async () => {
    const { service, repo } = await makeService();
    await service.addCourse({ code: 'BUS 719', name: 'Issues in Management', instructor: null });
    await service.addCourse({ code: 'BUS 719A', name: null, instructor: 'Dr. Lee' });
    const courses = await repo.listRecords('course');
    expect(courses.map((c) => c.fields.code)).toEqual(['BUS 719']);
    expect(courses[0].fields.instructor).toBe('Dr. Lee');
    const a = await service.saveTyped('assignment', { title: 'Unit 2 Discussion 1', courseCode: 'BUS 719A', dueDate: due('2026-11-20') }, null);
    expect(a.fields.courseCode).toBe('BUS 719');
  });

  it('merges two existing courses, moves the work, skips copies, and undo brings it all back', async () => {
    const { service, repo } = await makeService();
    const keep = await service.addCourse({ code: 'BUS 719', name: 'Issues in Management', instructor: null });
    await service.saveTyped('assignment', { title: 'Unit 2 Discussion 1', courseCode: 'BUS 719', dueDate: due('2026-11-20') }, null);
    // Make the second course directly in the database, as older versions could have.
    const drop = await repo.saveGenerated({ entityType: 'course', key: 'BUS 719A', fields: { code: 'BUS 719A', name: null, instructor: 'Dr. Lee', semester: null }, unknownFields: [], evidence: [] });
    await repo.saveGenerated({ entityType: 'assignment', key: 'BUS 719A|unit 2 discussion 1', fields: { title: 'Unit 2 Discussion 1', courseCode: 'BUS 719A', dueDate: due('2026-11-20') }, unknownFields: [], evidence: [] });
    await repo.saveGenerated({ entityType: 'assignment', key: 'BUS 719A|unit 5 paper', fields: { title: 'Unit 5 Paper', courseCode: 'BUS 719A', dueDate: due('2026-12-01') }, unknownFields: [], evidence: [] });
    const s = (await service.suggestions('2026-11-14')).find((x) => x.kind === 'course_duplicate')!;
    expect(s.title).toContain('same course');
    const r = await service.applySuggestion(s);
    const after = await repo.listRecords();
    expect(after.filter((x) => x.entityType === 'course').map((c) => c.fields.code)).toEqual(['BUS 719']);
    expect(after.filter((x) => x.entityType === 'assignment').map((x) => `${x.fields.title}|${x.fields.courseCode}`).sort()).toEqual(['Unit 2 Discussion 1|BUS 719', 'Unit 5 Paper|BUS 719']);
    expect((await repo.getRecord(keep.id))!.fields.instructor).toBe('Dr. Lee');
    await service.undo(r.undoId!);
    const back = await repo.listRecords();
    expect(back.filter((x) => x.entityType === 'course').map((c) => c.fields.code).sort()).toEqual(['BUS 719', 'BUS 719A']);
    expect(back.filter((x) => x.entityType === 'assignment')).toHaveLength(3);
    expect(back.find((x) => x.id === drop.id)).toBeTruthy();
  });

  it('ensureCourses folds work under a variant code into the saved course instead of making a new one', async () => {
    const { service, repo } = await makeService();
    await service.addCourse({ code: 'BUS 719', name: 'Management', instructor: null });
    await repo.saveGenerated({ entityType: 'assignment', key: 'BUS 719A|x', fields: { title: 'X', courseCode: 'BUS 719A', dueDate: due('2026-11-20') }, unknownFields: [], evidence: [] });
    expect(await service.ensureCourses()).toBe(0);
    expect((await repo.listRecords('course')).map((c) => c.fields.code)).toEqual(['BUS 719']);
    expect((await repo.listRecords('assignment'))[0].fields.courseCode).toBe('BUS 719');
  });
});

describe('modules on the course home', () => {
  it('deletes one module with undo', async () => {
    const { service, repo } = await makeService();
    await service.addCourse({ code: 'BUS 1', name: 'B', instructor: 'P' });
    await service.saveTyped('assignment', { title: 'Unit 2 Discussion 1', courseCode: 'BUS 1', unit: 'Unit 2', dueDate: due('2026-11-20') }, null);
    await service.saveTyped('assignment', { title: 'Unit 3 Paper', courseCode: 'BUS 1', unit: 'Unit 3', dueDate: due('2026-11-27') }, null);
    expect(await service.deleteUnit('BUS 1', 2)).toBe(1);
    expect((await repo.listRecords('assignment')).map((a) => a.fields.title)).toEqual(['Unit 3 Paper']);
    await service.undo((await service.undoList()).pop()!.id);
    expect(await repo.listRecords('assignment')).toHaveLength(2);
  });
});

describe('search inside files', () => {
  const src = (id: string, name: string, text: string, pageOffsets?: number[]) => ({ id, originalName: name, text, hints: { course: 'BUS 1' }, format: 'pdf', pageOffsets } as never);
  it('finds words in PDFs with their page, ignoring case and accents, and exact phrases', () => {
    const page2 = 'Chapter 2 covers transformational leadership in organizations.';
    const text = `Chapter 1 is about teams.\n${page2}`;
    const hits = searchSources([src('a', 'Leadership in Organizations.pdf', text, [0, text.indexOf('Chapter 2')]), src('b', 'Other.pdf', 'nothing relevant')], 'LEADERSHIP organisations');
    expect(hits).toHaveLength(0); // "organisations" is not in the text
    const ok = searchSources([src('a', 'Leadership in Organizations.pdf', text, [0, text.indexOf('Chapter 2')]), src('b', 'Other.pdf', 'nothing relevant')], 'Leadership organizations');
    expect(ok.map((h) => h.name)).toEqual(['Leadership in Organizations.pdf']);
    expect(ok[0].page).toBe(2);
    expect(searchSources([src('a', 'A.pdf', 'Transformational leadership matters')], '"transformational leadership"')).toHaveLength(1);
    expect(searchSources([src('a', 'A.pdf', 'Café culture')], 'cafe')).toHaveLength(1);
  });
});

describe('school time zone', () => {
  it('shows school time wherever the device is', () => {
    const instant = new Date('2026-11-15T05:30:00Z'); // 11:30 PM Saturday in Chicago, 9:30 PM in Seattle
    const chicago = zoneNow('America/Chicago', instant);
    expect(chicago.date).toBe('2026-11-14');
    expect(chicago.time).toBe('23:30');
    expect(chicago.weekday).toBe(6);
    expect(zoneNow('America/Los_Angeles', instant).time).toBe('21:30');
    expect(zoneNow('Nope/Nowhere', instant).date).toBe('2026-11-14'); // falls back to Central
    expect(zoneLabel('America/Chicago', instant)).toBe('CST');
  });
});

describe('done, dates, notes and notices', () => {
  it('marks done and undoes it; overriding a date can be undone', async () => {
    const { service, repo } = await makeService();
    await service.addCourse({ code: 'BUS 1', name: 'B', instructor: 'P' });
    const a = await service.saveTyped('assignment', { title: 'Unit 2 Discussion 1', courseCode: 'BUS 1', dueDate: due('2026-11-20') }, null);
    await service.markDone(a.id);
    expect((await repo.getRecord(a.id))!.fields.status).toBe('submitted');
    await service.undo((await service.undoList()).pop()!.id);
    expect((await repo.getRecord(a.id))!.fields.status ?? null).toBe(null);
    await service.overrideDueDate(a.id, '2026-11-25', '17:00');
    const changed = (await repo.getRecord(a.id))!.fields;
    expect(changed.dueDate).toMatchObject({ iso: '2026-11-25', time: '17:00' });
    expect(changed.dueOverridden).toBe(true);
    await service.undo((await service.undoList()).pop()!.id);
    expect((await repo.getRecord(a.id))!.fields.dueDate).toMatchObject({ iso: '2026-11-20' });
    await expect(service.overrideDueDate(a.id, '', null)).rejects.toThrow(/date/);
  });

  it('keeps sticky notes, deletes with undo', async () => {
    const { service } = await makeService();
    const n = await service.saveSticky({ text: 'Ask about chapter 2', courseCode: 'BUS 1' });
    await service.saveSticky({ id: n.id, color: 'blue' });
    expect((await service.stickies())[0]).toMatchObject({ text: 'Ask about chapter 2', color: 'blue', courseCode: 'BUS 1' });
    const before = await service.deleteSticky(n.id);
    expect(await service.stickies()).toEqual([]);
    await service.restoreStickies(before);
    expect(await service.stickies()).toHaveLength(1);
  });

  it('lists overdue, today and tomorrow, and read ones go away', async () => {
    const { service } = await makeService();
    await service.addCourse({ code: 'BUS 1', name: 'B', instructor: 'P' });
    await service.saveTyped('assignment', { title: 'Late one', courseCode: 'BUS 1', dueDate: due('2026-11-12') }, null);
    await service.saveTyped('assignment', { title: 'Today one', courseCode: 'BUS 1', dueDate: due('2026-11-14') }, null);
    await service.saveTyped('assignment', { title: 'Tomorrow one', courseCode: 'BUS 1', dueDate: due('2026-11-15') }, null);
    await service.saveTyped('assignment', { title: 'Far one', courseCode: 'BUS 1', dueDate: due('2026-12-15') }, null);
    const list = await service.notices('2026-11-14');
    expect(list.map((n) => n.tone)).toEqual(expect.arrayContaining(['overdue', 'today', 'soon']));
    expect(list.some((n) => n.text.includes('Far one'))).toBe(false);
    expect(list.find((n) => n.tone === 'today')!.text).toContain('11:59 PM');
    await service.markNoticesRead(list.map((n) => n.id));
    expect(await service.notices('2026-11-14')).toEqual([]);
    expect((await service.notices('2026-11-15')).length).toBeGreaterThan(0); // a new day brings new notices
  });
});

describe('a course is a project of files', () => {
  it('one file serves two assignments with different notes, and the assistant reads attached files first', async () => {
    const { service, repo } = await makeService();
    await service.addCourse({ code: 'BUS 1', name: 'B', instructor: 'P' });
    const d2 = await service.saveTyped('assignment', { title: 'Unit 2 Discussion 1', courseCode: 'BUS 1', dueDate: due('2026-11-20') }, null);
    const d5 = await service.saveTyped('assignment', { title: 'Unit 5 Discussion 1', courseCode: 'BUS 1', dueDate: due('2026-12-04') }, null);
    const r = await service.importForCourse('BUS 1', [{ kind: 'text', label: 'Leadership in Organizations', text: 'Chapter 1 sets out leadership theory.\nChapter 5 covers motivation and power.', hints: { material: 'reading' } } as never]);
    const src = r.sources[0].source;
    await service.attachMaterial(src.id, d2.id, 'Chapters 1 and 2');
    await service.attachMaterial(src.id, d5.id, 'Chapters 5 and 6');
    await service.attachMaterial(src.id, d5.id, 'Chapters 5 and 6, pages 40 to 60'); // changing the note does not duplicate
    const links = await service.materialLinks();
    expect(links).toHaveLength(2);
    const all = await repo.listRecords();
    expect(usedIn(src.id, links, all.filter((x) => x.entityType === 'assignment')).map((u) => u.note).sort()).toEqual(['Chapters 1 and 2', 'Chapters 5 and 6, pages 40 to 60']);
    const ctx2 = buildAssignmentContext(d2, all, await repo.listSources(), links);
    expect(ctx2.readings[0].title).toBe('Leadership in Organizations: Chapters 1 and 2');
    const ctx5 = buildAssignmentContext(d5, all, await repo.listSources(), links);
    expect(ctx5.readings[0].title).toContain('pages 40 to 60');
    const found = await service.passagesFor('BUS 1', 'motivation and power', { ollamaUrl: '' } as never, undefined, d5.id);
    expect(found[0].text).toContain('Chapters 5 and 6');
    await service.detachMaterial(src.id, d2.id);
    expect(await service.materialLinks()).toHaveLength(1);
  });

  it('reads a page range from a note', () => {
    expect(pageRange('pages 10 to 20')).toEqual([10, 20]);
    expect(pageRange('pp. 5-9')).toEqual([5, 9]);
    expect(pageRange('page 7')).toEqual([7, 7]);
    expect(pageRange('Chapters 1 and 2')).toBeNull();
    const text = 'AAA' + 'BBB' + 'CCC';
    const source = { id: 's', text, pageOffsets: [0, 3, 6] } as never;
    expect(attachmentText({ source, note: 'pages 2 to 2' })).toBe('BBB');
    expect(attachmentText({ source, note: 'Chapters 1 and 2' })).toBe(text);
  });
});
