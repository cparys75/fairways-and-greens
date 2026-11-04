/**
 * A minimal in-memory stand-in for Cloudflare D1 on Node's built-in SQLite, so the API can be tested
 * end to end without the Workers runtime. Only what the app uses: prepare/bind/first/all/run and batch.
 * (Excluded from tsconfig.functions.json because it uses Node types.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded with require because Vite 5 doesn't know the node:sqlite built-in yet.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

type Param = string | number | null;

export function testDatabase(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = fileURLToPath(new URL('../../migrations', import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));

  class Statement {
    constructor(
      readonly sql: string,
      readonly params: Param[] = [],
    ) {}
    bind(...params: Param[]) {
      return new Statement(this.sql, params);
    }
    private returnsRows() {
      return /^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql);
    }
    exec() {
      const stmt = db.prepare(this.sql);
      if (this.returnsRows()) return { results: stmt.all(...this.params) as Record<string, unknown>[], meta: { changes: 0 }, success: true };
      const r = stmt.run(...this.params);
      return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, success: true };
    }
    async first<T>(col?: string): Promise<T | null> {
      const row = this.exec().results[0];
      if (!row) return null;
      return (col ? row[col] : { ...row }) as T;
    }
    async all<T>() {
      return this.exec() as unknown as { results: T[] };
    }
    async run() {
      return this.exec();
    }
  }

  return {
    prepare: (sql: string) => new Statement(sql),
    async batch(stmts: Statement[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}
