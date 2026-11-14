import { invoke } from '@tauri-apps/api/core';
import { BatchingDriver, type SqlStatement, type SqlValue } from './driver';

/**
 * Desktop driver: the app's own Rust commands over a single SQLite
 * connection (src-tauri/src/db.rs). Each batch is one real transaction.
 */
export class TauriSqlDriver extends BatchingDriver {
  protected runBatch(statements: SqlStatement[]): Promise<void> {
    return invoke('db_batch', { statements });
  }

  select<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return invoke<T[]>('db_select', { sql, params });
  }
}
