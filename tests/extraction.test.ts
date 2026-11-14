import { runImport } from '../src/core/pipeline';
import type { ExtractedRecord } from '../src/core/types';
import { fixture } from './helpers';

const deps = () => ({ existingSourceHashes: new Map<string, string>(), confirmedRecords: [], context: {} });
const iso = (v: unknown) => (v as { iso: string | null } | null)?.iso ?? null;

async function extract(...texts: string[]): Promise<ExtractedRecord[]> {
  const r = await runImport(texts.map((text) => ({ kind: 'text' as const, text })), deps());
  return r.sources.flatMap((s) => s.records);
}

describe('syllabus extraction', () => {
  let recs: ExtractedRecord[];
  beforeAll(async () => { recs = await extract(fixture('syllabus.txt')); });
  const find = (type: string, title: string) => recs.find((r) => r.entityType === type && String(r.fields.title ?? r.fields.name ?? r.fields.code).includes(title));

  it('extracts university, program and semester window', () => {
    expect(find('university', 'North Florida')?.fields.program).toBe('Master of Science in Computing and Information Sciences');
    const sem = recs.find((r) => r.entityType === 'semester')!;
    expect(sem.fields.name).toBe('Fall 2026');
    expect(iso(sem.fields.startDate)).toBe('2026-08-24');
    expect(iso(sem.fields.endDate)).toBe('2026-12-11');
    expect(sem.fields.durationWeeks).toBe(16);
  });

  it('extracts the course with instructor', () => {
    expect(recs.find((r) => r.entityType === 'course')?.fields).toMatchObject({ code: 'CIS 6930', name: 'Applied Machine Learning', instructor: 'Dr. Jane Rivera' });
  });

  it('extracts breaks, modules, readings and exams', () => {
    const brk = recs.find((r) => r.entityType === 'academic_break')!;
    expect([iso(brk.fields.startDate), iso(brk.fields.endDate)]).toEqual(['2026-11-25', '2026-11-27']);
    expect(find('timeline_event', 'Week 1')?.fields.kind).toBe('module');
    expect(iso(find('timeline_event', 'Read Chapter 1')?.fields.date)).toBe('2026-08-26');
    expect(iso(find('timeline_event', 'Midterm')?.fields.date)).toBe('2026-10-14');
  });

  it('splits discussion posts and peer replies into separate deadlines', () => {
    const d = find('assignment', 'Discussion 1')!;
    const p = recs.find((r) => r.fields.type === 'peer_reply')!;
    expect(iso(d.fields.dueDate)).toBe('2026-08-26');
    expect(iso(p.fields.dueDate)).toBe('2026-08-30');
    expect((p.fields.dueDate as { timeZone: string }).timeZone).toBe('ET');
  });

  it('distinguishes availability dates from due dates', () => {
    const q = find('assignment', 'Quiz 1')!;
    expect(iso(q.fields.availableDate)).toBe('2026-09-07');
    expect(iso(q.fields.dueDate)).toBe('2026-09-13');
  });

  it('extracts points and flags a time with no zone', () => {
    expect(find('assignment', 'Homework 1')?.fields.pointsPossible).toBe(50);
    expect(find('assignment', 'Final Project')?.flags).toContain('ambiguous_time_zone');
  });

  it('keeps line level provenance for every record', () => {
    for (const r of recs) {
      expect(r.provenance.sourceId).toMatch(/^src_/);
      expect(r.provenance.extractionMethod).toBe('deterministic_text');
      expect(r.provenance.confirmationStatus).toBe('pending');
    }
    const hw = find('assignment', 'Homework 1')!;
    expect(hw.provenance.textLocation?.line).toBe(15);
    expect(hw.provenance.excerpt).toContain('Homework 1 due Sep 6');
  });
});

describe('assignment instruction extraction', () => {
  it('extracts requirements from a full assignment description', async () => {
    const recs = await extract(fixture('syllabus.txt'), fixture('assignment.txt'));
    const a = recs.find((r) => r.entityType === 'assignment' && String(r.fields.title).startsWith('Literature Review'))!;
    expect(a.fields).toMatchObject({
      courseCode: 'CIS 6930',
      pointsPossible: 100,
      wordCountMin: 1500,
      wordCountMax: 2000,
      requiredScholarlySources: 5,
      citationStyle: 'APA 7',
    });
    expect(iso(a.fields.dueDate)).toBe('2026-10-04');
    expect(a.fields.submissionRequirements).toEqual(expect.arrayContaining([expect.stringContaining('.docx')]));
    expect(a.unknownFields).toEqual(expect.arrayContaining(['pageCountMin', 'pageCountMax']));
  });

  it('flags missing dates and missing years instead of inventing them', async () => {
    const recs = await extract('Reflection Essay\nInstructions: Write a 500 word reflection on your learning.\nDue Oct 3');
    const a = recs.find((r) => r.entityType === 'assignment')!;
    expect(a.flags).toContain('missing_year');
    expect((a.fields.dueDate as { year: number | null }).year).toBeNull();
    const none = await extract('Essay\nInstructions: Write a 500 word essay about anything.');
    expect(none.find((r) => r.entityType === 'assignment')?.flags).toContain('missing_date');
  });

  it('flags an assignment with no identifiable course', async () => {
    const recs = await extract('Instructions: write a short report.\nReport due March 3, 2027');
    expect(recs.find((r) => r.entityType === 'assignment')?.flags).toContain('course_unassigned');
  });
});

describe('rubric extraction', () => {
  it('parses table rows with points and performance levels and links to the assignment', async () => {
    const recs = await extract(fixture('assignment.txt'), fixture('rubric.txt'));
    const crit = recs.filter((r) => r.entityType === 'rubric_criterion');
    expect(crit.map((c) => c.fields.criterion)).toEqual(['Thesis and Focus', 'Use of Sources', 'Organization', 'APA Formatting', 'Mechanics']);
    expect(crit.reduce((s, c) => s + Number(c.fields.maxPoints), 0)).toBe(100);
    expect(crit[0].fields.performanceLevels).toEqual(['Exemplary', 'Proficient']);
    expect(crit[0].fields.courseCode).toBe('CIS 6930');
    expect(crit[0].fields.assignmentKey).toBe('CIS 6930|literature review on fairness in machine learning');
  });

  it('parses parenthesised point formats', async () => {
    const recs = await extract('Rubric\n- Argument (40 points): Clear, supported claims\n- Evidence – 30 pts – relevant sources');
    const c = recs.filter((r) => r.entityType === 'rubric_criterion');
    expect(c.map((x) => [x.fields.criterion, x.fields.maxPoints])).toEqual([['Argument', 40], ['Evidence', 30]]);
  });
});

describe('multiple courses and research', () => {
  it('reads a course name with or without a separator', async () => {
    const recs = await extract('CIS 6930 Applied Machine Learning\nCOP 5615 - Distributed Systems');
    expect(recs.filter((r) => r.entityType === 'course').map((r) => r.fields.name)).toEqual(['Applied Machine Learning', 'Distributed Systems']);
  });

  it('assigns lines to the course heading they sit under', async () => {
    const recs = await extract('COP 5615 Distributed Systems\nLab 1 due Sep 10, 2026\nSTA 6166 Statistical Methods\nHomework 2 due Sep 12, 2026');
    const lab = recs.find((r) => r.fields.title === 'Lab 1')!;
    const hw = recs.find((r) => r.fields.title === 'Homework 2')!;
    expect(lab.fields.courseCode).toBe('COP 5615');
    expect(hw.fields.courseCode).toBe('STA 6166');
  });

  it('extracts DOIs as unverified research sources', async () => {
    const recs = await extract('Smith, J. (2021). Fair models. Journal of AI, 4(2). https://doi.org/10.1234/jai.2021.004');
    const r = recs.find((x) => x.entityType === 'research_source')!;
    expect(r.fields).toMatchObject({ doi: '10.1234/jai.2021.004', year: 2021, title: null });
    expect(r.provenance.verificationStatus).toBe('unverified');
  });
});
