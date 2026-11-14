import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { addDays } from '../../core/extract/dates';
import { remindersDueToday } from '../../core/reminders/deadlineReminders';
import type { AcademicDate } from '../../core/types';
import { formatDate, formatTime } from '../format';
import type { Tab } from '../App';

export function Home({ goTo }: { goTo: (tab: Tab) => void }) {
  const { service, version, refresh, today } = useApp();
  const { data } = useAsync(async () => ({
    onboarding: await service.onboarding(),
    prompt: await service.subjectPrompt(today),
    next: await service.nextSemesterSettings(),
    deadlines: await service.upcomingDeadlines(today, 14),
    reminders: remindersDueToday(await service.upcomingReminders(today), today),
    pending: (await service.repository.listProposals('pending')).length,
    courses: (await service.repository.listRecords('course')).length,
  }), [version, today]);

  if (!data) return <p className="muted">Loading…</p>;
  const { onboarding, prompt, deadlines, reminders, pending, next, courses } = data;
  const semester = onboarding.questions.find((q) => q.id === 'semester')?.answer;

  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <span className="chip">{semester ? semester.toLowerCase() : 'welcome'}</span>
        <h1 id="home-title" className="display">Your semester</h1>
        <p className="lede">Deadlines, readings and requirements from your own course material, checked and confirmed by you.</p>
        {pending > 0 ? (
          <button type="button" className="link lede-link" onClick={() => goTo('review')}>{pending} item{pending === 1 ? '' : 's'} waiting for review →</button>
        ) : (
          <button type="button" className="link lede-link" onClick={() => goTo('add')}>add course material →</button>
        )}

        <div className="stats">
          <div className="stat"><span className="num">{courses}</span><span className="what">course{courses === 1 ? '' : 's'} this semester</span></div>
          <div className="stat"><span className="num">{deadlines.length}</span><span className="what">due in the next 14 days</span></div>
          <div className="stat"><span className="num">{pending}</span><span className="what">waiting for your review</span></div>
        </div>
      </section>

      {prompt.show && <SubjectPrompt onDone={refresh} />}

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
          <p className="muted small" style={{ marginTop: 12 }}>Reminders show while the app is open. Notifications when the app is closed are not available yet.</p>
        </section>
      )}

      {!onboarding.complete && (
        <section aria-labelledby="setup-title">
          <span className="chip">set up</span>
          <h2 id="setup-title">Set up your semester</h2>
          <p className="muted">Answer by typing, or upload a syllabus or course schedule and the answers fill in from it. You can stop and come back later.</p>
          <ol className="steps">
            {onboarding.questions.map((q, i) => (
              <li key={q.id} className={q.answer ? 'done' : q.id === onboarding.nextQuestion?.id ? 'current' : ''}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span className="q">{q.prompt}</span>
                <span className={q.answer ? 'a' : 'a none'}>{q.answer ?? 'Not answered yet'}</span>
              </li>
            ))}
          </ol>
          <div className="row"><button type="button" onClick={() => goTo('add')}>Start adding →</button></div>
        </section>
      )}

      <section aria-labelledby="due-title">
        <span className="chip">next two weeks</span>
        <h2 id="due-title">Due in the next 14 days</h2>
        {deadlines.length === 0 ? <p className="muted">No confirmed deadlines in the next two weeks.</p> : (
          <ul className="deadlines">
            {deadlines.map((r) => {
              const d = (r.fields.dueDate ?? r.fields.date) as AcademicDate;
              const exam = r.fields.kind === 'exam' || r.fields.type === 'exam';
              return (
                <li key={r.id}>
                  <span className="date">{formatDate(d)}</span>
                  <span className="title">{String(r.fields.title)}</span>
                  <span>
                    {r.fields.courseCode ? <span className="tag">{String(r.fields.courseCode)}</span> : null}
                    {exam ? <span className="tag kind-conflict">exam</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {onboarding.complete && prompt.nextDate && !prompt.show && (
          <p className="muted small" style={{ marginTop: 16 }}>Next semester's subjects will be asked on {prompt.nextDate}.</p>
        )}
        {next.subjectsConfirmed && next.subjects.length > 0 && <p className="muted small">Next semester: {next.subjects.join(', ')}</p>}
      </section>

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
