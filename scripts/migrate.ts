/** Applies pending migrations and prints what happened. `npm run db:migrate`. */
import { databaseUrl, getDb, query } from '../lib/db/client';

async function main() {
  console.log(`database: ${databaseUrl()}`);
  await getDb();
  const applied = await query<{ name: string; applied_at: string }>(
    'SELECT name, applied_at FROM _migration ORDER BY name'
  );
  for (const m of applied) console.log(`  applied  ${m.name}  (${m.applied_at})`);
  console.log(`${applied.length} migration(s) in place.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
