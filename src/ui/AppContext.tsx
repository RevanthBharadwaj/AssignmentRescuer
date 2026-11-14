import { createContext, useContext } from 'react';
import type { AcademicService } from '../core/service';

export type Route =
  | { name: 'home' }
  | { name: 'setup' }
  | { name: 'courses' }
  | { name: 'course'; code: string; tab?: CourseTab }
  | { name: 'assignment'; id: string }
  | { name: 'review' }
  | { name: 'sources' }
  | { name: 'features' }
  | { name: 'add' };

export type CourseTab = 'timeline' | 'assignments' | 'materials' | 'add';

export interface AppContextValue {
  go: (route: Route) => void;
  service: AcademicService;
  /** Bumped after every write so screens reload their data. */
  version: number;
  refresh: () => void;
  today: string;
  mode: 'desktop' | 'browser-preview' | 'test';
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppContext');
  return ctx;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
