import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { AcademicDate, ConfirmedRecord } from '../../core/types';
import { parseCourseList } from '../../core/extract/courseList';
import { dateFromInputs, errorMessage, formatDate } from '../format';
import { FeedCard } from './FeedCard';

/**
 * Semester setup. Saved sections are shown read-only with a Modify button;
 * nothing here needs review because the student typed it.
 */

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

function guessSeason(today: string): string {
  const m = Number(today.slice(5, 7));
  return m <= 5 ? 'Spring' : m <= 7 ? 'Summer' : 'Fall';
}

function Saved({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="saved-values">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd className={v ? '' : 'none'}>{v || 'Not set'}</dd></div>
      ))}
    </dl>
  );
}

export function Setup() {
  const { service, version, refresh, today, go } = useApp();
  const { data } = useAsync(async () => ({
    student: await service.student(),
    uni: (await service.repository.listRecords('university'))[0] ?? null,
    onboarding: await service.onboarding(),
    courses: await service.repository.listRecords('course'),
  }), [version]);

  const [editSchool, setEditSchool] = useState(false);
  const [editSemester, setEditSemester] = useState(false);
  const [name, setName] = useState('');
  const [uni, setUni] = useState('');
  const [program, setProgram] = useState('');
  const [season, setSeason] = useState(guessSeason(today));
  const [year, setYear] = useState(today.slice(0, 4));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [course, setCourse] = useState({ code: '', name: '', instructor: '' });
  const [listText, setListText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fillFromSaved = () => {
    if (!data) return;
    setName(data.student.name);
    setUni(String(data.uni?.fields.name ?? ''));
    setProgram(String(data.uni?.fields.program ?? ''));
    const sem = data.onboarding.currentSemester;
    if (sem) {
      const m = /^(\w+)\s+(\d{4})$/.exec(String(sem.fields.name ?? ''));
      if (m) { setSeason(m[1]); setYear(m[2]); }
      setStart((sem.fields.startDate as AcademicDate | null)?.iso ?? '');
      setEnd((sem.fields.endDate as AcademicDate | null)?.iso ?? '');
    }
  };
  useEffect(fillFromSaved, [data]);

  const parsed = useMemo(() => parseCourseList(listText), [listText]);
  if (!data) return <p className="muted">Loading…</p>;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setMessage(label);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const schoolSaved = !!data.uni || !!data.student.name;
  const sem = data.onboarding.currentSemester;
  const weeks = start && end && end >= start ? Math.round(((Date.parse(end) - Date.parse(start)) / 86_400_000 + 1) / 7) : null;
  const semDates = sem && (sem.fields.startDate || sem.fields.endDate)
    ? `${formatDate(sem.fields.startDate as AcademicDate)} to ${formatDate(sem.fields.endDate as AcademicDate)}`
    : null;

  return (
    <section aria-labelledby="setup-title">
      <div className="page-head">
        <span className="chip">set up</span>
        <h1 id="setup-title">Your semester</h1>
        <p>Three short steps, plus an optional calendar feed. Everything is saved on this computer, and you can change it later.</p>
      </div>

      <ol className="wizard">
        {/* 01 school */}
        <li className={`card ${schoolSaved && !editSchool ? 'is-saved' : ''}`}>
          <span className="n">01</span>
          <div>
            <h2>You and your school {schoolSaved && !editSchool && <span className="saved-mark">saved</span>}</h2>
            {schoolSaved && !editSchool ? (
              <>
                <Saved rows={[['Your name', data.student.name], ['University', data.uni?.fields.name as string], ['Degree or program', data.uni?.fields.program as string]]} />
                <button type="button" className="modify" onClick={() => { fillFromSaved(); setEditSchool(true); }}>Modify</button>
              </>
            ) : (
              <>
                <div className="grid">
                  <label>Your name (for title pages)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
                  <label>University<input value={uni} onChange={(e) => setUni(e.target.value)} placeholder="Example State University" /></label>
                  <label>Degree or program<input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="MBA" /></label>
                </div>
                <div className="row">
                  <button type="button" disabled={!uni.trim()} onClick={() => run('School saved', async () => {
                    await service.saveStudent({ name });
                    await service.saveProfile(uni, program);
                    setEditSchool(false);
                  })}>Save school</button>
                  {editSchool && <button type="button" className="secondary" onClick={() => setEditSchool(false)}>Cancel</button>}
                </div>
              </>
            )}
          </div>
        </li>

        {/* 02 semester */}
        <li className={`card ${sem && !editSemester ? 'is-saved' : ''}`}>
          <span className="n">02</span>
          <div>
            <h2>Semester {sem && !editSemester && <span className="saved-mark">saved</span>}</h2>
            {sem && !editSemester ? (
              <>
                <Saved rows={[
                  ['Term', sem.fields.name as string],
                  ['Dates', semDates],
                  ['Length', typeof sem.fields.durationWeeks === 'number' ? `${sem.fields.durationWeeks} weeks` : null],
                ]} />
                {!semDates && <p className="muted small">Add the first and last day so reminders know when the semester ends.</p>}
                <button type="button" className="modify" onClick={() => { fillFromSaved(); setEditSemester(true); }}>Modify</button>
              </>
            ) : (
              <>
                <div className="grid">
                  <label>Term<select value={season} onChange={(e) => setSeason(e.target.value)}>{SEASONS.map((s) => <option key={s}>{s}</option>)}</select></label>
                  <label>Year<input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
                  <label>First day<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
                  <label>Last day<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
                </div>
                <p className="muted small">{weeks ? `${weeks} weeks.` : 'Dates let the app place deadlines that are written without a year.'}</p>
                <div className="row">
                  <button
                    type="button"
                    disabled={year.length !== 4 || (!!start && !!end && end < start)}
                    onClick={() => run('Semester saved', async () => {
                      await service.saveSemester({
                        name: `${season} ${year}`,
                        start: dateFromInputs(start, '', ''),
                        end: dateFromInputs(end, '', ''),
                      });
                      setEditSemester(false);
                    })}
                  >Save semester</button>
                  {editSemester && <button type="button" className="secondary" onClick={() => setEditSemester(false)}>Cancel</button>}
                </div>
              </>
            )}
          </div>
        </li>

        {/* 03 courses */}
        <li className="card">
          <span className="n">03</span>
          <div>
            <h2>Courses this semester {data.courses.length > 0 && <span className="saved-mark">{data.courses.length} saved</span>}</h2>
            {data.courses.length > 0 && (
              <ul className="saved-courses">
                {data.courses.map((c) => <CourseRow key={c.id} course={c} onDone={(m) => run(m, async () => undefined)} />)}
              </ul>
            )}

            <h3 className="sub">Paste your course list</h3>
            <p className="muted small">In Canvas, open Courses → All Courses, select the list and copy it. Or type one course per line, like "BUS 610 Strategic Management".</p>
            <textarea aria-label="Course list" rows={5} value={listText} onChange={(e) => setListText(e.target.value)} placeholder="2026FA Strategic Management (BUS-610-7AB12)" />
            {parsed.length > 0 && (
              <ul className="parsed-courses" aria-label="Courses found">
                {parsed.map((c) => (
                  <li key={c.code}>
                    <strong>{c.code}</strong> {c.name}
                    <span className="muted small">{[c.section && `section ${c.section}`, c.term].filter(Boolean).join(' · ')}</span>
                    {data.courses.some((x) => x.fields.code === c.code) && <span className="tag">already saved, will update</span>}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" disabled={parsed.length === 0} onClick={() => run(`${parsed.length} course${parsed.length === 1 ? '' : 's'} added`, async () => {
              await service.addCourses(parsed);
              setListText('');
            })}>{parsed.length ? `Add ${parsed.length} course${parsed.length === 1 ? '' : 's'}` : 'Add courses'}</button>

            <h3 className="sub">Or add one course</h3>
            <div className="grid">
              <label>Course code<input value={course.code} onChange={(e) => setCourse({ ...course, code: e.target.value })} placeholder="BUS 610" /></label>
              <label>Course name<input value={course.name} onChange={(e) => setCourse({ ...course, name: e.target.value })} placeholder="Strategic Management" /></label>
              <label>Instructor (optional)<input value={course.instructor} onChange={(e) => setCourse({ ...course, instructor: e.target.value })} /></label>
            </div>
            <button
              type="button"
              disabled={!/^[A-Za-z]{2,4}\s*-?\s*\d{3,4}[A-Za-z]?$/.test(course.code.trim())}
              onClick={() => run(`${course.code.toUpperCase().replace(/[-\s]+/, ' ')} added`, async () => {
                await service.addCourse(course);
                setCourse({ code: '', name: '', instructor: '' });
              })}
            >Add course</button>
            {!sem && <p className="muted small">Tip: a pasted Canvas list sets the semester name for you.</p>}
          </div>
        </li>

        {/* 04 calendar feed */}
        <li className="card">
          <span className="n">04</span>
          <div>
            <h2>Calendar feed <span className="muted small">optional</span></h2>
            <FeedCard />
          </div>
        </li>
      </ol>

      {message && <p role="status" className="saved">✓ {message}</p>}
      {error && <p role="alert" className="error">{error}</p>}

      <div className="row">
        <button type="button" className="secondary" onClick={() => go({ name: 'courses' })}>Go to my courses →</button>
        <button type="button" className="link" onClick={() => go({ name: 'add' })}>or fill this in from a syllabus</button>
      </div>
    </section>
  );
}

function CourseRow({ course, onDone }: { course: ConfirmedRecord; onDone: (message: string) => void }) {
  const { service, refresh } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(String(course.fields.name ?? ''));
  const [instructor, setInstructor] = useState(String(course.fields.instructor ?? ''));
  const code = String(course.fields.code);

  if (!editing) {
    return (
      <li>
        <div className="course-line">
          <strong>{code}</strong>
          <span>{String(course.fields.name ?? 'Name not set')}</span>
          <span className="muted small">
            {[course.fields.instructor && String(course.fields.instructor), course.fields.section && `section ${String(course.fields.section)}`].filter(Boolean).join(' · ') || 'Instructor not set'}
          </span>
        </div>
        <span className="actions">
          <button type="button" className="modify small-btn" aria-label={`Modify ${code}`} onClick={() => setEditing(true)}>Modify</button>
          <button type="button" className="link muted-link" aria-label={`Remove ${code}`} onClick={async () => { await service.removeCourse(course.id); refresh(); onDone(`${code} removed`); }}>remove</button>
        </span>
      </li>
    );
  }
  return (
    <li className="editing">
      <div className="grid">
        <label>Course name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Instructor<input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="Dr. Jane Doe" /></label>
      </div>
      <span className="actions">
        <button type="button" className="small-btn" onClick={async () => {
          await service.addCourse({ code, name, instructor });
          setEditing(false);
          refresh();
          onDone(`${code} updated`);
        }}>Save</button>
        <button type="button" className="secondary small-btn" onClick={() => setEditing(false)}>Cancel</button>
      </span>
    </li>
  );
}
