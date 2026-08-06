import { promises as fs } from 'fs';
import path from 'path';
import { createClient, type Client } from '@libsql/client';
import type { CollectionName, Db } from './types';
import { COLLECTIONS } from './types';
import seedJson from '@/data/db.json';

// Storage backends:
//  - TURSO_DATABASE_URL set (hosted): libSQL, one row per entity.
//  - Otherwise (local dev): JSON file at data/db.json (or DB_PATH).
//
// The Turso backend stores each record as its own row rather than each
// collection as one blob, and writes only the rows that actually changed.
// With a scraper importing thousands of postings, rewriting an entire
// collection on every edit would get slow fast.

const seed = seedJson as unknown as Db;

/** Resolved per call, not at import time, so the path can be set after the
 *  module loads (tests, and any runtime that populates env lazily). */
function dbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.json');
}

let client: Client | null = null;
let schemaReady = false;

function turso(): Client | null {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return null;
  if (!client) client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

async function ensureSchema(c: Client): Promise<void> {
  if (schemaReady) return;
  await c.batch(
    [
      `CREATE TABLE IF NOT EXISTS docs (
         collection TEXT NOT NULL,
         id         TEXT NOT NULL,
         data       TEXT NOT NULL,
         PRIMARY KEY (collection, id)
       )`,
      `CREATE INDEX IF NOT EXISTS docs_collection ON docs(collection)`,
      `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    ],
    'write'
  );
  schemaReady = true;
}

/** Serialized snapshot of what was on disk when a Db was read, so writeDb can
 *  work out the minimum set of statements to run. */
type Snapshot = Map<CollectionName, Map<string, string>>;
const snapshots = new WeakMap<Db, Snapshot>();

function snapshotOf(db: Db): Snapshot {
  const snap: Snapshot = new Map();
  for (const name of COLLECTIONS) {
    const rows = new Map<string, string>();
    for (const item of (db[name] as Array<{ id: string }>) || []) {
      if (item?.id) rows.set(item.id, JSON.stringify(item));
    }
    snap.set(name, rows);
  }
  return snap;
}

function emptyDb(): Db {
  const base = { profile: structuredClone(seed.profile) } as Db;
  for (const name of COLLECTIONS) (base[name] as unknown[]) = [];
  return base;
}

async function seedTurso(c: Client): Promise<void> {
  const statements: Array<{ sql: string; args: string[] }> = [
    { sql: 'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', args: ['profile', JSON.stringify(seed.profile)] },
  ];
  for (const name of COLLECTIONS) {
    for (const item of (seed[name] as Array<{ id: string }>) || []) {
      if (!item?.id) continue;
      statements.push({
        sql: 'INSERT OR REPLACE INTO docs (collection, id, data) VALUES (?, ?, ?)',
        args: [name, item.id, JSON.stringify(item)],
      });
    }
  }
  // Chunked: a single batch of thousands of statements is unwieldy.
  for (let i = 0; i < statements.length; i += 200) {
    await c.batch(statements.slice(i, i + 200), 'write');
  }
}

export async function readDb(): Promise<Db> {
  const c = turso();

  if (c) {
    await ensureSchema(c);
    const [docs, kv] = await Promise.all([
      c.execute('SELECT collection, id, data FROM docs'),
      c.execute("SELECT value FROM kv WHERE key = 'profile'"),
    ]);

    if (docs.rows.length === 0 && kv.rows.length === 0) {
      await seedTurso(c);
      const fresh = structuredClone(seed);
      snapshots.set(fresh, snapshotOf(fresh));
      return fresh;
    }

    const db = emptyDb();
    if (kv.rows.length > 0) {
      try {
        db.profile = JSON.parse(String(kv.rows[0].value));
      } catch {
        /* keep seed profile */
      }
    }
    const valid = new Set<string>(COLLECTIONS);
    for (const row of docs.rows) {
      const name = String(row.collection);
      if (!valid.has(name)) continue;
      try {
        (db[name as CollectionName] as unknown[]).push(JSON.parse(String(row.data)));
      } catch {
        /* skip a corrupt row rather than failing the whole read */
      }
    }
    // Newest first, matching the file backend's ordering.
    for (const name of COLLECTIONS) {
      const list = db[name] as Array<{ createdAt?: string }>;
      list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    snapshots.set(db, snapshotOf(db));
    return db;
  }

  try {
    const raw = await fs.readFile(dbPath(), 'utf8');
    const db = JSON.parse(raw) as Db;
    for (const name of COLLECTIONS) {
      if (!Array.isArray(db[name])) (db[name] as unknown[]) = [];
    }
    return db;
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
    await ensureSchema(c);
    const before = snapshots.get(db) ?? new Map();
    const statements: Array<{ sql: string; args: string[] }> = [];

    for (const name of COLLECTIONS) {
      const previous = before.get(name) ?? new Map<string, string>();
      const stillPresent = new Set<string>();

      for (const item of (db[name] as Array<{ id: string }>) || []) {
        if (!item?.id) continue;
        stillPresent.add(item.id);
        const serialized = JSON.stringify(item);
        if (previous.get(item.id) !== serialized) {
          statements.push({
            sql: 'INSERT INTO docs (collection, id, data) VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data',
            args: [name, item.id, serialized],
          });
        }
      }

      for (const id of previous.keys()) {
        if (!stillPresent.has(id)) {
          statements.push({
            sql: 'DELETE FROM docs WHERE collection = ? AND id = ?',
            args: [name, id],
          });
        }
      }
    }

    const profileJson = JSON.stringify(db.profile);
    statements.push({
      sql: 'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: ['profile', profileJson],
    });

    for (let i = 0; i < statements.length; i += 200) {
      await c.batch(statements.slice(i, i + 200), 'write');
    }

    // The written state is the new baseline, so a second write of the same
    // object doesn't re-send everything.
    snapshots.set(db, snapshotOf(db));
    return;
  }

  // File backend: serialize writes and write atomically (tmp + rename) so
  // concurrent requests can't leave a half-written file.
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(dbPath()), { recursive: true });
    const file = dbPath();
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fs.rename(tmp, file);
  });
  await writeQueue;
}

export async function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const db = await readDb();
  const result = await fn(db);
  await writeDb(db);
  return result;
}
