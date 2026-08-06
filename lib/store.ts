import { promises as fs } from 'fs';
import path from 'path';
import { createClient, type Client } from '@libsql/client';
import type { Db } from './types';
import seedJson from '@/data/db.json';

// Storage backends:
//  - TURSO_DATABASE_URL set (Vercel/hosted): Turso via libsql, one kv row per
//    collection, seeded from data/db.json on first read.
//  - Otherwise (local dev): plain JSON file at data/db.json (or DB_PATH).

const seed = seedJson as unknown as Db;
const KEYS = [
  'profile',
  'companies',
  'contacts',
  'applications',
  'outreach',
  'templates',
  'jobSources',
  'runs',
] as const;

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.json');

let client: Client | null = null;
let tableReady = false;

function turso(): Client | null {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}

async function ensureTable(c: Client): Promise<void> {
  if (tableReady) return;
  await c.execute('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  tableReady = true;
}

const upsertSql =
  'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

async function writeAll(c: Client, db: Db): Promise<void> {
  await c.batch(
    KEYS.map((key) => ({ sql: upsertSql, args: [key, JSON.stringify(db[key])] })),
    'write'
  );
}

export async function readDb(): Promise<Db> {
  const c = turso();
  if (c) {
    await ensureTable(c);
    const result = await c.execute('SELECT key, value FROM kv');
    if (result.rows.length === 0) {
      await writeAll(c, seed);
      return structuredClone(seed);
    }
    const stored = new Map(result.rows.map((r) => [String(r.key), String(r.value)]));
    const db = {} as Record<string, unknown>;
    for (const key of KEYS) {
      const raw = stored.get(key);
      db[key] = raw ? JSON.parse(raw) : structuredClone(seed[key]);
    }
    return db as unknown as Db;
  }

  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(raw) as Db;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const fresh = structuredClone(seed);
    await writeDb(fresh);
    return fresh;
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function writeDb(db: Db): Promise<void> {
  const c = turso();
  if (c) {
    await ensureTable(c);
    await writeAll(c, db);
    return;
  }
  // Serialize file writes and write atomically (tmp + rename) so concurrent
  // requests can't corrupt the JSON file.
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    const tmp = DB_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fs.rename(tmp, DB_PATH);
  });
  await writeQueue;
}

export async function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const db = await readDb();
  const result = await fn(db);
  await writeDb(db);
  return result;
}
