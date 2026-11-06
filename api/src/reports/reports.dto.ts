import { z } from 'zod';
import { LEVELS, VOTES } from '../arkiv/schemas';
import { isInMumbai } from '../geo/geo';

const point = {
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
};
const inMumbai = (p: { lat: number; lng: number }) => isInMumbai(p.lat, p.lng);
const MUMBAI_ONLY = { message: 'KneeDeep currently covers Mumbai only' };

export const submitReportSchema = z.object({ level: z.enum(LEVELS), ...point }).refine(inMumbai, MUMBAI_ONLY);

/** lat/lng is where the voter is now: only people near a report may vote on it. */
export const submitVoteSchema = z.object({ vote: z.enum(VOTES), ...point }).refine(inMumbai, MUMBAI_ONLY);

export const MAX_LIVE_RADIUS_M = 20_000;

export const liveReportsQuerySchema = z
  .object({ ...point, radius: z.coerce.number().int().min(50).max(MAX_LIVE_RADIUS_M).default(2_000) })
  .refine(inMumbai, MUMBAI_ONLY);

export const entityKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Not an Arkiv entity key');
