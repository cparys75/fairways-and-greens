import { describe, expect, it } from 'vitest';
import { addSummaries, girFrom, percent, summarizeStats } from './roundstats';

describe('girFrom', () => {
  it('is a green in regulation when strokes before putting are at most par - 2', () => {
    expect(girFrom(4, 2, 4)).toBe(true); // on in 2
    expect(girFrom(3, 1, 4)).toBe(true); // on in 2, one putt
    expect(girFrom(5, 2, 4)).toBe(false); // on in 3
    expect(girFrom(3, 2, 3)).toBe(true); // par 3 on in 1
    expect(girFrom(4, 0, 5)).toBe(false); // par 5 holed out from off the green in 4: not on in 3
  });

  it('needs both a score and putts', () => {
    expect(girFrom(null, 2, 4)).toBeNull();
    expect(girFrom(4, null, 4)).toBeNull();
  });
});

describe('summarizeStats', () => {
  const par = [4, 3, 5, 4];
  it('counts fairways on par 4s and 5s only, greens and putts where recorded', () => {
    const s = summarizeStats({ fir: [true, true, false, null], gir: [true, false, null, true], putts: [2, 3, null, 1] }, par);
    expect(s).toEqual({ fairways: { hit: 1, of: 2 }, greens: { hit: 2, of: 3 }, putts: { total: 6, holes: 3 } });
    expect(percent(s.fairways)).toBe(50);
    expect(percent(s.greens)).toBe(67);
  });

  it('adds rounds together, and treats missing stats as nothing recorded', () => {
    const a = summarizeStats({ fir: [true, null, true, true], gir: [true, true, true, true], putts: [2, 2, 2, 2] }, par);
    const total = addSummaries([a, summarizeStats(null, par)]);
    expect(total).toEqual(a);
    expect(percent({ hit: 0, of: 0 })).toBeNull();
  });
});
