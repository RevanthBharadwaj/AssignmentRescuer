import initSqlJs from 'sql.js';
import { SqlJsDriver } from '../src/db/sqljsDriver';

describe('driver transaction contract', () => {
  it('applies queued writes atomically and rolls back on failure', async () => {
    const d = await SqlJsDriver.create(await initSqlJs());
    await d.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
    await d.transaction(async () => {
      await d.execute('INSERT INTO t (v) VALUES (?)', ['a']);
      // Reads see the state from before the transaction.
      expect(await d.select('SELECT * FROM t')).toHaveLength(0);
    });
    expect(await d.select('SELECT * FROM t')).toHaveLength(1);

    await expect(d.transaction(async () => {
      await d.execute('INSERT INTO t (v) VALUES (?)', ['b']);
      await d.execute('INSERT INTO t (v) VALUES (?)', [null]);
    })).rejects.toThrow();
    expect(await d.select('SELECT v FROM t')).toEqual([{ v: 'a' }]);
  });

  it('does not apply writes when the callback throws', async () => {
    const d = await SqlJsDriver.create(await initSqlJs());
    await d.execute('CREATE TABLE t (v TEXT)');
    await expect(d.transaction(async () => {
      await d.execute('INSERT INTO t VALUES (?)', ['x']);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(await d.select('SELECT * FROM t')).toEqual([]);
    // The driver is usable again afterwards.
    await d.execute('INSERT INTO t VALUES (?)', ['y']);
    expect(await d.select('SELECT * FROM t')).toEqual([{ v: 'y' }]);
  });
});
