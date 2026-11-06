import { z } from 'zod';
import { isInMumbai } from '../geo/geo';

export const MAX_RADIUS_M = 2_000;
export const DEFAULT_RADIUS_M = 500;

export const conditionsQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radius: z.coerce.number().int().min(50).max(MAX_RADIUS_M).default(DEFAULT_RADIUS_M),
  })
  .refine((q) => isInMumbai(q.lat, q.lng), { message: 'KneeDeep currently covers Mumbai only' });

export type ConditionsQuery = z.infer<typeof conditionsQuerySchema>;
