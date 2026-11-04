/** League rules. Everything the spreadsheet hard-coded in formulas lives here so admins can change it. */
/** How the league plays: see FORMATS in formats.ts. */
export type Format = 'teamMatch' | 'bestBall' | 'individualMatch' | 'stroke' | 'stableford' | 'scramble';

export interface Settings {
  format: Format;
  menMaxHc: number;
  womenMaxHc: number;
  minHc: number;
  /** Handicap = average of the best `handicapBest` of the last `handicapWindow` scores (starting HC counts as one). */
  handicapWindow: number;
  handicapBest: number;
  /** Equitable stroke control: max score per hole for handicap purposes, by playing handicap. */
  esc: EscRule[];
  holeWinPoints: number;
  holeTiePoints: number;
  /** Points for the lower team net total over the nine. */
  netBonusWin: number;
  netBonusTie: number;
  forfeitWinnerPoints: number;
  forfeitLoserPoints: number;
  /** A net score strictly below this is a "Hotshot". */
  hotshotBelow: number;
  /** A virtual (absent player) score is set so the net is par + this. */
  virtualOverPar: number;
  /** Whether scores from weeks flagged as inclement weather count toward handicaps. */
  inclementCountsForHandicap: boolean;
  /** Whether virtual (absent-player) rounds count in scoring averages. The spreadsheet included them. */
  averagesIncludeVirtual: boolean;
  /**
   * How an absent player's team is scored (team formats):
   * - 'virtual': the absent player gets a virtual score (net = par + virtualOverPar) that counts.
   * - 'bestBall': the match becomes 2 vs 1 — each side's net on a hole is the best (lowest) of its
   *   present players, so the full team plays its better ball against the lone player.
   */
  absentRule: 'virtual' | 'bestBall';
  /** Stableford points for a net [double bogey or worse, bogey, par, birdie, eagle, albatross or better]. */
  stableford: number[];
  /** Scramble team handicap: percent of each player's handicap, lowest handicap first. */
  scramblePercents: number[];
}

export interface EscRule {
  /** Rule applies when playing HC <= upToHc (rules are checked in order; use null for "and over"). */
  upToHc: number | null;
  /** Fixed max per hole, or null to use par + overPar. */
  maxScore: number | null;
  overPar?: number;
}

/** A point on earth, [latitude, longitude]. */
export type LatLng = [number, number];

/** Front, center and back of a hole's green (each optional), for GPS distances. */
export interface HoleGreens {
  f?: LatLng;
  c?: LatLng;
  b?: LatLng;
}

export interface Nine {
  id: string;
  name: string;
  par: number[];
  /** Hole handicap rank 1 (hardest) .. 9 for men / red tees. */
  menHcp: number[];
  womenHcp: number[];
  /** Course this nine belongs to; nines from the same course are grouped together in menus. */
  course?: string;
  /** Tee the par, yardage and men's hole handicaps were taken from. */
  tee?: string;
  yardage?: number[];
  /** Number printed for the first hole (10 for a back nine). Defaults to 1. */
  firstHole?: number;
  /** Where the hole data came from, e.g. "GolfCourseAPI 12345". */
  source?: string;
  /** Front/center/back green coordinates per hole, for GPS distance-to-green. One entry per hole, null when unmapped. */
  greens?: (HoleGreens | null)[];
}

export interface Team {
  id: number;
  name: string;
}

export interface Player {
  id: number;
  name: string;
  teamId: number | null;
  startingHc: number;
  /** Plays the red tees: women's hole handicaps and max HC. */
  redTees: boolean;
  active?: boolean;
  /** Signing in with this email links the account to the player. Only sent to admins. */
  email?: string | null;
  /** Typed by an admin for league contact (a player's own number is on their account). Only sent to admins. */
  phone?: string | null;
}

export interface Match {
  slot?: string;
  teeTime?: string;
  teamA: number;
  teamB: number;
  /** Total points typed over the calculation, e.g. a forfeit [18, 4]. */
  pointsOverride?: [number, number] | null;
}

export interface Score {
  playerId: number;
  /** Nine gross hole scores. Ignored when `virtual` is set. */
  holes: number[] | null;
  /** Absent player: a net-39 score is generated from the player's handicap and doesn't count for handicap. */
  virtual?: boolean;
  /**
   * Holes the player did not play (left early, arrived late): one flag per hole, true = not played.
   * Scored by the league's absent rule — a virtual (net-39) score under the 'virtual' rule, or set
   * aside so the hole plays best ball (2 vs 1) under the 'bestBall' rule. Any flagged hole makes the
   * round incomplete, so it never counts toward handicap, records or averages.
   */
  dnf?: boolean[] | null;
  /** Playing handicap override for this week (otherwise computed). */
  hc?: number | null;
}

export interface Week {
  number: number;
  date?: string | null;
  nineId: string;
  playoff?: boolean;
  inclement?: boolean;
  matches: Match[];
  scores: Score[];
}

export interface SeasonData {
  season: { id?: number; name: string };
  settings: Settings;
  nines: Nine[];
  teams: Team[];
  players: Player[];
  weeks: Week[];
}

export const DEFAULT_SETTINGS: Settings = {
  format: 'teamMatch',
  menMaxHc: 20,
  womenMaxHc: 24,
  minHc: 0,
  handicapWindow: 5,
  handicapBest: 3,
  esc: [
    { upToHc: 4, maxScore: null, overPar: 2 },
    { upToHc: 9, maxScore: 7 },
    { upToHc: 14, maxScore: 8 },
    { upToHc: 19, maxScore: 9 },
    { upToHc: null, maxScore: 10 },
  ],
  holeWinPoints: 2,
  holeTiePoints: 1,
  netBonusWin: 4,
  netBonusTie: 2,
  forfeitWinnerPoints: 18,
  forfeitLoserPoints: 4,
  hotshotBelow: 37,
  virtualOverPar: 3,
  inclementCountsForHandicap: false,
  averagesIncludeVirtual: true,
  absentRule: 'virtual',
  stableford: [0, 1, 2, 3, 4, 5],
  scramblePercents: [35, 15, 10, 5],
};
