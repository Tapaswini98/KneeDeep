/**
 * Apply pending migrations.
 *   npm run db:migrate
 *   npm run db:reset      drops everything first (local only; refused in production)
 */
import { readConfig } from '../src/config/config';
import { runMigrations } from '../src/db/migrations';

async function main() {
  const { DATABASE_URL, NODE_ENV } = readConfig();
  const reset = process.argv.includes('--reset');
  if (reset && NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const applied = await runMigrations(DATABASE_URL, { reset });
  if (reset) console.log('Reset: dropped schema public');
  for (const name of applied) console.log(`Applied ${name}`);
  console.log('Database is up to date.');
}

main().catch((err: Error & { code?: string }) => {
  // Connection refused surfaces as an AggregateError with an empty message.
  const reason = err?.message || err?.code || String(err);
  console.error(`${reason}${err?.code === 'ECONNREFUSED' ? ' (is Postgres up? npm run db:up)' : ''}`);
  process.exit(1);
});
