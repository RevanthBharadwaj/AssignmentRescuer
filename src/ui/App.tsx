import { useCallback, useMemo, useState } from 'react';
import { AppContext, localToday, type AppContextValue } from './AppContext';
import type { AcademicService } from '../core/service';
import { Home } from './components/Home';
import { AddInfo } from './components/AddInfo';
import { Review } from './components/Review';
import { Courses } from './components/Courses';
import { Features, Sources } from './components/Sources';
import { useAsync } from './useAsync';

type Tab = 'home' | 'add' | 'review' | 'courses' | 'sources' | 'features';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'add', label: 'Add information' },
  { id: 'review', label: 'Review' },
  { id: 'courses', label: 'Courses' },
  { id: 'sources', label: 'Imported material' },
  { id: 'features', label: 'Features' },
];

export function App({ service, mode, today }: { service: AcademicService; mode: AppContextValue['mode']; today?: string }) {
  const [tab, setTab] = useState<Tab>('home');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const ctx = useMemo<AppContextValue>(() => ({ service, version, refresh, today: today ?? localToday(), mode }), [service, version, refresh, today, mode]);
  const { data: pending } = useAsync(() => service.repository.listProposals('pending').then((p) => p.length), [version]);

  return (
    <AppContext.Provider value={ctx}>
      <div className="shell">
        <nav aria-label="Main">
          <div className="brand">Assignment Rescue AI</div>
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}{t.id === 'review' && pending ? <span className="badge" aria-label={`${pending} pending`}>{pending}</span> : null}
            </button>
          ))}
          {mode === 'browser-preview' && <p className="muted small preview-note">Browser preview: data is kept in this browser only.</p>}
        </nav>
        <main>
          {tab === 'home' && <Home goTo={setTab} />}
          {tab === 'add' && <AddInfo onImported={() => setTab('review')} />}
          {tab === 'review' && <Review />}
          {tab === 'courses' && <Courses />}
          {tab === 'sources' && <Sources />}
          {tab === 'features' && <Features />}
        </main>
      </div>
    </AppContext.Provider>
  );
}
