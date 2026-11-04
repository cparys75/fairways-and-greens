import type { Match, SeasonData, Week } from './types';

/** One player's line on a player-entered match card. */
export interface CardEntry {
  playerId: number;
  /** Nine gross hole scores, or null when the player was absent. */
  holes: number[] | null;
  absent: boolean;
  /** Holes the player did not play (left early / arrived late): one flag per hole, true = not played. */
  dnf?: boolean[] | null;
}

/** A match card entered by a signed-in player. */
export interface Submission {
  userId: number;
  playerId: number;
  /** Team of the player who submitted it. */
  teamId: number;
  cards: CardEntry[];
  updatedAt?: string;
}

export type ConsensusStatus = 'none' | 'waiting' | 'mismatch' | 'agreed';

export interface Consensus {
  status: ConsensusStatus;
  /** The agreed card, when status is 'agreed'. */
  cards: CardEntry[] | null;
  /** Teams that haven't submitted yet. */
  missingTeams: number[];
  /** Where submissions disagree: hole index (0-8), or 'absent'. */
  differences: { playerId: number; hole: number | 'absent' }[];
}

/** Players on each side of a match: the team's active players plus anyone who already has a score. */
export function matchPlayerIds(data: SeasonData, week: Week, match: Pick<Match, 'teamA' | 'teamB'>): [number[], number[]] {
  const scored = new Set(week.scores.map((s) => s.playerId));
  const side = (teamId: number) => data.players.filter((p) => p.teamId === teamId && (p.active !== false || scored.has(p.id))).map((p) => p.id);
  return [side(match.teamA), side(match.teamB)];
}

/**
 * Sort by player, drop everything for absent players, and zero out the score on any hole the player
 * didn't play, so two cards that say the same thing compare equal.
 */
export function normalizeCards(cards: CardEntry[]): CardEntry[] {
  return [...cards]
    .sort((a, b) => a.playerId - b.playerId)
    .map((c) => {
      if (c.absent) return { playerId: c.playerId, absent: true, holes: null, dnf: null };
      const dnf = Array.from({ length: 9 }, (_, i) => !!c.dnf?.[i]);
      const holes = Array.from({ length: 9 }, (_, i) => (dnf[i] ? 0 : (c.holes?.[i] ?? 0)));
      return { playerId: c.playerId, absent: false, holes, dnf };
    });
}

export function sameCards(a: CardEntry[], b: CardEntry[]): boolean {
  return JSON.stringify(normalizeCards(a)) === JSON.stringify(normalizeCards(b));
}

/**
 * A match is agreed when at least one player from each team has submitted and every submission is
 * exactly the same. Any disagreement makes it a mismatch until someone corrects their card.
 */
export function consensus(submissions: Submission[], teamA: number, teamB: number): Consensus {
  const missingTeams = [teamA, teamB].filter((t) => !submissions.some((s) => s.teamId === t));
  if (!submissions.length) return { status: 'none', cards: null, missingTeams, differences: [] };

  const cards = submissions.map((s) => normalizeCards(s.cards));
  const differences = diff(cards);
  if (differences.length) return { status: 'mismatch', cards: null, missingTeams, differences };
  if (missingTeams.length) return { status: 'waiting', cards: null, missingTeams, differences };
  return { status: 'agreed', cards: cards[0], missingTeams, differences };
}

function diff(cards: CardEntry[][]): Consensus['differences'] {
  const out: Consensus['differences'] = [];
  const players = [...new Set(cards.flat().map((c) => c.playerId))].sort((a, b) => a - b);
  for (const playerId of players) {
    const lines = cards.map((cs) => cs.find((c) => c.playerId === playerId));
    if (lines.some((l) => !l) || new Set(lines.map((l) => l!.absent)).size > 1) {
      out.push({ playerId, hole: 'absent' });
      continue;
    }
    if (lines[0]!.absent) continue;
    // A hole differs if the cards disagree on the score, or on whether the player played it at all.
    for (let h = 0; h < 9; h++) {
      if (new Set(lines.map((l) => (l!.dnf?.[h] ? 'x' : l!.holes?.[h]))).size > 1) out.push({ playerId, hole: h });
    }
  }
  return out;
}
