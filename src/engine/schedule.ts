import type { Match, Week } from './types';

/**
 * Round-robin pairings (circle method). Returns one list of matches per round; with an odd number of
 * teams one team sits out each round. Tee-time slots rotate so every team gets early and late times.
 */
export function roundRobin(teamIds: number[], rounds: number, slots: { slot: string; teeTime?: string }[] = []): Match[][] {
  const ids: (number | null)[] = [...teamIds];
  if (ids.length % 2) ids.push(null);
  const n = ids.length;
  const out: Match[][] = [];
  for (let r = 0; r < rounds; r++) {
    const cycle = r % (n - 1);
    const order = [ids[0], ...rotate(ids.slice(1), cycle)];
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (a != null && b != null) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    const shift = r % Math.max(1, pairs.length);
    const rotated = rotate(pairs, shift);
    out.push(rotated.map(([a, b], i) => ({ teamA: a, teamB: b, slot: slots[i]?.slot, teeTime: slots[i]?.teeTime })));
  }
  return out;
}

function rotate<T>(xs: T[], k: number): T[] {
  if (!xs.length) return xs;
  const s = ((k % xs.length) + xs.length) % xs.length;
  return [...xs.slice(xs.length - s), ...xs.slice(0, xs.length - s)];
}

export interface SchedulePlan {
  /** Date of week 1 (YYYY-MM-DD); later weeks follow every 7 days. */
  startDate: string | null;
  /** Regular-season weeks, filled with round-robin matchups. */
  weeks: number;
  /** Playoff weeks added after the regular season, left without matchups. */
  playoffWeeks: number;
  /** Nines to play, rotating week by week (e.g. front, back, front…). */
  nineIds: string[];
  /** Tee-time slots, one per match. */
  slots: { slot: string; teeTime?: string }[];
}

/** A full season schedule: dated weeks, rotating nines, round-robin matchups and empty playoff weeks. */
export function buildSchedule(teamIds: number[], plan: SchedulePlan): Omit<Week, 'scores'>[] {
  const rounds = roundRobin(teamIds, plan.weeks, plan.slots);
  return Array.from({ length: plan.weeks + plan.playoffWeeks }, (_, i) => ({
    number: i + 1,
    date: plan.startDate ? addDays(plan.startDate, 7 * i) : null,
    nineId: plan.nineIds[i % plan.nineIds.length],
    playoff: i >= plan.weeks,
    inclement: false,
    matches: rounds[i] ?? [],
  }));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
