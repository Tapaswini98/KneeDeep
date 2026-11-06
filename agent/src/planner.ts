/**
 * Plan a trip: pay KneeDeep for conditions at every checkpoint of every candidate route, then
 * decide. Spending is bounded before the first payment: the whole trip must fit the budget.
 */
import { assessCheckpoint, assessRoute, type CheckpointResult, decide, type Decision } from './decide';
import type { ConditionsAnswer, KneeDeepClient, PaidAnswer, Vehicle } from './kneedeep';
import type { Route, Waypoint } from './routes';

export interface TripPayment {
  waypoint: string;
  txId: string;
  network: string;
  hashscan: string;
  payer?: string;
}

export interface TripPlan {
  vehicle: Vehicle;
  decision: Decision;
  payments: TripPayment[];
  priceTinybars: bigint;
  spentTinybars: bigint;
}

export interface PlanOptions {
  vehicle: Vehicle;
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
      const paid = await client.conditions(w.lat, w.lng, opts.radiusM, opts.vehicle);
      if (!paid.payment) throw new Error(`Answer for ${w.name} came without a settled payment`);
      payments.push({ waypoint: w.name, ...paid.payment });
      const result = assessCheckpoint(w, paid.answer);
      results.push(result);
      opts.onCheckpoint?.(route, result, paid);
    }
    assessed.push(assessRoute(route, results));
  }

  return {
    vehicle: opts.vehicle,
    decision: decide(assessed),
    payments,
    priceTinybars: price,
    spentTinybars: price * BigInt(payments.length),
  };
}

/** The trip as KneeDeep records it (POST /v1/trips): what was checked, decided, and paid. */
export function tripRecord(plan: TripPlan, trip: { from: Waypoint; to: Waypoint }) {
  const d = plan.decision;
  const statuses = new Set<ConditionsAnswer['dataStatus']>(
    d.routes.flatMap((r) => r.checkpoints.map((c) => c.dataStatus)).filter((s) => s !== 'empty'),
  );
  const dataStatus =
    statuses.size === 0 ? 'empty' : statuses.size === 1 ? [...statuses][0] : ('mixed' as const);
  const offsets = d.routes.map((_, i) => d.routes.slice(0, i).reduce((n, r) => n + r.checkpoints.length, 0));
  return {
    origin: trip.from,
    destination: trip.to,
    vehicle: plan.vehicle,
    outcome: d.outcome,
    chosenRoute: d.choice?.route.id ?? null,
    reasons: d.reasons,
    // Payments were made checkpoint by checkpoint, route by route: the same order as here.
    routes: d.routes.map((r, ri) => ({
      id: r.route.id,
      name: r.route.name,
      distanceKm: r.route.distanceKm,
      verdict: r.verdict,
      reason: r.reason,
      avgConfidence: Math.round(r.avgConfidence * 100) / 100,
      checkpoints: r.checkpoints.map((c, ci) => ({
        name: c.waypoint.name,
        lat: c.waypoint.lat,
        lng: c.waypoint.lng,
        cell: c.evidence?.cell ?? null,
        level: c.evidence?.level ?? null,
        confidence: c.evidence?.confidence ?? null,
        passability: c.passability,
        reason: c.reason,
        txId: plan.payments[offsets[ri] + ci]?.txId ?? null,
      })),
    })),
    totalCostTinybars: plan.spentTinybars.toString(),
    network: plan.payments[0]?.network ?? null,
    dataStatus,
  };
}

export type TripRecord = ReturnType<typeof tripRecord>;
