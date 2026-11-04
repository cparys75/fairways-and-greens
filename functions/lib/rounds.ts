/**
 * Personal rounds. The owner's scores live on the round itself (player 0); friends they keep score
 * for are round_players 1, 2, …. A registered friend sees the round in their own My rounds; a guest
 * gets a link that opens just this round.
 */
import type { GameSetup, RoundStats } from '../../src/engine';
import { newToken, sha256 } from './passwords';

export interface RoundPlayer {
  idx: number;
  name: string;
  /** A registered player: the round shows up in their My rounds. */
  userId: number | null;
  handicap: number | null;
  /** Gross score per hole, 0 = not played yet. */
  holes: number[];
  /** A guest link has been made for this player. */
  hasLink?: boolean;
}

export interface Round {
  id?: number;
  playedOn: string;
  courseId: string | null;
  courseName: string;
  tee: string | null;
  firstHole: number;
  par: number[];
  /** The owner's scores (player 0). */
  holes: number[];
  notes: string | null;
  /** Per-hole yardage and handicap (stroke index), when the course data has them. */
  yardage: number[] | null;
  hcp: number[] | null;
  /** Fairways, greens in regulation and putts, when the owner tracked them. */
  stats: RoundStats | null;
  /** The owner's handicap for this round's game. */
  handicap: number | null;
  game: GameSetup | null;
  /** Still being played: scores may be missing (0). */
  live: boolean;
  /** Everyone else in the group. */
  players: RoundPlayer[];
  /** Filled in when reading: who started the round, and which player the reader is (0 = the owner). */
  ownerId?: number;
  ownerName?: string | null;
  me?: number;
}

const json = (v: string | null) => (v ? JSON.parse(v) : null);
const ownerName = "COALESCE(u.name, substr(u.email, 1, instr(u.email, '@') - 1))";

function toRound(r: Record<string, never>, players: RoundPlayer[], me: number): Round {
  const mine = me === 0;
  return {
    id: r.id,
    playedOn: r.played_on,
    courseId: r.course_id,
    courseName: r.course_name,
    tee: r.tee,
    firstHole: r.first_hole,
    par: JSON.parse(r.par),
    holes: JSON.parse(r.holes),
    // Notes and stats are the owner's own.
    notes: mine ? r.notes : null,
    yardage: json(r.yardage),
    hcp: json(r.hcp),
    stats: mine ? json(r.stats) : null,
    handicap: r.handicap,
    game: json(r.game),
    live: !!r.live,
    players,
    ownerId: r.user_id,
    ownerName: r.owner_name,
    me,
  };
}

async function playersOf(db: D1Database, ids: number[]): Promise<Map<number, RoundPlayer[]>> {
  const out = new Map<number, RoundPlayer[]>();
  if (!ids.length) return out;
  const { results } = await db
    .prepare(`SELECT * FROM round_players WHERE round_id IN (${ids.map(() => '?').join(',')}) ORDER BY round_id, idx`)
    .bind(...ids)
    .all<Record<string, never>>();
  for (const p of results) {
    out.set(p.round_id, [
      ...(out.get(p.round_id) ?? []),
      { idx: p.idx, name: p.name, userId: p.user_id, handicap: p.handicap, holes: JSON.parse(p.holes), hasLink: !!p.guest_hash },
    ]);
  }
  return out;
}

/** Your rounds and the rounds others started with you in them, newest first. */
export async function listRounds(db: D1Database, userId: number): Promise<Round[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, ${ownerName} AS owner_name, COALESCE((SELECT idx FROM round_players WHERE round_id = r.id AND user_id = ?1), 0) AS me
       FROM rounds r JOIN users u ON u.id = r.user_id
       WHERE r.user_id = ?1 OR r.id IN (SELECT round_id FROM round_players WHERE user_id = ?1)
       ORDER BY r.played_on DESC, r.id DESC`,
    )
    .bind(userId)
    .all<Record<string, never>>();
  const players = await playersOf(db, results.map((r) => r.id));
  return results.map((r) => toRound(r, players.get(r.id) ?? [], r.user_id === userId ? 0 : r.me));
}

/** One round, if `userId` started it or is in it (null: not yours). */
export async function getRound(db: D1Database, id: number, userId: number): Promise<Round | null> {
  const r = await db
    .prepare(`SELECT r.*, ${ownerName} AS owner_name FROM rounds r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(id)
    .first<Record<string, never>>();
  if (!r) return null;
  const players = (await playersOf(db, [id])).get(id) ?? [];
  const me = r.user_id === userId ? 0 : players.find((p) => p.userId === userId)?.idx;
  return me == null ? null : toRound(r, players, me);
}

/** The round a guest link opens, and which player the guest is. */
export async function guestRound(db: D1Database, token: string): Promise<Round | null> {
  const p = await db
    .prepare("SELECT round_id, idx FROM round_players WHERE guest_hash = ? AND guest_expires > datetime('now')")
    .bind(await sha256(token))
    .first<{ round_id: number; idx: number }>();
  if (!p) return null;
  const r = await db
    .prepare(`SELECT r.*, ${ownerName} AS owner_name FROM rounds r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(p.round_id)
    .first<Record<string, never>>();
  return r ? toRound(r, (await playersOf(db, [p.round_id])).get(p.round_id) ?? [], p.idx) : null;
}

const GUEST_DAYS = 3;

/** A link that lets a guest (no account) see this round and enter scores, for a few days. A new link replaces the old one. */
export async function guestLink(db: D1Database, roundId: number, idx: number): Promise<string> {
  const { token, hash } = await newToken();
  const res = await db
    .prepare(`UPDATE round_players SET guest_hash = ?, guest_expires = datetime('now', '+${GUEST_DAYS} days') WHERE round_id = ? AND idx = ?`)
    .bind(hash, roundId, idx)
    .run();
  if (!res.meta.changes) throw new Error('not found');
  return token;
}

/** Save the whole round (the owner). Other players keep their guest links. */
export async function saveRound(db: D1Database, userId: number, r: Round): Promise<number> {
  const values = [
    r.playedOn,
    r.courseId,
    r.courseName,
    r.tee,
    r.firstHole,
    JSON.stringify(r.par),
    JSON.stringify(r.holes),
    r.notes,
    r.yardage ? JSON.stringify(r.yardage) : null,
    r.hcp ? JSON.stringify(r.hcp) : null,
    r.stats ? JSON.stringify(r.stats) : null,
    r.handicap,
    r.game ? JSON.stringify(r.game) : null,
    r.live ? 1 : 0,
  ];
  let id = r.id;
  if (id) {
    const res = await db
      .prepare(
        `UPDATE rounds SET played_on = ?, course_id = ?, course_name = ?, tee = ?, first_hole = ?, par = ?, holes = ?, notes = ?,
           yardage = ?, hcp = ?, stats = ?, handicap = ?, game = ?, live = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      )
      .bind(...values, id, userId)
      .run();
    if (!res.meta.changes) throw new Error('Round not found');
  } else {
    const row = await db
      .prepare(
        `INSERT INTO rounds (played_on, course_id, course_name, tee, first_hole, par, holes, notes, yardage, hcp, stats, handicap, game, live, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(...values, userId)
      .first<{ id: number }>();
    id = row!.id;
  }
  await db.batch([
    db.prepare(`DELETE FROM round_players WHERE round_id = ? AND idx NOT IN (${r.players.map(() => '?').join(',') || 'NULL'})`).bind(id, ...r.players.map((p) => p.idx)),
    ...r.players.map((p) =>
      db
        .prepare(
          `INSERT INTO round_players (round_id, idx, name, user_id, handicap, holes) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (round_id, idx) DO UPDATE SET name = excluded.name, user_id = excluded.user_id, handicap = excluded.handicap, holes = excluded.holes`,
        )
        .bind(id, p.idx, p.name, p.userId, p.handicap, JSON.stringify(p.holes)),
    ),
  ]);
  return id;
}

/** One score, from anyone in the round. Only that hole changes, so people scoring at once don't overwrite each other. */
export async function setScore(db: D1Database, roundId: number, idx: number, hole: number, score: number) {
  const path = `$[${hole}]`;
  const res =
    idx === 0
      ? await db.prepare('UPDATE rounds SET holes = json_set(holes, ?, ?), updated_at = datetime(\'now\') WHERE id = ?').bind(path, score, roundId).run()
      : await db.prepare('UPDATE round_players SET holes = json_set(holes, ?, ?) WHERE round_id = ? AND idx = ?').bind(path, score, roundId, idx).run();
  if (!res.meta.changes) throw new Error('not found');
}

/** The wolf's choice on a hole: a partner's player number, 'lone', or null. */
export async function setWolf(db: D1Database, roundId: number, hole: number, choice: number | 'lone' | null) {
  await db
    .prepare("UPDATE rounds SET game = json_set(game, ?, json(?)), updated_at = datetime('now') WHERE id = ? AND json_extract(game, '$.id') = 'wolf'")
    .bind(`$.wolf[${hole}]`, JSON.stringify(choice), roundId)
    .run();
}

/** People you might play with: everyone in your leagues who has an account. */
export async function golfers(db: D1Database, userId: number, leagueIds: number[]): Promise<{ userId: number; name: string }[]> {
  if (!leagueIds.length) return [];
  const ids = leagueIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT u.id, COALESCE(u.name, substr(u.email, 1, instr(u.email, '@') - 1)) AS name FROM users u
       WHERE u.status = 'active' AND u.id != ? AND u.id IN (
         SELECT user_id FROM league_members WHERE role != 'requested' AND league_id IN (${ids})
         UNION SELECT pa.user_id FROM player_accounts pa JOIN seasons s ON s.id = pa.season_id WHERE s.league_id IN (${ids})
         UNION SELECT v.id FROM users v JOIN players p ON lower(p.email) = v.email JOIN seasons s ON s.id = p.season_id
           WHERE v.email_verified = 1 AND s.league_id IN (${ids}))
       ORDER BY name COLLATE NOCASE`,
    )
    .bind(userId, ...leagueIds, ...leagueIds, ...leagueIds)
    .all<{ id: number; name: string }>();
  return results.map((r) => ({ userId: r.id, name: r.name }));
}

/** A registered player found by their exact email. */
export async function golferByEmail(db: D1Database, email: string): Promise<{ userId: number; name: string } | null> {
  const r = await db
    .prepare("SELECT id, COALESCE(name, substr(email, 1, instr(email, '@') - 1)) AS name FROM users WHERE email = ? AND status = 'active' LIMIT 1")
    .bind(email)
    .first<{ id: number; name: string }>();
  return r ? { userId: r.id, name: r.name } : null;
}
