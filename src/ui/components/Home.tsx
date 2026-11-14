import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { addDays } from '../../core/extract/dates';
import { remindersDueToday } from '../../core/reminders/deadlineReminders';
import type { AcademicDate } from '../../core/types';
import { formatDate, formatTime } from '../format';
import { CountUp, CourseDot, StatusButton, Urgency, statusOf } from '../ux';

export function Home() {
  const { service, version, refresh, today, go } = useApp();
  const { data } = useAsync(async () => {
    const records = await service.repository.listRecords();
    return {
      onboarding: await service.onboarding(),
      prompt: await service.subjectPrompt(today),
      next: await service.nextSemesterSettings(),
      deadlines: await service.upcomingDeadlines(today, 14),
      reminders: remindersDueToday(await service.upcomingReminders(today), today),
      pending: (await service.repository.listProposals('pending')).length,
      courses: records.filter((r) => r.entityType === 'course'),
      undated: records.filter((r) => r.entityType === 'assignment' && !r.fields.dueDate),
    };
  }, [version, today]);

  if (!data) return <p className="muted">Loading…</p>;
  const { onboarding, prompt, deadlines, reminders, pending, next, courses, undated } = data;
  const semester = onboarding.questions.find((q) => q.id === 'semester')?.answer;
  const weekEnd = addDays(today, 7);
  const thisWeek = deadlines.filter((r) => ((r.fields.dueDate ?? r.fields.date) as AcademicDate).iso! <= weekEnd);
  const later = deadlines.filter((r) => ((r.fields.dueDate ?? r.fields.date) as AcademicDate).iso! > weekEnd);
  const courseName = (code: unknown) => courses.find((c) => c.fields.code === code)?.fields.name;

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
          {r.fields.courseCode ? <button type="button" className="tag as-button" title={String(courseName(r.fields.courseCode) ?? '')} onClick={() => go({ name: 'course', code: String(r.fields.courseCode) })}><CourseDot code={r.fields.courseCode} /> {String(r.fields.courseCode)}</button> : null}
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
        <h1 id="home-title" className="display">Your semester</h1>
        <p className="lede">Every deadline from your courses in one place, taken from your own course pages and confirmed by you.</p>
        {courses.length === 0 ? (
          <button type="button" className="link lede-link" onClick={() => go({ name: 'setup' })}>set up your semester →</button>
        ) : pending > 0 ? (
          <button type="button" className="link lede-link" onClick={() => go({ name: 'review' })}>{pending} item{pending === 1 ? '' : 's'} waiting for review →</button>
        ) : (
          <button type="button" className="link lede-link" onClick={() => go({ name: 'courses' })}>open your courses →</button>
        )}

        <div className="stats">
          <button type="button" className="stat" onClick={() => go({ name: 'courses' })}><span className="num"><CountUp value={courses.length} /></span><span className="what">course{courses.length === 1 ? '' : 's'} this semester →</span></button>
          <button type="button" className="stat" onClick={() => go({ name: 'calendar' })}><span className="num"><CountUp value={thisWeek.filter((r) => statusOf(r) !== 'submitted').length} /></span><span className="what">still due in the next 7 days →</span></button>
          <button type="button" className="stat" onClick={() => go({ name: 'review' })}><span className="num"><CountUp value={pending} /></span><span className="what">waiting for your review →</span></button>
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
            {reminders.map((r) => (
              <li key={`${r.recordId}-${r.offsetDays}`}>
                <span className="date">{r.offsetDays === 0 ? 'due today' : `due in ${r.offsetDays} day${r.offsetDays === 1 ? '' : 's'}`}{r.dueTime ? ` · ${formatTime(r.dueTime)}` : ''}</span>
                <span className="title">{r.title}</span>
                {r.courseCode ? <span className="tag">{r.courseCode}</span> : <span />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="due-title">
        <span className="chip">this week</span>
        <h2 id="due-title">Due in the next 7 days</h2>
        {thisWeek.length === 0 ? <p className="muted">Nothing confirmed is due this week.</p> : <ul className="deadlines">{thisWeek.map(row)}</ul>}
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
                <span>{r.fields.courseCode ? <span className="tag">{String(r.fields.courseCode)}</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {onboarding.complete && prompt.nextDate && !prompt.show && (
        <p className="muted small" style={{ marginTop: 40 }}>Next semester's subjects will be asked on {prompt.nextDate}.</p>
      )}
      {next.subjectsConfirmed && next.subjects.length > 0 && <p className="muted small">Next semester: {next.subjects.join(', ')}</p>}

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
