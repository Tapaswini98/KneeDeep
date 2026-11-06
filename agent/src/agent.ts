/**
 * Dispatch agent. Deterministic on purpose: the demo must be reliable.
 *   npm run agent
 *
 * S2: pay for GET /v1/conditions via x402 on Hedera (no human approves the payment).
 * S5: compare both routes from the paid answers and pick the safer one.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { ROUTES, TRIP } from './routes';

for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
  if (existsSync(p)) {
    loadDotenv({ path: p, quiet: true });
    break;
  }
}

const API = process.env.KNEEDEEP_API_URL ?? 'http://localhost:3000';

async function main() {
  console.log(`Trip: ${TRIP.from.name} -> ${TRIP.to.name}`);
  for (const r of ROUTES) {
    console.log(`  ${r.id}: ${r.name}, ${r.distanceKm} km, checks ${r.waypoints.map((w) => w.name).join(', ')}`);
  }

  const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(10_000) });
  console.log(`\nKneeDeep API ${API}/health -> ${res.status}`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
