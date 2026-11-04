/** Leagues, who belongs to them, and who runs them. */
import type { User } from './accounts';
import { newToken } from './passwords';

export type LeagueRole = 'admin' | 'member';

export interface LeagueAccess {
  id: number;
  name: string;
  role: LeagueRole;
}

/**
 * The leagues a person can see. Super admins see every league as an admin. Everyone else belongs
 * to a league through its member list, a roster player linked to their account, or their verified
 * email on one of the league's rosters.
 */
export async function leaguesFor(db: D1Database, user: User | null, superAdmin: boolean): Promise<LeagueAccess[]> {
  if (superAdmin) {
    const { results } = await db.prepare('SELECT id, name FROM leagues ORDER BY id').all<{ id: number; name: string }>();
    return results.map((r) => ({ ...r, role: 'admin' }));
  }
  if (!user) return [];
  const { results } = await db
    .prepare(
      `SELECT l.id, l.name, m.role FROM leagues l
       LEFT JOIN league_members m ON m.league_id = l.id AND m.user_id = ?1 AND m.role IN ('member', 'admin')
       WHERE m.user_id IS NOT NULL
          OR l.id IN (SELECT s.league_id FROM player_accounts pa JOIN seasons s ON s.id = pa.season_id WHERE pa.user_id = ?1)
          OR (?2 IS NOT NULL AND l.id IN (SELECT s.league_id FROM players p JOIN seasons s ON s.id = p.season_id WHERE lower(p.email) = ?2))
       ORDER BY l.id`,
    )
    .bind(user.id, user.emailVerified ? user.email : null)
    .all<{ id: number; name: string; role: string | null }>();
  return results.map((r) => ({ id: r.id, name: r.name, role: r.role === 'admin' ? 'admin' : 'member' }));
}

/** Leagues the person has asked to join and is waiting on. */
export async function requestedLeagues(db: D1Database, userId: number): Promise<{ id: number; name: string }[]> {
  const { results } = await db
    .prepare("SELECT l.id, l.name FROM league_members m JOIN leagues l ON l.id = m.league_id WHERE m.user_id = ? AND m.role = 'requested' ORDER BY l.name")
    .bind(userId)
    .all<{ id: number; name: string }>();
  return results;
}

const joinCode = async () => (await newToken()).token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase();

/** A new league, run by the person who made it. */
export async function createLeague(db: D1Database, name: string, creatorId: number | null): Promise<number> {
  const row = await db
    .prepare('INSERT INTO leagues (name, join_code, created_by) VALUES (?, ?, ?) RETURNING id')
    .bind(name, await joinCode(), creatorId)
    .first<{ id: number }>();
  const id = row!.id;
  const stmts = [db.prepare("INSERT INTO audit_log (league_id, action, detail) VALUES (?, 'create league', ?)").bind(id, JSON.stringify({ name }))];
  if (creatorId != null) stmts.push(db.prepare("INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, 'admin')").bind(id, creatorId));
  await db.batch(stmts);
  return id;
}

export async function newJoinCode(db: D1Database, leagueId: number): Promise<string> {
  const code = await joinCode();
  await db.prepare('UPDATE leagues SET join_code = ? WHERE id = ?').bind(code, leagueId).run();
  return code;
}

export async function leagueByCode(db: D1Database, code: string): Promise<{ id: number; name: string } | null> {
  return db.prepare('SELECT id, name FROM leagues WHERE join_code = ?').bind(code.trim().toLowerCase()).first<{ id: number; name: string }>();
}

/** Ask to join a league. Someone already in it (or an admin) keeps their place. */
export function requestStatement(db: D1Database, leagueId: number, userId: number) {
  return db.prepare("INSERT OR IGNORE INTO league_members (league_id, user_id, role) VALUES (?, ?, 'requested')").bind(leagueId, userId);
}

/** Whether an account is in a league (any role, including a request to join), for league admins' account tools. */
export async function inLeague(db: D1Database, leagueId: number, userId: number): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT 1 FROM league_members WHERE league_id = ?1 AND user_id = ?2
       UNION SELECT 1 FROM player_accounts pa JOIN seasons s ON s.id = pa.season_id WHERE s.league_id = ?1 AND pa.user_id = ?2
       UNION SELECT 1 FROM users u JOIN players p ON lower(p.email) = u.email JOIN seasons s ON s.id = p.season_id
         WHERE u.id = ?2 AND u.email_verified = 1 AND s.league_id = ?1
       LIMIT 1`,
    )
    .bind(leagueId, userId)
    .first();
  return !!r;
}

export async function seasonLeague(db: D1Database, seasonId: number): Promise<number | null> {
  const r = await db.prepare('SELECT league_id FROM seasons WHERE id = ?').bind(seasonId).first<{ league_id: number }>();
  return r?.league_id ?? null;
}
