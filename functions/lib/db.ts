import { DEFAULT_SETTINGS, normalizeSeason, type Match, type Player, type SeasonData, type Score, type Team, type Week } from '../../src/engine';

export interface SeasonSummary {
  id: number;
  name: string;
  isCurrent: boolean;
  updatedAt: string;
}

const bool = (v: unknown) => (v ? 1 : 0);

/** Store per-hole "did not play" flags as JSON, or null when the player played every hole. */
const dnfJson = (s: Score) => (!s.virtual && s.dnf?.some(Boolean) ? JSON.stringify(s.dnf.map(Boolean)) : null);

export async function listSeasons(db: D1Database, leagueId: number): Promise<SeasonSummary[]> {
  const { results } = await db
    .prepare('SELECT id, name, is_current, updated_at FROM seasons WHERE league_id = ? ORDER BY is_current DESC, id DESC')
    .bind(leagueId)
    .all<{ id: number; name: string; is_current: number; updated_at: string }>();
  return results.map((r) => ({ id: r.id, name: r.name, isCurrent: !!r.is_current, updatedAt: r.updated_at }));
}

export async function currentSeasonId(db: D1Database, leagueId: number): Promise<number | null> {
  const row = await db.prepare('SELECT id FROM seasons WHERE league_id = ? ORDER BY is_current DESC, id DESC LIMIT 1').bind(leagueId).first<{ id: number }>();
  return row?.id ?? null;
}

export async function loadSeason(db: D1Database, id: number): Promise<SeasonData | null> {
  const [season, teams, players, weeks, matches, scores] = await db.batch([
    db.prepare('SELECT * FROM seasons WHERE id = ?').bind(id),
    db.prepare('SELECT id, name FROM teams WHERE season_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT * FROM players WHERE season_id = ? ORDER BY team_id, id').bind(id),
    db.prepare('SELECT * FROM weeks WHERE season_id = ? ORDER BY number').bind(id),
    db.prepare('SELECT * FROM matches WHERE season_id = ? ORDER BY week, idx').bind(id),
    db.prepare('SELECT * FROM scores WHERE season_id = ?').bind(id),
  ]);
  const s = season.results[0] as Record<string, string | number> | undefined;
  if (!s) return null;

  const weekList: Week[] = (weeks.results as Record<string, never>[]).map((w) => ({
    number: w.number,
    date: w.date,
    nineId: w.nine_id,
    playoff: !!w.playoff,
    inclement: !!w.inclement,
    matches: [],
    scores: [],
  }));
  const byNum = new Map(weekList.map((w) => [w.number, w]));
  for (const m of matches.results as Record<string, never>[]) {
    byNum.get(m.week)?.matches.push({
      slot: m.slot ?? undefined,
      teeTime: m.tee_time ?? undefined,
      teamA: m.team_a,
      teamB: m.team_b,
      pointsOverride: m.override_a == null || m.override_b == null ? null : [m.override_a, m.override_b],
    });
  }
  for (const sc of scores.results as Record<string, never>[]) {
    byNum.get(sc.week)?.scores.push({
      playerId: sc.player_id,
      holes: sc.holes ? JSON.parse(sc.holes) : null,
      virtual: !!sc.virtual,
      dnf: sc.dnf ? JSON.parse(sc.dnf) : null,
      hc: sc.hc,
    });
  }

  return normalizeSeason({
    season: { id: s.id as number, name: s.name as string },
    settings: { ...DEFAULT_SETTINGS, ...JSON.parse(s.settings as string) },
    nines: JSON.parse(s.nines as string),
    teams: teams.results as unknown as Team[],
    players: (players.results as Record<string, never>[]).map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.team_id,
      startingHc: p.starting_hc,
      redTees: !!p.red_tees,
      active: !!p.active,
      email: p.email ?? null,
      phone: p.phone ?? null,
    })),
    weeks: weekList,
  });
}

export function rosterStatements(db: D1Database, seasonId: number, teams: Team[], players: Player[]) {
  return [
    db.prepare('DELETE FROM teams WHERE season_id = ?').bind(seasonId),
    db.prepare('DELETE FROM players WHERE season_id = ?').bind(seasonId),
    ...teams.map((t) => db.prepare('INSERT INTO teams (season_id, id, name) VALUES (?, ?, ?)').bind(seasonId, t.id, t.name)),
    ...players.map((p) =>
      db
        .prepare('INSERT INTO players (season_id, id, name, team_id, starting_hc, red_tees, active, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(seasonId, p.id, p.name, p.teamId ?? null, p.startingHc ?? 0, bool(p.redTees), bool(p.active !== false), p.email || null, p.phone || null),
    ),
  ];
}

export function weekStatements(db: D1Database, seasonId: number, w: Omit<Week, 'scores'>) {
  return [
    db
      .prepare(
        `INSERT INTO weeks (season_id, number, date, nine_id, playoff, inclement) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (season_id, number) DO UPDATE SET date = excluded.date, nine_id = excluded.nine_id,
           playoff = excluded.playoff, inclement = excluded.inclement`,
      )
      .bind(seasonId, w.number, w.date ?? null, w.nineId, bool(w.playoff), bool(w.inclement)),
    db.prepare('DELETE FROM matches WHERE season_id = ? AND week = ?').bind(seasonId, w.number),
    ...w.matches.map((m: Match, idx) =>
      db
        .prepare(
          'INSERT INTO matches (season_id, week, idx, slot, tee_time, team_a, team_b, override_a, override_b) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(seasonId, w.number, idx, m.slot ?? null, m.teeTime ?? null, m.teamA, m.teamB, m.pointsOverride?.[0] ?? null, m.pointsOverride?.[1] ?? null),
    ),
  ];
}

export function scoreStatements(db: D1Database, seasonId: number, week: number, scores: Score[]) {
  return [
    db.prepare('DELETE FROM scores WHERE season_id = ? AND week = ?').bind(seasonId, week),
    ...scores
      .filter((s) => s.virtual || s.holes?.some((h) => h > 0) || s.dnf?.some(Boolean))
      .map((s) =>
        db
          .prepare('INSERT INTO scores (season_id, week, player_id, holes, virtual, dnf, hc) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(seasonId, week, s.playerId, s.virtual ? null : JSON.stringify(s.holes), bool(s.virtual), dnfJson(s), s.hc ?? null),
      ),
  ];
}

/** The same score for one player, leaving any handicap override in place (player-entered cards). */
export function upsertScoreStatement(db: D1Database, seasonId: number, week: number, s: Score) {
  return db
    .prepare(
      `INSERT INTO scores (season_id, week, player_id, holes, virtual, dnf) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (season_id, week, player_id) DO UPDATE SET holes = excluded.holes, virtual = excluded.virtual,
         dnf = excluded.dnf, updated_at = datetime('now')`,
    )
    .bind(seasonId, week, s.playerId, s.virtual ? null : JSON.stringify(s.holes), bool(s.virtual), dnfJson(s));
}

/** Tables holding per-season rows, deleted along with a season. */
export const SEASON_TABLES = ['submissions', 'player_accounts', 'scores', 'matches', 'weeks', 'players', 'teams'];

/** Create a season from a full SeasonData document (import / new season). Returns the new id. */
export async function insertSeason(db: D1Database, leagueId: number, data: SeasonData, makeCurrent: boolean): Promise<number> {
  const row = await db
    .prepare('INSERT INTO seasons (league_id, name, settings, nines, is_current) VALUES (?, ?, ?, ?, 0) RETURNING id')
    .bind(leagueId, data.season.name, JSON.stringify(data.settings), JSON.stringify(data.nines))
    .first<{ id: number }>();
  const id = row!.id;
  const stmts = [
    ...rosterStatements(db, id, data.teams, data.players),
    ...data.weeks.flatMap((w) => [...weekStatements(db, id, w), ...scoreStatements(db, id, w.number, w.scores)]),
  ];
  if (makeCurrent) stmts.push(...currentStatements(db, id));
  try {
    for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500));
  } catch (e) {
    await db.prepare('DELETE FROM seasons WHERE id = ?').bind(id).run();
    throw e;
  }
  return id;
}

export function currentStatements(db: D1Database, id: number) {
  return [
    // One current season per league.
    db.prepare('UPDATE seasons SET is_current = 0 WHERE is_current = 1 AND id != ?1 AND league_id = (SELECT league_id FROM seasons WHERE id = ?1)').bind(id),
    db.prepare('UPDATE seasons SET is_current = 1 WHERE id = ?').bind(id),
  ];
}

export function touch(db: D1Database, seasonId: number, action: string, detail?: unknown) {
  return [
    db.prepare("UPDATE seasons SET updated_at = datetime('now') WHERE id = ?").bind(seasonId),
    db
      .prepare('INSERT INTO audit_log (season_id, league_id, action, detail) VALUES (?1, (SELECT league_id FROM seasons WHERE id = ?1), ?2, ?3)')
      .bind(seasonId, action, detail === undefined ? null : JSON.stringify(detail)),
  ];
}
