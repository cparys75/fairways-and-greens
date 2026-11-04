/** Player accounts: users, sign-in identities, account ↔ player links, match submissions and personal rounds. */
import type { CardEntry, Submission } from '../../src/engine';
import type { Profile } from './oauth';
import { sha256 } from './passwords';

export type UserStatus = 'active' | 'pending' | 'disabled';

export interface User {
  id: number;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** Super admin: runs every league and the site. */
  isAdmin: boolean;
  /** Approved by a super admin to start new leagues. */
  canCreateLeagues: boolean;
  /** Only active accounts can sign in. Email/password accounts start pending until an admin approves. */
  status: UserStatus;
}

const toUser = (r: Record<string, unknown>): User => ({
  id: r.id as number,
  email: (r.email as string) ?? null,
  emailVerified: !!r.email_verified,
  name: (r.name as string) ?? null,
  isAdmin: !!r.is_admin,
  canCreateLeagues: !!r.can_create_leagues,
  status: ((r.status as string) ?? 'active') as UserStatus,
});

export async function getUser(db: D1Database, id: number): Promise<User | null> {
  const r = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return r ? toUser(r) : null;
}

/**
 * Find or create the user for a sign-in. A verified email that already belongs to an account
 * joins that account rather than creating a second one.
 */
export async function upsertUser(db: D1Database, p: Profile): Promise<User> {
  const known = await db
    .prepare('SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?')
    .bind(p.provider, p.subject)
    .first();
  if (known) {
    const user = toUser(known);
    // Keep the name current; adopt the email once it's verified (if no other account has it).
    const email = p.emailVerified && !user.emailVerified && !(await verifiedOwner(db, p.email!)) ? p.email : null;
    await db
      .prepare(
        `UPDATE users SET name = COALESCE(?, name), last_login_at = datetime('now'),
           email = COALESCE(?, email), email_verified = CASE WHEN ? IS NULL THEN email_verified ELSE 1 END WHERE id = ?`,
      )
      .bind(p.name, email, email, user.id)
      .run();
    return (await getUser(db, user.id))!;
  }

  const owner = p.emailVerified ? await verifiedOwner(db, p.email!) : null;
  const id =
    owner ??
    (
      await db
        .prepare("INSERT INTO users (email, email_verified, name, last_login_at) VALUES (?, ?, ?, datetime('now')) RETURNING id")
        .bind(p.email, p.emailVerified ? 1 : 0, p.name)
        .first<{ id: number }>()
    )!.id;
  await db.batch([
    db.prepare('INSERT INTO user_identities (provider, subject, user_id) VALUES (?, ?, ?)').bind(p.provider, p.subject, id),
    db.prepare("UPDATE users SET last_login_at = datetime('now'), name = COALESCE(name, ?) WHERE id = ?").bind(p.name, id),
  ]);
  return (await getUser(db, id))!;
}

async function verifiedOwner(db: D1Database, email: string): Promise<number | null> {
  const r = await db.prepare('SELECT id FROM users WHERE email = ? AND email_verified = 1').bind(email).first<{ id: number }>();
  return r?.id ?? null;
}

// ---------- passwordless sign-in: emailed one-time codes ----------

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 = 400,
  ) {
    super(message);
  }
}

const OTP_MINUTES = 10;
const OTP_RESEND_SECONDS = 45;
const OTP_MAX_ATTEMPTS = 5;

/** A random 6-digit code. */
export function randomCode(): string {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0] % 1000000).padStart(6, '0');
}

/** A code is only emailed to addresses we already know: an account, a roster player, or anyone with an invite. */
export async function emailKnown(db: D1Database, email: string, viaInvite: boolean): Promise<boolean> {
  if (viaInvite) return true;
  const r = await db.prepare('SELECT 1 FROM users WHERE email = ?1 UNION SELECT 1 FROM players WHERE lower(email) = ?1 LIMIT 1').bind(email).first();
  return !!r;
}

/** Make and store a code to email. Returns null if one was just sent (don't spam). */
export async function makeOtp(db: D1Database, email: string): Promise<string | null> {
  const existing = await db.prepare('SELECT sent_at FROM otp_codes WHERE email = ?').bind(email).first<{ sent_at: string }>();
  if (existing && Date.now() - new Date(`${existing.sent_at.replace(' ', 'T')}Z`).getTime() < OTP_RESEND_SECONDS * 1000) return null;
  const code = randomCode();
  const expires = new Date(Date.now() + OTP_MINUTES * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO otp_codes (email, code_hash, expires, attempts, sent_at) VALUES (?, ?, ?, 0, datetime('now'))
       ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0, sent_at = datetime('now')`,
    )
    .bind(email, await sha256(`${code}:${email}`), expires)
    .run();
  return code;
}

/** Check a code and sign the person in, creating or reusing their account (email now verified). */
export async function verifyOtp(db: D1Database, email: string, code: string): Promise<User> {
  const r = await db.prepare('SELECT * FROM otp_codes WHERE email = ?').bind(email).first<Record<string, unknown>>();
  if (!r) throw new AccountError('Enter the code we emailed you (or request a new one).', 400);
  if ((r.expires as string) < new Date().toISOString()) {
    await db.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();
    throw new AccountError('That code has expired. Request a new one.', 401);
  }
  if ((r.attempts as number) >= OTP_MAX_ATTEMPTS) throw new AccountError('Too many tries. Request a new code.', 429);
  if ((await sha256(`${code}:${email}`)) !== r.code_hash) {
    await db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    throw new AccountError('That code is not right.', 401);
  }
  await db.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();

  // Reuse any existing account for this email (Google, or a legacy password account), preferring a
  // verified one; otherwise create a fresh account. The code proves the person owns the address.
  const existing = await db.prepare('SELECT id FROM users WHERE email = ? ORDER BY email_verified DESC LIMIT 1').bind(email).first<{ id: number }>();
  const id =
    existing?.id ??
    (await db.prepare("INSERT INTO users (email, email_verified, name, status, last_login_at) VALUES (?, 1, ?, 'active', datetime('now')) RETURNING id").bind(email, email.split('@')[0]).first<{ id: number }>())!.id;
  await db.batch([
    db.prepare("UPDATE users SET email_verified = 1, last_login_at = datetime('now') WHERE id = ?").bind(id),
    db.prepare("INSERT OR IGNORE INTO user_identities (provider, subject, user_id) VALUES ('email', ?, ?)").bind(email, id),
  ]);
  const user = (await getUser(db, id))!;
  if (user.status === 'disabled') throw new AccountError('This account has been turned off. Contact a league admin.', 403);
  return user;
}

/** The roster player this user is in a season: linked by hand, or by matching verified email. */
export async function playerFor(db: D1Database, seasonId: number, user: User): Promise<number | null> {
  const r = await db
    .prepare(
      `SELECT id FROM players p WHERE p.season_id = ?1 AND (
         p.id IN (SELECT player_id FROM player_accounts WHERE season_id = ?1 AND user_id = ?2)
         OR (?3 IS NOT NULL AND lower(p.email) = ?3)
       ) ORDER BY p.id IN (SELECT player_id FROM player_accounts WHERE season_id = ?1 AND user_id = ?2) DESC LIMIT 1`,
    )
    .bind(seasonId, user.id, user.emailVerified ? user.email : null)
    .first<{ id: number }>();
  return r?.id ?? null;
}

export interface AccountRow extends User {
  providers: string[];
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Player in the requested season, and whether that came from a manual link. */
  playerId: number | null;
  manualLink: boolean;
  /** Role in the league being looked at: asked to join, member, or league admin. */
  leagueRole: 'requested' | 'member' | 'admin' | null;
}

/**
 * Accounts for the admin pages. With `onlyLeague`, just the people in that league: its member list
 * (including requests to join), accounts linked to its roster players, and verified emails on its rosters.
 */
export async function listAccounts(db: D1Database, leagueId: number, seasonId: number | null, onlyLeague: boolean): Promise<AccountRow[]> {
  const inLeague = `id IN (
      SELECT user_id FROM league_members WHERE league_id = ?1
      UNION SELECT pa.user_id FROM player_accounts pa JOIN seasons s ON s.id = pa.season_id WHERE s.league_id = ?1
      UNION SELECT u.id FROM users u JOIN players p ON lower(p.email) = u.email JOIN seasons s ON s.id = p.season_id
        WHERE u.email_verified = 1 AND s.league_id = ?1)`;
  const [users, ids, links, emails, roles] = await db.batch([
    db.prepare(`SELECT * FROM users ${onlyLeague ? `WHERE ${inLeague}` : 'WHERE ?1 IS NOT NULL'} ORDER BY status = 'pending' DESC, name COLLATE NOCASE, email`).bind(leagueId),
    db.prepare('SELECT user_id, provider FROM user_identities'),
    db.prepare('SELECT user_id, player_id FROM player_accounts WHERE season_id = ?').bind(seasonId ?? -1),
    db.prepare('SELECT id, lower(email) AS email FROM players WHERE season_id = ? AND email IS NOT NULL').bind(seasonId ?? -1),
    db.prepare('SELECT user_id, role FROM league_members WHERE league_id = ?').bind(leagueId),
  ]);
  const role = new Map((roles.results as { user_id: number; role: AccountRow['leagueRole'] }[]).map((r) => [r.user_id, r.role]));
  const providers = new Map<number, string[]>();
  for (const r of ids.results as { user_id: number; provider: string }[]) providers.set(r.user_id, [...(providers.get(r.user_id) ?? []), r.provider]);
  const manual = new Map((links.results as { user_id: number; player_id: number }[]).map((r) => [r.user_id, r.player_id]));
  const byEmail = new Map((emails.results as { id: number; email: string }[]).map((r) => [r.email, r.id]));
  return (users.results as Record<string, unknown>[]).map((r) => {
    const u = toUser(r);
    const viaEmail = u.emailVerified && u.email ? (byEmail.get(u.email) ?? null) : null;
    return {
      ...u,
      providers: providers.get(u.id) ?? [],
      hasPassword: (providers.get(u.id) ?? []).includes('password'),
      createdAt: r.created_at as string,
      lastLoginAt: (r.last_login_at as string) ?? null,
      playerId: manual.get(u.id) ?? viaEmail,
      manualLink: manual.has(u.id),
      leagueRole: role.get(u.id) ?? (onlyLeague || manual.has(u.id) || viaEmail != null ? 'member' : null),
    };
  });
}

// ---------- match submissions ----------

export async function loadSubmissions(db: D1Database, seasonId: number, week: number, teamA: number, teamB: number): Promise<(Submission & { name: string | null })[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, p.name AS player_name FROM submissions s
       LEFT JOIN players p ON p.season_id = s.season_id AND p.id = s.player_id
       WHERE s.season_id = ? AND s.week = ? AND s.team_a = ? AND s.team_b = ? ORDER BY s.updated_at`,
    )
    .bind(seasonId, week, teamA, teamB)
    .all<Record<string, never>>();
  return results.map((r) => ({
    userId: r.user_id,
    playerId: r.player_id,
    teamId: r.team_id,
    cards: JSON.parse(r.cards) as CardEntry[],
    updatedAt: r.updated_at,
    name: r.player_name ?? null,
  }));
}

export function submissionStatement(db: D1Database, seasonId: number, week: number, teamA: number, teamB: number, s: Submission) {
  return db
    .prepare(
      `INSERT INTO submissions (season_id, week, team_a, team_b, user_id, player_id, team_id, cards) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (season_id, week, team_a, team_b, user_id) DO UPDATE SET player_id = excluded.player_id,
         team_id = excluded.team_id, cards = excluded.cards, updated_at = datetime('now')`,
    )
    .bind(seasonId, week, teamA, teamB, s.userId, s.playerId, s.teamId, JSON.stringify(s.cards));
}
