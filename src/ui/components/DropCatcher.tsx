import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { errorMessage } from '../format';
import { readFileBytes } from './AddInfo';
import type { ImportInput } from '../../core/pipeline';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Drop PDFs or documents anywhere in the window. A small card then asks which course they belong to
 * (the open course is already chosen) and adds them.
 */
export function DropCatcher({ routeCourse }: { routeCourse: string | null }) {
  const { service, version, go, refresh, toast } = useApp();
  const { data: courses } = useAsync(() => service.repository.listRecords('course'), [version]);
  const [over, setOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [course, setCourse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); };
    const move = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Cards that handle their own drops (the paste cards) have already dealt with it.
      const handled = e.defaultPrevented;
      e.preventDefault();
      depth.current = 0; setOver(false);
      if (handled) return;
      const list = Array.from(e.dataTransfer?.files ?? []);
      if (list.length) { setFiles(list); setCourse(routeCourse ?? ''); setError(null); }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', move);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', move); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [routeCourse]);

  const add = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const inputs: ImportInput[] = [];
      for (const f of files) inputs.push({ kind: 'file', name: f.name, bytes: await readFileBytes(f) });
      const r = course ? await service.importForCourse(course, inputs) : await service.import(inputs);
      setFiles([]);
      refresh();
      const found = r.proposals.length;
      toast(found ? `Found ${found} item${found === 1 ? '' : 's'} to review` : `Saved ${r.sources.length} file${r.sources.length === 1 ? '' : 's'}${course ? ` to ${course}` : ''}`);
      if (found) go({ name: 'review' });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }, [files, course, service, refresh, toast, go]);

  return (
    <>
      {over && <div className="drop-veil" role="presentation"><div>Drop PDFs or documents to add them</div></div>}
      {files.length > 0 && (
        <div className="card drop-card" role="dialog" aria-label="Add dropped files">
          <strong>Add {files.length} file{files.length === 1 ? '' : 's'}</strong>
          <ul className="file-list">{files.map((f, i) => <li key={`${f.name}-${i}`}>{f.name}</li>)}</ul>
          <label>Which course?
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">Work it out from the file</option>
              {(courses ?? []).map((c) => <option key={c.id} value={String(c.fields.code)}>{String(c.fields.code)}{c.fields.name ? ` · ${String(c.fields.name)}` : ''}</option>)}
            </select>
          </label>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="row">
            <button type="button" disabled={busy} onClick={add}>{busy ? 'Reading…' : 'Add'}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setFiles([])}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
