import { cellCenter, distanceMeters, isInMumbai, prefixesCovering, toCell } from './geo';

const ANDHERI_SUBWAY = { lat: 19.1197, lng: 72.8464 };
const BANDRA_STATION = { lat: 19.0544, lng: 72.8406 };

describe('geo', () => {
  it('coarsens a point to a ~150 m cell whose centre is close to it', () => {
    const cell = toCell(ANDHERI_SUBWAY.lat, ANDHERI_SUBWAY.lng);
    expect(cell).toHaveLength(7);
    expect(distanceMeters(ANDHERI_SUBWAY, cellCenter(cell))).toBeLessThan(110);
  });

  it('puts nearby points in the same cell and distant ones in different cells', () => {
    const a = toCell(ANDHERI_SUBWAY.lat, ANDHERI_SUBWAY.lng);
    expect(toCell(ANDHERI_SUBWAY.lat + 0.0001, ANDHERI_SUBWAY.lng)).toBe(a);
    expect(toCell(BANDRA_STATION.lat, BANDRA_STATION.lng)).not.toBe(a);
  });

  it('rejects invalid coordinates', () => {
    expect(() => toCell(NaN, 72)).toThrow(RangeError);
    expect(() => toCell(91, 72)).toThrow(RangeError);
  });

  it('knows Mumbai', () => {
    expect(isInMumbai(ANDHERI_SUBWAY.lat, ANDHERI_SUBWAY.lng)).toBe(true);
    expect(isInMumbai(28.6139, 77.209)).toBe(false); // Delhi
  });

  it('measures Bandra to Andheri as roughly 7 km', () => {
    const d = distanceMeters(BANDRA_STATION, ANDHERI_SUBWAY);
    expect(d).toBeGreaterThan(6_500);
    expect(d).toBeLessThan(8_000);
  });

  it('covers a radius with a centre prefix and its 8 neighbours', () => {
    const prefixes = prefixesCovering(ANDHERI_SUBWAY.lat, ANDHERI_SUBWAY.lng, 500);
    expect(prefixes).toHaveLength(9);
    expect(prefixes.every((p) => p.length === 6)).toBe(true);
    expect(toCell(ANDHERI_SUBWAY.lat, ANDHERI_SUBWAY.lng).startsWith(prefixes[0])).toBe(true);
  });
});
