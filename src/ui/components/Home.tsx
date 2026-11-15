import { useState } from 'react';
import { Hint } from './Guide';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { addDays } from '../../core/extract/dates';
import { remindersDueToday } from '../../core/reminders/deadlineReminders';
import type { AcademicDate } from '../../core/types';
import { formatDate, formatTime } from '../format';
import { CountUp, CourseDot, StatusButton, Urgency, ProgressBar, statusOf } from '../ux';
import { Stickies } from './Stickies';
import { Calendar } from './Calendar';
import { zoneNow } from '../../core/timezone';
import { prettyDate, prettyTime } from '../../core/schedule';

function greeting(zone: string): string {
  const h = Number(zoneNow(zone).time.slice(0, 2));
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { service, version, refresh, today, go, zone, markDone } = useApp();
  const [showFinished, setShowFinished] = useState(false);
  const [only, setOnly] = useState<string | null>(null);
  const [range, setRange] = useState<'week' | 'two' | 'all'>('two');
  const { data } = useAsync(async () => {
    const records = await service.repository.listRecords();
    return {
      onboarding: await service.onboarding(),
      student: (await service.student()).name.trim().split(/\s+/)[0] ?? '',
      prompt: await service.subjectPrompt(today),
      next: await service.nextSemesterSettings(),
      deadlines: await service.upcomingDeadlines(today, 400),
      reminders: remindersDueToday(await service.upcomingReminders(today), today),
      pending: (await service.repository.listProposals('pending')).length,
      courses: records.filter((r) => r.entityType === 'course'),
      undated: records.filter((r) => r.entityType === 'assignment' && !r.fields.dueDate),
    };
  }, [version, today]);

  if (!data) return <p className="muted">Loading…</p>;
  const { onboarding, prompt, reminders, pending, next, courses, undated } = data;
  const { student } = data;
  const finishedCount = data.deadlines.filter((r) => r.fields.status === 'submitted').length;
  const inRange = (r: (typeof data.deadlines)[number]) => range === 'all' || ((r.fields.dueDate ?? r.fields.date) as AcademicDate).iso! <= addDays(today, range === 'week' ? 7 : 14);
  const deadlines = (showFinished ? data.deadlines : data.deadlines.filter((r) => r.fields.status !== 'submitted'))
    .filter((r) => !only || r.fields.courseCode === only).filter(inRange);
  const semester = onboarding.questions.find((q) => q.id === 'semester')?.answer;
  const weekEnd = addDays(today, 7);
  const thisWeek = deadlines.filter((r) => ((r.fields.dueDate ?? r.fields.date) as AcademicDate).iso! <= weekEnd);
  const later = deadlines.filter((r) => ((r.fields.dueDate ?? r.fields.date) as AcademicDate).iso! > weekEnd);
  const courseOf = (code: unknown) => courses.find((c) => c.fields.code === code);
  const courseName = (code: unknown) => String(courseOf(code)?.fields.name ?? code ?? '');
  // Shown on hover: the course name, its code and the professor.
  const courseHover = (code: unknown) => {
    const c = courseOf(code);
    return [c?.fields.name, String(code ?? ''), c?.fields.instructor ? `Professor ${String(c.fields.instructor)}` : ''].filter(Boolean).join(' · ');
  };
  // Earliest due date first, then the time of day; ties keep the order they were imported. Never by title or unit number.
  const reminderList = [...reminders].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'));

  const nextUp = deadlines.find((r) => r.entityType === 'assignment' && statusOf(r) !== 'submitted') ?? null;
  const nextDate = nextUp ? ((nextUp.fields.dueDate ?? nextUp.fields.date) as AcademicDate) : null;
  const sem = onboarding.currentSemester;
  const sStart = (sem?.fields.startDate as AcademicDate | null)?.iso ?? null;
  const sEnd = (sem?.fields.endDate as AcademicDate | null)?.iso ?? null;
  const span = sStart && sEnd && sEnd > sStart ? (() => {
    const total = (Date.parse(sEnd) - Date.parse(sStart)) / 86_400_000;
    const gone = Math.min(total, Math.max(0, (Date.parse(today) - Date.parse(sStart)) / 86_400_000));
    return { pct: Math.round((gone / total) * 100), week: Math.min(Math.ceil((gone + 1) / 7), Math.ceil(total / 7)), weeks: Math.ceil(total / 7) };
  })() : null;
  const openCount = deadlines.filter((r) => r.entityType === 'assignment' && statusOf(r) !== 'submitted').length;
  const lede = courses.length === 0 ? 'Add your courses and paste their Canvas pages, and this page fills in with what is due.'
    : nextUp ? `${openCount} thing${openCount === 1 ? '' : 's'} on your plate. The next one is ${String(nextUp.fields.title).replace(/^Unit \d+:\s*/i, '')}, ${nextDate!.iso === today ? 'due today' : `due ${prettyDate(nextDate!.iso!)}`}.`
    : 'Nothing is waiting on you right now. Enjoy it.';

  const row = (r: (typeof deadlines)[number], i: number) => {
    const d = (r.fields.dueDate ?? r.fields.date) as AcademicDate;
    const exam = r.fields.kind === 'exam' || r.fields.type === 'exam';
    return (
      <li key={r.id} className={`stagger ${statusOf(r) === 'submitted' ? 'is-done' : ''}`} style={{ ['--i' as string]: i }}>
        <span className="date">{r.entityType === 'assignment' ? <StatusButton record={r} compact /> : <span className="status-spacer" />} {formatDate(d)}</span>
        <span className="title">
          {r.entityType === 'assignment'
            ? <button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button>
            : String(r.fields.title)}
        </span>
        <span className="row-end">
          <Urgency record={r} />
          {r.fields.courseCode ? <button type="button" className="tag as-button" title={courseHover(r.fields.courseCode)} onClick={() => go({ name: 'course', code: String(r.fields.courseCode) })}><CourseDot code={r.fields.courseCode} /> {courseName(r.fields.courseCode)}</button> : null}
          {typeof r.fields.pointsPossible === 'number' ? <span className="tag">{r.fields.pointsPossible} pts</span> : null}
          {exam ? <span className="tag kind-conflict">exam</span> : null}
        </span>
      </li>
    );
  };

  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <span className="chip">{semester ? semester.toLowerCase() : 'welcome'}</span>
        <h1 id="home-title" className="display">{greeting(zone)}{student ? `, ${student}` : ''}.</h1>
        <Hint id="home" />
        <p className="lede">{lede}</p>
        {span && (
          <div className="course-progress" aria-label="Semester progress">
            <ProgressBar pct={span.pct} label="Semester progress" />
            <span className="muted small">Week {span.week} of {span.weeks} · {span.pct}% of the semester is behind you</span>
          </div>
        )}
        {courses.length === 0 ? (
          <button type="button" className="link lede-link" onClick={() => go({ name: 'setup' })}>set up your semester →</button>
        ) : pending > 0 ? (
          <button type="button" className="link lede-link" onClick={() => go({ name: 'review' })}>{pending} item{pending === 1 ? '' : 's'} waiting for review →</button>
        ) : null}

        {nextUp && (
          <div className="card next-up" aria-label="Next up">
            <span className="chip">next up</span>
            <h2 style={{ margin: '6px 0' }}>{String(nextUp.fields.title)}</h2>
            <p className="muted">{courseName(nextUp.fields.courseCode)} · {prettyDate(nextDate!.iso!)}{nextDate!.time ? ` at ${prettyTime(nextDate!.time)}` : ''} <Urgency record={nextUp} /></p>
            <div className="row">
              <button type="button" onClick={() => go({ name: 'assignment', id: nextUp.id })}>Open it</button>
              <button type="button" className="secondary" onClick={() => go({ name: 'assignment', id: nextUp.id, section: 'draft' })}>Check my draft</button>
              <button type="button" className="secondary" onClick={() => go({ name: 'chat', code: String(nextUp.fields.courseCode ?? ''), assignmentId: nextUp.id })}>Ask in Chat</button>
              <button type="button" className="secondary" onClick={() => markDone(nextUp)}>Mark as done</button>
            </div>
          </div>
        )}

        <div className="stats">
          <button type="button" className="stat" onClick={() => go({ name: 'courses' })}><span className="num"><CountUp value={courses.length} /></span><span className="what">course{courses.length === 1 ? '' : 's'} this semester →</span></button>
          <button type="button" className="stat" onClick={() => setRange('week')}><span className="num"><CountUp value={thisWeek.filter((r) => statusOf(r) !== 'submitted').length} /></span><span className="what">still due in the next 7 days</span></button>
          <button type="button" className="stat" onClick={() => go({ name: 'review' })}><span className="num"><CountUp value={pending} /></span><span className="what">waiting for your review →</span></button>
        </div>

        {courses.length > 1 && (
          <div className="legend" role="group" aria-label="Show one course">
            <button type="button" className={`legend-item ${only === null ? '' : 'off-soft'}`} aria-pressed={only === null} onClick={() => setOnly(null)}>All courses</button>
            {courses.map((c) => (
              <button key={c.id} type="button" className={`legend-item ${only === c.fields.code ? '' : 'off-soft'}`} aria-pressed={only === c.fields.code} title={courseHover(c.fields.code)} onClick={() => setOnly(only === c.fields.code ? null : String(c.fields.code))}>
                <CourseDot code={c.fields.code} /> {String(c.fields.name ?? c.fields.code)}
              </button>
            ))}
          </div>
        )}
        <div className="segmented" role="group" aria-label="How far ahead">
          {([['week', 'Next 7 days'], ['two', 'Next 2 weeks'], ['all', 'Everything']] as const).map(([id, label]) => (
            <button key={id} type="button" className={range === id ? 'on' : ''} aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>
          ))}
        </div>
      </section>

      {prompt.show && <SubjectPrompt onDone={refresh} />}

      {!onboarding.complete && (
        <section aria-labelledby="setup-title">
          <span className="chip">set up</span>
          <h2 id="setup-title">Set up your semester</h2>
          <p className="muted">Three short steps: your school, the semester dates, and your courses. Then paste each course's Canvas page into it.</p>
          <ol className="steps">
            {onboarding.questions.map((q, i) => (
              <li key={q.id} className={q.answer ? 'done' : q.id === onboarding.nextQuestion?.id ? 'current' : ''}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="q">{q.prompt}</span>
                <span className={q.answer ? 'a' : 'a none'}>{q.answer ?? 'Not answered yet'}</span>
              </li>
            ))}
          </ol>
          <div className="row"><button type="button" onClick={() => go({ name: 'setup' })}>Start setup →</button></div>
        </section>
      )}

      {reminders.length > 0 && (
        <section aria-labelledby="today-title">
          <span className="chip">today</span>
          <h2 id="today-title">Reminders for today</h2>
          <ul className="deadlines">
            {reminderList.map((r) => (
              <li key={`${r.recordId}-${r.offsetDays}`}>
                <span className="date">{r.offsetDays === 0 ? 'due today' : `due in ${r.offsetDays} day${r.offsetDays === 1 ? '' : 's'}`}{r.dueTime ? ` · ${formatTime(r.dueTime)}` : ''}</span>
                <span className="title">{r.title}</span>
                {r.courseCode ? <span className="tag" title={courseHover(r.courseCode)}>{courseName(r.courseCode)}</span> : <span />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="due-title">
        <span className="chip">this week</span>
        <h2 id="due-title">Due in the next 7 days</h2>
        {thisWeek.length === 0 ? <p className="muted">Nothing confirmed is due this week.</p> : <ul className="deadlines">{thisWeek.map(row)}</ul>}
        {finishedCount > 0 && (
          <button type="button" className="link muted-link small" aria-pressed={showFinished} onClick={() => setShowFinished((v) => !v)}>
            {showFinished ? 'Hide finished work' : `Show finished work (${finishedCount})`}
          </button>
        )}
      </section>

      {later.length > 0 && (
        <section aria-labelledby="later-title">
          <span className="chip ghost">coming up</span>
          <h2 id="later-title">The week after</h2>
          <ul className="deadlines">{later.map(row)}</ul>
        </section>
      )}

      {undated.length > 0 && (
        <section aria-labelledby="undated-title">
          <span className="chip ghost">needs a date</span>
          <h2 id="undated-title">Mentioned but not dated</h2>
          <ul className="deadlines">
            {undated.map((r, i) => (
              <li key={r.id} className="stagger" style={{ ['--i' as string]: i }}>
                <span className="date">{typeof r.fields.dueNote === 'string' ? r.fields.dueNote : 'no date yet'}</span>
                <span className="title"><button type="button" className="link plain" onClick={() => go({ name: 'assignment', id: r.id })}>{String(r.fields.title)}</button></span>
                <span>{r.fields.courseCode ? <span className="tag" title={courseHover(r.fields.courseCode)}>{courseName(r.fields.courseCode)}</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {onboarding.complete && prompt.nextDate && !prompt.show && (
        <p className="muted small" style={{ marginTop: 40 }}>Next semester's subjects will be asked on {prompt.nextDate}.</p>
      )}
      {next.subjectsConfirmed && next.subjects.length > 0 && <p className="muted small">Next semester: {next.subjects.join(', ')}</p>}

      <section aria-label="Calendar" style={{ marginTop: 32 }}>
        <Calendar embedded />
      </section>

      <Stickies />

      <div className="signature" aria-hidden="true">Rescue</div>
    </>
  );
}

function SubjectPrompt({ onDone }: { onDone: () => void }) {
  const { service, today } = useApp();
  const [subjects, setSubjects] = useState('');

  const mark = () => service.markSubjectPromptShown(today);
  const save = async () => {
    const list = subjects.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    await service.updateNextSemester({ subjectsConfirmed: true, subjects: list, lastPromptedOn: today });
    onDone();
  };
  const snooze = async () => {
    await mark();
    await service.updateNextSemester({ snoozedUntil: addDays(today, 3) });
    onDone();
  };
  const later = async () => {
    await mark();
    onDone();
  };
  const skip = async () => {
    await service.updateNextSemester({ skipping: true, lastPromptedOn: today });
    onDone();
  };
  const disable = async () => {
    await service.updateNextSemester({ remindersEnabled: false, lastPromptedOn: today });
    onDone();
  };

  return (
    <section className="card notice" role="dialog" aria-labelledby="next-sem">
      <span className="chip">next semester</span>
      <h2 id="next-sem">What subjects are you taking next semester?</h2>
      <p className="muted">Your current semester ends soon. List next semester's courses so we can set up your calendar.</p>
      <textarea rows={3} value={subjects} onChange={(e) => setSubjects(e.target.value)} aria-label="Next semester subjects" placeholder="CIS 6940 Deep Learning, STA 6166 Statistical Methods" />
      <div className="row wrap">
        <button type="button" onClick={save}>Save subjects</button>
        <button type="button" className="secondary" onClick={later}>Ask me in 14 days</button>
        <button type="button" className="secondary" onClick={snooze}>Snooze 3 days</button>
        <button type="button" className="secondary" onClick={skip}>Not enrolling next semester</button>
        <button type="button" className="link" onClick={disable}>Turn off these reminders</button>
      </div>
    </section>
  );
}
