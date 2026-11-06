import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { TripInput } from './trips.dto';

export interface TripRow {
  id: string;
  createdAt: string;
  origin: TripInput['origin'];
  destination: TripInput['destination'];
  vehicle: TripInput['vehicle'];
  routes: TripInput['routes'];
  chosenRoute: string | null;
  outcome: TripInput['outcome'];
  reasons: string[];
  totalCostTinybars: string;
  txIds: string[];
  network: string | null;
  dataStatus: TripInput['dataStatus'];
  /** How many of the trip's payments KneeDeep's own ledger has as settled queries. */
  paymentsRecorded: number;
}

const COLUMNS = `t.id, t.created_at AS "createdAt", t.origin, t.destination, t.vehicle, t.routes,
  t.chosen_route AS "chosenRoute", t.outcome, t.reasons,
  t.total_cost_tinybars::text AS "totalCostTinybars", t.tx_ids AS "txIds", t.network,
  t.data_status AS "dataStatus",
  (SELECT count(*)::int FROM queries q WHERE q.payment_tx_id = ANY(t.tx_ids)) AS "paymentsRecorded"`;

@Injectable()
export class TripsRepository {
  constructor(private readonly db: DbService) {}

  async create(t: TripInput): Promise<string> {
    const txIds = t.routes.flatMap((r) => r.checkpoints.map((c) => c.txId)).filter((x): x is string => !!x);
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO trips (origin, destination, vehicle, routes, chosen_route, outcome, reasons,
                          total_cost_tinybars, tx_ids, network, data_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        JSON.stringify(t.origin),
        JSON.stringify(t.destination),
        t.vehicle,
        JSON.stringify(t.routes),
        t.chosenRoute,
        t.outcome,
        t.reasons,
        t.totalCostTinybars,
        [...new Set(txIds)],
        t.network,
        t.dataStatus,
      ],
    );
    return row.id;
  }

  recent(limit: number): Promise<TripRow[]> {
    return this.db.query<TripRow>(`SELECT ${COLUMNS} FROM trips t ORDER BY t.created_at DESC LIMIT $1`, [
      limit,
    ]);
  }

  async byId(id: string): Promise<TripRow | null> {
    const rows = await this.db.query<TripRow>(`SELECT ${COLUMNS} FROM trips t WHERE t.id = $1`, [id]);
    return rows[0] ?? null;
  }
}
