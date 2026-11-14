import { createContext, useContext } from 'react';
import type { AcademicService } from '../core/service';

export interface AppContextValue {
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
