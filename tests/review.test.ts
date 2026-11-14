import { describe, expect, it } from 'vitest';
import { makeService } from './helpers';
import { checkDraft, countWords } from '../src/core/draftCheck';
import { detectRepeats, seriesName } from '../src/core/repeats';
import { parseFindings } from '../src/core/aiReview';
import type { ConfirmedRecord } from '../src/core/types';

const due = (iso: string, time: string | null = '23:59') => { const [y, m, d] = iso.split('-').map(Number); return { iso, month: m, day: d, year: y, time, raw: iso } as never; };

describe('suggestions on plain rules', () => {
  it('finds a duplicate, an undated item, a course missing its professor and an empty course, and removing then undoing restores the item', async () => {
    const { service, repo } = await makeService();
    await service.addCourse({ code: 'BUS 719A', name: 'Business Ethics', instructor: null });
    await service.addCourse({ code: 'BUS 799', name: 'Empty', instructor: 'Dr. X' });
    await service.saveTyped('assignment', { title: 'Unit 5: Reflection', courseCode: 'BUS 719A', dueDate: due('2026-11-20') }, null);
    await service.saveTyped('assignment', { title: 'Reflection', courseCode: 'BUS 719A', dueDate: due('2026-11-20') }, null);
    await service.saveTyped('assignment', { title: 'Mentioned only', courseCode: 'BUS 719A' }, null);
    const list = await service.suggestions('2026-11-14');
    const kinds = list.map((s) => s.kind + ':' + s.title);
    expect(kinds.some((k) => k.startsWith('duplicate'))).toBe(true);
    expect(kinds.some((k) => k.includes('has no due date'))).toBe(true);
    expect(kinds.some((k) => k.includes('missing the professor'))).toBe(true);
    expect(kinds.some((k) => k.includes('BUS 799 has nothing'))).toBe(true);

    const dup = list.find((s) => s.kind === 'duplicate')!;
    const before = (await repo.listRecords('assignment')).length;
    const r = await service.applySuggestion(dup);
    expect((await repo.listRecords('assignment')).length).toBe(before - 1);
    await service.undo(r.undoId!);
    expect((await repo.listRecords('assignment')).length).toBe(before);
  });

  it('removing a course can be undone and brings its items back', async () => {
    const { service, repo } = await makeService();
    const c = await service.addCourse({ code: 'BUS 719A', name: 'Ethics', instructor: 'Dr. Lee' });
    await service.saveTyped('assignment', { title: 'Unit 5', courseCode: 'BUS 719A', dueDate: due('2026-11-20') }, null);
    await service.removeCourse(c.id);
    expect((await repo.listRecords()).length).toBe(0);
    const u = (await service.undoList()).pop()!;
    await service.undo(u.id);
    expect((await repo.listRecords()).length).toBe(2);
  });

  it('a field change is reversed by undo and dismissed suggestions stay away', async () => {
    const { service, repo } = await makeService();
    await service.addCourse({ code: 'BUS 719A', name: 'Ethics', instructor: 'Dr. Lee' });
    const a = await service.saveTyped('assignment', { title: 'Unit 5 Paper', courseCode: 'BUS 719A', dueDate: due('2026-11-20') }, null);
    const r = await service.applySuggestion({ id: 't', kind: 'finished', by: 'rules', title: 't', detail: '', fix: { type: 'set_fields', recordId: a.id, fields: { status: 'submitted' }, label: 'Mark as submitted' } });
    expect((await repo.getRecord(a.id))!.fields.status).toBe('submitted');
    await service.undo(r.undoId!);
    expect((await repo.getRecord(a.id))!.fields.status ?? null).toBe(null);
    await service.dismissSuggestion('x');
    expect(await repo.getSetting('review.dismissed', [])).toContain('x');
  });
});

describe('repeating work', () => {
  const rec = (title: string, iso: string, extra: Record<string, unknown> = {}): ConfirmedRecord => ({
    id: title + iso, entityType: 'assignment', key: title + iso, fields: { title, courseCode: 'BUS 1', dueDate: due(iso), ...extra },
    unknownFields: [], evidence: [], confirmedAt: iso, updatedAt: iso,
  });
  it('ignores digits in titles', () => { expect(seriesName('Unit 3: Work Hour Log 3')).toBe('work hour log'); });
  it('detects weekly work and offers it, and stops when the semester is over', () => {
    const rs = [rec('Work Hour Log', '2026-11-01'), rec('Work Hour Log', '2026-11-08'), rec('Work Hour Log', '2026-11-15')];
    expect(detectRepeats(rs, '2026-11-14', '2026-12-20').map((r) => r.label)).toEqual(['Work Hour Log']);
    expect(detectRepeats(rs, '2026-11-14', '2026-11-20')).toEqual([]);
    expect(detectRepeats([rs[0], rs[2]], '2026-11-14', null)).toEqual([]);
  });
  it('adds future milestones once a repeat is accepted', async () => {
    const { service } = await makeService();
    await service.addCourse({ code: 'BUS 1', name: 'B', instructor: 'P' });
    for (const [i, d] of ['2026-11-01', '2026-11-08', '2026-11-15'].entries()) await service.saveTyped('assignment', { title: `Work Hour Log ${i + 1}`, courseCode: 'BUS 1', dueDate: due(d) }, null);
    const s = (await service.suggestions('2026-11-14')).find((x) => x.kind === 'repeat')!;
    expect(s).toBeTruthy();
    const before = (await service.milestones()).length;
    await service.applySuggestion(s);
    const after = (await service.milestones()).filter((m) => m.title.includes('repeating'));
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].date).toBe('2026-11-22');
    expect((await service.milestones()).length).toBeGreaterThan(before);
  });
});

describe('draft check', () => {
  it('counts words, learns the limit from earlier similar work, and flags missing citations', () => {
    const mk = (id: string, title: string, f: Record<string, unknown>): ConfirmedRecord => ({ id, entityType: 'assignment', key: id, fields: { title, courseCode: 'C', type: 'paper', ...f }, unknownFields: [], evidence: [], confirmedAt: '', updatedAt: '' });
    const a = mk('a', 'Unit 4 Paper', { requiredScholarlySources: 2 });
    const earlier = [mk('b', 'Unit 2 Paper', { wordCountMin: 500, wordCountMax: 700 }), mk('c', 'Unit 3 Paper', { wordCountMin: 500, wordCountMax: 700 })];
    const draft = 'Ethics matters in business. '.repeat(20);
    const r = checkDraft(draft, a, [{ criterion: 'Ethical analysis', maxPoints: 10, description: 'Applies ethical theory' }, { criterion: 'Recommendation', maxPoints: 5, description: 'Gives a recommendation' }], null, [a, ...earlier]);
    expect(r.words).toBe(countWords(draft));
    expect(r.length).toBe('short');
    expect(r.limit.from).toContain('2 earlier similar');
    expect(r.citations.notes.join(' ')).toContain('References');
    expect(r.rubric.find((x) => x.criterion === 'Recommendation')!.covered).toBe('unclear');
    const apa = checkDraft('Text (Smith, 2021) and (Lee & Park, 2020).\n\nReferences\nSmith.', a, [], null, [a]);
    expect(apa.citations.inText).toBe(2);
    expect(apa.citations.hasReferences).toBe(true);
  });
});

describe('AI review findings', () => {
  const a: ConfirmedRecord = { id: 'r1', entityType: 'assignment', key: 'k', fields: { title: 'Unit 5 Paper', dueDate: due('2026-11-20') }, unknownFields: [], evidence: [], confirmedAt: '', updatedAt: '' };
  const material = 'Announcement: the Unit 5 Paper is now due November 22 at 11:59 PM.';
  it('keeps findings whose quote is in the material and drops invented ones', () => {
    const ok = JSON.stringify({ findings: [
      { kind: 'date', text: 'Date changed', assignment: 'Unit 5 Paper', due: '2026-11-22', quote: 'is now due November 22 at 11:59 PM' },
      { kind: 'date', text: 'Invented', assignment: 'Unit 5 Paper', due: '2026-12-01', quote: 'due December 1 for sure' },
      { kind: 'date', text: 'Unknown title', assignment: 'Nope', due: '2026-11-22', quote: 'is now due November 22' },
    ] });
    const f = parseFindings(ok, [a], material);
    expect(f).toHaveLength(1);
    expect(f[0].due).toBe('2026-11-22');
  });
  it('turns an AI date finding into a suggestion that waits for approval, and changing it can be undone', async () => {
    const { service, repo } = await makeService();
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:8b', ollamaUrl: 'http://localhost:11434', cloudConsent: true, writingModel: 'qwen3:8b', visionModel: '', embedModel: '', enabled: { ollama: true, anthropic: false, openai: false } });
    await service.addCourse({ code: 'BUS 1', name: 'B', instructor: 'P' });
    const rec = await service.saveTyped('assignment', { title: 'Unit 5 Paper', courseCode: 'BUS 1', dueDate: due('2026-11-20') }, null);
    await service.import([{ kind: 'text', name: 'Announcement', text: 'Announcement: the Unit 5 Paper is now due November 22 at 11:59 PM.', hints: { course: 'BUS 1', kind: 'announcement' } } as never]);
    const complete = async () => JSON.stringify({ findings: [{ kind: 'date', text: 'The Unit 5 Paper moved to November 22.', assignment: 'Unit 5 Paper', due: '2026-11-22', quote: 'is now due November 22 at 11:59 PM' }] });
    const r = await service.aiReview(complete);
    expect(r.added).toBe(1);
    expect((await repo.getRecord(rec.id))!.fields.dueDate).toMatchObject({ iso: '2026-11-20' }); // nothing changed yet
    const s = (await service.suggestions()).find((x) => x.by === 'ai')!;
    const applied = await service.applySuggestion(s);
    expect((await repo.getRecord(rec.id))!.fields.dueDate).toMatchObject({ iso: '2026-11-22' });
    await service.undo(applied.undoId!);
    expect((await repo.getRecord(rec.id))!.fields.dueDate).toMatchObject({ iso: '2026-11-20' });
    expect((await service.suggestions()).some((x) => x.by === 'ai')).toBe(false);
  });
});
