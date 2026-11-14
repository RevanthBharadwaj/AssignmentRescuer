import { useState } from 'react';
import { useApp } from '../AppContext';
import { useAsync } from '../useAsync';
import { addDays } from '../../core/extract/dates';
import { remindersDueToday } from '../../core/reminders/deadlineReminders';
import type { AcademicDate } from '../../core/types';
import { formatDate, formatTime } from '../format';

export function Home({ goTo }: { goTo: (tab: 'add' | 'review' | 'courses') => void }) {
  const { service, version, refresh, today } = useApp();
  const { data } = useAsync(async () => ({
    onboarding: await service.onboarding(),
    prompt: await service.subjectPrompt(today),
    next: await service.nextSemesterSettings(),
    deadlines: await service.upcomingDeadlines(today, 14),
    reminders: remindersDueToday(await service.upcomingReminders(today), today),
    pending: (await service.repository.listProposals('pending')).length,
  }), [version, today]);

  if (!data) return <p>Loading…</p>;
  const { onboarding, prompt, deadlines, reminders, pending, next } = data;

  return (
    <section aria-labelledby="home-title">
      <h1 id="home-title">Your semester</h1>

      {pending > 0 && (
        <div className="card notice">
          {pending} extracted item{pending === 1 ? '' : 's'} waiting for your review. <button type="button" className="link" onClick={() => goTo('review')}>Review now</button>
        </div>
      )}

      {!onboarding.complete && (
        <div className="card">
          <h2>Set up your semester</h2>
          <p className="muted">Answer by typing, or upload a syllabus or course schedule and we will fill in what we can. You can stop and come back later.</p>
          <ol className="onboarding">
            {onboarding.questions.map((q) => (
              <li key={q.id} className={q.answer ? 'done' : q.id === onboarding.nextQuestion?.id ? 'current' : ''}>
                <span>{q.prompt}</span> {q.answer ? <strong>{q.answer}</strong> : <span className="muted">Not answered yet</span>}
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => goTo('add')}>Add information</button>
        </div>
      )}

      {prompt.show && <SubjectPrompt onDone={refresh} />}
      {!prompt.show && prompt.nextDate && onboarding.complete && (
        <p className="muted small">We will ask about next semester's subjects on {prompt.nextDate}.</p>
      )}
      {next.subjectsConfirmed && next.subjects.length > 0 && <p className="muted small">Next semester: {next.subjects.join(', ')}</p>}

      {reminders.length > 0 && (
        <div className="card notice" role="status">
          <h2>Reminders for today</h2>
          <ul>{reminders.map((r) => <li key={`${r.recordId}-${r.offsetDays}`}>{r.title}{r.courseCode ? ` (${r.courseCode})` : ''}: {r.offsetDays === 0 ? 'due today' : `due in ${r.offsetDays} day${r.offsetDays === 1 ? '' : 's'}`}{r.dueTime ? ` at ${formatTime(r.dueTime)}` : ''}</li>)}</ul>
          <p className="muted small">Reminders show while the app is open. Notifications when the app is closed are not available yet.</p>
        </div>
      )}

      <div className="card">
        <h2>Due in the next 14 days</h2>
        {deadlines.length === 0 ? <p className="muted">No confirmed deadlines in the next two weeks.</p> : (
          <ul className="deadlines">
            {deadlines.map((r) => {
              const d = (r.fields.dueDate ?? r.fields.date) as AcademicDate;
              return (
                <li key={r.id}>
                  <span className="date">{formatDate(d)}</span>
                  <span>{String(r.fields.title)}</span>
                  {r.fields.courseCode ? <span className="tag">{String(r.fields.courseCode)}</span> : null}
                  {r.fields.kind === 'exam' || r.fields.type === 'exam' ? <span className="tag kind-conflict">Exam</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
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
    <div className="card notice" role="dialog" aria-labelledby="next-sem">
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
    </div>
  );
}
