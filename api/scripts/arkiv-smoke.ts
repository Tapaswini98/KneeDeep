/**
 * S1 checkpoint: write one report entity to Arkiv with a short expiry, then read it back by query.
 * It is labelled source=simulated, so it can never be mistaken for a live observation.
 *   npm run arkiv:smoke
 */
import { ExpirationTime } from '@arkiv-network/sdk';
import { and, eq } from '@arkiv-network/sdk/query';
import { u64 } from '@arkiv-network/sdk/schema';
import { arkivExplorerTx, arkivPublicClient, arkivWalletClient } from '../src/arkiv/client';
import { Reports } from '../src/arkiv/schemas';
import { readConfig } from '../src/config/config';
import { toCell } from '../src/geo/geo';

const SMOKE_TTL_SECONDS = 120;

async function main() {
  const config = readConfig();
  if (!config.ARKIV_PRIVATE_KEY) throw new Error('Set ARKIV_PRIVATE_KEY in .env (npm run arkiv:wallet)');

  const reader = arkivPublicClient(config.ARKIV_ACCESS_KEY);
  const writer = arkivWalletClient(config.ARKIV_ACCESS_KEY, config.ARKIV_PRIVATE_KEY);
  const owner = writer.account.address;
  console.log(`Writer ${owner}, chain block ${await reader.getBlockNumber()}`);

  const cell = toCell(19.1197, 72.8464); // Andheri subway
  const { entityKey, txHash, expiresAt } = await writer.createEntity(
    Reports,
    {
      level: 'knee',
      cell,
      reportedAt: u64(Math.floor(Date.now() / 1000)),
      reporter: 'smoke-test',
      source: 'simulated',
    },
    { expiration: ExpirationTime.fromSeconds(SMOKE_TTL_SECONDS) },
  );
  console.log(`Created ${entityKey} (expires at ${expiresAt})`);
  console.log(`Tx: ${arkivExplorerTx(txHash)}`);

  const result = await reader
    .select({ $key: true, $expiresAt: true, level: true, cell: true, reportedAt: true, source: true })
    .from(Reports)
    .where(and(eq('cell', cell), eq('source', 'simulated')))
    .ownedBy(owner)
    .limit(10)
    .fetch();

  const found = result.entities.find((e) => e.$key === entityKey);
  if (!found) throw new Error(`Wrote ${entityKey} but the query did not return it`);
  console.log('Read back:', {
    key: found.$key,
    level: found.level.value,
    cell: found.cell.value,
    reportedAt: found.reportedAt.value.toString(),
    source: found.source.value,
    expiresAt: found.$expiresAt?.toString(),
  });
  console.log(`\nCheckpoint passed. The entity disappears from Arkiv in about ${SMOKE_TTL_SECONDS}s.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
