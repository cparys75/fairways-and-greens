import { stablefordPoints } from './formats';
import type { Match, Nine, Player, Settings } from './types';

export const HOLES = 9;

export function holeHcps(nine: Nine, redTees: boolean): number[] {
  return redTees ? nine.womenHcp : nine.menHcp;
}

/** Handicap strokes received on a hole: one per full nine, plus one more on the hardest `hc % 9` holes. */
export function strokesOnHole(hc: number, holeHcp: number): number {
  if (hc <= 0) return 0;
  return Math.floor(hc / HOLES) + (hc % HOLES >= holeHcp ? 1 : 0);
}

export function strokesForNine(hc: number, hcps: number[]): number[] {
  return hcps.map((h) => strokesOnHole(hc, h));
}

/**
 * Score for an absent player: par plus their strokes, plus `virtualOverPar` extra strokes on the
 * hardest holes, so the net always comes out to par + virtualOverPar (the sheet's "Virtual 39").
 */
export function virtualHoles(hc: number, nine: Nine, redTees: boolean, settings: Settings): number[] {
  const hcps = holeHcps(nine, redTees);
  return nine.par.map((par, i) => par + strokesOnHole(hc, hcps[i]) + strokesOnHole(settings.virtualOverPar, hcps[i]));
}

/** Max score per hole for handicap purposes (equitable stroke control). */
export function escMax(hc: number, par: number, settings: Settings): number {
  const rule = settings.esc.find((r) => r.upToHc === null || hc <= r.upToHc);
  if (!rule) return Infinity;
  return rule.maxScore ?? par + (rule.overPar ?? 2);
}

export function maxHcFor(player: Pick<Player, 'redTees'>, settings: Settings): number {
  return player.redTees ? settings.womenMaxHc : settings.menMaxHc;
}

export interface PlayerCard {
  playerId: number;
  hc: number;
  /** The whole round was a virtual (absent) score — no holes were played. */
  virtual: boolean;
  /** Per hole, true where the player did not play it (whole-round virtual → all true). */
  dnf: boolean[];
  /** Virtual, or at least one hole not played: never counts toward handicap, records or averages. */
  incomplete: boolean;
  gross: number[];
  strokes: number[];
  net: number[];
  grossTotal: number;
  netTotal: number;
  /** Holes where the gross exceeded the ESC max (shown red, like the sheet). */
  escCapped: boolean[];
  /** Score adjusted for handicap minus par, capped at the player's max HC. */
  differential: number;
  hotshot: boolean;
  /** Stableford points per hole for the net score, and their total. */
  stableford: number[];
  stablefordTotal: number;
}

export function playerCard(
  player: Player,
  hc: number,
  nine: Nine,
  holes: number[] | null,
  virtual: boolean,
  settings: Settings,
  /** Holes the player did not play; those get a virtual (net-39) fill and make the round incomplete. */
  dnfHoles?: boolean[] | null,
): PlayerCard {
  const hcps = holeHcps(nine, player.redTees);
  const whole = virtual || !holes;
  const fill = virtualHoles(hc, nine, player.redTees, settings);
  // Which holes weren't played: the whole round (virtual), or specific holes left blank for DNF.
  const dnf = nine.par.map((_, i) => whole || !!dnfHoles?.[i]);
  // Real gross where the player played, a virtual net-39 score where they didn't.
  const gross = nine.par.map((_, i) => (dnf[i] ? fill[i] : holes![i]));
  const strokes = strokesForNine(hc, hcps);
  const net = gross.map((g, i) => g - strokes[i]);
  const caps = nine.par.map((par) => escMax(hc, par, settings));
  const adjusted = gross.reduce((sum, g, i) => sum + Math.min(g, caps[i]), 0);
  const grossTotal = sum(gross);
  const netTotal = sum(net);
  const incomplete = dnf.some(Boolean);
  return {
    playerId: player.id,
    hc,
    virtual,
    dnf,
    incomplete,
    gross,
    strokes,
    net,
    grossTotal,
    netTotal,
    // Virtual-fill holes aren't a real score, so they're never flagged as capped.
    escCapped: gross.map((g, i) => !dnf[i] && g > caps[i]),
    differential: Math.min(adjusted - sumPar(nine), maxHcFor(player, settings)),
    hotshot: !incomplete && netTotal < settings.hotshotBelow,
    ...stablefordFor(net, nine, settings),
  };
}

function stablefordFor(net: number[], nine: Nine, settings: Settings) {
  const stableford = net.map((n, h) => stablefordPoints(n, nine.par[h], settings.stableford));
  return { stableford, stablefordTotal: sum(stableford) };
}

export type Outcome = 'W' | 'L' | 'T';

export interface MatchSide {
  teamId: number;
  /** Cards for the team's players, in roster order; null where no score has been entered. */
  cards: (PlayerCard | null)[];
  playerIds: number[];
  teamNet: number[];
  teamNetTotal: number;
  holePoints: number[];
  holePointsTotal: number;
  bonus: number;
  total: number;
  outcome: Outcome;
}

export interface MatchResult {
  match: Match;
  status: 'complete' | 'pending' | 'forfeit';
  /** Scored as 2 vs 1 (an absent player, with the best-ball rule on). */
  twoVsOne?: boolean;
  sides: [MatchSide, MatchSide];
}

export function scoreMatch(
  match: Match,
  sides: [{ teamId: number; playerIds: number[]; cards: (PlayerCard | null)[] }, { teamId: number; playerIds: number[]; cards: (PlayerCard | null)[] }],
  settings: Settings,
  /** Best ball: the team's net on a hole is its best player's net, not the sum. */
  bestBall = false,
  /** 2 vs 1 for an absent player: score each side by its present (non-virtual) players' best ball. */
  twoVsOne = false,
): MatchResult {
  const useMin = bestBall || twoVsOne;
  const teamNet = sides.map((s) =>
    Array.from({ length: HOLES }, (_, h) => {
      const cards = s.cards.filter((c): c is PlayerCard => !!c);
      if (!cards.length) return 0;
      // Best ball / 2-vs-1: a player who didn't play this hole is set aside, so the team plays the
      // better ball of whoever teed off. Otherwise every card counts (virtual holes carry a net-39).
      const pool = useMin ? cards.filter((c) => !c.dnf[h]) : cards;
      const use = pool.length ? pool : cards;
      const nets = use.map((c) => c.net[h]);
      return useMin ? Math.min(...nets) : sum(nets);
    }),
  );
  const pts = (mine: number, theirs: number, win: number, tie: number) => (mine < theirs ? win : mine === theirs ? tie : 0);
  const built = sides.map((s, i) => {
    const mine = teamNet[i];
    const theirs = teamNet[1 - i];
    const holePoints = mine.map((n, h) => pts(n, theirs[h], settings.holeWinPoints, settings.holeTiePoints));
    const bonus = pts(sum(mine), sum(theirs), settings.netBonusWin, settings.netBonusTie);
    return {
      teamId: s.teamId,
      cards: s.cards,
      playerIds: s.playerIds,
      teamNet: mine,
      teamNetTotal: sum(mine),
      holePoints,
      holePointsTotal: sum(holePoints),
      bonus,
      total: sum(holePoints) + bonus,
      outcome: 'T' as Outcome,
    };
  }) as [MatchSide, MatchSide];

  let status: MatchResult['status'] = sides.every((s) => s.cards.length > 0 && s.cards.every(Boolean)) ? 'complete' : 'pending';
  if (match.pointsOverride) {
    built[0].total = match.pointsOverride[0];
    built[1].total = match.pointsOverride[1];
    status = 'forfeit';
  }
  const [a, b] = built;
  a.outcome = a.total > b.total ? 'W' : a.total < b.total ? 'L' : 'T';
  b.outcome = a.outcome === 'W' ? 'L' : a.outcome === 'L' ? 'W' : 'T';
  return { match, status, twoVsOne, sides: built };
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function sumPar(nine: Nine): number {
  return sum(nine.par);
}
