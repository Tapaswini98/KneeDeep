/**
 * Dispatch agent: a delivery scooter from Bandra to Andheri on a monsoon evening.
 *   npm run agent                (API on localhost:3000, npm run dev)
 *   npm run demo:agent           (API in Docker on localhost:8080)
 *
 * It discovers KneeDeep, checks the whole trip fits its budget, pays per query via x402 on
 * Hedera for every checkpoint on both routes (no human approval), and picks the safer route.
 * Deterministic on purpose: the decision rules are in decide.ts, with tests.
 */
import { env } from './env';
import { KneeDeepClient } from './kneedeep';
import { planTrip } from './planner';
import { ROUTES, TRIP } from './routes';

const hbar = (tinybars: bigint) =>
  `${(Number(tinybars) / 1e8).toLocaleString('en', { maximumFractionDigits: 8 })} HBAR`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const COLOR = { clear: '\x1b[32m', slow: '\x1b[33m', unknown: '\x1b[35m', impassable: '\x1b[31m' } as const;
const verdict = (v: keyof typeof COLOR) => `${COLOR[v]}${v.toUpperCase().padEnd(10)}\x1b[0m`;

async function main() {
  const api = env('KNEEDEEP_API_URL', 'http://localhost:3000');
  const network = env('HEDERA_NETWORK', 'hedera:testnet') as 'hedera:testnet';
  const client = new KneeDeepClient(api, {
    accountId: env('AGENT_HEDERA_ACCOUNT_ID'),
    privateKey: env('AGENT_HEDERA_PRIVATE_KEY'),
    keyType: env('AGENT_HEDERA_KEY_TYPE', 'ECDSA') as 'ECDSA' | 'ED25519',
    network,
    maxTinybarsPerQuery: BigInt(env('AGENT_MAX_TINYBARS_PER_QUERY', '20000000')),
  });
  const budget = BigInt(env('AGENT_MAX_TINYBARS_PER_TRIP', '100000000'));

  console.log(bold(`Trip: ${TRIP.from.name} -> ${TRIP.to.name}, delivery scooter`));
  for (const r of ROUTES) console.log(`  ${r.name}, ${r.distanceKm} km, ${r.waypoints.length} checkpoints`);

  const endpoint = await client.discover();
  const p = endpoint.payment!;
  const checkpoints = ROUTES.reduce((n, r) => n + r.waypoints.length, 0);
  console.log(
    `\nDiscovered ${endpoint.method} ${endpoint.path} on ${api}: ${hbar(BigInt(p.amount))} per query to ${p.payTo}`,
  );
  console.log(
    `Checking ${checkpoints} checkpoints = ${hbar(BigInt(p.amount) * BigInt(checkpoints))} (trip budget ${hbar(budget)}). ` +
      'Paying from its own account, no human approval.',
  );

  let current = '';
  const started = Date.now();
  const plan = await planTrip(client, ROUTES, {
    radiusM: 250,
    budgetTinybars: budget,
    onCheckpoint: (route, c, paid) => {
      if (route.id !== current) {
        current = route.id;
        console.log(`\n${bold(route.name)} (${route.distanceKm} km)`);
      }
      console.log(`  ${c.waypoint.name.padEnd(22)} ${verdict(c.verdict)} ${c.reason}`);
      if (c.evidence?.explanation) console.log(dim(`  ${''.padEnd(22)} ${c.evidence.explanation}`));
      console.log(dim(`  ${''.padEnd(22)} paid: ${paid.payment?.hashscan}`));
    },
  });

  const d = plan.decision;
  console.log(`\n${bold(d.choice ? `Decision: ${d.choice.route.name}` : 'Decision: HOLD the delivery')}`);
  console.log(d.explanation);
  if (d.usesSimulatedData)
    console.log('\x1b[33mNOTE: based on SIMULATED demo data, not real observations.\x1b[0m');
  console.log(
    `\nSpent ${hbar(plan.spentTinybars)} in ${plan.payments.length} Hedera payments ` +
      `from ${plan.payments[0]?.payer ?? 'the agent'} in ${((Date.now() - started) / 1000).toFixed(0)}s.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
