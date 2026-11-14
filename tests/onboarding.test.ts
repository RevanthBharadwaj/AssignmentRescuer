import { approveAll, fixture, makeService } from './helpers';
import { analyseAssignment } from '../src/core/assignments/checklist';

describe('semester onboarding', () => {
  it('starts with the first question and resumes where it stopped', async () => {
    const { service } = await makeService();
    let st = await service.onboarding();
    expect(st.complete).toBe(false);
    expect(st.nextQuestion?.id).toBe('university');
    await service.import([{ kind: 'manual', entityType: 'university', fields: { name: 'University of North Florida', program: null, academicYear: null } }]);
    await approveAll(service);
    st = await service.onboarding();
    expect(st.nextQuestion?.id).toBe('program');
  });

  it('is answered entirely from an uploaded syllabus without manual entry', async () => {
    const { service } = await makeService();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    await approveAll(service);
    const st = await service.onboarding();
    expect(st.complete).toBe(true);
    expect(Object.fromEntries(st.questions.map((q) => [q.id, q.answer]))).toEqual({
      university: 'University of North Florida',
      program: 'Master of Science in Computing and Information Sciences',
      semester: 'Fall 2026',
      semester_start: '2026-08-24',
      semester_end: '2026-12-11',
      semester_length: '16 weeks',
      subjects: 'CIS 6930 Applied Machine Learning',
    });
  });
});

describe('assignment intelligence', () => {
  it('builds a requirements checklist with rubric items and lists missing information', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }, { kind: 'text', text: fixture('assignment.txt') }, { kind: 'text', text: fixture('rubric.txt') }]);
    await approveAll(service);
    const a = (await repo.listRecords('assignment')).find((r) => String(r.fields.title).startsWith('Literature Review'))!;
    const rubric = (await repo.listRecords('rubric_criterion')).filter((r) => r.fields.assignmentKey === a.key);
    const res = analyseAssignment(a, rubric);
    const texts = res.checklist.map((c) => c.text);
    expect(texts).toEqual(expect.arrayContaining([
      'Submit by Oct 4, 2026 at 11:59 PM ET',
      'Write 1500 to 2000 words',
      'Use at least 5 scholarly sources',
      'Format citations in APA 7',
      'Rubric: Use of Sources (30 pts)',
    ]));
    expect(res.missing).toEqual([]);
  });

  it('asks about missing details', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'text', text: 'Essay\nInstructions: Write an essay on ethics.\nDue Oct 3 at 5 pm' }]);
    await approveAll(service);
    const res = analyseAssignment((await repo.listRecords('assignment'))[0]);
    expect(res.missing).toEqual(expect.arrayContaining(['Length requirement', 'Citation style', 'Points possible', 'Course', 'Grading rubric']));
    expect(res.questions).toEqual(expect.arrayContaining(['Which year is the due date in?', 'Which time zone is the due time in?', 'Which course is this assignment for?']));
  });
});
