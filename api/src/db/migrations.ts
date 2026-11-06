import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/** api/db/migrations, from both src/db (ts) and dist/db (compiled). */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

/**
 * Apply db/migrations/*.sql in name order, each once, each in its own transaction.
 * An advisory lock makes concurrent runs (e.g. two containers booting) safe.
 * Returns the names of the migrations it applied.
 */
export async function runMigrations(
  databaseUrl: string,
  opts: { reset?: boolean; dir?: string } = {},
): Promise<string[]> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('kneedeep:migrations'))");
    if (opts.reset) await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('kneedeep:migrations'))").catch(() => undefined);
    await client.end();
  }
}
