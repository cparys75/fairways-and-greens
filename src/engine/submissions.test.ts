import { describe, expect, it } from 'vitest';
import { consensus, matchPlayerIds, sameCards, type CardEntry, type Submission } from './submissions';
import { normalizeSeason } from './normalize';

const holes = (n: number) => Array(9).fill(n);
const card: CardEntry[] = [
  { playerId: 1, holes: holes(4), absent: false },
  { playerId: 2, holes: holes(5), absent: false },
  { playerId: 3, holes: holes(6), absent: false },
  { playerId: 4, holes: null, absent: true },
];
const sub = (userId: number, teamId: number, cards = card): Submission => ({ userId, playerId: userId, teamId, cards });

describe('consensus', () => {
  it('waits for the other team even when the submissions agree', () => {
    const c = consensus([sub(1, 10), sub(2, 10)], 10, 20);
    expect(c.status).toBe('waiting');
    expect(c.missingTeams).toEqual([20]);
  });

  it('agrees once both teams submit identical cards, in any player order', () => {
    const c = consensus([sub(1, 10), sub(3, 20, [...card].reverse())], 10, 20);
    expect(c.status).toBe('agreed');
    expect(c.cards?.map((x) => x.playerId)).toEqual([1, 2, 3, 4]);
  });

  it('reports every hole that differs', () => {
    const other = card.map((c) => (c.playerId === 2 ? { ...c, holes: [5, 5, 6, 5, 5, 5, 5, 5, 4] } : c));
    const c = consensus([sub(1, 10), sub(3, 20, other)], 10, 20);
    expect(c.status).toBe('mismatch');
    expect(c.differences).toEqual([
      { playerId: 2, hole: 2 },
      { playerId: 2, hole: 8 },
    ]);
  });

  it('flags a mismatch before the other team submits, and absent vs present', () => {
    const other = card.map((c) => (c.playerId === 4 ? { playerId: 4, holes: holes(7), absent: false } : c));
    const c = consensus([sub(1, 10), sub(2, 10, other)], 10, 20);
    expect(c.status).toBe('mismatch');
    expect(c.differences).toEqual([{ playerId: 4, hole: 'absent' }]);
  });

  it('ignores hole scores sent for absent players', () => {
    const withJunk = card.map((c) => (c.absent ? { ...c, holes: holes(9) } : c));
    expect(sameCards(card, withJunk)).toBe(true);
  });

  it('treats cards as equal when they agree on which holes were not played', () => {
    const dnf = [false, false, true, false, false, false, false, false, false];
    const a = card.map((c) => (c.playerId === 1 ? { ...c, dnf, holes: [4, 4, 0, 4, 4, 4, 4, 4, 4] } : c));
    // The second card left the skipped hole at a different leftover value — still the same card.
    const b = card.map((c) => (c.playerId === 1 ? { ...c, dnf, holes: [4, 4, 9, 4, 4, 4, 4, 4, 4] } : c));
    expect(sameCards(a, b)).toBe(true);
  });

  it('flags a hole where one card marks did-not-play and the other has a score', () => {
    const dnf = [false, false, true, false, false, false, false, false, false];
    const a = card.map((c) => (c.playerId === 1 ? { ...c, dnf, holes: [4, 4, 0, 4, 4, 4, 4, 4, 4] } : c));
    const c = consensus([sub(1, 10, a), sub(3, 20)], 10, 20);
    expect(c.status).toBe('mismatch');
    expect(c.differences).toEqual([{ playerId: 1, hole: 2 }]);
  });

  it('has no status without submissions', () => {
    expect(consensus([], 10, 20)).toMatchObject({ status: 'none', missingTeams: [10, 20] });
  });
});

describe('matchPlayerIds', () => {
  it('uses active players, plus inactive ones who already have a score that week', () => {
    const data = normalizeSeason({
      players: [
        { id: 1, name: 'A', teamId: 1, startingHc: 0, redTees: false },
        { id: 2, name: 'B', teamId: 1, startingHc: 0, redTees: false, active: false },
        { id: 3, name: 'C', teamId: 2, startingHc: 0, redTees: false, active: false },
        { id: 4, name: 'D', teamId: 2, startingHc: 0, redTees: false },
      ],
    });
    const week = { number: 1, nineId: 'f', matches: [], scores: [{ playerId: 3, holes: holes(4) }] };
    expect(matchPlayerIds(data, week, { teamA: 1, teamB: 2 })).toEqual([[1], [3, 4]]);
  });
});
