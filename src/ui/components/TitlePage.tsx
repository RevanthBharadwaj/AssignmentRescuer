import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { AcademicDate, ConfirmedRecord } from '../../core/types';
import { hyphenCode } from '../../core/extract/courseList';

/**
 * Title page in APA 7 student format, filled from the student's setup and
 * the course: title (bold), name, university, "CODE: Course name",
 * instructor, due date. See docs/specs/paper-format.md.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(d: AcademicDate | null): string | null {
  if (!d || d.year === null) return null;
  return `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
}

export function titlePageLines(input: {
  title: string;
  student: string;
  university: string | null;
  course: ConfirmedRecord | null;
  due: AcademicDate | null;
}): { text: string; missing: string | null; bold?: boolean }[] {
  const code = input.course ? hyphenCode(String(input.course.fields.code)) : null;
  const courseLine = code ? `${code}: ${String(input.course?.fields.name ?? '')}`.replace(/:\s*$/, '') : null;
  return [
    { text: input.title, missing: input.title ? null : 'Paper title', bold: true },
    { text: input.student, missing: input.student ? null : 'Your name (Semester setup)' },
    { text: input.university ?? '', missing: input.university ? null : 'University (Semester setup)' },
    { text: courseLine ?? '', missing: courseLine ? null : 'Course' },
    { text: String(input.course?.fields.instructor ?? ''), missing: input.course?.fields.instructor ? null : 'Instructor (Semester setup → Modify course)' },
    { text: longDate(input.due) ?? '', missing: longDate(input.due) ? null : 'Due date' },
  ];
}

export function TitlePage({ record }: { record: ConfirmedRecord }) {
  const { service, version, refresh } = useApp();
  const { data } = useAsync(async () => ({
    student: await service.student(),
    uni: (await service.repository.listRecords('university'))[0] ?? null,
    course: (await service.repository.listRecords('course')).find((c) => c.fields.code === record.fields.courseCode) ?? null,
  }), [version, record.id]);
  const [title, setTitle] = useState(String(record.fields.paperTitle ?? ''));
  const [copied, setCopied] = useState(false);
  if (!data) return null;

  const lines = titlePageLines({
    title: String(record.fields.paperTitle ?? ''),
    student: data.student.name,
    university: (data.uni?.fields.name as string | null) ?? null,
    course: data.course,
    due: (record.fields.dueDate as AcademicDate | null) ?? null,
  });
  const missing = lines.filter((l) => l.missing).map((l) => l.missing);

  return (
    <div className="card">
      <h2>Title page</h2>
      <p className="muted small">APA 7 student format, the way you lay out your papers: Times New Roman 12, double spaced, page number top right.</p>
      <div className="row">
        <label style={{ flex: 1 }}>Paper title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A Descriptive Title for the Paper" />
        </label>
        <button type="button" style={{ alignSelf: 'flex-end' }} disabled={title === String(record.fields.paperTitle ?? '')} onClick={async () => {
          await service.repository.correctRecord(record.id, { paperTitle: title.trim() || null });
          refresh();
        }}>Save title</button>
      </div>

      <div className="paper" aria-label="Title page preview">
        <span className="page-no">1</span>
        <div className="title-block">
          {lines.map((l, i) => (
            <p key={i} className={`${l.bold ? 'bold' : ''} ${l.missing ? 'placeholder' : ''}`}>{l.missing ? `[${l.missing}]` : l.text}</p>
          ))}
        </div>
      </div>

      {missing.length > 0 && <p className="muted small">Still needed: {missing.join(', ')}.</p>}
      <button type="button" className="secondary" disabled={missing.length > 0} onClick={async () => {
        await navigator.clipboard?.writeText(lines.map((l) => l.text).join('\n'));
        setCopied(true);
      }}>{copied ? 'Copied' : 'Copy title page text'}</button>
    </div>
  );
}
