import { describe, expect, it } from 'vitest';
import { distancesToGreen, haversineMeters, yardsBetween } from './gps';
import type { LatLng } from './types';

describe('gps distances', () => {
  const a: LatLng = [39.8797, -105.0528];
  it('measures short distances accurately', () => {
    // 0.001° of latitude is ~111.3 m.
    expect(haversineMeters(a, [39.8807, -105.0528])).toBeCloseTo(111.2, 0);
    expect(yardsBetween(a, a)).toBe(0);
    // A point ~150 yards north.
    const north: LatLng = [a[0] + 0.001234, a[1]];
    expect(yardsBetween(a, north)).toBe(150);
  });
  it('gives front/center/back, skipping unmapped points', () => {
    const green = { f: [a[0] + 0.0011, a[1]] as LatLng, c: [a[0] + 0.00135, a[1]] as LatLng };
    const d = distancesToGreen(a, green);
    expect(d.f).toBe(134);
    expect(d.c).toBe(164);
    expect(d.b).toBeNull();
    expect(distancesToGreen(a, null)).toEqual({ f: null, c: null, b: null });
  });
});
