/** Queue notifications and fan them out as web pushes. Who-to-notify helpers for each event. */
import { sendPush, type PushEnv } from './push';

export interface Note {
  title: string;
  body: string;
  url?: string;
}

/** Queue a notification for each user and wake their devices. Safe to call without push configured (just queues). */
export async function notify(db: D1Database, env: PushEnv, waitUntil: (p: Promise<unknown>) => void, userIds: number[], n: Note): Promise<void> {
  const targets = [...new Set(userIds)].filter((x) => x > 0);
  if (!targets.length) return;
  await db.batch(targets.map((uid) => db.prepare('INSERT INTO notifications (user_id, title, body, url) VALUES (?, ?, ?, ?)').bind(uid, n.title, n.body.slice(0, 300), n.url ?? null)));
  if (!env.VAPID_JWK) return;
  const { results } = await db.prepare(`SELECT endpoint FROM push_subscriptions WHERE user_id IN (${targets.map(() => '?').join(',')})`).bind(...targets).all<{ endpoint: string }>();
  waitUntil(
    Promise.all(
      results.map(async (row) => {
        const status = await sendPush(env, row.endpoint);
        if (status === 404 || status === 410) await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run();
      }),
    ),
  );
}

/** Undelivered notifications for a user; marks them delivered. The service worker calls this when woken. */
export async function pendingNotifications(db: D1Database, userId: number): Promise<{ id: number; title: string; body: string; url: string | null }[]> {
  const { results } = await db.prepare('SELECT id, title, body, url FROM notifications WHERE user_id = ? AND delivered_at IS NULL ORDER BY id DESC LIMIT 20').bind(userId).all<{ id: number; title: string; body: string; url: string | null }>();
  if (results.length) await db.prepare("UPDATE notifications SET delivered_at = datetime('now') WHERE user_id = ? AND delivered_at IS NULL").bind(userId).run();
  return results;
}

export async function saveSubscription(db: D1Database, userId: number, endpoint: string, p256dh: string, auth: string): Promise<void> {
  await db
    .prepare("INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = datetime('now')")
    .bind(endpoint, userId, p256dh, auth)
    .run();
}

export const removeSubscription = (db: D1Database, endpoint: string) => db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();

// ---------- who to notify ----------

const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

/** Everyone in a league: its member list, accounts linked to its rosters, and verified emails on its rosters. */
export async function leagueMemberIds(db: D1Database, leagueId: number): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT id FROM (
         SELECT user_id AS id FROM league_members WHERE league_id = ?1 AND role IN ('member','admin')
         UNION SELECT pa.user_id FROM player_accounts pa JOIN seasons s ON s.id = pa.season_id WHERE s.league_id = ?1
         UNION SELECT u.id FROM users u JOIN players p ON lower(p.email) = u.email JOIN seasons s ON s.id = p.season_id
           WHERE u.email_verified = 1 AND s.league_id = ?1)`,
    )
    .bind(leagueId)
    .all<{ id: number }>();
  return ids(results);
}

export async function leagueAdminIds(db: D1Database, leagueId: number): Promise<number[]> {
  const { results } = await db.prepare("SELECT user_id AS id FROM league_members WHERE league_id = ? AND role = 'admin'").bind(leagueId).all<{ id: number }>();
  const { results: supers } = await db.prepare('SELECT id FROM users WHERE is_admin = 1').all<{ id: number }>();
  return [...ids(results), ...ids(supers)];
}

/** Accounts for a set of roster players in a season (linked by hand or by verified email). */
export async function usersForPlayers(db: D1Database, seasonId: number, playerIds: number[]): Promise<number[]> {
  if (!playerIds.length) return [];
  const ph = playerIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT DISTINCT id FROM (
         SELECT user_id AS id FROM player_accounts WHERE season_id = ?1 AND player_id IN (${ph})
         UNION SELECT u.id FROM users u JOIN players p ON lower(p.email) = u.email
           WHERE u.email_verified = 1 AND p.season_id = ?1 AND p.id IN (${ph}))`,
    )
    .bind(seasonId, ...playerIds, ...playerIds)
    .all<{ id: number }>();
  return ids(results);
}
