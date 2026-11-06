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
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO queries (lat, lng, radius_m, cells, amount_tinybars, data_status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [q.lat, q.lng, q.radiusM, q.cells, q.amountTinybars.toString(), q.dataStatus],
    );
    return row.id;
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
}
