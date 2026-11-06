/**
 * Apply db/migrations/*.sql in name order, each once, each in its own transaction.
 *   npm run db:migrate
 *   npm run db:reset      drops everything first (local only)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { readConfig } from '../src/config/config';

async function main() {
  const { DATABASE_URL } = readConfig();
  const reset = process.argv.includes('--reset');
  const dir = join(__dirname, '..', 'db', 'migrations');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('Reset: dropped schema public');
    }
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log('Database is up to date.');
  } finally {
    await client.end();
  }
}

main().catch((err: Error & { code?: string }) => {
  // Connection refused surfaces as an AggregateError with an empty message.
  const reason = err?.message || err?.code || String(err);
  console.error(`${reason}${err?.code === 'ECONNREFUSED' ? ' (is Postgres up? npm run db:up)' : ''}`);
  process.exit(1);
});
