import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext, localToday, type AppContextValue, type Route } from './AppContext';
import type { AcademicService } from '../core/service';
import { Home } from './components/Home';
import { AddInfo } from './components/AddInfo';
import { Review } from './components/Review';
import { AssignmentWorkspace, CourseList, CoursePage } from './components/Courses';
import { Features, Sources } from './components/Sources';
import { Setup } from './components/Setup';
import { useAsync } from './useAsync';
import { Calendar } from './components/Calendar';
import { Chat } from './components/Chat';
import { useBackgroundReminders, useReminderLoop } from './useReminderLoop';
import { Tour } from './components/Guide';
import { Toasts, type Toast } from './ux';
import { Breadcrumbs, type Crumb } from './components/Breadcrumbs';

/** The four main areas live in the bottom dock. */
const DOCK: { route: Route['name']; label: string; verb: string }[] = [
  { route: 'home', label: 'Home', verb: 'this week' },
  { route: 'calendar', label: 'Calendar', verb: 'see it' },
  { route: 'courses', label: 'Courses', verb: 'plan it' },
  { route: 'review', label: 'Review', verb: 'confirm it' },
  { route: 'sources', label: 'Imported material', verb: 'trace it' },
  { route: 'chat', label: 'Chat', verb: 'ask it' },
];

const AREA: Record<Route['name'], Route['name']> = {
  home: 'home', setup: 'home', add: 'home', courses: 'courses', course: 'courses', assignment: 'courses',
  review: 'review', sources: 'sources', features: 'features', calendar: 'calendar', chat: 'chat',
};

/** Breadcrumbs for pages outside a course (course pages draw their own). */
const TOP_CRUMBS: Partial<Record<Route['name'], Crumb[]>> = {
  setup: [{ label: 'Semester setup' }],
  add: [{ label: 'Import a syllabus' }],
  courses: [{ label: 'Courses' }],
  calendar: [{ label: 'Calendar' }],
  review: [{ label: 'Review' }],
  sources: [{ label: 'Imported material' }],
  features: [{ label: 'Features' }],
};

function useClock(): string {
  const fmt = () => {
    const d = new Date();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const tz = new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
    return `${time} ${tz}`;
  };
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const t = setInterval(() => setNow(fmt()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function App({ service, mode, today }: { service: AcademicService; mode: AppContextValue['mode']; today?: string }) {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const go = useCallback((r: Route) => {
    setRoute(r);
    window.scrollTo?.({ top: 0 });
  }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, undo?: Toast['undo']) => {
    const id = nextToast.current++;
    setToasts((t) => [...t.slice(-2), { id, text, undo: undo ? async () => { await undo(); refresh(); } : undefined }]);
    setTimeout(() => dismiss(id), 6000);
  }, [dismiss, refresh]);
  const ctx = useMemo<AppContextValue>(() => ({ service, version, refresh, today: today ?? localToday(), mode, go, toast }), [service, version, refresh, today, mode, go, toast]);
  useReminderLoop(service, mode !== 'browser-preview', ctx.today, toast);
  useBackgroundReminders(service, version, ctx.today, toast);
  useEffect(() => {
    if (mode === 'test') return;
    void service.ensureCourses().then((n) => { if (n > 0) refresh(); });
  }, [service, version, mode, refresh]);
  const { data: pending } = useAsync(() => service.repository.listProposals('pending').then((p) => p.length), [version]);
  const clock = useClock();
  const [tour, setTour] = useState(false);
  useEffect(() => {
    if (mode === 'test') return;
    void service.repository.getSetting<boolean>('tour.done', false).then((d) => { if (!d) setTour(true); });
  }, [service, mode]);
  const closeTour = useCallback(() => { setTour(false); void service.repository.setSetting('tour.done', true); }, [service]);
  const area = AREA[route.name];

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <button type="button" className="wordmark" onClick={() => go({ name: 'home' })}>Assignment Rescue</button>
          <nav aria-label="Main">
            <button type="button" className={route.name === 'setup' ? 'active' : ''} aria-current={route.name === 'setup' ? 'page' : undefined} onClick={() => go({ name: 'setup' })}>Semester setup</button>
            <button type="button" className={route.name === 'add' ? 'active' : ''} aria-current={route.name === 'add' ? 'page' : undefined} onClick={() => go({ name: 'add' })}>Import a syllabus</button>
            <button type="button" onClick={() => setTour(true)}>Take the tour</button>
            <button type="button" className={route.name === 'features' ? 'active' : ''} aria-current={route.name === 'features' ? 'page' : undefined} onClick={() => go({ name: 'features' })}>Features</button>
          </nav>
          {mode === 'browser-preview' && <span className="preview-note">browser preview</span>}
          <span className="clock" aria-label="Local time">{clock}</span>
        </header>

        <main key={`${route.name}-${'code' in route ? route.code : ''}-${'id' in route ? route.id : ''}-${'tab' in route ? route.tab : ''}-${'section' in route ? route.section : ''}`} className="route">
          {TOP_CRUMBS[route.name] && route.name !== 'home' && <Breadcrumbs trail={[{ label: 'Home', route: { name: 'home' } }, ...(TOP_CRUMBS[route.name] as Crumb[])]} />}
          {route.name === 'home' && <Home />}
          {route.name === 'setup' && <Setup />}
          {route.name === 'add' && <AddInfo onImported={() => go({ name: 'review' })} />}
          {route.name === 'courses' && <CourseList />}
          {route.name === 'course' && <CoursePage code={route.code} tab={route.tab} addKind={route.addKind} forAssignment={route.forAssignment} unit={route.unit} />}
          {route.name === 'assignment' && <AssignmentWorkspace id={route.id} section={route.section} />}
          {route.name === 'review' && <Review />}
          {route.name === 'sources' && <Sources />}
          {route.name === 'features' && <Features />}
          {route.name === 'calendar' && <Calendar />}
          {route.name === 'chat' && <Chat code={route.code} assignmentId={route.assignmentId} />}
        </main>
        <Toasts items={toasts} dismiss={dismiss} />
        {tour && <Tour onClose={closeTour} />}

        <nav className="dock" aria-label="Workflow">
          {DOCK.map((d) => {
            const count = d.route === 'review' && pending ? pending : 0;
            return (
              <button
                key={d.route}
                type="button"
                className={`${area === d.route ? 'active' : ''} ${d.route === 'chat' ? 'dock-chat' : ''}`.trim()}
                aria-current={area === d.route ? 'page' : undefined}
                aria-label={count ? `${d.label}, ${count} pending` : d.label}
                onClick={() => go({ name: d.route } as Route)}
              >
                <span>{d.label}{count ? <span className="badge">{count}</span> : null}</span>
                <span className="verb">{d.verb}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </AppContext.Provider>
  );
}
