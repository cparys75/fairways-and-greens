import { describe, expect, it } from 'vitest';
import { escMax, playerCard, scoreMatch, strokesOnHole, virtualHoles } from './scoring';
import { handicapFrom } from './season';
import { DEFAULT_SETTINGS as S, type Nine, type Player } from './types';

const blue: Nine = {
  id: 'blue',
  name: 'Blue Nine',
  par: [5, 4, 4, 4, 3, 4, 4, 5, 3],
  menHcp: [2, 3, 6, 5, 9, 8, 4, 1, 7],
  womenHcp: [2, 3, 5, 6, 8, 7, 4, 1, 9],
};
const man: Player = { id: 1, name: 'A', teamId: 1, startingHc: 10, redTees: false };

describe('strokes', () => {
  it('gives one stroke per full nine plus extras on the hardest holes', () => {
    expect([0, 1, 2, 9, 10, 18, 19].map((hc) => strokesOnHole(hc, 1))).toEqual([0, 1, 1, 1, 2, 2, 3]);
    expect(strokesOnHole(8, 9)).toBe(0);
    expect(strokesOnHole(9, 9)).toBe(1);
    expect(strokesOnHole(-2, 1)).toBe(0);
  });
});

describe('virtual score', () => {
  it('nets to par + 3 for any handicap (the sheet\'s "Virtual 39")', () => {
    for (const hc of [0, 5, 11, 20]) {
      const card = playerCard(man, hc, blue, null, true, S);
      expect(card.netTotal).toBe(39);
      expect(card.hotshot).toBe(false);
    }
    // A handicap-5 player's virtual card on the Blue nine (a known-good reference value).
    expect(virtualHoles(5, blue, false, S)).toEqual([7, 6, 4, 5, 3, 4, 5, 7, 3]);
  });
});

describe('equitable stroke control', () => {
  it('uses double bogey up to 4, then 7/8/9/10', () => {
    expect(escMax(4, 5, S)).toBe(7);
    expect(escMax(4, 3, S)).toBe(5);
    expect([5, 9, 10, 14, 15, 19, 20, 30].map((hc) => escMax(hc, 4, S))).toEqual([7, 7, 8, 8, 9, 9, 10, 10]);
  });

  it('caps the differential at the max handicap', () => {
    const card = playerCard(man, 20, blue, [12, 12, 12, 12, 12, 12, 12, 12, 12], false, S);
    expect(card.differential).toBe(20);
    expect(playerCard({ ...man, redTees: true }, 30, blue, Array(9).fill(15), false, S).differential).toBe(24);
  });
});

describe('handicap', () => {
  const vals = (...v: number[]) => v.map((value, i) => ({ week: i || null, value }));
  it('keeps the starting HC until there are 5 scores (starting HC included)', () => {
    expect(handicapFrom(vals(7, 5, 9, 5), 7, 20, S).hc).toBe(7);
  });
  it('averages the best 3 of the last 5 and rounds', () => {
    expect(handicapFrom(vals(7, 5, 9, 5, 11), 7, 20, S).hc).toBe(6); // 5,5,7 -> 5.67
    expect(handicapFrom(vals(1, 4, 9, 6, 1, 6), 7, 20, S).hc).toBe(4); // last 5: 4,9,6,1,6 -> 1,4,6
  });
  it('treats negative differentials as 0', () => {
    expect(handicapFrom(vals(0, 3, -1, 8, 3), 2, 20, S).hc).toBe(1);
  });
});

describe('match points', () => {
  const card = (id: number, holes: number[]) => playerCard({ ...man, id }, 0, blue, holes, false, S);
  const par = blue.par;
  it('gives 2/1/0 per hole and 4/2/0 for the lower team net', () => {
    const better = par.map((p, i) => (i === 0 ? p - 1 : p));
    const r = scoreMatch(
      { teamA: 1, teamB: 2 },
      [
        { teamId: 1, playerIds: [1, 2], cards: [card(1, better), card(2, par)] },
        { teamId: 2, playerIds: [3, 4], cards: [card(3, par), card(4, par)] },
      ],
      S,
    );
    expect(r.status).toBe('complete');
    expect(r.sides[0].total).toBe(2 + 8 + 4);
    expect(r.sides[1].total).toBe(0 + 8 + 0);
    expect(r.sides[0].outcome).toBe('W');
  });
  it('uses forfeit overrides and stays pending without all scores', () => {
    const sides = [
      { teamId: 1, playerIds: [1, 2], cards: [card(1, par), null] },
      { teamId: 2, playerIds: [3, 4], cards: [card(3, par), card(4, par)] },
    ] as const;
    expect(scoreMatch({ teamA: 1, teamB: 2 }, [...sides] as never, S).status).toBe('pending');
    const f = scoreMatch({ teamA: 1, teamB: 2, pointsOverride: [4, 18] }, [...sides] as never, S);
    expect(f.status).toBe('forfeit');
    expect(f.sides.map((s) => s.outcome)).toEqual(['L', 'W']);
  });
});
