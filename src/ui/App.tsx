import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, localToday, type AppContextValue } from './AppContext';
import type { AcademicService } from '../core/service';
import { Home } from './components/Home';
import { AddInfo } from './components/AddInfo';
import { Review } from './components/Review';
import { Courses } from './components/Courses';
import { Features, Sources } from './components/Sources';
import { useAsync } from './useAsync';

export type Tab = 'home' | 'add' | 'review' | 'courses' | 'sources' | 'features';

/** The four stages of the workflow live in the bottom dock. */
const DOCK: { id: Tab; label: string; verb: string }[] = [
  { id: 'add', label: 'Add information', verb: 'capture it' },
  { id: 'review', label: 'Review', verb: 'confirm it' },
  { id: 'courses', label: 'Courses', verb: 'plan it' },
  { id: 'sources', label: 'Imported material', verb: 'trace it' },
];

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
  const [tab, setTab] = useState<Tab>('home');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const ctx = useMemo<AppContextValue>(() => ({ service, version, refresh, today: today ?? localToday(), mode }), [service, version, refresh, today, mode]);
  const { data: pending } = useAsync(() => service.repository.listProposals('pending').then((p) => p.length), [version]);
  const clock = useClock();

  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo?.({ top: 0 });
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <span className="wordmark">Assignment Rescue</span>
          <nav aria-label="Main">
            <button type="button" className={tab === 'home' ? 'active' : ''} aria-current={tab === 'home' ? 'page' : undefined} onClick={() => go('home')}>Home</button>
            <button type="button" className={tab === 'features' ? 'active' : ''} aria-current={tab === 'features' ? 'page' : undefined} onClick={() => go('features')}>Features</button>
          </nav>
          {mode === 'browser-preview' && <span className="preview-note">browser preview</span>}
          <span className="clock" aria-label="Local time">{clock}</span>
        </header>

        <main>
          {tab === 'home' && <Home goTo={go} />}
          {tab === 'add' && <AddInfo onImported={() => go('review')} />}
          {tab === 'review' && <Review />}
          {tab === 'courses' && <Courses />}
          {tab === 'sources' && <Sources />}
          {tab === 'features' && <Features />}
        </main>

        <nav className="dock" aria-label="Workflow">
          {DOCK.map((d) => {
            const count = d.id === 'review' && pending ? pending : 0;
            return (
              <button
                key={d.id}
                type="button"
                className={tab === d.id ? 'active' : ''}
                aria-current={tab === d.id ? 'page' : undefined}
                aria-label={count ? `${d.label}, ${count} pending` : d.label}
                onClick={() => go(d.id)}
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
