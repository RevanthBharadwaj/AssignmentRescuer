import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { SqlDriver, SqlValue } from './driver';
import { SqlJsDriver } from './sqljsDriver';

const STORAGE_KEY = 'assignment-rescue-ai.db';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Browser preview only: sql.js database saved to localStorage after each
 * write so a page reload keeps data. The desktop app uses a real SQLite
 * file through tauri-plugin-sql instead.
 */
class PersistentSqlJsDriver implements SqlDriver {
  constructor(private readonly inner: SqlJsDriver) {}
  private save() {
    try {
      const bytes = this.inner.export();
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(STORAGE_KEY, btoa(bin));
    } catch {
      // Storage full or unavailable: data stays in memory for this session.
    }
  }
  async execute(sql: string, params?: SqlValue[]) {
    await this.inner.execute(sql, params);
    this.save();
  }
  select<T>(sql: string, params?: SqlValue[]) {
    return this.inner.select<T>(sql, params);
  }
  async transaction(fn: () => Promise<void>) {
    await this.inner.transaction(fn);
    this.save();
  }
}

export async function openDatabase(): Promise<{ driver: SqlDriver; mode: 'desktop' | 'browser-preview' }> {
  if (isTauri()) {
    const { TauriSqlDriver } = await import('./tauriDriver');
    return { driver: new TauriSqlDriver(), mode: 'desktop' };
  }
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let bytes: Uint8Array | undefined;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) bytes = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
  } catch {
    bytes = undefined;
  }
  return { driver: new PersistentSqlJsDriver(await SqlJsDriver.create(SQL, bytes)), mode: 'browser-preview' };
}
