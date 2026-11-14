import { runImport } from '../src/core/pipeline';
import { fixture, fixtureBytes } from './helpers';

const deps = () => ({ existingSourceHashes: new Map<string, string>(), confirmedRecords: [], context: {} });

describe('import pipeline', () => {
  it('accepts pasted text and several files in one batch', async () => {
    const r = await runImport([
      { kind: 'text', text: fixture('syllabus.txt') },
      { kind: 'file', name: 'assignment.txt', bytes: fixtureBytes('assignment.txt') },
      { kind: 'file', name: 'canvas.md', bytes: fixtureBytes('canvas-copy.md') },
    ], deps());
    expect(r.errors).toEqual([]);
    expect(r.sources.map((s) => s.source.format)).toEqual(['plain_text', 'txt', 'markdown']);
    expect(r.sources.map((s) => s.source.sourceType)).toEqual(['pasted_text', 'file', 'file']);
  });

  it('merges the same assignment from two sources into one proposal', async () => {
    const r = await runImport([
      { kind: 'text', text: fixture('syllabus.txt') },
      { kind: 'file', name: 'canvas.md', bytes: fixtureBytes('canvas-copy.md') },
    ], deps());
    const hw = r.proposals.filter((p) => p.key === 'CIS 6930|homework 1');
    expect(hw).toHaveLength(1);
    expect(hw[0].kind).toBe('create');
    expect(hw[0].alternatives).toHaveLength(1);
    expect(hw[0].alternatives[0].provenance.originalName).toBe('canvas.md');
  });

  it('reports a conflict when two sources in one import disagree', async () => {
    const r = await runImport([
      { kind: 'text', text: fixture('syllabus.txt') },
      { kind: 'text', text: fixture('announcement-update.txt'), label: 'Canvas announcement' },
    ], deps());
    const hw = r.proposals.find((p) => p.key === 'CIS 6930|homework 1')!;
    expect(hw.kind).toBe('conflict');
    const due = hw.changes.find((c) => c.field === 'dueDate')!;
    expect((due.oldValue as { iso: string }).iso).toBe('2026-09-06');
    expect((due.newValue as { iso: string }).iso).toBe('2026-09-08');
  });

  it('skips an exact repeat within one import and re-reads content imported earlier', async () => {
    const first = await runImport([
      { kind: 'file', name: 'a.txt', bytes: fixtureBytes('syllabus.txt') },
      { kind: 'file', name: 'copy of a.txt', bytes: fixtureBytes('syllabus.txt') },
    ], deps());
    expect(first.sources).toHaveLength(1);
    expect(first.duplicateInputs[0]).toMatchObject({ inputName: 'copy of a.txt', reprocessed: false });
    const hashes = new Map([[first.sources[0].source.contentHash, first.sources[0].source.id]]);
    const again = await runImport([{ kind: 'text', text: fixture('syllabus.txt') }], { ...deps(), existingSourceHashes: hashes });
    expect(again.sources).toHaveLength(1);
    expect(again.sources[0].source.id).toBe(first.sources[0].source.id);
    expect(again.duplicateInputs[0]).toMatchObject({ existingSourceId: first.sources[0].source.id, reprocessed: true });
    expect(again.proposals.length).toBeGreaterThan(0);
  });

  it('reports unsupported, corrupt and empty inputs without stopping the batch', async () => {
    const r = await runImport([
      { kind: 'file', name: 'syllabus.pdf', bytes: fixtureBytes('fake.pdf') },
      { kind: 'file', name: 'shot.png', bytes: fixtureBytes('screenshot.png') },
      { kind: 'file', name: 'mystery.zip', bytes: fixtureBytes('mystery.zip') },
      { kind: 'file', name: 'broken.txt', bytes: fixtureBytes('corrupt.txt') },
      { kind: 'text', text: '   ' },
      { kind: 'file', name: 'empty.txt', bytes: new Uint8Array() },
      { kind: 'text', text: fixture('assignment.txt') },
    ], deps());
    expect(r.errors.map((e) => [e.inputName, e.reason])).toEqual([
      ['syllabus.pdf', 'corrupt_file'],
      ['shot.png', 'unsupported_format'],
      ['mystery.zip', 'unsupported_format'],
      ['broken.txt', 'corrupt_file'],
      ['Pasted text', 'empty_input'],
      ['empty.txt', 'empty_input'],
    ]);
    expect(r.sources).toHaveLength(1);
  });

  it('treats malicious document text as data and flags affected records', async () => {
    const r = await runImport([{ kind: 'text', text: fixture('malicious.txt') }], deps());
    const src = r.sources[0].source;
    expect(src.securityFlags.some((f) => f.kind === 'prompt_injection_pattern')).toBe(true);
    // The real deadline is still extracted; nothing was marked complete.
    const essay = r.proposals.find((p) => p.candidate.fields.title === 'Essay 2')!;
    expect(essay.status).toBe('pending');
    expect(r.proposals.every((p) => p.status === 'pending')).toBe(true);
  });

  it('accepts manual entries as verified student input', async () => {
    const r = await runImport([
      { kind: 'manual', entityType: 'course', fields: { code: 'sta6166', name: 'Statistical Methods', instructor: null, semester: 'Spring 2027' } },
      { kind: 'manual', entityType: 'assignment', fields: { title: 'Problem Set 1', type: 'homework', courseCode: 'STA 6166', dueDate: { iso: '2027-01-20', month: 1, day: 20, year: 2027, yearSource: 'explicit', time: null, timeZone: null, raw: '2027-01-20' } } },
    ], deps());
    expect(r.proposals.map((p) => p.key)).toEqual(['STA 6166', 'STA 6166|problem set 1']);
    expect(r.proposals[0].candidate.provenance).toMatchObject({ extractionMethod: 'manual_entry', verificationStatus: 'verified', sourceType: 'manual_entry' });
  });

  it('uses student hints and flags course mismatches', async () => {
    const r = await runImport([{ kind: 'text', text: 'Homework 3 due Oct 1, 2026', hints: { course: 'cis6930' } }], deps());
    expect(r.proposals.find((p) => p.entityType === 'assignment')?.candidate.fields.courseCode).toBe('CIS 6930');
    const mm = await runImport([{ kind: 'text', text: 'COP 5615 Lab 2 due Oct 1, 2026', hints: { course: 'CIS 6930' } }], deps());
    expect(mm.proposals.find((p) => p.entityType === 'assignment')?.candidate.flags).toContain('course_mismatch');
  });
});
