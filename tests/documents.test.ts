import { extractText, NeedsOcrError } from '../src/core/input/extractors';
import { detectFormat } from '../src/core/input/formatDetection';
import { runImport } from '../src/core/pipeline';
import { fixtureBytes } from './helpers';

const deps = () => ({ existingSourceHashes: new Map<string, string>(), confirmedRecords: [], context: {} });
const iso = (v: unknown) => (v as { iso: string | null } | null)?.iso ?? null;

describe('PDF import', () => {
  it('reads text PDFs line by line, rejoining runs drawn separately', async () => {
    const ex = await extractText('pdf', fixtureBytes('syllabus.pdf'));
    expect(ex.method).toBe('document_parser');
    expect(ex.pageOffsets).toHaveLength(2);
    expect(ex.text).toContain('Homework 1 due Sep 6 at 11:59 PM ET (50 points)');
    expect(ex.text.split('\n')[0]).toBe('DSC 6400: Data Ethics');
  });

  it('extracts the syllabus with the page each item came from', async () => {
    const r = await runImport([{ kind: 'file', name: 'syllabus.pdf', bytes: fixtureBytes('syllabus.pdf') }], deps());
    expect(r.errors).toEqual([]);
    const recs = r.sources[0].records;
    const sem = recs.find((x) => x.entityType === 'semester')!;
    expect([iso(sem.fields.startDate), iso(sem.fields.endDate)]).toEqual(['2026-08-24', '2026-12-11']);
    expect(sem.provenance.page).toBe(1);
    const hw = recs.find((x) => x.fields.title === 'Homework 1')!;
    expect(hw.fields).toMatchObject({ courseCode: 'DSC 6400', pointsPossible: 50 });
    expect(iso(hw.fields.dueDate)).toBe('2026-09-06');
    expect(hw.provenance.page).toBe(2);
    expect(hw.provenance.extractionMethod).toBe('deterministic_text');
  });

  it('reports scanned PDFs honestly instead of returning nothing', async () => {
    await expect(extractText('pdf', fixtureBytes('scanned.pdf'))).rejects.toThrow(NeedsOcrError);
    const r = await runImport([{ kind: 'file', name: 'scan.pdf', bytes: fixtureBytes('scanned.pdf') }], deps());
    expect(r.errors[0]).toMatchObject({ reason: 'needs_ocr' });
  });
});

describe('Word import', () => {
  it('detects .docx and keeps table rows as rows', async () => {
    expect(detectFormat('assignment.docx', fixtureBytes('assignment.docx'))).toBe('docx');
    const ex = await extractText('docx', fixtureBytes('assignment.docx'));
    expect(ex.text).toContain('Assignment: Privacy Impact Assessment');
    expect(ex.text).toContain('Risk Analysis | 60 | Identifies and weighs privacy risks');
  });

  it('extracts assignment requirements and the rubric from a Word file', async () => {
    const r = await runImport([{ kind: 'file', name: 'assignment.docx', bytes: fixtureBytes('assignment.docx') }], deps());
    const recs = r.sources[0].records;
    const a = recs.find((x) => x.entityType === 'assignment')!;
    expect(a.fields).toMatchObject({
      title: 'Privacy Impact Assessment', courseCode: 'DSC 6400', pointsPossible: 150,
      wordCountMin: 1200, wordCountMax: 1500, requiredScholarlySources: 4, citationStyle: 'APA 7',
    });
    expect(iso(a.fields.dueDate)).toBe('2026-11-22');
    const rubric = recs.filter((x) => x.entityType === 'rubric_criterion');
    expect(rubric.map((x) => [x.fields.criterion, x.fields.maxPoints])).toEqual([['Risk Analysis', 60], ['Use of Sources', 50], ['APA Formatting', 40]]);
    expect(rubric[0].fields.assignmentKey).toBe(a.key);
  });

  it('reports a broken Word file as corrupt', async () => {
    const r = await runImport([{ kind: 'file', name: 'broken.docx', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) }], deps());
    expect(r.errors[0]).toMatchObject({ reason: 'corrupt_file' });
  });
});

describe('re-reading earlier imports', () => {
  it('reads content imported before again, for the course it is pasted into', async () => {
    const text = 'Lab 4 due Oct 2, 2026';
    const first = await runImport([{ kind: 'text', text }], deps());
    const id = first.sources[0].source.id;
    const again = await runImport([{ kind: 'text', text, hints: { course: 'DSC 6400' } }], {
      ...deps(), existingSourceHashes: new Map([[first.sources[0].source.contentHash, id]]),
    });
    expect(again.duplicateInputs).toEqual([{ inputName: 'Pasted text', existingSourceId: id, reprocessed: true }]);
    expect(again.sources[0].source.id).toBe(id);
    expect(again.proposals.find((p) => p.entityType === 'assignment')?.candidate.fields.courseCode).toBe('DSC 6400');
  });
});

describe('course scoped imports', () => {
  it('records the course an item was added to, even when its text names another', async () => {
    const r = await runImport([{ kind: 'file', name: 'syllabus.pdf', bytes: fixtureBytes('syllabus.pdf'), hints: { course: 'STA 6166' } }], deps());
    const hw = r.proposals.find((p) => p.candidate.fields.title === 'Homework 1')!;
    expect(hw.candidate.fields.courseCode).toBe('DSC 6400');
    expect(hw.candidate.flags).toContain('course_mismatch');
    expect(hw.candidate.provenance.importedInto).toBe('STA 6166');
  });
});
