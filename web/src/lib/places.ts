/** Friendly names for the ~150 m cells reports live in. Locations are coarse on purpose. */
type Point = { lat: number; lng: number };

/** Known spots: the demo routes' checkpoints and Mumbai's usual flood points. */
export const PLACES = [
  { name: 'Andheri subway', lat: 19.1197, lng: 72.8464 },
  { name: 'Milan subway', lat: 19.0833, lng: 72.8427 },
  { name: 'Khar subway', lat: 19.0717, lng: 72.8406 },
  { name: 'Kalanagar junction', lat: 19.0606, lng: 72.8484 },
  { name: 'Vile Parle flyover', lat: 19.0996, lng: 72.8526 },
  { name: 'Andheri flyover (E)', lat: 19.1155, lng: 72.8551 },
  { name: 'Hindmata', lat: 19.0035, lng: 72.8423 },
  { name: 'Sion', lat: 19.039, lng: 72.8619 },
];

export function distanceMeters(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "Andheri subway" when within 300 m of a known spot, otherwise coordinates. */
export function placeName(p: Point): string {
  let best: { name: string; d: number } | null = null;
  for (const s of PLACES) {
    const d = distanceMeters(p, s);
    if (d <= 300 && (!best || d < best.d)) best = { name: s.name, d };
  }
  return best?.name ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function timeAgo(iso: string): string {
  const min = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min ago`;
  return new Date(iso).toLocaleString();
}

export function timeLeft(iso: string): string {
  const min = (new Date(iso).getTime() - Date.now()) / 60_000;
  if (min < 1) return 'under a minute';
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
}
