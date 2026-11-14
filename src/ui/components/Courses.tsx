import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { AcademicDate, ConfirmedRecord } from '../../core/types';
import { analyseAssignment } from '../../core/assignments/checklist';
import { ENTITY_LABELS, FIELD_LABELS, formatDate, formatValue } from '../format';
import { SourceTrace } from './SourceTrace';

const dateOf = (r: ConfirmedRecord) => ((r.fields.dueDate ?? r.fields.date ?? r.fields.startDate) as AcademicDate | null) ?? null;
const sortKey = (r: ConfirmedRecord) => dateOf(r)?.iso ?? `9999-${String(dateOf(r)?.month ?? 99).padStart(2, '0')}`;

export function Courses() {
  const { service, version } = useApp();
  const { data: records } = useAsync(() => service.repository.listRecords(), [version]);
  const [open, setOpen] = useState<string | null>(null);
  if (!records) return <p>Loading…</p>;

  const courses = records.filter((r) => r.entityType === 'course');
  const items = records.filter((r) => r.entityType === 'assignment' || r.entityType === 'timeline_event').sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const groups = new Map<string, ConfirmedRecord[]>();
  for (const it of items) {
    const k = (it.fields.courseCode as string | null) ?? 'Unassigned';
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const other = records.filter((r) => !['course', 'assignment', 'timeline_event', 'rubric_criterion'].includes(r.entityType));
  const workspace = open ? records.find((r) => r.id === open) : null;

  if (workspace) return <AssignmentWorkspace record={workspace} all={records} onBack={() => setOpen(null)} />;

  return (
    <section aria-labelledby="courses-title">
      <h1 id="courses-title">Courses and timeline</h1>
      {records.length === 0 && <p className="muted">No confirmed information yet.</p>}
      {other.map((r) => (
        <div key={r.id} className="card compact">
          <span className="tag">{ENTITY_LABELS[r.entityType]}</span> <strong>{String(r.fields.name ?? r.fields.doi ?? r.key)}</strong>
          {r.entityType === 'semester' && <span className="muted"> · {formatDate(r.fields.startDate as AcademicDate)} to {formatDate(r.fields.endDate as AcademicDate)}</span>}
          {r.entityType === 'academic_break' && <span className="muted"> · {formatDate(r.fields.startDate as AcademicDate)} to {formatDate(r.fields.endDate as AcademicDate)}</span>}
        </div>
      ))}
      {[...groups.entries()].map(([code, list]) => {
        const c = courses.find((x) => x.fields.code === code);
        return (
          <div key={code} className="card">
            <h2>{code}{c?.fields.name ? `: ${String(c.fields.name)}` : ''}</h2>
            {c?.fields.instructor ? <p className="muted">Instructor: {String(c.fields.instructor)}</p> : null}
            <table className="timeline">
              <thead><tr><th>Date</th><th>Item</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(dateOf(r))}</td>
                    <td>{String(r.fields.title)}{r.fields.unit ? <span className="muted small"> · {String(r.fields.unit)}</span> : null}</td>
                    <td>{String(r.fields.type ?? r.fields.kind ?? '')}</td>
                    <td>{r.entityType === 'assignment' && <button type="button" className="link" onClick={() => setOpen(r.id)}>Open</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

function AssignmentWorkspace({ record, all, onBack }: { record: ConfirmedRecord; all: ConfirmedRecord[]; onBack: () => void }) {
  const rubric = all.filter((r) => r.entityType === 'rubric_criterion' && r.fields.assignmentKey === record.key);
  const a = analyseAssignment(record, rubric);
  const shown = Object.entries(record.fields).filter(([k]) => !['instructions', 'title'].includes(k));
  return (
    <section aria-labelledby="ws-title">
      <button type="button" className="link" onClick={onBack}>← Back to courses</button>
      <h1 id="ws-title">{String(record.fields.title)}</h1>
      <div className="card">
        <h2>Requirements checklist</h2>
        <ul className="checklist">{a.checklist.map((c) => <li key={c.id}><label><input type="checkbox" /> {c.text}</label></li>)}</ul>
        {a.missing.length > 0 && <p className="warning">Not found in your material: {a.missing.join(', ')}.</p>}
        {a.questions.length > 0 && <ul className="muted">{a.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
      </div>
      <div className="card">
        <h2>Details</h2>
        <dl className="fields">{shown.map(([k, v]) => <div key={k}><dt>{FIELD_LABELS[k] ?? k}</dt><dd>{formatValue(v)}</dd></div>)}</dl>
        {typeof record.fields.instructions === 'string' && <details><summary>Full instructions</summary><pre className="instructions">{record.fields.instructions}</pre></details>}
        <SourceTrace provenance={record.evidence} />
      </div>
      <div className="card muted">Research, planning, writing and APA review tools for this workspace arrive in later milestones.</div>
    </section>
  );
}
