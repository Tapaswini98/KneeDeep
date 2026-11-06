/**
 * Dispatch agent. Deterministic on purpose: the demo must be reliable.
 *   npm run agent
 *
 * S2 (now): discover KneeDeep, pay for one conditions query via x402 on Hedera, no human approval.
 * S5: query every waypoint on both routes and pick the safer route.
 */
import { env } from './env';
import { KneeDeepClient } from './kneedeep';
import { ROUTES, TRIP } from './routes';

async function main() {
  const api = env('KNEEDEEP_API_URL', 'http://localhost:3000');
  const client = new KneeDeepClient(api, {
    accountId: env('AGENT_HEDERA_ACCOUNT_ID'),
    privateKey: env('AGENT_HEDERA_PRIVATE_KEY'),
    keyType: env('AGENT_HEDERA_KEY_TYPE', 'ECDSA') as 'ECDSA' | 'ED25519',
    network: env('HEDERA_NETWORK', 'hedera:testnet') as 'hedera:testnet',
    maxTinybarsPerQuery: BigInt(env('AGENT_MAX_TINYBARS_PER_QUERY', '20000000')),
  });

  console.log(`Trip: ${TRIP.from.name} -> ${TRIP.to.name}`);
  for (const r of ROUTES) console.log(`  ${r.id}: ${r.name}, ${r.distanceKm} km`);

  const endpoint = await client.discover();
  const p = endpoint.payment!;
  console.log(`\nDiscovered ${endpoint.method} ${endpoint.path}: ${p.amount} tinybars to ${p.payTo} on ${p.network}`);

  const waypoint = ROUTES[0].waypoints[ROUTES[0].waypoints.length - 1];
  console.log(`Paying for conditions at ${waypoint.name}...`);
  const started = Date.now();
  const { answer, payment } = await client.conditions(waypoint.lat, waypoint.lng, 300);
  console.log(`Answer in ${((Date.now() - started) / 1000).toFixed(1)}s, data: ${answer.dataStatus}`);
  for (const n of answer.notices ?? []) console.log(`  NOTE: ${n}`);
  for (const a of answer.areas) {
    console.log(`  ${a.cell} (${a.distanceM} m): ${a.level ?? 'CONTESTED'}, confidence ${a.confidence} [${a.confidenceLabel}]`);
    console.log(`    ${a.explanation}`);
  }

  if (!payment) throw new Error('Got an answer but no settled payment (missing PAYMENT-RESPONSE)');
  console.log(`\nPaid by ${payment.payer}, tx ${payment.txId}`);
  console.log(`HashScan: ${payment.hashscan}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
