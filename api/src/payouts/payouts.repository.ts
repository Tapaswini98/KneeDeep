import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import type { UnpaidEarning } from './payout-plan';

export type PayoutStatus = 'pending' | 'submitted' | 'settled' | 'failed';

export interface OpenPayout {
  id: string;
  txId: string | null;
  /** Seconds since the transfer was submitted (Hedera transactions are only valid for 120 s). */
  ageSeconds: number;
}

export interface NewPayout {
  id: string;
  txId: string;
  network: string;
  memo: string;
  transfers: { accountId: string; amountTinybars: bigint }[];
  earningIds: string[];
  totalTinybars: bigint;
}

export interface PayoutRow {
  id: string;
  status: PayoutStatus;
  txId: string | null;
  network: string | null;
  totalTinybars: string;
  recipients: number;
  createdAt: string;
  settledAt: string | null;
  error: string | null;
}

export interface ReporterEarnings {
  payoutAccount: string | null;
  queriesCredited: number;
  /** Credited, waiting for a payout batch (needs a payout account). */
  owedTinybars: string;
  /** In a submitted batch that has not settled yet. */
  inFlightTinybars: string;
  paidTinybars: string;
  payouts: {
    id: string;
    txId: string | null;
    network: string | null;
    amountTinybars: string;
    settledAt: string | null;
  }[];
}

/** Advisory lock key: one payout run at a time, across the API and the CLI. */
const PAYOUT_LOCK = 7_402_115_001;

@Injectable()
export class PayoutsRepository {
  constructor(private readonly db: DbService) {}

  /** Run fn while holding the payout lock, or return null at once if another run holds it. */
  async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const client = await this.db.pool.connect();
    try {
      const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [
        PAYOUT_LOCK,
      ]);
      if (!rows[0].ok) return null;
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [PAYOUT_LOCK]);
      }
    } finally {
      client.release();
    }
  }

  async open(): Promise<OpenPayout[]> {
    return this.db.query<OpenPayout>(
      `SELECT id, tx_id AS "txId",
              EXTRACT(EPOCH FROM now() - COALESCE(submitted_at, created_at))::int AS "ageSeconds"
       FROM payouts WHERE status IN ('pending', 'submitted') ORDER BY created_at`,
    );
  }

  /**
   * Lock and return every unpaid earning of reporters who have a payout account, inside `c`'s
   * transaction, so nothing can be added to two batches.
   */
  async unpaidForUpdate(c: PoolClient, excludeAccount?: string): Promise<UnpaidEarning[]> {
    const { rows } = await c.query<{ id: string; accountId: string; amount: string }>(
      `SELECT e.id::text, r.hedera_account_id AS "accountId", e.amount_tinybars::text AS amount
       FROM earnings e JOIN reporters r ON r.pseudonym = e.reporter
       WHERE e.payout_id IS NULL AND r.hedera_account_id IS NOT NULL
         AND r.hedera_account_id IS DISTINCT FROM $1
       FOR UPDATE OF e`,
      [excludeAccount ?? null],
    );
    return rows.map((r) => ({ id: r.id, accountId: r.accountId, amountTinybars: BigInt(r.amount) }));
  }

  /** Record the batch and claim its earnings BEFORE the transfer is sent (the idempotency record). */
  async insert(c: PoolClient, p: NewPayout): Promise<void> {
    await c.query(
      `INSERT INTO payouts (id, status, tx_id, network, memo, total_tinybars, recipient_count, submitted_at)
       VALUES ($1, 'submitted', $2, $3, $4, $5, $6, now())`,
      [p.id, p.txId, p.network, p.memo, p.totalTinybars.toString(), p.transfers.length],
    );
    await c.query(
      `INSERT INTO payout_transfers (payout_id, account_id, amount_tinybars)
       SELECT $1, * FROM unnest($2::text[], $3::bigint[])`,
      [p.id, p.transfers.map((t) => t.accountId), p.transfers.map((t) => t.amountTinybars.toString())],
    );
    const claimed = await c.query(
      'UPDATE earnings SET payout_id = $1 WHERE id = ANY($2::bigint[]) AND payout_id IS NULL',
      [p.id, p.earningIds],
    );
    if (claimed.rowCount !== p.earningIds.length)
      throw new Error('Earnings changed while planning the batch');
  }

  async settle(id: string): Promise<void> {
    await this.db.query(
      `UPDATE payouts SET status = 'settled', settled_at = now(), error = NULL
       WHERE id = $1 AND status IN ('pending', 'submitted')`,
      [id],
    );
  }

  /** The transfer did not happen: release its earnings so the next batch pays them. */
  async fail(id: string, error: string): Promise<void> {
    await this.db.tx(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE payouts SET status = 'failed', error = $2 WHERE id = $1 AND status IN ('pending', 'submitted')`,
        [id, error.slice(0, 500)],
      );
      if (rowCount) await c.query('UPDATE earnings SET payout_id = NULL WHERE payout_id = $1', [id]);
    });
  }

  async owedTinybars(): Promise<{ withAccount: bigint; withoutAccount: bigint }> {
    const [row] = await this.db.query<{ withAccount: string; withoutAccount: string }>(
      `SELECT COALESCE(SUM(e.amount_tinybars) FILTER (WHERE r.hedera_account_id IS NOT NULL), 0)::text AS "withAccount",
              COALESCE(SUM(e.amount_tinybars) FILTER (WHERE r.hedera_account_id IS NULL), 0)::text AS "withoutAccount"
       FROM earnings e JOIN reporters r ON r.pseudonym = e.reporter WHERE e.payout_id IS NULL`,
    );
    return { withAccount: BigInt(row.withAccount), withoutAccount: BigInt(row.withoutAccount) };
  }

  async setPayoutAccount(pseudonym: string, accountId: string | null): Promise<void> {
    await this.db.query(
      `INSERT INTO reporters (pseudonym, hedera_account_id) VALUES ($1, $2)
       ON CONFLICT (pseudonym) DO UPDATE SET hedera_account_id = EXCLUDED.hedera_account_id`,
      [pseudonym, accountId],
    );
  }

  async reporterEarnings(pseudonym: string): Promise<ReporterEarnings> {
    const [summary] = await this.db.query<Omit<ReporterEarnings, 'payouts'>>(
      `SELECT (SELECT hedera_account_id FROM reporters WHERE pseudonym = $1) AS "payoutAccount",
              COUNT(e.id)::int AS "queriesCredited",
              COALESCE(SUM(e.amount_tinybars) FILTER (WHERE e.payout_id IS NULL), 0)::text AS "owedTinybars",
              COALESCE(SUM(e.amount_tinybars) FILTER (WHERE p.status IN ('pending', 'submitted')), 0)::text
                AS "inFlightTinybars",
              COALESCE(SUM(e.amount_tinybars) FILTER (WHERE p.status = 'settled'), 0)::text AS "paidTinybars"
       FROM earnings e LEFT JOIN payouts p ON p.id = e.payout_id
       WHERE e.reporter = $1`,
      [pseudonym],
    );
    const payouts = await this.db.query<ReporterEarnings['payouts'][number]>(
      `SELECT p.id, p.tx_id AS "txId", p.network, SUM(e.amount_tinybars)::text AS "amountTinybars",
              p.settled_at AS "settledAt"
       FROM earnings e JOIN payouts p ON p.id = e.payout_id
       WHERE e.reporter = $1 AND p.status = 'settled'
       GROUP BY p.id ORDER BY p.settled_at DESC LIMIT 10`,
      [pseudonym],
    );
    return { ...summary, payouts };
  }

  async recent(limit: number): Promise<PayoutRow[]> {
    return this.db.query<PayoutRow>(
      `SELECT id, status, tx_id AS "txId", network, total_tinybars::text AS "totalTinybars",
              recipient_count AS recipients, created_at AS "createdAt", settled_at AS "settledAt", error
       FROM payouts ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
  }

  async totals(): Promise<{ paidOutTinybars: string; owedTinybars: string; batches: number }> {
    const [row] = await this.db.query<{ paidOutTinybars: string; owedTinybars: string; batches: number }>(
      `SELECT (SELECT COALESCE(SUM(total_tinybars), 0) FROM payouts WHERE status = 'settled')::text AS "paidOutTinybars",
              (SELECT COALESCE(SUM(amount_tinybars), 0) FROM earnings WHERE payout_id IS NULL)::text AS "owedTinybars",
              (SELECT COUNT(*) FROM payouts WHERE status = 'settled')::int AS batches`,
    );
    return row;
  }
}
