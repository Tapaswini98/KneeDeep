/**
 * Read KneeDeep's live data straight from Arkiv, without the KneeDeep API.
 * Anyone can run this: it needs only the public writer address.
 *
 *   npm run arkiv:query                       uses the writer from ARKIV_PRIVATE_KEY
 *   npm run arkiv:query -- 0xWriterAddress    any writer
 *   npm run arkiv:query -- 0xWriter te7uc8    only cells starting with this geohash prefix
 */
import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { asc, startsWith } from '@arkiv-network/sdk/query';
import { arkivExplorerAddress, arkivExplorerEntity } from '../src/arkiv/client';
import { Reports, Votes } from '../src/arkiv/schemas';
import { viem, viemAccounts } from '../src/arkiv/viem';
import { readConfig } from '../src/config/config';

async function main() {
  const config = readConfig();
  const writer = (process.argv[2]?.startsWith('0x')
    ? process.argv[2]
    : config.ARKIV_PRIVATE_KEY
      ? viemAccounts.privateKeyToAccount(config.ARKIV_PRIVATE_KEY as `0x${string}`).address
      : undefined) as `0x${string}` | undefined;
  if (!writer) throw new Error('Pass the writer address: npm run arkiv:query -- 0x...');
  const prefix = process.argv[3] ?? 'te7'; // te7 covers Mumbai

  const client = createPublicClient({ chain: rabdi({ accessKey: config.ARKIV_ACCESS_KEY }), transport: viem.http() });
  const { currentBlock, blockDuration } = await client.getBlockTiming();
  const minutesLeft = (expiresAt: bigint) => Math.round((Number(expiresAt - currentBlock) * blockDuration) / 60);

  console.log(`Writer ${writer}`);
  console.log(`  ${arkivExplorerAddress(writer)}`);
  console.log(`Block ${currentBlock}, cells starting "${prefix}"\n`);

  // The same query KneeDeep runs, minus pagination: reports owned by the writer, in an area.
  const reports = await client
    .select({ $key: true, $expiresAt: true, level: true, cell: true, reportedAt: true, source: true })
    .from(Reports)
    .where(startsWith('cell', prefix))
    .ownedBy(writer)
    .orderBy(asc('$expiresAt'))
    .limit(100)
    .fetch();

  console.log(`${reports.entities.length} live report(s):`);
  for (const r of reports.entities) {
    const age = Math.round((Date.now() / 1000 - Number(r.reportedAt.value)) / 60);
    console.log(
      `  ${r.level.value.padEnd(6)} ${r.cell.value}  ${r.source.value.padEnd(9)}  ${String(age).padStart(3)} min old, ` +
        `expires in ${minutesLeft(BigInt(r.$expiresAt))} min  ${arkivExplorerEntity(r.$key)}`,
    );
  }

  const votes = await client
    .select({ $key: true, report: true, vote: true, cell: true })
    .from(Votes)
    .where(startsWith('cell', prefix))
    .ownedBy(writer)
    .limit(100)
    .fetch();
  console.log(`\n${votes.entities.length} live vote(s):`);
  for (const v of votes.entities) {
    console.log(`  ${v.vote.value.padEnd(7)} on ${v.report.value.slice(0, 12)}…  ${v.cell.value}  ${arkivExplorerEntity(v.$key)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
