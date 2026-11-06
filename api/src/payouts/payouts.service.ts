import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AccountId,
  Hbar,
  PrecheckStatusError,
  ReceiptStatusError,
  Status,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { HederaService } from '../hedera/hedera.service';
import { hashscanTxUrl } from '../hedera/keys';
import { fetchTransaction } from '../hedera/mirror';
import { planBatch } from './payout-plan';
import { PayoutsRepository } from './payouts.repository';

/** Hedera transactions are valid for 120 s; after this long, one the network never saw never will be. */
const TX_DEAD_AFTER_S = 180;

export type BatchOutcome =
  | { status: 'busy' }
  | { status: 'waiting'; payoutId: string; txId: string | null; reason: string }
  | { status: 'nothing'; owedTinybars: bigint; owedWithoutAccountTinybars: bigint }
  | {
      status: 'settled';
      payoutId: string;
      txId: string;
      hashscan: string;
      recipients: number;
      totalTinybars: bigint;
    }
  | { status: 'failed'; payoutId: string; txId: string; error: string };

/**
 * Batched reporter payouts: everyone's unpaid earnings in ONE Hedera transfer from the platform
 * account. Idempotent by batch id:
 *   1. Before sending, the batch row (with its pre-generated Hedera transaction id) is committed and
 *      claims its earnings, so no earning can be in two batches.
 *   2. A batch whose outcome is unknown (crash, timeout) is resolved from the mirror node by that
 *      transaction id before any new batch starts: success -> settled; failure, or never seen within
 *      the 120 s validity window -> failed, and its earnings are released for the next batch.
 * Runs are serialised by a Postgres advisory lock, so the API's schedule and `npm run payout`
 * can never pay twice.
 */
@Injectable()
export class PayoutsService {
  private readonly log = new Logger(PayoutsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly hedera: HederaService,
    private readonly repo: PayoutsRepository,
  ) {}

  async runBatch(): Promise<BatchOutcome> {
    const outcome = await this.repo.withLock(async () => {
      const unresolved = await this.resolveOpen();
      if (unresolved) return unresolved;
      return this.payNewBatch();
    });
    return outcome ?? { status: 'busy' };
  }

  /** Settle or fail every batch left in flight. Returns 'waiting' if one cannot be decided yet. */
  private async resolveOpen(): Promise<BatchOutcome | null> {
    for (const p of await this.repo.open()) {
      if (!p.txId) {
        await this.repo.fail(p.id, 'No Hedera transaction was recorded');
        continue;
      }
      const tx = await fetchTransaction(this.config.HEDERA_MIRROR_NODE_URL, p.txId);
      if (tx?.result === 'SUCCESS') {
        await this.repo.settle(p.id);
        this.log.log(`Payout ${p.id} confirmed by the mirror node: ${p.txId}`);
      } else if (tx) {
        await this.repo.fail(p.id, `Hedera result ${tx.result}`);
        this.log.warn(`Payout ${p.id} failed on Hedera (${tx.result}); its earnings go into the next batch`);
      } else if (p.ageSeconds > TX_DEAD_AFTER_S) {
        await this.repo.fail(p.id, 'Never reached consensus (transaction expired)');
        this.log.warn(`Payout ${p.id} never reached Hedera; its earnings go into the next batch`);
      } else {
        return {
          status: 'waiting',
          payoutId: p.id,
          txId: p.txId,
          reason: `Batch ${p.id} was submitted ${p.ageSeconds}s ago and is not on the mirror node yet`,
        };
      }
    }
    return null;
  }

  private async payNewBatch(): Promise<BatchOutcome> {
    const platform = this.hedera.accountId;
    const client = this.hedera.sdk; // throws 503 if the platform account is not configured
    const id = randomUUID();
    const txId = TransactionId.generate(platform!);
    const memo = `KneeDeep reporter payout ${id}`;

    const plan = await this.db.tx(async (c) => {
      const earnings = await this.repo.unpaidForUpdate(c, platform);
      const p = planBatch(earnings, {
        minTinybars: this.config.PAYOUT_MIN_TINYBARS,
        maxRecipients: this.config.PAYOUT_MAX_RECIPIENTS,
      });
      if (p.transfers.length === 0) return null;
      await this.repo.insert(c, {
        id,
        txId: txId.toString(),
        network: this.hedera.network,
        memo,
        transfers: p.transfers,
        earningIds: p.earningIds,
        totalTinybars: p.totalTinybars,
      });
      return p;
    });

    if (!plan) {
      const owed = await this.repo.owedTinybars();
      return {
        status: 'nothing',
        owedTinybars: owed.withAccount,
        owedWithoutAccountTinybars: owed.withoutAccount,
      };
    }

    const transfer = new TransferTransaction()
      .setTransactionId(txId)
      .setTransactionMemo(memo)
      .addHbarTransfer(
        AccountId.fromString(platform!),
        Hbar.fromTinybars(plan.totalTinybars.toString()).negated(),
      );
    for (const t of plan.transfers) {
      transfer.addHbarTransfer(
        AccountId.fromString(t.accountId),
        Hbar.fromTinybars(t.amountTinybars.toString()),
      );
    }

    try {
      const response = await transfer.execute(client);
      await response.getReceipt(client); // throws ReceiptStatusError unless SUCCESS
    } catch (err) {
      const definitelyNotPaid =
        err instanceof ReceiptStatusError ||
        (err instanceof PrecheckStatusError && err.status !== Status.DuplicateTransaction);
      if (definitelyNotPaid) {
        const error = err instanceof Error ? err.message : String(err);
        await this.repo.fail(id, error);
        this.log.warn(`Payout ${id} was not paid (${error}); its earnings go into the next batch`);
        return { status: 'failed', payoutId: id, txId: txId.toString(), error };
      }
      // Unknown outcome (timeout, connection lost after submit): the next run resolves it by tx id.
      this.log.warn(
        `Payout ${id} outcome unknown (${String(err)}); will check ${txId.toString()} on the next run`,
      );
      return {
        status: 'waiting',
        payoutId: id,
        txId: txId.toString(),
        reason: `Outcome unknown: ${String(err)}`,
      };
    }

    await this.repo.settle(id);
    const hashscan = hashscanTxUrl(this.hedera.network, txId.toString());
    this.log.log(
      `Payout ${id}: ${plan.totalTinybars} tinybars to ${plan.transfers.length} reporter account(s), ${hashscan}`,
    );
    return {
      status: 'settled',
      payoutId: id,
      txId: txId.toString(),
      hashscan,
      recipients: plan.transfers.length,
      totalTinybars: plan.totalTinybars,
    };
  }
}
