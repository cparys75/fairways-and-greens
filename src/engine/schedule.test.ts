import { describe, expect, it } from 'vitest';
import { buildSchedule, roundRobin } from './schedule';

describe('roundRobin', () => {
  it('pairs every team with every other exactly once in n-1 rounds', () => {
    const teams = Array.from({ length: 14 }, (_, i) => i + 1);
    const rounds = roundRobin(teams, 13);
    const met = new Map<string, number>();
    for (const r of rounds) {
      const seen = new Set<number>();
      for (const m of r) {
        expect(seen.has(m.teamA) || seen.has(m.teamB)).toBe(false);
        seen.add(m.teamA).add(m.teamB);
        const k = [m.teamA, m.teamB].sort((a, b) => a - b).join('-');
        met.set(k, (met.get(k) ?? 0) + 1);
      }
      expect(seen.size).toBe(14);
    }
    expect(met.size).toBe((14 * 13) / 2);
    expect([...met.values()].every((v) => v === 1)).toBe(true);
  });

  it('gives a bye with an odd number of teams', () => {
    const rounds = roundRobin([1, 2, 3, 4, 5], 5);
    expect(rounds.every((r) => r.length === 2)).toBe(true);
  });
});

describe('buildSchedule', () => {
  it('dates weeks a week apart, rotates nines and leaves playoff weeks empty', () => {
    const weeks = buildSchedule([1, 2, 3, 4], {
      startDate: '2026-04-28',
      weeks: 3,
      playoffWeeks: 2,
      nineIds: ['front', 'back'],
      slots: [{ slot: 'A', teeTime: '4:00pm' }, { slot: 'B', teeTime: '4:09pm' }],
    });
    expect(weeks.map((w) => [w.number, w.date, w.nineId, w.playoff, w.matches.length])).toEqual([
      [1, '2026-04-28', 'front', false, 2],
      [2, '2026-05-05', 'back', false, 2],
      [3, '2026-05-12', 'front', false, 2],
      [4, '2026-05-19', 'back', true, 0],
      [5, '2026-05-26', 'front', true, 0],
    ]);
    expect(weeks[0].matches[0]).toMatchObject({ slot: 'A', teeTime: '4:00pm' });
  });
});
