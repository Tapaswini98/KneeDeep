import ngeohash from 'ngeohash';

/**
 * Privacy by design: a report's location is stored only as a geohash cell.
 * Precision 7 is about 153 m x 153 m, enough to name an underpass, not a doorway.
 */
export const CELL_PRECISION = 7;

/** Mumbai, roughly Virar to Colaba and the harbour line. Reports outside are rejected. */
export const MUMBAI_BOUNDS = { minLat: 18.85, maxLat: 19.5, minLng: 72.75, maxLng: 73.15 } as const;

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function isInMumbai(lat: number, lng: number): boolean {
  const b = MUMBAI_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

/** Coarsen a raw GPS point to its cell. Raw coordinates never leave this function's caller. */
export function toCell(lat: number, lng: number): string {
  if (!isValidLatLng(lat, lng)) throw new RangeError(`Invalid coordinates: ${lat}, ${lng}`);
  return ngeohash.encode(lat, lng, CELL_PRECISION);
}

/** Centre of a cell, for drawing it on a map and measuring distance. */
export function cellCenter(cell: string): { lat: number; lng: number } {
  const { latitude, longitude } = ngeohash.decode(cell);
  return { lat: latitude, lng: longitude };
}

/** Cell bounding box as [minLat, minLng, maxLat, maxLng]. */
export function cellBounds(cell: string): [number, number, number, number] {
  return ngeohash.decode_bbox(cell) as [number, number, number, number];
}

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The shortest geohash prefix whose cell (plus its neighbours) covers a radius.
 * Used to turn "lat, lng, radius" into one Arkiv `startsWith(cell, prefix)` query per prefix.
 */
export function prefixesCovering(lat: number, lng: number, radiusM: number): string[] {
  // Approximate cell heights (m) by precision; geohash cells are roughly square at Mumbai's latitude.
  const cellSizeM: Record<number, number> = { 4: 19_500, 5: 4_900, 6: 1_220, 7: 153 };
  let precision = 4;
  for (const p of [7, 6, 5, 4]) {
    if (cellSizeM[p] >= radiusM) {
      precision = p;
      break;
    }
  }
  const center = ngeohash.encode(lat, lng, precision);
  return [center, ...ngeohash.neighbors(center)];
}
