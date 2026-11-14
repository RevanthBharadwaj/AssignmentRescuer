import { runImport } from '../src/core/pipeline';
import { looksLikeModuleList } from '../src/core/extract/canvas';
import { fixture } from './helpers';

const deps = () => ({ existingSourceHashes: new Map<string, string>(), confirmedRecords: [], context: {} });
const iso = (v: unknown) => (v as { iso: string | null } | null)?.iso ?? null;

async function importCanvas(hints = { course: 'DSC 6400', semester: 'Fall 2026' }) {
  const r = await runImport([{ kind: 'text', text: fixture('canvas-modules.txt'), hints }], deps());
  return { r, recs: r.sources[0].records };
}

describe('LMS module list (Canvas) import', () => {
  it('recognises a copied module list and ignores other text', () => {
    expect(looksLikeModuleList(fixture('canvas-modules.txt'))).toBe(true);
    expect(looksLikeModuleList(fixture('syllabus.txt'))).toBe(false);
  });

  it('pairs each title with the date and points on the following lines', async () => {
    const { recs } = await importCanvas();
    const items = recs.filter((r) => r.entityType === 'assignment' && r.fields.dueDate);
    expect(items.map((r) => [r.fields.title, iso(r.fields.dueDate), r.fields.pointsPossible, r.fields.type])).toEqual([
      ['Meet Your Classmates', '2026-09-01', null, 'discussion'],
      ['Week 1: Discussion Question 1', '2026-09-06', 15, 'discussion'],
      ['Week 1: Discussion Question 2', '2026-09-06', 15, 'discussion'],
      ['Week 2: Discussion Question 1', '2026-09-13', 15, 'discussion'],
      ['Week 2: Writing Assignment', '2026-09-13', 100, 'essay'],
      ['Final Exam', '2026-12-12', 200, 'exam'],
      ['Week 15: Final Research Paper', '2026-12-14', 300, 'paper'],
    ]);
    expect(items.every((r) => r.fields.courseCode === 'DSC 6400' && r.flags.length === 0)).toBe(true);
  });

  it('files readings, lectures, documents and forums as course materials with their unit', async () => {
    const { recs } = await importCanvas();
    const mats = recs.filter((r) => r.entityType === 'course_material' && r.fields.kind !== 'note');
    expect(mats.map((r) => [r.fields.title, r.fields.kind, r.fields.unit])).toEqual([
      ['Course Handbook.pdf', 'file', null],
      ['Ask the Instructor', 'forum', null],
      ['Week 1: Readings', 'reading', 'Week 1'],
      ['Foundations of Data Ethics.pdf', 'reading_file', 'Week 1'],
      ['Week 1: Lecture', 'lecture', 'Week 1'],
      ['Week 2: Lecture', 'lecture', 'Week 2'],
    ]);
  });

  it('never extracts Canvas interface text', async () => {
    const { recs } = await importCanvas();
    const all = JSON.stringify(recs.map((r) => r.fields));
    for (const noise of ['Context Module', 'Marked done', 'Module item', 'Complete All Items', 'Module Locked', 'Prerequisites']) {
      expect(all).not.toContain(noise);
    }
  });

  it('turns projects named in reminders into undated items with a due note', async () => {
    const { recs } = await importCanvas();
    const p = recs.find((r) => r.fields.title === 'Project 1: Ethics Case Brief')!;
    expect(p.fields).toMatchObject({ type: 'project', dueDate: null, dueNote: 'Due next week (mentioned in Week 1)' });
    expect(p.flags).toContain('missing_date');
  });

  it('keeps similarly named items in different units apart', async () => {
    const { r } = await importCanvas();
    expect(r.proposals.every((p) => p.kind === 'create')).toBe(true);
    const lectures = r.proposals.filter((p) => String(p.candidate.fields.title).endsWith('Lecture'));
    expect(lectures).toHaveLength(2);
  });

  it('flags missing years when no semester is known, and resolves them from a term code', async () => {
    const { recs } = await importCanvas({ course: 'DSC 6400' } as never);
    expect(recs.find((r) => r.fields.title === 'Final Exam')?.flags).toContain('missing_year');
    const withTerm = await runImport([
      { kind: 'text', text: `2026FA DSC-6400-01\n${fixture('canvas-modules.txt')}`, hints: { course: 'DSC 6400' } },
    ], deps());
    expect(iso(withTerm.sources[0].records.find((r) => r.fields.title === 'Final Exam')?.fields.dueDate)).toBe('2026-12-12');
  });

  it('flags the line with planted instructions without acting on it', async () => {
    const { r } = await importCanvas();
    expect(r.sources[0].source.securityFlags.some((f) => f.kind === 'prompt_injection_pattern')).toBe(true);
    expect(r.proposals.every((p) => p.status === 'pending')).toBe(true);
  });

  it('marks items without a course when none was chosen', async () => {
    const { recs } = await importCanvas({ semester: 'Fall 2026' } as never);
    expect(recs.find((r) => r.fields.title === 'Final Exam')?.flags).toContain('course_unassigned');
  });
});

describe('module headings', () => {
  it('recognises two digit week numbers as modules', async () => {
    const text = fixture('canvas-modules.txt').replace(/WEEK 1\b/g, 'WEEK 11').replace(/Week 1:/g, 'Week 11:');
    const r = await runImport([{ kind: 'text', text, hints: { course: 'DSC 6400', semester: 'Fall 2026' } }], deps());
    const pdf = r.sources[0].records.find((x) => x.fields.title === 'Foundations of Data Ethics.pdf')!;
    expect(pdf.fields.unit).toBe('Week 11');
  });
});

describe('matching regressions', () => {
  it('does not read stray letters as an instructor name', async () => {
    const r = await runImport([{ kind: 'text', text: 'MGT 6200 Leadership\nQuestions for the Professor\nPost questions for instructors.' }], deps());
    expect(r.sources[0].records.find((x) => x.entityType === 'course')?.fields.instructor).toBeNull();
  });
});
