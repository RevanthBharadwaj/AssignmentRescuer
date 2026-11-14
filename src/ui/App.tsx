import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, localToday, type AppContextValue, type Route } from './AppContext';
import type { AcademicService } from '../core/service';
import { Home } from './components/Home';
import { AddInfo } from './components/AddInfo';
import { Review } from './components/Review';
import { AssignmentWorkspace, CourseList, CoursePage } from './components/Courses';
import { Features, Sources } from './components/Sources';
import { Setup } from './components/Setup';
import { useAsync } from './useAsync';

/** The four main areas live in the bottom dock. */
const DOCK: { route: Route['name']; label: string; verb: string }[] = [
  { route: 'home', label: 'Home', verb: 'this week' },
  { route: 'courses', label: 'Courses', verb: 'plan it' },
  { route: 'review', label: 'Review', verb: 'confirm it' },
  { route: 'sources', label: 'Imported material', verb: 'trace it' },
];

const AREA: Record<Route['name'], Route['name']> = {
  home: 'home', setup: 'home', add: 'home', courses: 'courses', course: 'courses', assignment: 'courses',
  review: 'review', sources: 'sources', features: 'features',
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
  const ctx = useMemo<AppContextValue>(() => ({ service, version, refresh, today: today ?? localToday(), mode, go }), [service, version, refresh, today, mode, go]);
  const { data: pending } = useAsync(() => service.repository.listProposals('pending').then((p) => p.length), [version]);
  const clock = useClock();
  const area = AREA[route.name];

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <button type="button" className="wordmark" onClick={() => go({ name: 'home' })}>Assignment Rescue</button>
          <nav aria-label="Main">
            <button type="button" className={route.name === 'setup' ? 'active' : ''} aria-current={route.name === 'setup' ? 'page' : undefined} onClick={() => go({ name: 'setup' })}>Semester setup</button>
            <button type="button" className={route.name === 'add' ? 'active' : ''} aria-current={route.name === 'add' ? 'page' : undefined} onClick={() => go({ name: 'add' })}>Import a syllabus</button>
            <button type="button" className={route.name === 'features' ? 'active' : ''} aria-current={route.name === 'features' ? 'page' : undefined} onClick={() => go({ name: 'features' })}>Features</button>
          </nav>
          {mode === 'browser-preview' && <span className="preview-note">browser preview</span>}
          <span className="clock" aria-label="Local time">{clock}</span>
        </header>

        <main>
          {route.name === 'home' && <Home />}
          {route.name === 'setup' && <Setup />}
          {route.name === 'add' && <AddInfo onImported={() => go({ name: 'review' })} />}
          {route.name === 'courses' && <CourseList />}
          {route.name === 'course' && <CoursePage code={route.code} tab={route.tab} />}
          {route.name === 'assignment' && <AssignmentWorkspace id={route.id} />}
          {route.name === 'review' && <Review />}
          {route.name === 'sources' && <Sources />}
          {route.name === 'features' && <Features />}
        </main>

        <nav className="dock" aria-label="Workflow">
          {DOCK.map((d) => {
            const count = d.route === 'review' && pending ? pending : 0;
            return (
              <button
                key={d.route}
                type="button"
                className={area === d.route ? 'active' : ''}
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
