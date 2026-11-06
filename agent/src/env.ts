import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
  if (existsSync(p)) {
    loadDotenv({ path: p, quiet: true });
    break;
  }
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (value === undefined) throw new Error(`Missing ${name} in .env`);
  return value;
}
