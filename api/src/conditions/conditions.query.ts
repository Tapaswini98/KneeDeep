import { z } from 'zod';
import { DEFAULT_VEHICLE, VEHICLES, type Vehicle } from '../fusion/passability';
import { isInMumbai } from '../geo/geo';

export const MAX_RADIUS_M = 2_000;
export const DEFAULT_RADIUS_M = 500;

export const conditionsQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radius: z.coerce.number().int().min(50).max(MAX_RADIUS_M).default(DEFAULT_RADIUS_M),
    vehicle: z.enum(Object.keys(VEHICLES) as [Vehicle, ...Vehicle[]]).default(DEFAULT_VEHICLE),
  })
  .refine((q) => isInMumbai(q.lat, q.lng), { message: 'KneeDeep currently covers Mumbai only' });

export type ConditionsQuery = z.infer<typeof conditionsQuerySchema>;
