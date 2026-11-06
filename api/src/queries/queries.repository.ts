import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type DataStatus = 'stub' | 'live' | 'simulated' | 'mixed' | 'empty';

export interface NewQuery {
  lat: number;
  lng: number;
  radiusM: number;
  cells: string[];
  amountTinybars: bigint;
  dataStatus: DataStatus;
  /** Reports the answer was built from; the basis for reporter earnings once the query is paid. */
  used: { key: string; reporter: string; corroborated: boolean }[];
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
  summary: AreaSummary[];
}

export interface Settlement {
  txId: string;
  payer?: string;
  network: string;
}

@Injectable()
export class QueriesRepository {
  constructor(private readonly db: DbService) {}

  /** Called by the handler, before settlement. Returns the query id. */
  async create(q: NewQuery): Promise<string> {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO queries (lat, lng, radius_m, cells, amount_tinybars, data_status, summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [q.lat, q.lng, q.radiusM, q.cells, q.amountTinybars.toString(), q.dataStatus, JSON.stringify(q.summary)],
      );
      const id = rows[0].id;
      if (q.used.length > 0) {
        // Reports seeded straight onto Arkiv may have reporters we have not seen yet.
        await c.query(
          'INSERT INTO reporters (pseudonym) SELECT DISTINCT unnest($1::text[]) ON CONFLICT DO NOTHING',
          [q.used.map((u) => u.reporter)],
        );
        await c.query(
          `INSERT INTO query_reports (query_id, report_key, reporter, corroborated)
           SELECT $1, * FROM unnest($2::text[], $3::text[], $4::boolean[])
           ON CONFLICT DO NOTHING`,
          [id, q.used.map((u) => u.key), q.used.map((u) => u.reporter), q.used.map((u) => u.corroborated)],
        );
      }
      return id;
    });
  }

  /**
   * Called after x402 settlement succeeds. Idempotent: a query is marked paid once,
   * and a Hedera transaction can pay for at most one query (UNIQUE payment_tx_id).
   */
  async markPaid(queryId: string, s: Settlement): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE queries SET payment_tx_id = $2, payer_account = $3, network = $4, paid_at = now()
       WHERE id = $1 AND paid_at IS NULL RETURNING id`,
      [queryId, s.txId, s.payer ?? null, s.network],
    );
    return rows.length === 1;
  }

  /** Latest queries with their payment and what the answer rested on, for the dashboard. */
  async recent(limit: number): Promise<RecentQuery[]> {
    return this.db.query<RecentQuery>(
      `SELECT q.id, q.created_at AS "createdAt", q.lat, q.lng, q.radius_m AS "radiusM",
              q.data_status AS "dataStatus", q.amount_tinybars::text AS "amountTinybars",
              q.paid_at IS NOT NULL AS paid, q.payment_tx_id AS "paymentTxId",
              q.payer_account AS payer, q.network, q.summary,
              COUNT(qr.report_key)::int AS "reportsUsed",
              COUNT(qr.report_key) FILTER (WHERE qr.corroborated)::int AS "corroboratedUsed"
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
