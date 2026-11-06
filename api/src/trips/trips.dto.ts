import { z } from 'zod';
import { LEVELS } from '../arkiv/vocabulary';
import { VEHICLES, type Vehicle } from '../fusion/passability';

const name = z.string().trim().min(1).max(120);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const place = z.object({ name, lat, lng });
const sentence = z.string().trim().min(1).max(600);

const checkpoint = z.object({
  name,
  lat,
  lng,
  cell: z
    .string()
    .regex(/^[0-9b-hjkmnp-z]{7}$/, 'cell must be a precision-7 geohash')
    .nullable(),
  level: z.enum(LEVELS).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  passability: z.enum(['safe', 'risky', 'blocked', 'unknown']),
  reason: sentence,
  /** The Hedera transaction that paid for this checkpoint's query. */
  txId: z
    .string()
    .regex(/^0\.0\.\d+@\d+\.\d+$/, 'txId must be a Hedera transaction id')
    .nullable(),
});

const route = z.object({
  id: z.string().trim().min(1).max(64),
  name,
  distanceKm: z.number().min(0).max(500),
  verdict: z.enum(['chosen', 'rejected', 'passed_over']),
  reason: sentence,
  avgConfidence: z.number().min(0).max(1),
  checkpoints: z.array(checkpoint).min(1).max(12),
});

/** POST /v1/trips. Checked for internal consistency, so a buggy agent cannot draw a nonsense trip. */
export const tripSchema = z
  .object({
    origin: place,
    destination: place,
    vehicle: z.enum(Object.keys(VEHICLES) as [Vehicle, ...Vehicle[]]),
    outcome: z.enum(['dispatched', 'held']),
    chosenRoute: z.string().trim().min(1).max(64).nullable(),
    reasons: z.array(sentence).min(1).max(12),
    routes: z.array(route).min(1).max(6),
    totalCostTinybars: z.string().regex(/^\d{1,18}$/, 'totalCostTinybars must be an integer string'),
    network: z.enum(['hedera:testnet', 'hedera:mainnet']).nullable(),
    dataStatus: z.enum(['live', 'simulated', 'mixed', 'empty']),
  })
  .superRefine((t, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const chosen = t.routes.filter((r) => r.verdict === 'chosen');
    if (new Set(t.routes.map((r) => r.id)).size !== t.routes.length) problem('route ids must be unique');
    for (const r of t.routes) {
      const blocked = r.checkpoints.some((c) => c.passability === 'blocked');
      if (blocked !== (r.verdict === 'rejected')) {
        problem(`route ${r.id}: rejected if and only if a checkpoint is blocked`);
      }
    }
    if (t.outcome === 'dispatched') {
      if (chosen.length !== 1 || chosen[0].id !== t.chosenRoute) {
        problem('a dispatched trip has exactly one chosen route, named in chosenRoute');
      }
    } else if (
      t.chosenRoute !== null ||
      chosen.length > 0 ||
      t.routes.some((r) => r.verdict !== 'rejected')
    ) {
      problem('a held trip has no chosen route and every route rejected');
    }
  });

export type TripInput = z.infer<typeof tripSchema>;
