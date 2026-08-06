/**
 * The SQLite connection and migration runner.
 *
 * SQLite is the system of record for everything, including drafts (ULTRAPROMPT
 * §4). One file, easy to back up, no server to keep alive at midnight.
 *
 * Migrations are plain numbered .sql files applied in order and recorded in
 * `_migration`. They run automatically on first access so the tech-shy user
 * never meets a setup step, and `npm run db:migrate` runs them explicitly when
 * the founder wants to see what happened.
 */
import { createClient, type Client, type InArgs, type Row } from '@libsql/client';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type { Row };

const MIGRATIONS_DIR = join(process.cwd(), 'lib', 'db', 'migrations');

let client: Client | null = null;
let migrated: Promise<void> | null = null;

export class DatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

/** Where the database file lives. `DB_PATH` overrides it for tests and backups. */
export function databaseUrl(): string {
  const path = process.env.DB_PATH ?? join(process.cwd(), 'data', 'engine.db');
  return path.startsWith('file:') || path === ':memory:' ? path : `file:${path}`;
}

function rawClient(): Client {
  if (!client) {
    const url = databaseUrl();
    // A missing `data/` directory otherwise surfaces as SQLite error 14,
    // which tells the founder nothing.
    if (url.startsWith('file:')) {
      mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
    }
    client = createClient({ url });
  }
  return client;
}

async function runMigrations(c: Client): Promise<void> {
  await c.execute('PRAGMA foreign_keys = ON');
  await c.execute(`
    CREATE TABLE IF NOT EXISTS _migration (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (await c.execute('SELECT name FROM _migration')).rows.map((r) => String(r.name))
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      // executeMultiple runs the whole file as one script. libsql wraps it in
      // an implicit transaction, so a syntax error part-way through leaves
      // nothing half-applied.
      await c.executeMultiple(sql);
      await c.execute({
        sql: 'INSERT INTO _migration (name, applied_at) VALUES (?, ?)',
        args: [file, new Date().toISOString()],
      });
    } catch (e) {
      throw new DatabaseError(
        `migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
  }
}

/** The migrated database. Safe to call from anywhere; migrations run once. */
export async function getDb(): Promise<Client> {
  const c = rawClient();
  if (!migrated) {
    migrated = runMigrations(c).catch((e) => {
      // Let the next call retry rather than caching a permanent failure.
      migrated = null;
      throw e;
    });
  }
  await migrated;
  return c;
}

/** Rows from a query, typed by the caller. */
export async function query<T = Row>(sql: string, args: InArgs = []): Promise<T[]> {
  const db = await getDb();
  const result = await db.execute({ sql, args });
  return result.rows as unknown as T[];
}

/** The first row, or null. */
export async function queryOne<T = Row>(sql: string, args: InArgs = []): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

/** A statement with no result set. Returns the number of rows it changed. */
export async function execute(sql: string, args: InArgs = []): Promise<number> {
  const db = await getDb();
  const result = await db.execute({ sql, args });
  return Number(result.rowsAffected);
}

/**
 * Run several statements atomically. Used wherever the register calls for
 * "in one transaction" — supersede-on-reply, reply_conflict resolution, the
 * approved → sending compare-and-swap.
 */
export async function transaction<T>(
  fn: (tx: {
    execute: (sql: string, args?: InArgs) => Promise<number>;
    query: <R = Row>(sql: string, args?: InArgs) => Promise<R[]>;
  }) => Promise<T>
): Promise<T> {
  const db = await getDb();
  const tx = await db.transaction('write');
  try {
    const result = await fn({
      execute: async (sql, args = []) => Number((await tx.execute({ sql, args })).rowsAffected),
      query: async <R,>(sql: string, args: InArgs = []) =>
        (await tx.execute({ sql, args })).rows as unknown as R[],
    });
    await tx.commit();
    return result;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/** Close the connection. Tests use this; the app does not. */
export async function closeDb(): Promise<void> {
  if (client) client.close();
  client = null;
  migrated = null;
}
