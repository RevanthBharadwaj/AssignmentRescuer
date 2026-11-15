import { useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { errorMessage } from '../format';
import { MATERIAL_LABELS, sourceKind, sourcesForCourse } from '../../core/courseContent';
import { usedIn } from '../../core/materials';
import type { ConfirmedRecord } from '../../core/types';
import type { ImportInput } from '../../core/pipeline';
import { readFileBytes } from './AddInfo';

/**
 * The course's files, with the ones used for this assignment ticked. The same PDF can be ticked on many
 * assignments, each with its own note (for example "Chapters 1 and 2" here, "Chapters 5 and 6" on another).
 */
export function MaterialsView({ assignment }: { assignment: ConfirmedRecord }) {
  const { service, version, refresh, toast } = useApp();
  const code = String(assignment.fields.courseCode ?? '');
  const { data } = useAsync(async () => {
    const records = await service.repository.listRecords();
    const sources = sourcesForCourse(code, await service.repository.listSources(), records)
      .filter((s) => !['announcement', 'modules'].includes(sourceKind(s)));
    return { sources, links: await service.materialLinks(), assignments: records.filter((r) => r.entityType === 'assignment' && r.fields.courseCode === code) };
  }, [version, code]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!data) return <p className="muted">Loading…</p>;

  const mine = (id: string) => data.links.find((l) => l.sourceId === id && l.assignmentKey === assignment.key);

  const addFiles = async (files: FileList | File[]) => {
    setBusy(true); setError(null);
    try {
      const inputs: ImportInput[] = [];
      for (const f of Array.from(files)) inputs.push({ kind: 'file', name: f.name, bytes: await readFileBytes(f), hints: { material: 'reading' } } as ImportInput);
      const r = await service.importForCourse(code, inputs);
      for (const s of r.sources) await service.attachMaterial(s.source.id, assignment.id, '');
      refresh();
      toast(`${r.sources.length} file${r.sources.length === 1 ? '' : 's'} added and attached`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="mat-title">
      <h2 id="mat-title">Course files for this assignment</h2>
      <p className="muted">Tick the files that matter for this assignment and say which part (chapters or pages). The assistant reads these first. A file can be ticked on as many assignments as you like.</p>
      <div className="card dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}>
        <button type="button" className="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Adding…' : 'Add PDFs or documents…'}</button>
        <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md" aria-label="Add files to this assignment" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        <span className="muted small"> or drop them here. They are added to {code} and attached to this assignment.</span>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
      {data.sources.length === 0 ? <p className="muted">No files in this course yet.</p> : (
        <ul className="plain" style={{ marginTop: 12 }}>
          {data.sources.map((s) => {
            const link = mine(s.id);
            const elsewhere = usedIn(s.id, data.links, data.assignments).filter((u) => u.assignment.id !== assignment.id);
            return (
              <li key={s.id} className="card compact">
                <label className="check">
                  <input type="checkbox" checked={!!link} onChange={async (e) => {
                    if (e.target.checked) await service.attachMaterial(s.id, assignment.id, notes[s.id] ?? '');
                    else await service.detachMaterial(s.id, assignment.id);
                    refresh();
                  }} aria-label={`Use ${s.originalName} for this assignment`} />
                  <strong> {s.originalName}</strong> <span className={`kind-badge k-${sourceKind(s)}`}>{MATERIAL_LABELS[sourceKind(s)]}</span>
                </label>
                {link && (
                  <label style={{ display: 'block', marginTop: 6 }}>Which part?
                    <input aria-label={`Which part of ${s.originalName}`} value={notes[s.id] ?? link.note} placeholder="Chapters 1 and 2, or pages 10 to 25"
                      onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
                      onBlur={async () => { if (notes[s.id] !== undefined && notes[s.id] !== link.note) { await service.attachMaterial(s.id, assignment.id, notes[s.id]); refresh(); } }} />
                  </label>
                )}
                {elsewhere.length > 0 && <p className="muted small">Also used for: {elsewhere.map((u) => `${String(u.assignment.fields.title)}${u.note ? ` (${u.note})` : ''}`).join('; ')}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
