/**
 * Run one reporter payout batch now: every reporter's unpaid earnings in ONE Hedera transfer.
 *   npm run payout
 * Safe to run any time, also while the API runs its own schedule: runs are serialised by a
 * Postgres lock, and a batch whose outcome is unknown is resolved before a new one starts.
 */
import 'reflect-metadata';
import { readConfig } from '../src/config/config';
import { DbService } from '../src/db/db.service';
import { HederaService } from '../src/hedera/hedera.service';
import { formatHbar } from '../src/hedera/mirror';
import { PayoutsRepository } from '../src/payouts/payouts.repository';
import { PayoutsService } from '../src/payouts/payouts.service';

async function main() {
  const config = readConfig();
  const db = new DbService(config);
  const hedera = new HederaService(config);
  const repo = new PayoutsRepository(db);
  try {
    const outcome = await new PayoutsService(config, db, hedera, repo).runBatch();
    switch (outcome.status) {
      case 'settled':
        console.log(
          `Paid ${formatHbar(outcome.totalTinybars)} to ${outcome.recipients} reporter account(s) in one Hedera transfer.`,
        );
        console.log(`  batch ${outcome.payoutId}`);
        console.log(`  ${outcome.hashscan}`);
        break;
      case 'nothing':
        console.log('Nothing to pay right now.');
        if (outcome.owedTinybars > 0n) {
          console.log(
            `  ${formatHbar(outcome.owedTinybars)} is owed but below PAYOUT_MIN_TINYBARS (${config.PAYOUT_MIN_TINYBARS}) per account.`,
          );
        }
        if (outcome.owedWithoutAccountTinybars > 0n) {
          console.log(
            `  ${formatHbar(outcome.owedWithoutAccountTinybars)} is owed to reporters with no payout account yet (they add one on /report).`,
          );
        }
        if (outcome.owedTinybars === 0n && outcome.owedWithoutAccountTinybars === 0n) {
          console.log(
            '  No earnings yet: reporters earn when an agent pays for an answer that used their live, corroborated report.',
          );
        }
        break;
      case 'waiting':
        console.log(`Not starting a new batch: ${outcome.reason}. Run again in a minute.`);
        break;
      case 'failed':
        console.error(`Batch ${outcome.payoutId} was not paid: ${outcome.error}`);
        console.error('Its earnings are released and will be paid by the next batch.');
        process.exitCode = 1;
        break;
      case 'busy':
        console.log(
          'Another payout run is in progress (the API schedule or another terminal). Try again shortly.',
        );
        break;
    }
  } finally {
    hedera.onModuleDestroy();
    await db.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
