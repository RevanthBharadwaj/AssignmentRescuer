import type { Database, SqlJsStatic } from 'sql.js';
import { BatchingDriver, type SqlStatement, type SqlValue } from './driver';

/** sql.js driver: used by tests and by the browser preview build. */
export class SqlJsDriver extends BatchingDriver {
  constructor(public readonly db: Database) {
    super();
    db.run('PRAGMA foreign_keys = ON;');
  }

  static async create(SQL: SqlJsStatic, bytes?: Uint8Array): Promise<SqlJsDriver> {
    return new SqlJsDriver(bytes ? new SQL.Database(bytes) : new SQL.Database());
  }

  protected async runBatch(statements: SqlStatement[]): Promise<void> {
    this.db.exec('BEGIN');
    try {
      for (const s of statements) {
        if (s.params.length === 0) this.db.exec(s.sql);
        else this.db.run(s.sql, s.params);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async select<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  export(): Uint8Array {
    return this.db.export();
  }
}
