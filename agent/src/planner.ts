/**
 * Plan a trip: pay KneeDeep for conditions at every checkpoint of every candidate route, then
 * decide. Spending is bounded before the first payment: the whole trip must fit the budget.
 */
import { assessCheckpoint, assessRoute, type CheckpointResult, decide, type Decision } from './decide';
import type { KneeDeepClient, PaidAnswer } from './kneedeep';
import type { Route } from './routes';

export interface TripPayment {
  waypoint: string;
  txId: string;
  hashscan: string;
  payer?: string;
}

export interface TripPlan {
  decision: Decision;
  payments: TripPayment[];
  priceTinybars: bigint;
  spentTinybars: bigint;
}

export interface PlanOptions {
  /** Search radius around each checkpoint, metres. */
  radiusM: number;
  /** Refuse to start if the trip would cost more than this. */
  budgetTinybars: bigint;
  /** Called as each checkpoint is paid for and assessed (for live output). */
  onCheckpoint?: (route: Route, result: CheckpointResult, paid: PaidAnswer) => void;
}

export async function planTrip(
  client: KneeDeepClient,
  routes: Route[],
  opts: PlanOptions,
): Promise<TripPlan> {
  const endpoint = await client.discover();
  const price = BigInt(endpoint.payment!.amount);
  const checkpoints = routes.reduce((n, r) => n + r.waypoints.length, 0);
  const cost = price * BigInt(checkpoints);
  if (cost > opts.budgetTinybars) {
    throw new Error(
      `Checking ${checkpoints} checkpoints costs ${cost} tinybars, over this trip's budget of ${opts.budgetTinybars}`,
    );
  }

  const payments: TripPayment[] = [];
  const assessed = [];
  for (const route of routes) {
    const results: CheckpointResult[] = [];
    for (const w of route.waypoints) {
      const paid = await client.conditions(w.lat, w.lng, opts.radiusM);
      if (!paid.payment) throw new Error(`Answer for ${w.name} came without a settled payment`);
      payments.push({ waypoint: w.name, ...paid.payment });
      const result = assessCheckpoint(w, paid.answer);
      results.push(result);
      opts.onCheckpoint?.(route, result, paid);
    }
    assessed.push(assessRoute(route, results));
  }

  return {
    decision: decide(assessed),
    payments,
    priceTinybars: price,
    spentTinybars: price * BigInt(payments.length),
  };
}
