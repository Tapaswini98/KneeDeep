/**
 * Replay "a monsoon evening in Mumbai": write the SIMULATED demo scenario to Arkiv.
 *   npm run demo:seed
 * Safe to repeat: each simulated human keeps one pseudonym, and the fusion engine counts a
 * human's latest report per cell once, so re-seeding refreshes the scene instead of inflating it.
 */
import { arkivWalletClient } from '../src/arkiv/client';
import { readConfig } from '../src/config/config';
import { seedMonsoonEvening } from './lib/demo-scenario';

async function main() {
  const config = readConfig();
  if (!config.ARKIV_PRIVATE_KEY) throw new Error('Set ARKIV_PRIVATE_KEY in .env');
  const wallet = arkivWalletClient(config.ARKIV_ACCESS_KEY, config.ARKIV_PRIVATE_KEY);
  console.log('Writing a SIMULATED monsoon evening to Arkiv (two transactions)…');
  const res = await seedMonsoonEvening(wallet, config.DATABASE_URL, config.REPORT_TTL_SECONDS);
  console.log(`${res.reports} reports and ${res.votes} votes, all labelled simulated.`);
  for (const tx of res.txs) console.log(`  ${tx}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
