import { describe, expect, it } from 'vitest';
import { formatUnits, playGame, strokesPerHole, vegasNumber, type GameSetup, type GamePlayer } from './games';

const par9 = [4, 4, 3, 5, 4, 4, 3, 5, 4];
const setup = (id: GameSetup['id'], extra: Partial<GameSetup> = {}): GameSetup => ({ id, handicaps: 'off', stakes: 'points', unit: 1, ...extra });
const p = (name: string, holes: number[], handicap: number | null = null): GamePlayer => ({ name, holes, handicap });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('strokes', () => {
  it('gives a nine half the 18-hole handicap, on the hardest holes first', () => {
    expect(strokesPerHole(10, [9, 1, 7, 3, 5, 2, 8, 4, 6], 9)).toEqual([0, 1, 0, 1, 1, 1, 0, 1, 0]);
    expect(strokesPerHole(20, null, 9)).toEqual([2, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(strokesPerHole(0, null, 18)).toEqual(Array(18).fill(0));
  });
});

describe('skins', () => {
  it('carries tied holes over and pays each skin from every other player', () => {
    const r = playGame(setup('skins', { carryover: true }), par9, null, [
      p('A', [4, 4, 3, 5, 4, 4, 3, 5, 4]),
      p('B', [4, 5, 3, 5, 4, 4, 3, 5, 4]),
      p('C', [4, 5, 4, 4, 4, 4, 3, 5, 4]),
    ]);
    // Hole 1 tied (carry), hole 2 A wins 2 skins, hole 3 tied A/B (carry), hole 4 C wins 2.
    expect(r.holes.slice(0, 4)).toEqual(['Tied: 1 carries over', 'A wins 2 skins', 'Tied: 1 carries over', 'C wins 2 skins']);
    expect(r.units).toEqual([2 * 2 - 2, -2 - 2, -2 + 2 * 2]);
    expect(sum(r.units)).toBe(0);
  });
});

describe('match play', () => {
  it('closes out a match early, with net strokes', () => {
    const r = playGame(setup('match', { handicaps: 'full' }), par9, [1, 2, 3, 4, 5, 6, 7, 8, 9], [p('A', [4, 4, 3, 5, 4, 4, 3, 5, 4], 0), p('B', [5, 5, 4, 6, 5, 5, 4, 6, 5], 2)]);
    // B gets one stroke (half of 2 for a nine) on the hardest hole, halving hole 1; A wins the next five.
    expect(r.holes[0]).toBe('Halved');
    expect(r.status).toBe('A won 5 & 3');
    expect(r.units).toEqual([1, -1]);
  });

  it('plays two-on-two best ball and Nassau bets on 18 holes', () => {
    const h = (x: number) => Array(18).fill(x);
    const r = playGame(setup('nassau', { teamA: [0, 2] }), [...par9, ...par9], null, [p('A', h(4)), p('B', h(5)), p('C', h(6)), p('D', h(6))]);
    // Team A+C best ball 4 beats B+D's 5 on every hole: front, back and overall.
    expect(r.status).toBe('Front: A & C won 5 & 4 · Back: A & C won 5 & 4 · Overall: A & C won 10 & 8');
    expect(r.units).toEqual([3, -3, 3, -3]);
  });
});

describe('wolf', () => {
  it('pays two on two, and double for a lone wolf', () => {
    const r = playGame(setup('wolf', { wolf: [1, 'lone', 'lone', null] }), par9, null, [
      p('A', [4, 4, 5, 4, 4, 4, 4, 4, 4]),
      p('B', [5, 3, 4, 4, 4, 4, 4, 4, 4]),
      p('C', [5, 5, 3, 4, 4, 4, 4, 4, 4]),
      p('D', [5, 5, 4, 4, 4, 4, 4, 4, 4]),
    ]);
    // Hole 1: wolf A picks B; A&B (4) beat C&D (5). Hole 2: B lone, 3 beats 4. Hole 3: C lone, 3 beats 4.
    expect(r.holes.slice(0, 4)).toEqual(['A & B win', 'Lone wolf B wins', 'Lone wolf C wins', 'D is the wolf: pick a partner or lone wolf']);
    expect(r.units).toEqual([1 - 2 - 2, 1 + 6 - 2, -1 - 2 + 6, -1 - 2 - 2]);
    expect(sum(r.units)).toBe(0);
  });
});

describe('Vegas', () => {
  it('makes numbers low digit first, flips on a birdie, and 10+ goes first', () => {
    expect(vegasNumber([5, 4], false)).toBe(45);
    expect(vegasNumber([5, 4], true)).toBe(54);
    expect(vegasNumber([4, 10], false)).toBe(104);
    const r = playGame(setup('vegas', { birdieFlip: true }), [4], null, [p('A', [3]), p('B', [5]), p('C', [4]), p('D', [6])]);
    // A&B: 35 with a birdie; C&D flipped to 64. A&B win 29 each.
    expect(r.holes[0]).toBe('35 – 64: A & B +29');
    expect(r.units).toEqual([29, 29, -29, -29]);
  });
});

describe('stroke play and Stableford', () => {
  it('pays the low total once everyone has finished', () => {
    const r = playGame(setup('stroke'), [4, 4], null, [p('A', [4, 4]), p('B', [5, 4]), p('C', [5, 5])]);
    expect(r.units).toEqual([2, -1, -1]);
    expect(r.status).toBe('A wins with 8');
  });

  it('settles Stableford by the difference in points', () => {
    const r = playGame(setup('stableford'), [4, 4], null, [p('A', [3, 4]), p('B', [5, 4])]);
    expect(r.standing).toEqual(['5 pts', '3 pts']);
    expect(r.units).toEqual([2, -2]);
    expect(formatUnits(2, { stakes: 'money', unit: 0.5 })).toBe('+$1.00');
    expect(formatUnits(-2, { stakes: 'points', unit: 1 })).toBe('−2 pts');
  });
});
