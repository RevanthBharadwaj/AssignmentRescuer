import { approveAll, fixture, makeService } from './helpers';

const iso = (v: unknown) => (v as { iso: string | null } | null)?.iso ?? null;

describe('review, confirmation and persistence', () => {
  it('saves nothing as confirmed until the student approves', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    expect(await repo.listRecords()).toHaveLength(0);
    expect((await repo.listProposals('pending')).length).toBeGreaterThan(5);
    await approveAll(service);
    expect((await repo.listRecords('assignment')).length).toBe(6);
  });

  it('turns an identical re-import into duplicate proposals that only add evidence', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    await approveAll(service);
    const r = await service.import([{ kind: 'text', text: fixture('canvas-copy.md'), label: 'Canvas page' }]);
    const hw = r.proposals.find((p) => p.key === 'CIS 6930|homework 1')!;
    expect(hw.kind).toBe('duplicate');
    await service.approve(hw.id);
    const rec = await repo.findRecordByKey('assignment', 'CIS 6930|homework 1');
    expect(rec!.evidence.map((e) => e.originalName)).toEqual(['Pasted text', 'Canvas page']);
  });

  it('never overwrites a changed deadline silently and lets the student keep the old value', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    await approveAll(service);
    const r = await service.import([{ kind: 'text', text: fixture('announcement-update.txt') }]);
    const upd = r.proposals.find((p) => p.key === 'CIS 6930|homework 1')!;
    expect(upd.kind).toBe('update');
    expect(upd.changes.map((c) => c.field)).toEqual(['dueDate']);
    // Still the old value while pending.
    expect(iso((await repo.findRecordByKey('assignment', 'CIS 6930|homework 1'))!.fields.dueDate)).toBe('2026-09-06');

    await service.approve(upd.id, { dueDate: 'old' });
    const kept = await repo.findRecordByKey('assignment', 'CIS 6930|homework 1');
    expect(iso(kept!.fields.dueDate)).toBe('2026-09-06');
    expect(await repo.changeLog(kept!.id)).toHaveLength(1);
  });

  it('applies an approved update and keeps both sources as evidence', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    await approveAll(service);
    const r = await service.import([{ kind: 'text', text: fixture('announcement-update.txt'), label: 'Announcement' }]);
    await service.approve(r.proposals.find((p) => p.key === 'CIS 6930|homework 1')!.id);
    const rec = await repo.findRecordByKey('assignment', 'CIS 6930|homework 1');
    expect(iso(rec!.fields.dueDate)).toBe('2026-09-08');
    expect(rec!.evidence.map((e) => e.originalName)).toEqual(['Pasted text', 'Announcement']);
    expect(rec!.evidence[1].textLocation?.line).toBe(2);
  });

  it('rejected proposals change nothing', async () => {
    const { service, repo } = await makeService();
    const r = await service.import([{ kind: 'text', text: 'Lab 1 due Sep 10, 2026' }]);
    await service.reject(r.proposals[0].id);
    expect(await repo.listRecords()).toHaveLength(0);
    expect(await repo.listProposals('rejected')).toHaveLength(1);
    await expect(service.approve(r.proposals[0].id)).rejects.toThrow(/already rejected/);
  });

  it('supports manual corrections with a change log', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'text', text: 'CIS 6930\nLab 1 due Sep 10, 2026' }]);
    await approveAll(service);
    const lab = (await repo.listRecords('assignment'))[0];
    await repo.correctRecord(lab.id, { pointsPossible: 25 });
    const after = await repo.getRecord(lab.id);
    expect(after!.fields.pointsPossible).toBe(25);
    expect((await repo.changeLog(lab.id))[0].changes).toEqual([{ field: 'pointsPossible', oldValue: null, newValue: 25, chosen: 'manual' }]);
  });

  it('traces a confirmed deadline back to its source text', async () => {
    const { service, repo } = await makeService();
    await service.import([{ kind: 'file', name: 'syllabus.txt', bytes: new TextEncoder().encode(fixture('syllabus.txt')) }]);
    await approveAll(service);
    const rec = await repo.findRecordByKey('assignment', 'CIS 6930|final project');
    const ev = rec!.evidence[0];
    const [src] = (await repo.listSources()).filter((s) => s.id === ev.sourceId);
    expect(src.originalName).toBe('syllabus.txt');
    expect(src.text.slice(ev.textLocation!.start, ev.textLocation!.end)).toBe('Final Project due December 9, 2026 at 5:00 PM');
    expect(ev).toMatchObject({ confirmationStatus: 'confirmed', extractionMethod: 'deterministic_text' });
  });

  it('deletes an imported source with its pending proposals and orphaned records', async () => {
    const { service, repo } = await makeService();
    const a = await service.import([{ kind: 'text', text: 'Lab 1 due Sep 10, 2026' }]);
    await approveAll(service);
    await service.import([{ kind: 'text', text: 'Lab 9 due Nov 10, 2026' }]);
    await repo.deleteSource(a.sources[0].source.id);
    expect(await repo.listRecords()).toHaveLength(0);
    expect((await repo.listSources()).map((s) => s.text)).toEqual(['Lab 9 due Nov 10, 2026']);
    const pend = await repo.listProposals('pending');
    expect(pend).toHaveLength(1);
  });

  it('keeps everything after a restart', async () => {
    const first = await makeService();
    await first.service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    await approveAll(first.service);
    await first.service.updateNextSemester({ snoozedUntil: '2026-12-01' });
    const bytes = first.driver.export();

    const second = await makeService(bytes);
    expect((await second.repo.listRecords('assignment')).length).toBe(6);
    expect((await second.repo.listSources())).toHaveLength(1);
    expect((await second.service.nextSemesterSettings()).snoozedUntil).toBe('2026-12-01');
    expect((await second.service.onboarding()).questions.find((q) => q.id === 'university')?.answer).toBe('University of North Florida');
  });

  it('migrations are idempotent', async () => {
    const { repo } = await makeService();
    await repo.migrate();
    await repo.migrate();
    expect(await repo.listRecords()).toEqual([]);
  });
});
