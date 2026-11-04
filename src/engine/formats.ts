import type { Format, Player, Settings, Team } from './types';

export interface FormatInfo {
  id: Format;
  name: string;
  /** One line for menus. */
  summary: string;
  /** Every player is their own side: no teams to set up. */
  individual: boolean;
  /** Everyone plays the field each week (a leaderboard) instead of head-to-head matches. */
  field: boolean;
  /** Each team turns in one card (scramble) instead of one per player. */
  teamCard: boolean;
}

export const FORMATS: FormatInfo[] = [
  {
    id: 'teamMatch',
    name: 'Team match play',
    summary: 'Teams of two play another team each week. Both partners’ net scores add up on every hole; points per hole won plus a bonus for the lower team net.',
    individual: false,
    field: false,
    teamCard: false,
  },
  {
    id: 'bestBall',
    name: 'Best ball match play',
    summary: 'Teams play another team each week. The better net score of the partners counts on each hole; points per hole won plus a bonus for the lower best-ball total.',
    individual: false,
    field: false,
    teamCard: false,
  },
  {
    id: 'individualMatch',
    name: 'Individual match play',
    summary: 'Each player plays another player each week, with handicap strokes; points per hole won plus a bonus for the lower net total.',
    individual: true,
    field: false,
    teamCard: false,
  },
  {
    id: 'stroke',
    name: 'Stroke play (net)',
    summary: 'Everyone plays the field each week. Lowest net score wins the week; standings points by where you finish.',
    individual: true,
    field: true,
    teamCard: false,
  },
  {
    id: 'stableford',
    name: 'Stableford (net)',
    summary: 'Everyone plays the field. Points on every hole for your net score (par 2, birdie 3, bogey 1…); most points wins, and points add up for the season.',
    individual: true,
    field: true,
    teamCard: false,
  },
  {
    id: 'scramble',
    name: 'Scramble',
    summary: 'Teams play one ball and turn in one card, with a team handicap from the players’ handicaps. Lowest team net wins the week; standings points by finish.',
    individual: false,
    field: true,
    teamCard: true,
  },
];

export const formatInfo = (s: Pick<Settings, 'format'>): FormatInfo => FORMATS.find((f) => f.id === s.format) ?? FORMATS[0];
export const isFormat = (v: unknown): v is Format => FORMATS.some((f) => f.id === v);

/** Labels for Stableford points by net score: [double bogey or worse, bogey, par, birdie, eagle, albatross or better]. */
export const STABLEFORD_LABELS = ['Double bogey or worse', 'Bogey', 'Par', 'Birdie', 'Eagle', 'Albatross or better'];

/** Stableford points for a net score on a hole. */
export function stablefordPoints(net: number, par: number, table: number[]): number {
  const i = Math.min(table.length - 1, Math.max(0, par - net + 2));
  return table[i] ?? 0;
}

/** Scramble team handicap: each player's handicap times a percentage, lowest handicap first, rounded. */
export function scrambleHandicap(hcs: number[], percents: number[]): number {
  const sorted = [...hcs].sort((a, b) => a - b);
  return Math.round(sorted.reduce((t, hc, i) => t + (hc * (percents[i] ?? 0)) / 100, 0));
}

/** A scramble team's card is stored under this id (negative, so it never clashes with a player). */
export const teamCardId = (teamId: number) => -teamId;
export const isTeamCardId = (id: number) => id < 0;

/** Individual formats: every player is their own one-player "team", named after them. */
export function individualTeams(players: Player[]): { teams: Team[]; players: Player[] } {
  return {
    teams: players.map((p) => ({ id: p.id, name: p.name })),
    players: players.map((p) => ({ ...p, teamId: p.id })),
  };
}
