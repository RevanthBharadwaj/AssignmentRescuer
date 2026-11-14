import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import type { AcademicDate } from '../../core/types';
import { dateFromInputs, errorMessage } from '../format';

/**
 * Semester setup. Real fields, saved as you go. Nothing here needs review:
 * the student is typing their own details.
 */

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

function guessSeason(today: string): string {
  const m = Number(today.slice(5, 7));
  return m <= 5 ? 'Spring' : m <= 7 ? 'Summer' : 'Fall';
}

export function Setup() {
  const { service, version, refresh, today, go } = useApp();
  const { data } = useAsync(async () => ({
    uni: (await service.repository.listRecords('university'))[0] ?? null,
    onboarding: await service.onboarding(),
    courses: await service.repository.listRecords('course'),
  }), [version]);

  const [uni, setUni] = useState('');
  const [program, setProgram] = useState('');
  const [season, setSeason] = useState(guessSeason(today));
  const [year, setYear] = useState(today.slice(0, 4));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [course, setCourse] = useState({ code: '', name: '', instructor: '' });
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefill from what is already confirmed (typed earlier or imported).
  useEffect(() => {
    if (!data) return;
    if (data.uni) {
      setUni(String(data.uni.fields.name ?? ''));
      setProgram(String(data.uni.fields.program ?? ''));
    }
    const sem = data.onboarding.currentSemester;
    if (sem) {
      const m = /^(\w+)\s+(\d{4})$/.exec(String(sem.fields.name ?? ''));
      if (m) { setSeason(m[1]); setYear(m[2]); }
      setStart((sem.fields.startDate as AcademicDate | null)?.iso ?? '');
      setEnd((sem.fields.endDate as AcademicDate | null)?.iso ?? '');
    }
  }, [data]);

  if (!data) return <p className="muted">Loading…</p>;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setSaved(label);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const weeks = start && end && end >= start ? Math.round(((Date.parse(end) - Date.parse(start)) / 86_400_000 + 1) / 7) : null;
  const semesterDone = !!data.onboarding.currentSemester;

  return (
    <section aria-labelledby="setup-title">
      <div className="page-head">
        <span className="chip">set up</span>
        <h1 id="setup-title">Your semester</h1>
        <p>Three short steps. Everything is saved on this computer, and you can change it later.</p>
      </div>

      <ol className="wizard">
        <li className="card">
          <span className="n">01</span>
          <div>
            <h2>School</h2>
            <div className="grid two">
              <label>University<input value={uni} onChange={(e) => setUni(e.target.value)} placeholder="University of North Florida" /></label>
              <label>Degree or program<input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="MS in Computing and Information Sciences" /></label>
            </div>
            <button type="button" disabled={!uni.trim()} onClick={() => run('School saved', () => service.saveProfile(uni, program))}>Save school</button>
          </div>
        </li>

        <li className="card">
          <span className="n">02</span>
          <div>
            <h2>Semester</h2>
            <div className="grid">
              <label>Term<select value={season} onChange={(e) => setSeason(e.target.value)}>{SEASONS.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label>Year<input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
              <label>First day<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label>Last day<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            <p className="muted small">{weeks ? `${weeks} weeks.` : 'Dates let the app place deadlines that are written without a year.'}</p>
            <button
              type="button"
              disabled={year.length !== 4 || (!!start && !!end && end < start)}
              onClick={() => run('Semester saved', () => service.saveSemester({
                name: `${season} ${year}`,
                start: dateFromInputs(start, '', '') as AcademicDate | null,
                end: dateFromInputs(end, '', '') as AcademicDate | null,
              }))}
            >Save semester</button>
          </div>
        </li>

        <li className="card">
          <span className="n">03</span>
          <div>
            <h2>Courses this semester</h2>
            {data.courses.length > 0 && (
              <ul className="course-chips">
                {data.courses.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="link" onClick={() => go({ name: 'course', code: String(c.fields.code) })}>
                      {String(c.fields.code)}{c.fields.name ? ` ${String(c.fields.name)}` : ''}
                    </button>
                    <button type="button" className="link muted-link" aria-label={`Remove ${String(c.fields.code)}`} onClick={() => run('Course removed', () => service.removeCourse(c.id))}>remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid">
              <label>Course code<input value={course.code} onChange={(e) => setCourse({ ...course, code: e.target.value })} placeholder="MGT 6200" /></label>
              <label>Course name<input value={course.name} onChange={(e) => setCourse({ ...course, name: e.target.value })} placeholder="Leadership Theories" /></label>
              <label>Instructor (optional)<input value={course.instructor} onChange={(e) => setCourse({ ...course, instructor: e.target.value })} /></label>
            </div>
            <button
              type="button"
              disabled={!/^[A-Za-z]{2,4}\s*-?\s*\d{3,4}[A-Za-z]?$/.test(course.code.trim())}
              onClick={() => run(`${course.code.toUpperCase()} added`, async () => {
                await service.addCourse(course);
                setCourse({ code: '', name: '', instructor: '' });
              })}
            >Add course</button>
            {!semesterDone && <p className="muted small">Tip: save the semester first so each course is filed under it.</p>}
          </div>
        </li>
      </ol>

      {saved && <p role="status" className="saved">✓ {saved}</p>}
      {error && <p role="alert" className="error">{error}</p>}

      <div className="row">
        <button type="button" className="secondary" onClick={() => go({ name: 'courses' })}>Go to my courses →</button>
        <button type="button" className="link" onClick={() => go({ name: 'add' })}>or fill this in from a syllabus</button>
      </div>
    </section>
  );
}
