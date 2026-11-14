import { useRef, useState } from 'react';
import { useApp, type CourseTab } from '../AppContext';
import { useAsync } from '../useAsync';
import type { AcademicDate, ChangeProposal, ConfirmedRecord } from '../../core/types';
import type { ImportInput, ImportResult } from '../../core/pipeline';
import { analyseAssignment } from '../../core/assignments/checklist';
import { FIELD_LABELS, errorMessage, formatDate, formatValue } from '../format';
import { SourceTrace } from './SourceTrace';
import { ReviewList } from './ReviewList';
import { TitlePage } from './TitlePage';
import { readFileBytes } from './AddInfo';
import { CourseDot, ProgressBar, StatusButton, Urgency, courseColor, courseProgress, statusOf } from '../ux';

const dateOf = (r: ConfirmedRecord) => ((r.fields.dueDate ?? r.fields.date ?? null) as AcademicDate | null);
// Date first, then title, so "Question 1" comes before "Question 2" on the same day.
const sortKey = (r: ConfirmedRecord) => `${dateOf(r)?.iso ?? `9999-${String(dateOf(r)?.month ?? 99).padStart(2, '0')}-${String(dateOf(r)?.day ?? 99).padStart(2, '0')}`}|${String(r.fields.title ?? '')}`;
const unitNum = (u: unknown) => Number(/(\d+)/.exec(String(u ?? ''))?.[1] ?? 999);

/* ---------------- course list ---------------- */

export function CourseList() {
  const { service, version, go, today } = useApp();
  const { data } = useAsync(async () => {
    const records = await service.repository.listRecords();
    const pending = await service.repository.listProposals('pending');
    return { records, pending };
  }, [version]);
  if (!data) return <p className="muted">Loading…</p>;
  const courses = data.records.filter((r) => r.entityType === 'course');

  return (
    <section aria-labelledby="courses-title">
      <div className="page-head">
        <span className="chip">plan it</span>
        <h1 id="courses-title">Courses</h1>
        <p>Open a course to see its timeline, assignments and readings, or to add material from Canvas or a syllabus.</p>
      </div>
      {courses.length === 0 ? (
        <div className="card">
          <p>No courses yet.</p>
          <button type="button" onClick={() => go({ name: 'setup' })}>Set up your semester →</button>
        </div>
      ) : (
        <div className="course-grid">
          {courses.map((c) => {
            const code = String(c.fields.code);
            const items = data.records.filter((r) => r.fields.courseCode === code && (r.entityType === 'assignment' || r.entityType === 'timeline_event'));
            const next = items.filter((r) => (dateOf(r)?.iso ?? '') >= today).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))[0];
            const waiting = data.pending.filter((p) => p.candidate.fields.courseCode === code).length;
            const prog = courseProgress(items);
            return (
              <button key={c.id} type="button" className="course-card" style={{ ['--c' as string]: courseColor(code) }} onClick={() => go({ name: 'course', code })} aria-label={`Open ${code}`}>
                <span className="code">{code}</span>
                <span className="name">{String(c.fields.name ?? 'Name not set')}</span>
                {c.fields.instructor ? <span className="meta">{String(c.fields.instructor)}</span> : null}
                <span className="meta">{items.length} dated item{items.length === 1 ? '' : 's'}{waiting ? ` · ${waiting} to review` : ''}</span>
                <span className="next">{next ? <>next: {String(next.fields.title)} · {formatDate(dateOf(next))}</> : items.length ? 'nothing upcoming' : 'add material to fill this course'}</span>
                {prog.total > 0 && <><ProgressBar pct={prog.pct} color={courseColor(code)} label={`${code} progress`} /><span className="meta">{prog.pct}% of points submitted</span></>}
              </button>
            );
          })}
          <button type="button" className="course-card add" onClick={() => go({ name: 'setup' })}>
            <span className="code">+</span>
            <span className="name">Add a course</span>
          </button>
        </div>
      )}
    </section>
  );
}

/* ---------------- course page ---------------- */

const TABS: { id: CourseTab; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'materials', label: 'Readings and materials' },
  { id: 'add', label: 'Add material' },
];

export function CoursePage({ code, tab = 'timeline' }: { code: string; tab?: CourseTab }) {
  const { service, version, go } = useApp();
  const { data } = useAsync(async () => ({
    records: await service.repository.listRecords(),
    pending: (await service.repository.listProposals('pending')).filter((p) =>
      p.candidate.fields.courseCode === code || p.key === code || p.candidate.provenance.importedInto === code),
  }), [version, code]);
  if (!data) return <p className="muted">Loading…</p>;

  const course = data.records.find((r) => r.entityType === 'course' && r.fields.code === code);
  const mine = data.records.filter((r) => r.fields.courseCode === code);
  const dated = mine.filter((r) => (r.entityType === 'assignment' || r.entityType === 'timeline_event') && r.fields.kind !== 'module');
  const assignments = mine.filter((r) => r.entityType === 'assignment');
  const materials = mine.filter((r) => r.entityType === 'course_material');

  return (
    <section aria-labelledby="course-title">
      <button type="button" className="link" onClick={() => go({ name: 'courses' })}>← all courses</button>
      <div className="page-head course-head" style={{ ['--c' as string]: courseColor(code) }}>
        <span className="chip course-chip">{code.toLowerCase()}</span>
        <h1 id="course-title">{String(course?.fields.name ?? code)}</h1>
        <p className="muted">
          {course?.fields.instructor ? `${String(course.fields.instructor)} · ` : ''}
          {assignments.length} graded item{assignments.length === 1 ? '' : 's'} · {materials.filter((m) => m.fields.kind !== 'note').length} readings and files
          {course?.fields.section ? ` · section ${String(course.fields.section)}` : ''}
        </p>
        {assignments.length > 0 && (() => {
          const prog = courseProgress(assignments);
          return <div className="course-progress"><ProgressBar pct={prog.pct} color={courseColor(code)} label={`${code} progress`} /><span className="muted small">{prog.pct}% of points submitted · {assignments.filter((a) => statusOf(a) === 'submitted').length} of {assignments.length} done</span></div>;
        })()}
      </div>

      <div className="tabs" role="tablist" aria-label={`${code} sections`}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => go({ name: 'course', code, tab: t.id })}>
            {t.label}{t.id === 'add' && data.pending.length ? <span className="badge">{data.pending.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'timeline' && <Timeline code={code} items={dated} notes={materials.filter((m) => m.fields.kind === 'note')} />}
      {tab === 'assignments' && <AssignmentTable code={code} items={assignments} />}
      {tab === 'materials' && <Materials code={code} items={materials.filter((m) => m.fields.kind !== 'note')} />}
      {tab === 'add' && <AddToCourse code={code} pending={data.pending} />}
    </section>
  );
}

function Timeline({ code, items, notes }: { code: string; items: ConfirmedRecord[]; notes: ConfirmedRecord[] }) {
  const { go, today } = useApp();
  if (items.length === 0) return <EmptyCourse code={code} />;
  const sorted = [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const undated = sorted.filter((r) => !dateOf(r));
  return (
    <>
      <ul className="deadlines">
        {sorted.filter((r) => dateOf(r)).map((r, i) => {
          const past = (dateOf(r)?.iso ?? '9999') < today;
          const done = statusOf(r) === 'submitted';
          return (
            <li key={r.id} className={`stagger ${past && !done ? 'past' : ''} ${done ? 'is-done' : ''}`} style={{ ['--i' as string]: i }}>
              <span className="date">{r.entityType === 'assignment' ? <StatusButton record={r} compact /> : <span className="status-spacer" />} {formatDate(dateOf(r))}</span>
              <span className="title">
                {r.entityType === 'assignment' ? <button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button> : String(r.fields.title)}
              </span>
              <span className="row-end">
                <Urgency record={r} />
                {r.fields.unit ? <span className="tag">{String(r.fields.unit).toLowerCase()}</span> : null}
                {typeof r.fields.pointsPossible === 'number' ? <span className="tag">{r.fields.pointsPossible} pts</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {undated.length > 0 && (
        <div className="card notice" style={{ marginTop: 28 }}>
          <h2>Still needs a date</h2>
          <ul className="plain-list">
            {undated.map((r) => (
              <li key={r.id}>
                <button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button>
                <span className="muted small"> · {typeof r.fields.dueNote === 'string' ? r.fields.dueNote : 'no date in your material'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary>Reminders from the course page ({notes.length})</summary>
          <ul className="plain-list">{notes.map((n) => <li key={n.id}><span className="muted small">{String(n.fields.unit ?? '')}</span> {String(n.fields.title)}</li>)}</ul>
        </details>
      )}
    </>
  );
}

function AssignmentTable({ code, items }: { code: string; items: ConfirmedRecord[] }) {
  const { go } = useApp();
  if (items.length === 0) return <EmptyCourse code={code} />;
  const sorted = [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const total = items.reduce((s, r) => s + (typeof r.fields.pointsPossible === 'number' ? r.fields.pointsPossible : 0), 0);
  return (
    <>
      <table className="timeline">
        <thead><tr><th>Status</th><th>Due</th><th>Assignment</th><th>Type</th><th>Unit</th><th>Points</th></tr></thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.id} className={`stagger ${statusOf(r) === 'submitted' ? 'is-done' : ''}`} style={{ ['--i' as string]: i }}>
              <td><StatusButton record={r} /></td>
              <td>{dateOf(r) ? <>{formatDate(dateOf(r))} <Urgency record={r} /></> : <span className="warn-text">no date</span>}</td>
              <td><button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button></td>
              <td>{String(r.fields.type ?? '').replace('_', ' ')}</td>
              <td>{String(r.fields.unit ?? '')}</td>
              <td>{typeof r.fields.pointsPossible === 'number' ? r.fields.pointsPossible : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small" style={{ marginTop: 12 }}>{total} points listed in your material.</p>
    </>
  );
}

const KIND_LABEL: Record<string, string> = { reading: 'reading', reading_file: 'reading file', lecture: 'lecture', file: 'file', page: 'page', forum: 'forum', link: 'link', tool: 'tool' };

function Materials({ code, items }: { code: string; items: ConfirmedRecord[] }) {
  if (items.length === 0) return <EmptyCourse code={code} />;
  const groups = new Map<string, ConfirmedRecord[]>();
  for (const m of items) {
    const u = String(m.fields.unit ?? 'Course resources');
    groups.set(u, [...(groups.get(u) ?? []), m]);
  }
  const ordered = [...groups.entries()].sort((a, b) => unitNum(a[0]) - unitNum(b[0]));
  return (
    <div className="materials">
      {ordered.map(([unit, list]) => (
        <div key={unit} className="material-group">
          <h3><CourseDot code={code} /> {unit}</h3>
          <ul>
            {list.map((m) => (
              <li key={m.id}>
                <span className="tag">{KIND_LABEL[String(m.fields.kind)] ?? String(m.fields.kind)}</span>
                <span>{String(m.fields.title)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EmptyCourse({ code }: { code: string }) {
  const { go } = useApp();
  return (
    <div className="card">
      <p>Nothing here yet. Copy the Modules page from Canvas (select all, copy) or paste a syllabus, and the items fill in.</p>
      <button type="button" onClick={() => go({ name: 'course', code, tab: 'add' })}>Add material →</button>
    </div>
  );
}

function AddToCourse({ code, pending }: { code: string; pending: ChangeProposal[] }) {
  const { service, refresh } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (inputs: ImportInput[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await service.importForCourse(code, inputs);
      setResult(r);
      if (r.sources.length) setText('');
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const [dragging, setDragging] = useState(false);
  const onFiles = async (files: FileList | File[]) => {
    const inputs: ImportInput[] = [];
    for (const f of Array.from(files)) inputs.push({ kind: 'file', name: f.name, bytes: await readFileBytes(f) });
    if (inputs.length) await run(inputs);
  };
  const found = result ? result.proposals.length : 0;

  return (
    <>
      <div
        className={`card dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files); }}
      >
        <label htmlFor="course-paste" className="label">
          Paste anything for {code}: the Canvas Modules or Assignments page, a syllabus, assignment instructions, a rubric, an announcement
        </label>
        <textarea id="course-paste" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="In Canvas: open Modules, press Cmd+A then Cmd+C, and paste here." />
        <div className="row">
          <button type="button" disabled={busy || !text.trim()} onClick={() => run([{ kind: 'text', text, label: `Pasted into ${code}` }])}>{busy ? 'Reading…' : 'Extract'}</button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>Choose files…</button>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,text/plain" aria-label="Choose files for this course" onChange={(e) => e.target.files && void onFiles(e.target.files)} />
          <span className="muted small">or drop PDF, Word, TXT or Markdown files anywhere on this card.</span>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
      {result && (
        <div className={`card import-result ${found ? 'ok' : 'empty'}`} aria-live="polite">
          <strong>{found ? `Found ${found} item${found === 1 ? '' : 's'} for ${code}` : 'Nothing new found'}</strong>
          {result.sources.map((s) => (
            <p key={s.source.id} className="small">
              {s.source.originalName}: {s.records.length} item{s.records.length === 1 ? '' : 's'}
              {result.duplicateInputs.some((d) => d.existingSourceId === s.source.id && d.reprocessed) ? ' (you imported this before; it was read again for this course)' : ''}
            </p>
          ))}
          {result.errors.map((e) => <p key={e.inputName} className="error small">{e.message}</p>)}
          {result.sources.some((s) => s.source.securityFlags.some((f) => f.kind === 'prompt_injection_pattern')) && <p className="small warning">Some text looked like instructions aimed at software; it was treated as plain text.</p>}
          {found > 0 && <p className="small muted">Review them below, then approve. They appear in Timeline, Assignments and Calendar right after.</p>}
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Waiting for your review</h2>
      <ReviewList proposals={pending} emptyText={`Nothing waiting for ${code}.`} />
    </>
  );
}

/* ---------------- assignment workspace ---------------- */

export function AssignmentWorkspace({ id }: { id: string }) {
  const { service, version, go, refresh } = useApp();
  const { data } = useAsync(async () => ({ all: await service.repository.listRecords() }), [version]);
  const [date, setDate] = useState('');
  if (!data) return <p className="muted">Loading…</p>;
  const record = data.all.find((r) => r.id === id);
  if (!record) return <p className="muted">This item no longer exists.</p>;
  const rubric = data.all.filter((r) => r.entityType === 'rubric_criterion' && r.fields.assignmentKey === record.key);
  const a = analyseAssignment(record, rubric);
  const shown = Object.entries(record.fields).filter(([k, v]) => !['instructions', 'title', 'paperTitle', 'status', 'checklistDone'].includes(k) && v !== null);
  const isPaper = ['paper', 'essay', 'report', 'reflection', 'project', 'assignment'].includes(String(record.fields.type));
  const code = String(record.fields.courseCode ?? '');

  return (
    <section aria-labelledby="ws-title">
      {code && <button type="button" className="link" onClick={() => go({ name: 'course', code, tab: 'assignments' })}>← {code}</button>}
      <div className="page-head">
        <span className="chip">assignment workspace</span>
        <h1 id="ws-title">{String(record.fields.title)}</h1>
        <p className="muted">{dateOf(record) ? `Due ${formatDate(dateOf(record))}` : typeof record.fields.dueNote === 'string' ? record.fields.dueNote : 'No due date yet'}</p>
        <div className="row"><StatusButton record={record} /> <Urgency record={record} /></div>
      </div>
      {!dateOf(record) && (
        <div className="card notice">
          <label>Set the due date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <button type="button" style={{ marginTop: 10 }} disabled={!date} onClick={async () => {
            const [y, m, d] = date.split('-').map(Number);
            await service.repository.correctRecord(record.id, { dueDate: { iso: date, year: y, month: m, day: d, yearSource: 'explicit', time: null, timeZone: null, raw: date } });
            refresh();
          }}>Save date</button>
        </div>
      )}
      <div className="card">
        <h2>Requirements checklist</h2>
        <ul className="checklist">
          {a.checklist.map((c) => {
            const doneIds = Array.isArray(record.fields.checklistDone) ? (record.fields.checklistDone as string[]) : [];
            const on = doneIds.includes(c.id);
            return (
              <li key={c.id} className={on ? 'is-done' : ''}>
                <label>
                  <input type="checkbox" checked={on} onChange={async () => {
                    const next = on ? doneIds.filter((x) => x !== c.id) : [...doneIds, c.id];
                    await service.repository.correctRecord(record.id, { checklistDone: next });
                    refresh();
                  }} /> {c.text}
                </label>
              </li>
            );
          })}
        </ul>
        {a.checklist.length > 0 && (() => {
          const doneIds = Array.isArray(record.fields.checklistDone) ? (record.fields.checklistDone as string[]) : [];
          const pct = Math.round((a.checklist.filter((c) => doneIds.includes(c.id)).length / a.checklist.length) * 100);
          return <ProgressBar pct={pct} color={courseColor(record.fields.courseCode)} label="Checklist progress" />;
        })()}
        {a.missing.length > 0 && <p className="warning">Not found in your material yet: {a.missing.join(', ')}. Paste the assignment instructions or rubric into the course to fill these in.</p>}
      </div>
      <div className="card">
        <h2>Details</h2>
        <dl className="fields">{shown.map(([k, v]) => <div key={k}><dt>{FIELD_LABELS[k] ?? k}</dt><dd>{formatValue(v)}</dd></div>)}</dl>
        {typeof record.fields.instructions === 'string' && <details><summary>Full instructions</summary><pre className="instructions">{record.fields.instructions}</pre></details>}
        <SourceTrace provenance={record.evidence} />
      </div>
      {isPaper && <TitlePage record={record} />}
      <div className="card muted">Research, planning, writing and APA review tools for this workspace arrive in later milestones.</div>
    </section>
  );
}
