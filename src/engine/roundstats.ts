/** Optional per-hole stats for personal rounds. Each array has one entry per hole; null = not recorded. */
export interface RoundStats {
  /** Fairway hit on the tee shot. Always null on par 3s. */
  fir: (boolean | null)[];
  /** Green in regulation: on the green in (par - 2) strokes or fewer. */
  gir: (boolean | null)[];
  putts: (number | null)[];
}

export const emptyStats = (holes: number): RoundStats => ({
  fir: Array(holes).fill(null),
  gir: Array(holes).fill(null),
  putts: Array(holes).fill(null),
});

/** Strokes before putting at most par - 2 means the green was hit in regulation. */
export function girFrom(score: number | null | undefined, putts: number | null | undefined, par: number): boolean | null {
  if (score == null || putts == null) return null;
  return score - putts <= par - 2;
}

export interface StatsSummary {
  fairways: { hit: number; of: number };
  greens: { hit: number; of: number };
  /** Total putts on holes where putts were recorded, and on how many holes. */
  putts: { total: number; holes: number };
}

export function summarizeStats(stats: RoundStats | null | undefined, par: number[]): StatsSummary {
  const s: StatsSummary = { fairways: { hit: 0, of: 0 }, greens: { hit: 0, of: 0 }, putts: { total: 0, holes: 0 } };
  if (!stats) return s;
  par.forEach((p, h) => {
    if (p > 3 && stats.fir[h] != null) {
      s.fairways.of++;
      if (stats.fir[h]) s.fairways.hit++;
    }
    if (stats.gir[h] != null) {
      s.greens.of++;
      if (stats.gir[h]) s.greens.hit++;
    }
    if (stats.putts[h] != null) {
      s.putts.holes++;
      s.putts.total += stats.putts[h]!;
    }
  });
  return s;
}

/** Combine several rounds' summaries. */
export function addSummaries(xs: StatsSummary[]): StatsSummary {
  return xs.reduce(
    (a, b) => ({
      fairways: { hit: a.fairways.hit + b.fairways.hit, of: a.fairways.of + b.fairways.of },
      greens: { hit: a.greens.hit + b.greens.hit, of: a.greens.of + b.greens.of },
      putts: { total: a.putts.total + b.putts.total, holes: a.putts.holes + b.putts.holes },
    }),
    summarizeStats(null, []),
  );
}

export const percent = (x: { hit: number; of: number }) => (x.of ? Math.round((100 * x.hit) / x.of) : null);
