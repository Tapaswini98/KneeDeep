import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * One .env at the repo root serves every workspace. npm runs workspace scripts
 * with cwd = the workspace folder, so look there first, then one level up.
 *
 * KNEEDEEP_ENV_FILE names a different file instead (e.g. deploy/.env for the deployment
 * preflight). Only that file is read, so a setting missing from it cannot be quietly
 * filled in from the local .env. Variables already set in the environment always win.
 */
export function loadEnv(): void {
  const explicit = process.env.KNEEDEEP_ENV_FILE?.trim();
  if (explicit) {
    const path = [resolve(process.cwd(), explicit), resolve(process.cwd(), '..', explicit)].find((p) =>
      existsSync(p),
    );
    if (!path) throw new Error(`KNEEDEEP_ENV_FILE=${explicit} not found`);
    loadDotenv({ path, quiet: true });
    return;
  }
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      return;
    }
  }
}
