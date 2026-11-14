import { buildAssignmentContext, mentionsAssignment, policySections, sourceKind, splitSections, type CourseSource } from '../src/core/courseContent';
import { approveAll, fixture, makeService } from './helpers';
import type { ConfirmedRecord } from '../src/core/types';

const src = (text: string, hints: Record<string, string> = {}, classifications: CourseSource['classifications'] = []): CourseSource => ({
  id: 'src_x', sourceType: 'pasted_text', format: 'plain_text', originalName: 'Pasted', importedAt: '2026-09-01T00:00:00Z',
  contentHash: 'h', text, byteSize: text.length, hints, securityFlags: [], classifications,
});
const rec = (fields: ConfirmedRecord['fields'], key = 'DSC 6400|x'): ConfirmedRecord => ({
  id: 'r', entityType: 'assignment', key, fields, unknownFields: [], evidence: [], confirmedAt: '', updatedAt: '',
});

describe('kinds of course material', () => {
  it('uses the kind the student chose, otherwise infers it', () => {
    expect(sourceKind(src('anything', { material: 'policy' }))).toBe('policy');
    expect(sourceKind(src(fixture('canvas-modules.txt')))).toBe('modules');
    expect(sourceKind(src('x', {}, [{ label: 'announcement', score: 5, evidence: [] }]))).toBe('announcement');
    expect(sourceKind(src('x', {}, [{ label: 'course_timeline', score: 9, evidence: [] }, { label: 'syllabus', score: 4, evidence: [] }]))).toBe('syllabus');
    expect(sourceKind(src('x', {}, [{ label: 'grading_rubric', score: 8, evidence: [] }]))).toBe('rubric');
  });
});

describe('syllabus sections', () => {
  it('splits a syllabus by its headings and tags policy topics', () => {
    const secs = splitSections(fixture('syllabus-policies.txt'));
    expect(secs.map((s) => s.heading)).toEqual(['DSC 6400: Data Ethics', 'Fall 2026 Syllabus', 'Course Description', 'Late Work Policy', 'Academic Integrity', 'Use of Artificial Intelligence', 'Writing Standards', 'Discussion Expectations', 'Grading Scale']);
    expect(secs.find((s) => s.heading === 'Use of Artificial Intelligence')?.topics).toContain('ai');
    expect(secs.find((s) => s.heading === 'Writing Standards')?.topics).toContain('format');
  });

  it('picks out the sections that state rules', () => {
    const p = policySections(src(fixture('syllabus-policies.txt'), { material: 'syllabus' }));
    expect(p.map((s) => s.heading)).toEqual(['Late Work Policy', 'Academic Integrity', 'Use of Artificial Intelligence', 'Writing Standards', 'Discussion Expectations', 'Grading Scale']);
  });
});

describe('finding mentions of an assignment', () => {
  const a = rec({ title: 'Week 2: Writing Assignment', type: 'essay' });
  it('matches the title, or the same numbers with the same kind of work', () => {
    expect(mentionsAssignment('Reminder: the Week 2 writing assignment now needs four sources.', a)).toBe(true);
    expect(mentionsAssignment('Week 2: Writing Assignment is extended.', a)).toBe(true);
    expect(mentionsAssignment('The Week 3 writing assignment opens Friday.', a)).toBe(false);
    expect(mentionsAssignment('Week 2 discussion replies are due Sunday.', a)).toBe(false);
  });
  it('matches projects by their name', () => {
    expect(mentionsAssignment('Rough draft of the Major Project: Ethics Audit is due in Week 6.', rec({ title: 'Major Project: Ethics Audit' }))).toBe(true);
  });
});

describe('assignment context', () => {
  it('pulls instructions, policies, announcements and unit readings for an assignment', async () => {
    const { service, repo } = await makeService();
    await service.saveSemester({ name: 'Fall 2026', start: null, end: null });
    await service.addCourse({ code: 'DSC 6400', name: 'Data Ethics', instructor: null });
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('syllabus-policies.txt'), hints: { material: 'syllabus' } }]);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: 'Week 2 writing assignment update\nHi class, the Week 2 writing assignment now needs four scholarly sources.', hints: { material: 'announcement' } }]);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: 'Unrelated news\nThe library is closed Monday.', hints: { material: 'announcement' } }]);
    await approveAll(service);
    const records = await repo.listRecords();
    const a = records.find((r) => r.fields.title === 'Week 2: Writing Assignment')!;
    const ctx = buildAssignmentContext(a, records, await repo.listSources());
    expect(ctx.policies.map((p) => p.title).slice(0, 4)).toEqual(['Writing Standards', 'Academic Integrity', 'Use of Artificial Intelligence', 'Late Work Policy']);
    expect(ctx.policies.every((p) => p.sourceName && p.location)).toBe(true);
    expect(ctx.announcements.map((x) => x.title)).toEqual(['Week 2 writing assignment update']);
    expect(ctx.readings.map((x) => x.title)).toEqual(['Week 2: Lecture']);

    const d = records.find((r) => r.fields.title === 'Week 1: Discussion Question 1')!;
    const dctx = buildAssignmentContext(d, records, await repo.listSources());
    expect(dctx.policies[0].title).toBe('Discussion Expectations');
    expect(dctx.readings.map((x) => x.title).sort()).toEqual(['Foundations of Data Ethics.pdf', 'Project 1: Ethics Case Brief is due next week.', 'Week 1: Lecture', 'Week 1: Readings']);
  });

  it('attaches instructions and a rubric to the assignment the student picked', async () => {
    const { service, repo } = await makeService();
    await service.saveSemester({ name: 'Fall 2026', start: null, end: null });
    await service.addCourse({ code: 'DSC 6400', name: 'Data Ethics', instructor: null });
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);
    const target = (await repo.listRecords('assignment')).find((r) => r.fields.title === 'Week 2: Writing Assignment')!;
    const r = await service.importForCourse('DSC 6400', [{
      kind: 'text',
      text: 'Ethics Reflection\nInstructions: Write a 900-1,200 word reflection on a data practice you have seen. Use at least three peer-reviewed sources in APA 7 format.\nRubric\n- Analysis (60 points): depth of ethical analysis\n- Sources (40 points): quality of sources',
      hints: { material: 'instructions', assignmentKey: target.key, assignmentTitle: String(target.fields.title) },
    }]);
    const upd = r.proposals.find((p) => p.entityType === 'assignment')!;
    expect(upd.kind).toBe('update');
    expect(upd.targetRecordId).toBe(target.id);
    expect(upd.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['wordCountMin', 'requiredScholarlySources', 'citationStyle', 'instructions']));
    await approveAll(service);
    const after = await repo.getRecord(target.id);
    expect(after?.fields).toMatchObject({ title: 'Week 2: Writing Assignment', wordCountMin: 900, wordCountMax: 1200, requiredScholarlySources: 3, citationStyle: 'APA 7' });
    const rubric = (await repo.listRecords('rubric_criterion')).filter((x) => x.fields.assignmentKey === target.key);
    expect(rubric.map((x) => x.fields.criterion).sort()).toEqual(['Analysis', 'Sources']);
    const ctx = buildAssignmentContext(after!, await repo.listRecords(), await repo.listSources());
    expect(ctx.instructions).toHaveLength(1);
    expect(ctx.rubric).toHaveLength(2);
  });
});
