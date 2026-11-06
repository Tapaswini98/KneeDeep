import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { splitRevenue } from '../payouts/payout-plan';

export type DataStatus = 'stub' | 'live' | 'simulated' | 'mixed' | 'empty';

export interface NewQuery {
  lat: number;
  lng: number;
  radiusM: number;
  cells: string[];
  amountTinybars: bigint;
  dataStatus: DataStatus;
  /** Reports the answer was built from; the basis for reporter earnings once the query is paid. */
  used: { key: string; reporter: string; corroborated: boolean; earns: boolean }[];
  /** Per-area answer, as returned to the agent (level, confidence, explanation). */
  summary: AreaSummary[];
}

export interface AreaSummary {
  cell: string;
  level: string | null;
  confidence: number;
  confidenceLabel: string;
  explanation: string;
  source: string;
  passability?: string;
  passabilityReason?: string;
}

export interface RecentQuery {
  id: string;
  createdAt: string;
  lat: number;
  lng: number;
  radiusM: number;
  dataStatus: DataStatus;
  amountTinybars: string;
  paid: boolean;
  paymentTxId: string | null;
  payer: string | null;
  network: string | null;
  reportsUsed: number;
  corroboratedUsed: number;
  /** Distinct reporters credited for this query (only once it is paid). */
  reportersCredited: number;
  summary: AreaSummary[];
}

export interface Settlement {
  txId: string;
  payer?: string;
  network: string;
}

export interface PaidResult {
  /** False if this query was already recorded as paid (settle hooks can repeat). */
  recorded: boolean;
  /** Reporters credited, and how much each. */
  credited: number;
  eachTinybars: bigint;
}

@Injectable()
export class QueriesRepository {
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Called by the handler, before settlement. Returns the query id. */
  async create(q: NewQuery): Promise<string> {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO queries (lat, lng, radius_m, cells, amount_tinybars, data_status, summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          q.lat,
          q.lng,
          q.radiusM,
          q.cells,
          q.amountTinybars.toString(),
          q.dataStatus,
          JSON.stringify(q.summary),
        ],
      );
      const id = rows[0].id;
      if (q.used.length > 0) {
        // Reports seeded straight onto Arkiv may have reporters we have not seen yet.
        await c.query(
          'INSERT INTO reporters (pseudonym) SELECT DISTINCT unnest($1::text[]) ON CONFLICT DO NOTHING',
          [q.used.map((u) => u.reporter)],
        );
        await c.query(
          `INSERT INTO query_reports (query_id, report_key, reporter, corroborated, earns)
           SELECT $1, * FROM unnest($2::text[], $3::text[], $4::boolean[], $5::boolean[])
           ON CONFLICT DO NOTHING`,
          [
            id,
            q.used.map((u) => u.key),
            q.used.map((u) => u.reporter),
            q.used.map((u) => u.corroborated),
            q.used.map((u) => u.earns),
          ],
        );
      }
      return id;
    });
  }

  /**
   * Called after x402 settlement succeeds: mark the query paid and credit the reporters whose
   * earning reports it used, in one transaction. Idempotent: a query is marked paid (and credits
   * its reporters) once, and a Hedera transaction pays for at most one query (UNIQUE payment_tx_id).
   * Unpaid queries never credit anyone.
   */
  async markPaid(queryId: string, s: Settlement): Promise<PaidResult> {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ amount: string }>(
        `UPDATE queries SET payment_tx_id = $2, payer_account = $3, network = $4, paid_at = now()
         WHERE id = $1 AND paid_at IS NULL RETURNING amount_tinybars::text AS amount`,
        [queryId, s.txId, s.payer ?? null, s.network],
      );
      if (rows.length === 0) return { recorded: false, credited: 0, eachTinybars: 0n };

      const earners = await c.query<{ reporter: string }>(
        'SELECT DISTINCT reporter FROM query_reports WHERE query_id = $1 AND earns',
        [queryId],
      );
      const credits = splitRevenue(
        BigInt(rows[0].amount),
        earners.rows.map((r) => r.reporter),
        this.config.REPORTER_SHARE_PERCENT,
      );
      if (credits.length > 0) {
        await c.query(
          `INSERT INTO earnings (query_id, reporter, amount_tinybars)
           SELECT $1, * FROM unnest($2::text[], $3::bigint[])
           ON CONFLICT (query_id, reporter) DO NOTHING`,
          [queryId, credits.map((x) => x.reporter), credits.map((x) => x.amountTinybars.toString())],
        );
      }
      return { recorded: true, credited: credits.length, eachTinybars: credits[0]?.amountTinybars ?? 0n };
    });
  }

  /** Latest queries with their payment and what the answer rested on, for the dashboard. */
  async recent(limit: number): Promise<RecentQuery[]> {
    return this.db.query<RecentQuery>(
      `SELECT q.id, q.created_at AS "createdAt", q.lat, q.lng, q.radius_m AS "radiusM",
              q.data_status AS "dataStatus", q.amount_tinybars::text AS "amountTinybars",
              q.paid_at IS NOT NULL AS paid, q.payment_tx_id AS "paymentTxId",
              q.payer_account AS payer, q.network, q.summary,
              COUNT(qr.report_key)::int AS "reportsUsed",
              COUNT(qr.report_key) FILTER (WHERE qr.corroborated)::int AS "corroboratedUsed",
              (SELECT COUNT(*)::int FROM earnings e WHERE e.query_id = q.id) AS "reportersCredited"
       FROM queries q LEFT JOIN query_reports qr ON qr.query_id = q.id
       GROUP BY q.id ORDER BY q.created_at DESC LIMIT $1`,
      [limit],
    );
  }

  async totals(): Promise<{ paidQueries: number; revenueTinybars: string }> {
    const [row] = await this.db.query<{ paidQueries: number; revenueTinybars: string }>(
      `SELECT COUNT(*)::int AS "paidQueries", COALESCE(SUM(amount_tinybars), 0)::text AS "revenueTinybars"
       FROM queries WHERE paid_at IS NOT NULL`,
    );
    return row;
  }
}
