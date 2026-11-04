import { formatInfo, isTeamCardId, scrambleHandicap, teamCardId } from './formats';
import { maxHcFor, playerCard, scoreMatch, sum, type MatchResult, type Outcome, type PlayerCard } from './scoring';
import type { Nine, Player, SeasonData, Settings, Team, Week } from './types';

/** One side's week in a field format (stroke play, Stableford, scramble). */
export interface FieldEntry {
  teamId: number;
  /** Player id, or the team-card id for a scramble. */
  entrantId: number;
  card: PlayerCard | null;
  /** Net total (stroke play, scramble) or Stableford points. */
  value: number | null;
  /** Finishing place among those with a score (ties share it). */
  rank: number | null;
  /** Standings points earned: by finishing place, or Stableford points. */
  points: number;
}

export interface WeekResult {
  week: Week;
  nine: Nine;
  matches: MatchResult[];
  /** Field formats: everyone's result this week, best first. Null for match formats. */
  field: FieldEntry[] | null;
  /** Keyed by player id (or team-card id for a scramble). */
  cards: Map<number, PlayerCard>;
  /** Every match has all scores entered (or was forfeited). */
  complete: boolean;
  /** At least one score has been entered. */
  started: boolean;
}

export interface HandicapHistory {
  playerId: number;
  /** Playing handicap used in each week, keyed by week number. */
  playing: Map<number, number>;
  /** Handicap after each week's scores were posted, keyed by week number. */
  after: Map<number, number>;
  /** Differentials that count toward the handicap, oldest first. */
  differentials: { week: number; value: number }[];
  /** The scores (as differentials) currently making up the handicap, and which of them are the best ones. */
  window: { week: number | null; value: number; used: boolean }[];
  current: number;
}

export interface StandingRow {
  rank: number;
  team: Team;
  players: Player[];
  w: number;
  l: number;
  t: number;
  standingPoints: number;
  totalPoints: number;
  avgPoints: number;
  streak: string;
  weekly: Map<number, number>;
  /** Weeks with a score (field formats). */
  rounds: number;
  /** Field formats: average net (stroke play, scramble) or average Stableford points per round. */
  avgValue: number | null;
}

export interface HotshotRow {
  player: Player;
  byWeek: Map<number, number>;
  count: number;
}

export interface Record {
  value: number;
  entries: { player: Player; week: number }[];
}

export interface HoleAverages {
  nine: Nine;
  rounds: number;
  avg: number[];
  total: number;
}

export interface SeasonResult {
  data: SeasonData;
  weeks: WeekResult[];
  handicaps: Map<number, HandicapHistory>;
  standings: StandingRow[];
  hotshots: HotshotRow[];
  lowGross: Record | null;
  lowNet: Record | null;
  netDistribution: Map<number, number>;
  /** Per player, per nine. */
  playerAverages: Map<number, HoleAverages[]>;
  leagueAverages: HoleAverages[];
  /** The next week without complete results. */
  currentWeek: number | null;
  /** The most recent week with any scores. */
  latestWeek: number | null;
}

/** Handicap from a list of differentials (starting HC first). */
export function handicapFrom(
  values: { week: number | null; value: number }[],
  startingHc: number,
  maxHc: number,
  settings: Settings,
): { hc: number; window: HandicapHistory['window'] } {
  if (values.length < settings.handicapWindow) {
    return { hc: startingHc, window: values.map((v) => ({ ...v, used: false })) };
  }
  const recent = values.slice(-settings.handicapWindow);
  const floored = recent.map((v, i) => ({ i, value: Math.max(settings.minHc, v.value) }));
  const best = [...floored].sort((a, b) => a.value - b.value || b.i - a.i).slice(0, settings.handicapBest);
  const avg = sum(best.map((b) => b.value)) / best.length;
  const used = new Set(best.map((b) => b.i));
  return {
    hc: clamp(Math.round(avg), settings.minHc, maxHc),
    window: recent.map((v, i) => ({ ...v, used: used.has(i) })),
  };
}

export function computeSeason(data: SeasonData): SeasonResult {
  const { settings } = data;
  const format = formatInfo(settings);
  const playersById = new Map(data.players.map((p) => [p.id, p]));
  // Scramble: each team's card belongs to a stand-in "player" for the team.
  const teamCards = new Map(
    format.teamCard ? data.teams.map((t) => [teamCardId(t.id), { id: teamCardId(t.id), name: t.name, teamId: t.id, startingHc: 0, redTees: false } as Player]) : [],
  );
  const teamsById = new Map(data.teams.map((t) => [t.id, t]));
  const ninesById = new Map(data.nines.map((n) => [n.id, n]));
  const weeks = [...data.weeks].sort((a, b) => a.number - b.number);

  const handicaps = new Map<number, HandicapHistory>();
  const values = new Map<number, { week: number | null; value: number }[]>();
  for (const p of data.players) {
    handicaps.set(p.id, {
      playerId: p.id,
      playing: new Map(),
      after: new Map(),
      differentials: [],
      window: [{ week: null, value: p.startingHc, used: false }],
      current: p.startingHc,
    });
    values.set(p.id, [{ week: null, value: p.startingHc }]);
  }

  const rosterOf = (teamId: number) => data.players.filter((p) => p.teamId === teamId);

  const weekResults: WeekResult[] = weeks.map((week) => {
    const nine = ninesById.get(week.nineId) ?? data.nines[0];
    const cards = new Map<number, PlayerCard>();
    for (const s of week.scores) {
      const player = playersById.get(s.playerId) ?? teamCards.get(s.playerId);
      if (!player || (!s.virtual && !s.holes?.some((h) => h > 0))) continue;
      const hc = s.hc ?? (isTeamCardId(player.id) ? teamHandicap(player.teamId!) : handicaps.get(player.id)!.current);
      const card = playerCard(player, hc, nine, s.holes, !!s.virtual, settings, s.dnf);
      // Team cards aren't anyone's own round: no handicap differential or hotshot.
      cards.set(player.id, isTeamCardId(player.id) ? { ...card, hotshot: false } : card);
    }
    for (const p of data.players) {
      const h = handicaps.get(p.id)!;
      h.playing.set(week.number, cards.get(p.id)?.hc ?? h.current);
    }

    const matches = (format.field ? [] : week.matches)
      .filter((m) => teamsById.has(m.teamA) && teamsById.has(m.teamB))
      .map((m) => {
        const side = (teamId: number) => {
          const roster = rosterOf(teamId).filter((p) => p.active !== false || cards.has(p.id));
          return { teamId, playerIds: roster.map((p) => p.id), cards: roster.map((p) => cards.get(p.id) ?? null) };
        };
        const sideA = side(m.teamA);
        const sideB = side(m.teamB);
        const present = (sd: { cards: (PlayerCard | null)[] }) => sd.cards.filter((c) => c && !c.virtual).length;
        // A whole team marked absent (every player virtual, nobody present) forfeits automatically,
        // unless an admin already set a forfeit by hand.
        const forfeits = (sd: { cards: (PlayerCard | null)[] }) => present(sd) === 0 && sd.cards.some((c) => c?.virtual);
        let eff = m;
        if (!m.pointsOverride && (forfeits(sideA) || forfeits(sideB))) {
          const { forfeitWinnerPoints: win, forfeitLoserPoints: lose } = settings;
          const [a, b] = [forfeits(sideA), forfeits(sideB)];
          eff = { ...m, pointsOverride: a && b ? [lose, lose] : a ? [lose, win] : [win, lose] };
        }
        // 2 vs 1: only when the best-ball absent rule is on, a player missed some or all holes, and
        // each side still has a player who teed off.
        const twoVsOne =
          settings.absentRule === 'bestBall' &&
          [...sideA.cards, ...sideB.cards].some((c) => c?.incomplete) &&
          present(sideA) > 0 &&
          present(sideB) > 0;
        return scoreMatch(eff, [sideA, sideB], settings, settings.format === 'bestBall' || twoVsOne, twoVsOne);
      });
    const field = format.field ? fieldResults(data, cards, settings) : null;

    // Post this week's scores to handicaps. A forfeit isn't a real round, so neither side's scores
    // (including any the winning team posted) count toward handicaps.
    const counts = !week.inclement || settings.inclementCountsForHandicap;
    const forfeited = new Set(matches.filter((mr) => mr.status === 'forfeit').flatMap((mr) => mr.sides.flatMap((s) => s.playerIds)));
    for (const p of data.players) {
      const h = handicaps.get(p.id)!;
      const card = cards.get(p.id);
      if (card && !card.incomplete && counts && !forfeited.has(p.id)) {
        h.differentials.push({ week: week.number, value: card.differential });
        values.get(p.id)!.push({ week: week.number, value: card.differential });
        const r = handicapFrom(values.get(p.id)!, p.startingHc, maxHcFor(p, settings), settings);
        h.current = r.hc;
        h.window = r.window;
      }
      h.after.set(week.number, h.current);
    }

    return {
      week,
      nine,
      matches,
      field,
      cards,
      complete: field
        ? field.length > 0 && field.every((e) => e.card || !isActive(data, e))
        : matches.length > 0 && matches.every((m) => m.status !== 'pending'),
      started: cards.size > 0 || matches.some((m) => m.status === 'forfeit'),
    };
  });

  /** Scramble team handicap from the players' handicaps going into the week. */
  function teamHandicap(teamId: number): number {
    const hcs = rosterOf(teamId).filter((p) => p.active !== false).map((p) => handicaps.get(p.id)!.current);
    return scrambleHandicap(hcs, settings.scramblePercents);
  }

  // Players' own rounds only (not scramble team cards).
  const allCards = weekResults.flatMap((w) =>
    [...w.cards.values()].filter((c) => !isTeamCardId(c.playerId)).map((c) => ({ week: w.week.number, nine: w.nine, card: c })),
  );
  // Records and the net distribution use only fully-played rounds.
  const playedCards = allCards.filter((c) => !c.card.incomplete);
  // Averages may include whole-round virtual scores (the sheet did), but never partial DNF rounds,
  // whose virtual-fill holes would skew the per-hole averages.
  const averaged = settings.averagesIncludeVirtual ? allCards.filter((c) => c.card.virtual || !c.card.incomplete) : playedCards;

  return {
    data,
    weeks: weekResults,
    handicaps,
    standings: format.field ? fieldStandings(data, weekResults) : computeStandings(data, weekResults),
    hotshots: computeHotshots(data, weekResults),
    lowGross: record(playedCards, (c) => c.grossTotal, playersById),
    lowNet: record(playedCards, (c) => c.netTotal, playersById),
    netDistribution: countBy(playedCards.map((c) => c.card.netTotal)),
    playerAverages: new Map(
      data.players.map((p) => [p.id, averagesByNine(averaged.filter((c) => c.card.playerId === p.id), data.nines)]),
    ),
    leagueAverages: averagesByNine(averaged, data.nines),
    currentWeek: weekResults.find((w) => !w.complete)?.week.number ?? null,
    latestWeek: [...weekResults].reverse().find((w) => w.started)?.week.number ?? null,
  };
}

function computeStandings(data: SeasonData, weeks: WeekResult[]): StandingRow[] {
  const rows = new Map<number, StandingRow & { results: Outcome[] }>();
  for (const team of data.teams) {
    rows.set(team.id, {
      rank: 0,
      team,
      players: data.players.filter((p) => p.teamId === team.id && p.active !== false),
      w: 0,
      l: 0,
      t: 0,
      standingPoints: 0,
      totalPoints: 0,
      avgPoints: 0,
      streak: '',
      weekly: new Map(),
      rounds: 0,
      avgValue: null,
      results: [],
    });
  }
  for (const w of weeks) {
    if (w.week.playoff) continue;
    for (const m of w.matches) {
      if (m.status === 'pending') continue;
      for (const side of m.sides) {
        const row = rows.get(side.teamId);
        if (!row) continue;
        row[side.outcome === 'W' ? 'w' : side.outcome === 'L' ? 'l' : 't']++;
        row.totalPoints += side.total;
        row.weekly.set(w.week.number, (row.weekly.get(w.week.number) ?? 0) + side.total);
        row.results.push(side.outcome);
      }
    }
  }
  const list = [...rows.values()].map(({ results, ...row }) => {
    const played = row.w + row.l + row.t;
    const last = results[results.length - 1];
    let n = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
    return {
      ...row,
      standingPoints: row.w * 2 + row.t,
      avgPoints: played ? row.totalPoints / played : 0,
      streak: last ? `${last}${n}` : '',
    };
  });
  list.sort((a, b) => b.standingPoints - a.standingPoints || b.totalPoints - a.totalPoints || a.team.id - b.team.id);
  list.forEach((r, i) => (r.rank = i + 1));
  return list;
}

/** Who plays the field this week: every player (individual formats) or every team (scramble). */
function fieldEntrants(data: SeasonData): { teamId: number; entrantId: number }[] {
  if (formatInfo(data.settings).teamCard) return data.teams.map((t) => ({ teamId: t.id, entrantId: teamCardId(t.id) }));
  return data.players.map((p) => ({ teamId: p.teamId ?? p.id, entrantId: p.id }));
}

function isActive(data: SeasonData, e: FieldEntry): boolean {
  if (isTeamCardId(e.entrantId)) return data.players.some((p) => p.teamId === e.teamId && p.active !== false);
  return data.players.find((p) => p.id === e.entrantId)?.active !== false;
}

/**
 * A field week: rank everyone with a score. Stableford: most points first, and the points are what
 * count. Otherwise lowest net first, and finishing places earn points: last place 1, one more for
 * each place higher; tied players share the points of the places they cover.
 */
function fieldResults(data: SeasonData, cards: Map<number, PlayerCard>, settings: Settings): FieldEntry[] {
  const stableford = settings.format === 'stableford';
  const entries: FieldEntry[] = fieldEntrants(data)
    .map(({ teamId, entrantId }) => {
      const card = cards.get(entrantId) ?? null;
      return { teamId, entrantId, card, value: card ? (stableford ? card.stablefordTotal : card.netTotal) : null, rank: null, points: 0 };
    })
    .filter((e) => e.card || isActive(data, e));
  const scored = entries.filter((e) => e.value != null).sort((a, b) => (stableford ? b.value! - a.value! : a.value! - b.value!));
  const n = scored.length;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && scored[j].value === scored[i].value) j++;
    // Places i+1..j share their points.
    const shared = sum(Array.from({ length: j - i }, (_, k) => n - (i + k))) / (j - i);
    for (let k = i; k < j; k++) {
      scored[k].rank = i + 1;
      scored[k].points = stableford ? scored[k].value! : shared;
    }
    i = j;
  }
  return [...scored, ...entries.filter((e) => e.value == null)];
}

/** Field formats: season totals of the weekly points; ties broken by the better average. */
function fieldStandings(data: SeasonData, weeks: WeekResult[]): StandingRow[] {
  const stableford = data.settings.format === 'stableford';
  const values = new Map<number, number[]>();
  const rows = new Map<number, StandingRow>();
  for (const team of data.teams) {
    rows.set(team.id, {
      rank: 0,
      team,
      players: data.players.filter((p) => p.teamId === team.id && p.active !== false),
      w: 0,
      l: 0,
      t: 0,
      standingPoints: 0,
      totalPoints: 0,
      avgPoints: 0,
      streak: '',
      weekly: new Map(),
      rounds: 0,
      avgValue: null,
    });
    values.set(team.id, []);
  }
  for (const w of weeks) {
    if (w.week.playoff || !w.field) continue;
    for (const e of w.field) {
      const row = rows.get(e.teamId);
      if (!row || e.value == null) continue;
      row.rounds++;
      if (e.rank === 1) row.w++;
      row.totalPoints += e.points;
      row.weekly.set(w.week.number, round1(e.points));
      values.get(e.teamId)!.push(e.value);
    }
  }
  const list = [...rows.values()].map((row) => {
    const v = values.get(row.team.id)!;
    const total = round1(row.totalPoints);
    return { ...row, standingPoints: total, totalPoints: total, avgPoints: row.rounds ? row.totalPoints / row.rounds : 0, avgValue: v.length ? sum(v) / v.length : null };
  });
  const better = (a: number | null, b: number | null) => (a == null ? 1 : b == null ? -1 : stableford ? b - a : a - b);
  list.sort((a, b) => b.standingPoints - a.standingPoints || better(a.avgValue, b.avgValue) || a.team.id - b.team.id);
  list.forEach((r, i) => (r.rank = i + 1));
  return list;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function computeHotshots(data: SeasonData, weeks: WeekResult[]): HotshotRow[] {
  const rows = data.players.map((player) => {
    const byWeek = new Map<number, number>();
    for (const w of weeks) {
      const c = w.cards.get(player.id);
      if (c?.hotshot) byWeek.set(w.week.number, c.netTotal);
    }
    return { player, byWeek, count: byWeek.size };
  });
  return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count || a.player.name.localeCompare(b.player.name));
}

function record(
  cards: { week: number; card: PlayerCard }[],
  value: (c: PlayerCard) => number,
  players: Map<number, Player>,
): Record | null {
  if (!cards.length) return null;
  const best = Math.min(...cards.map((c) => value(c.card)));
  return {
    value: best,
    entries: cards.filter((c) => value(c.card) === best).map((c) => ({ player: players.get(c.card.playerId)!, week: c.week })),
  };
}

function averagesByNine(cards: { nine: Nine; card: PlayerCard }[], nines: Nine[]): HoleAverages[] {
  return nines
    .map((nine) => {
      const mine = cards.filter((c) => c.nine.id === nine.id);
      const avg = nine.par.map((_, h) => (mine.length ? sum(mine.map((c) => c.card.gross[h])) / mine.length : 0));
      return { nine, rounds: mine.length, avg, total: sum(avg) };
    })
    .filter((a) => a.rounds > 0);
}

function countBy(xs: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of [...xs].sort((a, b) => a - b)) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

/** How often each pair of teams meets, and how often each team gets each tee-time slot (the sheet's Distribution tab). */
export function scheduleBalance(data: SeasonData, includePlayoffs = false) {
  const opponents = new Map<string, number>();
  const slots = new Map<number, Map<string, number>>();
  for (const w of data.weeks) {
    if (w.playoff && !includePlayoffs) continue;
    for (const m of w.matches) {
      const key = [m.teamA, m.teamB].sort((a, b) => a - b).join('-');
      opponents.set(key, (opponents.get(key) ?? 0) + 1);
      for (const t of [m.teamA, m.teamB]) {
        if (!m.slot) continue;
        const s = slots.get(t) ?? new Map<string, number>();
        s.set(m.slot, (s.get(m.slot) ?? 0) + 1);
        slots.set(t, s);
      }
    }
  }
  return {
    timesMet: (a: number, b: number) => opponents.get([a, b].sort((x, y) => x - y).join('-')) ?? 0,
    slotCount: (team: number, slot: string) => slots.get(team)?.get(slot) ?? 0,
  };
}
