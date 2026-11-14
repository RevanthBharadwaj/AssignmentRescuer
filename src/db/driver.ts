/**
 * Minimal SQL driver interface so the repository runs on the desktop
 * SQLite commands and on sql.js (real SQLite compiled to WebAssembly) in
 * tests and browser preview.
 *
 * Transaction contract (identical in every driver): writes issued inside
 * `transaction` are queued and applied together, atomically, when the
 * callback returns. Reads inside the callback see the state from before
 * the transaction. Do all reads first, then queue writes.
 */
export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params: SqlValue[];
}

export interface SqlDriver {
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  select<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  transaction(fn: () => Promise<void>): Promise<void>;
}

/** Shared queue logic for drivers. */
export abstract class BatchingDriver implements SqlDriver {
  private queue: SqlStatement[] | null = null;

  protected abstract runBatch(statements: SqlStatement[]): Promise<void>;
  abstract select<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;

  async execute(sql: string, params: SqlValue[] = []): Promise<void> {
    if (this.queue) this.queue.push({ sql, params });
    else await this.runBatch([{ sql, params }]);
  }

  async transaction(fn: () => Promise<void>): Promise<void> {
    if (this.queue) return fn(); // nested: join the outer transaction
    this.queue = [];
    try {
      await fn();
      const statements = this.queue;
      this.queue = null;
      if (statements.length) await this.runBatch(statements);
    } finally {
      this.queue = null;
    }
  }
}
