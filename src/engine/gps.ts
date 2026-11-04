/** GPS distance helpers: how far a point on the course is from a green. */
import type { HoleGreens, LatLng } from './types';

const EARTH_M = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters between two [lat, lng] points. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const metersToYards = (m: number) => m * 1.0936133;

/** Whole yards between two points. */
export const yardsBetween = (a: LatLng, b: LatLng) => Math.round(metersToYards(haversineMeters(a, b)));

/** Distances in yards from a position to a hole's front/center/back green (null where that point isn't mapped). */
export function distancesToGreen(from: LatLng, green: HoleGreens | null | undefined): { f: number | null; c: number | null; b: number | null } {
  const d = (p?: LatLng) => (p ? yardsBetween(from, p) : null);
  return { f: d(green?.f), c: d(green?.c), b: d(green?.b) };
}

/** Whether a hole has at least one green point mapped. */
export const hasGreen = (g: HoleGreens | null | undefined): g is HoleGreens => !!(g && (g.f || g.c || g.b));
