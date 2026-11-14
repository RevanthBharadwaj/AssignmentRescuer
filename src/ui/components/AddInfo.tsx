import { useRef, useState, type DragEvent, type ClipboardEvent } from 'react';
import { useApp } from '../AppContext';
import type { ImportInput, ImportResult } from '../../core/pipeline';
import type { ContentLabel, EntityType, FieldValue, ImportHints } from '../../core/types';
import { CONTENT_LABELS } from '../../core/types';
import { dateFromInputs, errorMessage } from '../format';

interface PendingFile {
  name: string;
  bytes: Uint8Array;
}

const MANUAL_KINDS: { id: string; label: string; entity: EntityType }[] = [
  { id: 'course', label: 'Course', entity: 'course' },
  { id: 'semester', label: 'Semester dates', entity: 'semester' },
  { id: 'assignment', label: 'Assignment deadline', entity: 'assignment' },
  { id: 'discussion', label: 'Discussion deadline', entity: 'assignment' },
  { id: 'reading', label: 'Reading', entity: 'timeline_event' },
  { id: 'milestone', label: 'Project milestone', entity: 'timeline_event' },
  { id: 'exam', label: 'Exam', entity: 'timeline_event' },
];

/** File.arrayBuffer with a FileReader fallback for older webviews. */
function readFileBytes(f: Blob): Promise<Uint8Array> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(f);
  });
}

const TIME_ZONES = ['', 'ET', 'CT', 'MT', 'PT', 'AKST', 'HST', 'UTC'];

export function AddInfo({ onImported }: { onImported: () => void }) {
  const { service, refresh } = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [hints, setHints] = useState<ImportHints>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | File[]) => {
    const next: PendingFile[] = [];
    for (const f of Array.from(list)) next.push({ name: f.name, bytes: await readFileBytes(f) });
    setFiles((cur) => [...cur, ...next]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      void addFiles(imgs.map((f, i) => new File([f], f.name || `pasted-screenshot-${i + 1}.png`, { type: f.type })));
    }
  };

  const cleanHints = (): ImportHints => Object.fromEntries(Object.entries(hints).filter(([, v]) => v)) as ImportHints;

  const runImport = async (inputs: ImportInput[]) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await service.import(inputs);
      setResult(r);
      refresh();
      if (r.sources.length > 0) {
        setText('');
        setFiles([]);
      }
    } catch (e) {
      setNotice(`Import failed: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const h = cleanHints();
    const inputs: ImportInput[] = [];
    if (text.trim()) inputs.push({ kind: 'text', text, hints: h });
    for (const f of files) inputs.push({ kind: 'file', name: f.name, bytes: f.bytes, hints: h });
    if (inputs.length === 0) {
      setNotice('Paste some text or add a file first.');
      return;
    }
    void runImport(inputs);
  };

  return (
    <section aria-labelledby="add-title">
      <div className="page-head">
        <span className="chip">capture it</span>
        <h1 id="add-title">Add Academic Information</h1>
        <p>Paste text, drop files, or type details yourself. Nothing is saved until you review it.</p>
      </div>

      <div className="card" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <label htmlFor="paste" className="label">Paste text (assignment instructions, course timeline, syllabus, announcement, rubric)</label>
        <textarea id="paste" rows={10} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste} placeholder="Paste from Canvas, Blackboard, email or a document…" />
        <div className="row">
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>Choose files…</button>
          <input ref={fileRef} type="file" multiple hidden aria-label="Choose files" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          <span className="muted small">or drag and drop. Text and Markdown files are supported in this version; PDF, Word, images and spreadsheets will be reported as not yet available.</span>
        </div>
        {files.length > 0 && (
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                {f.name} <span className="muted small">({Math.ceil(f.bytes.length / 1024)} KB)</span>
                <button type="button" className="link" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        <details className="hints">
          <summary>Optional: tell us where this belongs</summary>
          <div className="grid">
            <label>University<input value={hints.university ?? ''} onChange={(e) => setHints({ ...hints, university: e.target.value })} /></label>
            <label>Semester<input value={hints.semester ?? ''} placeholder="Fall 2026" onChange={(e) => setHints({ ...hints, semester: e.target.value })} /></label>
            <label>Course<input value={hints.course ?? ''} placeholder="CIS 6930" onChange={(e) => setHints({ ...hints, course: e.target.value })} /></label>
            <label>Academic year<input value={hints.academicYear ?? ''} placeholder="2026-2027" onChange={(e) => setHints({ ...hints, academicYear: e.target.value })} /></label>
            <label>Content type
              <select value={hints.contentType ?? ''} onChange={(e) => setHints({ ...hints, contentType: (e.target.value || undefined) as ContentLabel | undefined })}>
                <option value="">Detect automatically</option>
                {CONTENT_LABELS.map((l) => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
          </div>
        </details>

        <div className="row">
          <button type="button" onClick={submit} disabled={busy}>{busy ? 'Reading…' : 'Extract information'}</button>
        </div>
        {notice && <p role="alert" className="error">{notice}</p>}
      </div>

      {result && <ImportSummary result={result} onReview={onImported} />}

      <ManualEntry onSubmit={(entity, fields) => runImport([{ kind: 'manual', entityType: entity, fields, hints: cleanHints() }])} busy={busy} />
    </section>
  );
}

function ImportSummary({ result, onReview }: { result: ImportResult; onReview: () => void }) {
  const flagged = result.sources.filter((s) => s.source.securityFlags.some((f) => f.kind === 'prompt_injection_pattern'));
  return (
    <div className="card" aria-live="polite">
      <h2>What we found</h2>
      {result.sources.map((s) => (
        <p key={s.source.id}>
          <strong>{s.source.originalName}</strong>: {s.records.length} item{s.records.length === 1 ? '' : 's'}
          {s.classifications.length > 0 && <span className="muted"> · looks like {s.classifications.slice(0, 4).map((c) => c.label.replace(/_/g, ' ')).join(', ')}</span>}
        </p>
      ))}
      {result.duplicateInputs.map((d) => <p key={d.inputName} className="muted">{d.inputName}: already imported, skipped.</p>)}
      {result.errors.map((e) => <p key={e.inputName} className="error">{e.message}</p>)}
      {flagged.length > 0 && (
        <p className="warning">Some text contains instructions aimed at software (for example “ignore previous instructions”). It was treated as plain data and nothing was changed automatically.</p>
      )}
      {result.proposals.length > 0 && <button type="button" onClick={onReview}>Review {result.proposals.length} item{result.proposals.length === 1 ? '' : 's'}</button>}
    </div>
  );
}

function ManualEntry({ onSubmit, busy }: { onSubmit: (e: EntityType, f: Record<string, FieldValue>) => void; busy: boolean }) {
  const [kind, setKind] = useState('assignment');
  const [v, setV] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const def = MANUAL_KINDS.find((k) => k.id === kind)!;

  const submit = () => {
    const date = (p: string) => dateFromInputs(v[`${p}`] ?? '', v[`${p}Time`] ?? '', v[`${p}Tz`] ?? '');
    let fields: Record<string, FieldValue>;
    if (kind === 'course') fields = { code: v.code ?? '', name: v.name || null, instructor: v.instructor || null, semester: v.semester || null };
    else if (kind === 'semester') {
      const s = date('start'), e = date('end');
      fields = { name: v.name ?? '', startDate: s, endDate: e, durationWeeks: s?.iso && e?.iso ? Math.round(((Date.parse(e.iso) - Date.parse(s.iso)) / 86_400_000 + 1) / 7) : null };
    } else if (def.entity === 'assignment') fields = {
      title: v.title ?? '', type: kind === 'discussion' ? 'discussion' : 'assignment', courseCode: v.courseCode || null, unit: v.unit || null,
      dueDate: date('due'), availableDate: null, pointsPossible: v.points ? Number(v.points) : null,
    };
    else fields = { kind, title: v.title ?? '', courseCode: v.courseCode || null, unit: v.unit || null, date: date('due') };

    const required = kind === 'course' ? fields.code : fields.name ?? fields.title;
    if (!required) return;
    onSubmit(def.entity, fields);
    setV({});
  };

  const dateRow = (p: string, label: string) => (
    <div className="grid">
      <label>{label}<input type="date" value={v[p] ?? ''} onChange={set(p)} /></label>
      {p !== 'start' && p !== 'end' && (
        <>
          <label>Time (optional)<input type="time" value={v[`${p}Time`] ?? ''} onChange={set(`${p}Time`)} /></label>
          <label>Time zone
            <select value={v[`${p}Tz`] ?? ''} onChange={set(`${p}Tz`)}>{TIME_ZONES.map((t) => <option key={t} value={t}>{t || 'Not specified'}</option>)}</select>
          </label>
        </>
      )}
    </div>
  );

  return (
    <div className="card">
      <h2>Enter details manually</h2>
      <label>What are you adding?
        <select value={kind} onChange={(e) => { setKind(e.target.value); setV({}); }}>
          {MANUAL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      {kind === 'course' && (
        <div className="grid">
          <label>Course code<input value={v.code ?? ''} onChange={set('code')} placeholder="CIS 6930" /></label>
          <label>Course name<input value={v.name ?? ''} onChange={set('name')} /></label>
          <label>Instructor<input value={v.instructor ?? ''} onChange={set('instructor')} /></label>
          <label>Semester<input value={v.semester ?? ''} onChange={set('semester')} placeholder="Fall 2026" /></label>
        </div>
      )}
      {kind === 'semester' && (
        <>
          <label>Semester name<input value={v.name ?? ''} onChange={set('name')} placeholder="Spring 2027" /></label>
          {dateRow('start', 'Start date')}
          {dateRow('end', 'End date')}
        </>
      )}
      {kind !== 'course' && kind !== 'semester' && (
        <>
          <div className="grid">
            <label>Title<input value={v.title ?? ''} onChange={set('title')} /></label>
            <label>Course<input value={v.courseCode ?? ''} onChange={set('courseCode')} placeholder="CIS 6930" /></label>
            <label>Week / unit<input value={v.unit ?? ''} onChange={set('unit')} placeholder="Week 3" /></label>
            {def.entity === 'assignment' && <label>Points<input inputMode="numeric" value={v.points ?? ''} onChange={set('points')} /></label>}
          </div>
          {dateRow('due', def.entity === 'assignment' ? 'Due date' : 'Date')}
        </>
      )}
      <button type="button" onClick={submit} disabled={busy}>Add for review</button>
    </div>
  );
}
