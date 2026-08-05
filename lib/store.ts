import { promises as fs } from 'fs';
import path from 'path';
import type { Db } from './types';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.json');

let writeQueue: Promise<unknown> = Promise.resolve();

export async function readDb(): Promise<Db> {
  const raw = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(raw) as Db;
}

export async function writeDb(db: Db): Promise<void> {
  // Serialize writes and write atomically (tmp + rename) so concurrent
  // requests can't corrupt the JSON file.
  writeQueue = writeQueue.then(async () => {
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
