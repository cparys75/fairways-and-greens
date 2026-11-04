import { Hono, type Context } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import {
  buildSchedule,
  computeSeason,
  consensus,
  formatInfo,
  gameInfo,
  GAMES,
  individualTeams,
  isFormat,
  matchPlayerIds,
  teamCardId,
  normalizeSeason,
  type CardEntry,
  type Match,
  type Nine,
  type Player,
  type GameSetup,
  type RoundStats,
  type SchedulePlan,
  type SeasonData,
  type Score,
  type Settings,
  type Team,
} from '../../src/engine';
import {
  AccountError,
  getUser,
  listAccounts,
  emailKnown,
  makeOtp,
  verifyOtp,
  loadSubmissions,
  playerFor,
  submissionStatement,
  upsertUser,
  type User,
  type UserStatus,
} from '../lib/accounts';
import { adminCookie, checkPassword, isPasswordAdmin, passwordConfigured, sessionUser, signOutCookies, userCookie } from '../lib/auth';
import { BRAND } from '../lib/brand';
import { addPost, listPosts, postInfo } from '../lib/board';
import { CourseLookupError, getCourse, searchCourses, type CourseEnv } from '../lib/courses';
import {
  currentSeasonId,
  currentStatements,
  insertSeason,
  listSeasons,
  loadSeason,
  rosterStatements,
  scoreStatements,
  SEASON_TABLES,
  touch,
  upsertScoreStatement,
  weekStatements,
} from '../lib/db';
import { calendarFeed, calendarToken, resetCalendarToken, userByCalendarToken } from '../lib/calendar';
import { createLeague, inLeague, leagueByCode, leaguesFor, newJoinCode, requestedLeagues, requestStatement, seasonLeague, type LeagueAccess } from '../lib/leagues';
import { emailConfigured, sendEmail, type EmailEnv } from '../lib/email';
import { vapidPublicKey, type PushEnv } from '../lib/push';
import { leagueAdminIds, leagueMemberIds, notify, pendingNotifications, removeSubscription, saveSubscription, usersForPlayers } from '../lib/notify';
import { getRound, golferByEmail, golfers, guestLink, guestRound, listRounds, saveRound, setScore, setWolf, type Round } from '../lib/rounds';
import { clearTxCookie, enabledProviders, finishSignIn, isProvider, OAuthError, startSignIn, type OAuthEnv } from '../lib/oauth';

type Env = OAuthEnv & CourseEnv & PushEnv & EmailEnv & { DB: D1Database; DEV_LOGIN?: string; CRON_SECRET?: string };
type Vars = { user: User | null; superAdmin: boolean; leagues: LeagueAccess[] };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api');

class BadRequest extends Error {}
class Forbidden extends Error {}

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  if (err instanceof Forbidden) return c.json({ error: err.message }, 403);
  if (err instanceof AccountError) return c.json({ error: err.message }, err.status);
  if (err instanceof CourseLookupError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'Server error' }, 500);
});

const secure = (c: C) => new URL(c.req.url).protocol === 'https:';
// Run a background task (push fan-out) without delaying the response; a no-op when there's no exec context (tests).
const bg = (c: C) => (pr: Promise<unknown>) => { try { c.executionCtx.waitUntil(pr); } catch { /* no context */ } };
const shortName = (name: string | null, email: string | null) => name || email?.split('@')[0] || 'A player';

// Send API calls from a configured legacy host (BRAND.legacyHost) on to the canonical domain (so saved
// calendar subscriptions and guest links follow a move); preview deploys (<hash>.pages.dev) are left alone.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (BRAND.legacyHost && url.hostname === BRAND.legacyHost) return c.redirect(`https://${BRAND.domain}${url.pathname}${url.search}`, 301);
  return next();
});

// Defense in depth against CSRF (cookies are already SameSite=Strict): reject state-changing
// requests whose Origin is a site we don't own. Requests without an Origin (apps, our tests, cron) pass.
app.use('*', async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const origin = c.req.header('Origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { return c.json({ error: 'Bad origin' }, 403); }
    const ok =
      host === new URL(c.req.url).host ||
      host === BRAND.domain ||
      host.endsWith(`.${BRAND.domain}`) ||
      host.endsWith('.pages.dev') ||
      host.startsWith('localhost') ||
      host.startsWith('127.0.0.1');
    if (!ok) return c.json({ error: 'Cross-site request blocked' }, 403);
  }
  return next();
});

// Who is signed in: a player account (sliding 8-hour session) and/or the admin password fallback.
app.use('*', async (c, next) => {
  const cookies = c.req.header('Cookie');
  const session = await sessionUser(c.env, cookies);
  const found = session ? await getUser(c.env.DB, session.userId) : null;
  // Pending or turned-off accounts are treated as signed out.
  const user = found?.status === 'active' ? found : null;
  c.set('user', user);
  // The admin password is a super admin, like an account with is_admin.
  const superAdmin = !!user?.isAdmin || (await isPasswordAdmin(c.env, cookies));
  c.set('superAdmin', superAdmin);
  c.set('leagues', await leaguesFor(c.env.DB, user, superAdmin));
  await next();
  const signingOut = c.req.path === '/api/logout' || c.res.headers.get('Set-Cookie')?.includes('league_session=');
  if (session?.refresh && user && !signingOut) c.res.headers.append('Set-Cookie', await userCookie(c.env, user.id, secure(c)));
});

/** A subscribable .ics of the member's league schedule. The token in the URL stands in for signing in. */
app.get('/calendar/:token', async (c) => {
  const token = c.req.param('token').replace(/\.ics$/, '');
  const user = await userByCalendarToken(c.env.DB, token);
  if (!user) return c.text('This calendar link is no longer valid. Get a new one in the app under Leagues.', 404);
  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=3600');
  c.header('Content-Disposition', 'inline; filename="golf-schedule.ics"');
  return c.body(await calendarFeed(c.env.DB, user));
});

// ---------- leagues (members only) ----------

/** Your role in a league: super admins are admins of every league. */
const roleIn = (c: C, leagueId: number | null) => (leagueId == null ? null : (c.var.leagues.find((l) => l.id === leagueId)?.role ?? null));
const isLeagueAdmin = (c: C, leagueId: number | null) => roleIn(c, leagueId) === 'admin';

const notInLeague = (c: C) =>
  c.var.user || c.var.superAdmin
    ? new AccountError('This league is only visible to its members. Ask the league’s admin for an invite link.', 403)
    : new AccountError('Please sign in', 401);

/** The league a request is about: the one asked for (if you're in it), else your first league. */
function leagueParam(c: C, v: unknown): number {
  if (v != null && v !== '') {
    const id = int(v, 'league');
    if (!roleIn(c, id)) throw notInLeague(c);
    return id;
  }
  if (!c.var.leagues.length) throw notInLeague(c);
  return c.var.leagues[0].id;
}

app.get('/seasons', async (c) => c.json(await listSeasons(c.env.DB, leagueParam(c, c.req.query('league')))));

app.get('/seasons/:id', async (c) => {
  const id = c.req.param('id') === 'current' ? await currentSeasonId(c.env.DB, leagueParam(c, c.req.query('league'))) : int(c.req.param('id'), 'season');
  const leagueId = id ? await seasonLeague(c.env.DB, id) : null;
  if (leagueId != null && !roleIn(c, leagueId)) throw notInLeague(c);
  const data = id && leagueId != null ? await loadSeason(c.env.DB, id) : null;
  if (!data) return c.json({ error: 'Season not found' }, 404);
  // Player emails and phone numbers are only for the league's admins.
  if (!isLeagueAdmin(c, leagueId)) data.players = data.players.map(({ email: _e, phone: _p, ...p }) => p);
  if (c.req.query('download') !== undefined) {
    c.header('Content-Disposition', `attachment; filename="${data.season.name.replace(/[^\w.-]+/g, '-')}.json"`);
  }
  c.header('Cache-Control', 'no-cache');
  return c.json({ format: 'golf-league-season/v1', leagueId, ...data });
});

/** Start a league (super admins, and people a super admin approved to). You become its admin. */
app.post('/leagues', async (c) => {
  if (!c.var.superAdmin && !c.var.user?.canCreateLeagues) throw new Forbidden('Ask a site admin for permission to start leagues');
  const { name } = await c.req.json<{ name?: string }>();
  return c.json({ id: await createLeague(c.env.DB, str(name, 'League name').slice(0, 80), c.var.user?.id ?? null) });
});

/** The league an invite link is for. */
app.get('/join/:code', async (c) => {
  const league = await leagueByCode(c.env.DB, c.req.param('code'));
  return league ? c.json({ name: league.name }) : c.json({ error: 'This invite link is no longer valid. Ask the league’s admin for a new one.' }, 404);
});

/** Ask to join a league from its invite link. The league's admins approve it. */
app.post('/leagues/join', async (c) => {
  const user = requireUser(c);
  const { code } = await c.req.json<{ code?: string }>();
  const league = await leagueByCode(c.env.DB, str(code, 'invite code'));
  if (!league) throw new BadRequest('This invite link is no longer valid. Ask the league’s admin for a new one.');
  if (roleIn(c, league.id)) return c.json({ status: 'member', id: league.id, name: league.name });
  await c.env.DB.batch([
    requestStatement(c.env.DB, league.id, user.id),
    c.env.DB.prepare("INSERT INTO audit_log (league_id, action, detail) VALUES (?, 'asked to join', ?)").bind(league.id, JSON.stringify({ account: user.id })),
  ]);
  await notify(c.env.DB, c.env, bg(c), await leagueAdminIds(c.env.DB, league.id), { title: 'New join request', body: `${shortName(user.name, user.email)} asked to join ${league.name}.`, url: '/admin/league' });
  return c.json({ status: 'requested', id: league.id, name: league.name });
});

// ---------- health and usage ----------

/** For an uptime monitor: answers 200 when the site and its database are working, 503 when not. */
app.get('/health', async (c) => {
  c.header('Cache-Control', 'no-store');
  try {
    await c.env.DB.prepare('SELECT COUNT(*) FROM leagues').first();
    return c.json({ ok: true, database: 'ok', time: new Date().toISOString() });
  } catch (e) {
    console.error('health check', e);
    return c.json({ ok: false, database: 'unavailable' }, 503);
  }
});

/** How the site is being used, for site admins (Admin → Site). */
app.get('/admin/site', async (c) => {
  if (!c.var.superAdmin) throw new Forbidden('Only site admins can see this');
  const db = c.env.DB;
  const one = (sql: string) => db.prepare(sql);
  const [accounts, rounds, league, leagues, recent, size] = await db.batch([
    one(`SELECT
        SUM(status = 'active') AS active, SUM(status = 'pending') AS pending, SUM(status = 'disabled') AS disabled,
        SUM(last_login_at > datetime('now', '-7 days')) AS week, SUM(last_login_at > datetime('now', '-30 days')) AS month,
        SUM(created_at > datetime('now', '-30 days')) AS new_month
      FROM users`),
    one(`SELECT COUNT(*) AS total, SUM(created_at > datetime('now', '-30 days')) AS month, SUM(live) AS live,
        SUM(id IN (SELECT round_id FROM round_players)) AS groups,
        (SELECT COUNT(*) FROM round_players WHERE guest_expires > datetime('now')) AS guest_links
      FROM rounds`),
    one(`SELECT (SELECT COUNT(*) FROM scores WHERE updated_at > datetime('now', '-30 days')) AS scores_month,
        (SELECT COUNT(*) FROM posts WHERE created_at > datetime('now', '-30 days')) AS posts_month,
        (SELECT COUNT(*) FROM audit_log WHERE at > datetime('now', '-1 day')) AS changes_day`),
    one(`SELECT l.id, l.name, l.created_at,
        (SELECT COUNT(*) FROM seasons s WHERE s.league_id = l.id) AS seasons,
        (SELECT name FROM seasons s WHERE s.league_id = l.id ORDER BY is_current DESC, id DESC LIMIT 1) AS current_season,
        (SELECT COUNT(*) FROM players p JOIN seasons s ON s.id = p.season_id WHERE s.league_id = l.id AND s.is_current = 1 AND p.active = 1) AS players,
        (SELECT COUNT(*) FROM league_members m WHERE m.league_id = l.id AND m.role = 'admin') AS admins,
        (SELECT COUNT(*) FROM league_members m WHERE m.league_id = l.id AND m.role = 'requested') AS requests,
        (SELECT MAX(at) FROM audit_log a WHERE a.league_id = l.id) AS last_activity
      FROM leagues l ORDER BY l.id`),
    one(`SELECT a.at, a.action, a.detail, l.name AS league FROM audit_log a LEFT JOIN leagues l ON l.id = a.league_id ORDER BY a.id DESC LIMIT 25`),
    one('SELECT 1'),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  const a = accounts.results[0] as Record<string, number>;
  const r = rounds.results[0] as Record<string, number>;
  const g = league.results[0] as Record<string, number>;
  return c.json({
    accounts: { active: n(a.active), pending: n(a.pending), disabled: n(a.disabled), signedInWeek: n(a.week), signedInMonth: n(a.month), newMonth: n(a.new_month) },
    rounds: { total: n(r.total), month: n(r.month), live: n(r.live), groups: n(r.groups), guestLinks: n(r.guest_links) },
    activity: { leagueScoresMonth: n(g.scores_month), postsMonth: n(g.posts_month), changesDay: n(g.changes_day) },
    leagues: leagues.results,
    recent: recent.results,
    // D1 reports the database's size after each query.
    databaseBytes: (size.meta as { size_after?: number }).size_after ?? null,
  });
});

// ---------- sign-in ----------

app.get('/me', async (c) => {
  const user = c.var.user;
  return c.json({
    superAdmin: c.var.superAdmin,
    canCreateLeagues: c.var.superAdmin || !!user?.canCreateLeagues,
    leagues: c.var.leagues,
    requested: user ? await requestedLeagues(c.env.DB, user.id) : [],
    user: user && { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
    providers: enabledProviders(c.env),
    emailLogin: emailConfigured(c.env),
    adminPassword: passwordConfigured(c.env),
    devLogin: devLoginAllowed(c),
  });
});

app.get('/auth/:provider/start', async (c) => {
  const p = c.req.param('provider');
  if (!isProvider(p) || !enabledProviders(c.env).includes(p)) return c.redirect('/signin?error=That+sign-in+option+is+not+set+up');
  const { url, cookie } = await startSignIn(c.env, p, new URL(c.req.url).origin, c.req.query('returnTo') ?? '/');
  c.header('Set-Cookie', cookie);
  return c.redirect(url);
});

app.get('/auth/:provider/callback', async (c) => {
  const p = c.req.param('provider');
  if (!isProvider(p) || !enabledProviders(c.env).includes(p)) return c.redirect('/signin');
  c.header('Set-Cookie', clearTxCookie(), { append: true });
  try {
    const url = new URL(c.req.url);
    const { profile, returnTo } = await finishSignIn(c.env, p, url.origin, url.searchParams, c.req.header('Cookie'));
    const user = await upsertUser(c.env.DB, profile);
    c.header('Set-Cookie', await userCookie(c.env, user.id, secure(c)), { append: true });
    return c.redirect(returnTo);
  } catch (e) {
    if (!(e instanceof OAuthError)) console.error(e);
    const msg = e instanceof OAuthError ? e.message : 'Sign-in failed. Please try again.';
    return c.redirect(`/signin?error=${encodeURIComponent(msg)}`);
  }
});

/** Local development only: sign in as any email without Google. */
function devLoginAllowed(c: C): boolean {
  return c.env.DEV_LOGIN === 'true' && ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);
}

app.post('/auth/dev', async (c) => {
  if (!devLoginAllowed(c)) return c.json({ error: 'Not found' }, 404);
  const { email, admin } = await c.req.json<{ email?: string; admin?: boolean }>();
  const addr = str(email, 'email').toLowerCase();
  const user = await upsertUser(c.env.DB, { provider: 'google', subject: `dev:${addr}`, email: addr, emailVerified: true, name: addr.split('@')[0] });
  if (admin) await c.env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(user.id).run();
  c.header('Set-Cookie', await userCookie(c.env, user.id, secure(c)));
  return c.json({ ok: true });
});

// Passwordless sign-in: a 6-digit code emailed each time. Google users don't need this.
const emailOf = (v: unknown) => {
  const email = str(v, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new BadRequest('Enter a valid email address');
  return email;
};

/** Email a sign-in code. Always reports success (no account enumeration); only known emails actually get one. */
app.post('/auth/otp/request', async (c) => {
  const body = await c.req.json<{ email?: string; joinCode?: string }>().catch(() => ({}) as Record<string, never>);
  const email = emailOf(body.email);
  const viaInvite = body.joinCode ? !!(await leagueByCode(c.env.DB, String(body.joinCode))) : false;
  let code: string | null = null;
  if (await emailKnown(c.env.DB, email, viaInvite)) {
    code = await makeOtp(c.env.DB, email);
    if (code && emailConfigured(c.env)) {
      const text = `Your ${BRAND.name} sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask to sign in, you can ignore this.`;
      await sendEmail(c.env, email, `${code} is your ${BRAND.name} code`, text).catch((e) => console.error('otp email', e));
    }
  }
  // On localhost dev, return the code so there's no need for real email.
  return c.json({ sent: true, ...(devLoginAllowed(c) && code ? { devCode: code } : {}) });
});

/** Check the code, sign in, and (from an invite link) file a join request. */
app.post('/auth/otp/verify', async (c) => {
  const body = await c.req.json<{ email?: string; code?: string; joinCode?: string }>().catch(() => ({}) as Record<string, never>);
  const email = emailOf(body.email);
  const user = await verifyOtp(c.env.DB, email, str(body.code, 'code').replace(/\s/g, ''));
  c.header('Set-Cookie', await userCookie(c.env, user.id, secure(c)));
  const league = body.joinCode ? await leagueByCode(c.env.DB, String(body.joinCode)) : null;
  if (league && !(await leaguesFor(c.env.DB, user, false)).some((l) => l.id === league.id)) {
    await c.env.DB.batch([
      requestStatement(c.env.DB, league.id, user.id),
      c.env.DB.prepare("INSERT INTO audit_log (league_id, action, detail) VALUES (?, 'asked to join', ?)").bind(league.id, JSON.stringify({ account: user.id })),
    ]);
    await notify(c.env.DB, c.env, bg(c), await leagueAdminIds(c.env.DB, league.id), { title: 'New join request', body: `${user.name ?? email} asked to join ${league.name}.`, url: '/admin/league' });
  }
  return c.json({ ok: true });
});

app.post('/login', async (c) => {
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  if (!passwordConfigured(c.env)) return c.json({ error: 'ADMIN_PASSWORD and SESSION_SECRET are not set' }, 500);
  if (!password || !(await checkPassword(c.env, password))) return c.json({ error: 'Wrong password' }, 401);
  c.header('Set-Cookie', await adminCookie(c.env, secure(c)));
  return c.json({ ok: true });
});

app.post('/logout', (c) => {
  for (const v of signOutCookies()) c.header('Set-Cookie', v, { append: true });
  return c.json({ ok: true });
});

// ---------- signed-in players ----------

const requireUser = (c: C): User => {
  if (!c.var.user) throw new Forbidden('Please sign in');
  return c.var.user;
};

app.use('/my/*', async (c, next) => {
  if (!c.var.user) return c.json({ error: 'Please sign in' }, 401);
  await next();
});

app.use('/courses/*', async (c, next) => {
  if (!c.var.user && !c.var.superAdmin) return c.json({ error: 'Please sign in' }, 401);
  await next();
});

/** The signed-in player's matches in a season, with everyone's submitted cards and whether they agree. */
app.get('/my/matches', async (c) => {
  const user = requireUser(c);
  const q = c.req.query('season');
  const seasonId = !q || q === 'current' ? (c.var.leagues.length ? await currentSeasonId(c.env.DB, leagueParam(c, c.req.query('league'))) : null) : int(q, 'season');
  const data = seasonId ? await loadSeason(c.env.DB, seasonId) : null;
  if (!data || !seasonId) return c.json({ seasonId, playerId: null, matches: [] });
  const playerId = await playerFor(c.env.DB, seasonId, user);
  const player = data.players.find((p) => p.id === playerId);
  if (!player?.teamId) return c.json({ seasonId, playerId: playerId ?? null, matches: [] });
  const format = formatInfo(data.settings);

  // Field formats: your own card each week (your team's, in a scramble). It counts as soon as it's sent.
  if (format.field) {
    const entrant = format.teamCard ? teamCardId(player.teamId) : player.id;
    return c.json({
      seasonId,
      playerId,
      field: true,
      matches: data.weeks
        .filter((w) => !w.playoff || w.scores.length)
        .map((week) => {
          const s = week.scores.find((x) => x.playerId === entrant);
          const official = s ? [{ playerId: entrant, holes: s.holes, absent: !!s.virtual, dnf: s.dnf ?? null }] : [];
          return {
            week: week.number,
            date: week.date ?? null,
            nineId: week.nineId,
            playoff: !!week.playoff,
            teamA: player.teamId,
            teamB: player.teamId,
            playerIds: [[entrant], []],
            forfeit: false,
            official,
            consensus: { status: s ? 'agreed' : 'none', cards: null, missingTeams: [], differences: [] },
            submissions: [],
            blocked: submitBlocked(week.date, false),
          };
        }),
    });
  }

  const matches = [];
  for (const week of data.weeks) {
    const m = week.matches.find((x) => x.teamA === player.teamId || x.teamB === player.teamId);
    if (!m) continue;
    const subs = await loadSubmissions(c.env.DB, seasonId, week.number, m.teamA, m.teamB);
    const ids = matchPlayerIds(data, week, m);
    const official = week.scores.filter((s) => ids.flat().includes(s.playerId)).map((s) => ({ playerId: s.playerId, holes: s.holes, absent: !!s.virtual, dnf: s.dnf ?? null }));
    // Other people's cards (and where they differ) stay hidden until you've entered yours, so
    // each card is entered independently rather than copied.
    const entered = subs.some((s) => s.userId === user.id);
    const result = consensus(subs, m.teamA, m.teamB);
    matches.push({
      week: week.number,
      date: week.date ?? null,
      nineId: week.nineId,
      playoff: !!week.playoff,
      teamA: m.teamA,
      teamB: m.teamB,
      playerIds: ids,
      forfeit: !!m.pointsOverride,
      official,
      consensus: entered ? result : { ...result, differences: [] },
      submissions: subs.map((s) => ({ name: s.name, teamId: s.teamId, cards: entered || s.userId === user.id ? s.cards : null, updatedAt: s.updatedAt, mine: s.userId === user.id })),
      blocked: submitBlocked(week.date, !!m.pointsOverride),
    });
  }
  return c.json({ seasonId, playerId, matches });
});

function submitBlocked(date: string | null | undefined, forfeit: boolean): string | null {
  if (forfeit) return 'This match was recorded as a forfeit.';
  if (date && date > new Date().toISOString().slice(0, 10)) return 'Scores can be entered on the day of the match.';
  return null;
}

/** Enter or correct your match card. Identical cards from both teams become the official scores. */
app.put('/my/matches/:season/:week', async (c) => {
  const user = requireUser(c);
  const seasonId = int(c.req.param('season'), 'season');
  const n = int(c.req.param('week'), 'week');
  const data = await loadSeason(c.env.DB, seasonId);
  const week = data?.weeks.find((w) => w.number === n);
  if (!data || !week) throw new BadRequest('That week is not on the schedule');
  const playerId = await playerFor(c.env.DB, seasonId, user);
  const player = data.players.find((p) => p.id === playerId);
  const format = formatInfo(data.settings);
  if (format.field) {
    if (!player?.teamId) throw new Forbidden('You can only enter your own scores');
    const blockedField = submitBlocked(week.date, false);
    if (blockedField) throw new BadRequest(blockedField);
    const entrant = format.teamCard ? teamCardId(player.teamId) : player.id;
    const { cards } = await c.req.json<{ cards: CardEntry[] }>();
    const [card] = validateCards(cards, [entrant], data.players);
    await c.env.DB.batch([
      upsertScoreStatement(c.env.DB, seasonId, n, { playerId: card.playerId, holes: card.holes, virtual: card.absent }),
      ...touch(c.env.DB, seasonId, 'score entered by player', { week: n, entrant, by: user.id }),
    ]);
    return c.json({ status: 'agreed', missingTeams: [], differences: [] });
  }
  const match = player?.teamId ? week.matches.find((m) => m.teamA === player.teamId || m.teamB === player.teamId) : undefined;
  if (!player || !match) throw new Forbidden('You can only enter scores for your own match');
  const blocked = submitBlocked(week.date, !!match.pointsOverride);
  if (blocked) throw new BadRequest(blocked);

  // Once the match is final — both teams' cards agreed, or an admin accepted/entered the scores —
  // only a league admin can change it, through the admin score screen.
  const scored = new Set(week.scores.map((s) => s.playerId));
  if (matchPlayerIds(data, week, match).flat().every((id) => scored.has(id))) {
    throw new BadRequest('These scores are final. Ask a league admin to make any corrections.');
  }

  const { cards } = await c.req.json<{ cards: CardEntry[] }>();
  const valid = validateCards(cards, matchPlayerIds(data, week, match).flat(), data.players);
  const db = c.env.DB;
  await submissionStatement(db, seasonId, n, match.teamA, match.teamB, { userId: user.id, playerId: player.id, teamId: player.teamId!, cards: valid }).run();

  const result = consensus(await loadSubmissions(db, seasonId, n, match.teamA, match.teamB), match.teamA, match.teamB);
  const [idsA, idsB] = matchPlayerIds(data, week, match);
  if (result.status === 'agreed') {
    await db.batch([
      ...result.cards!.map((cd) => upsertScoreStatement(db, seasonId, n, { playerId: cd.playerId, holes: cd.holes, virtual: cd.absent, dnf: cd.dnf })),
      ...touch(db, seasonId, 'scores agreed by players', { week: n, teams: [match.teamA, match.teamB] }),
    ]);
    const everyone = (await usersForPlayers(db, seasonId, [...idsA, ...idsB])).filter((uid) => uid !== user.id);
    await notify(db, c.env, bg(c), everyone, { title: 'Scores posted', body: `Week ${n} scores are official.`, url: `/results/${n}` });
  } else if (result.status === 'waiting') {
    // Nudge the other team to enter their card.
    const opponents = await usersForPlayers(db, seasonId, player.teamId === match.teamA ? idsB : idsA);
    await notify(db, c.env, bg(c), opponents, { title: 'Scores needed', body: `Enter your scorecard for week ${n}.`, url: `/play/${n}` });
  }
  return c.json({ status: result.status, missingTeams: result.missingTeams, differences: result.differences });
});

// ---------- My profile ----------

app.get('/my/profile', async (c) => {
  const user = requireUser(c);
  const r = await c.env.DB.prepare('SELECT phone, sms_ok FROM users WHERE id = ?').bind(user.id).first<{ phone: string | null; sms_ok: number }>();
  return c.json({ name: user.name, email: user.email, phone: r?.phone ?? null, smsOk: !!r?.sms_ok });
});

app.put('/my/profile', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json<{ name?: string; phone?: string | null; smsOk?: boolean }>();
  const name = str(body.name, 'Your name').slice(0, 80);
  const phone = phoneOf(body.phone, 'Phone number');
  await c.env.DB.prepare('UPDATE users SET name = ?, phone = ?, sms_ok = ? WHERE id = ?').bind(name, phone, phone && body.smsOk ? 1 : 0, user.id).run();
  return c.json({ ok: true, phone });
});

/** The member's own subscribe link, and a way to make a new one. */
const calendarUrl = (c: C, token: string) => `${new URL(c.req.url).origin}/api/calendar/${token}.ics`;
app.get('/my/calendar', async (c) => c.json({ url: calendarUrl(c, await calendarToken(c.env.DB, requireUser(c).id)) }));
app.post('/my/calendar/reset', async (c) => c.json({ url: calendarUrl(c, await resetCalendarToken(c.env.DB, requireUser(c).id)) }));

// ---------- your account: export and delete your own data ----------

/** Everything we hold about you, as JSON, so you can keep a copy. */
app.get('/my/data', async (c) => {
  const user = requireUser(c);
  const db = c.env.DB;
  const q = (sql: string) => db.prepare(sql).bind(user.id).all().then((r) => r.results);
  const [profile, identities, leagues, links, rounds, inRounds, submissions] = await Promise.all([
    db.prepare('SELECT id, email, name, phone, sms_ok, created_at, last_login_at FROM users WHERE id = ?').bind(user.id).first(),
    q('SELECT provider FROM user_identities WHERE user_id = ?'),
    q("SELECT l.name, m.role FROM league_members m JOIN leagues l ON l.id = m.league_id WHERE m.user_id = ?"),
    q('SELECT season_id, player_id FROM player_accounts WHERE user_id = ?'),
    q('SELECT id, played_on, course_name, tee, par, holes, notes, stats FROM rounds WHERE user_id = ?'),
    q('SELECT round_id, idx, name, holes FROM round_players WHERE user_id = ?'),
    q('SELECT season_id, week, team_a, team_b, cards, updated_at FROM submissions WHERE user_id = ?'),
  ]);
  c.header('Content-Disposition', 'attachment; filename="my-golf-data.json"');
  c.header('Cache-Control', 'no-store');
  return c.json({ exportedAt: new Date().toISOString(), profile, identities, leagues, playerLinks: links, rounds, roundsImIn: inRounds, matchCards: submissions });
});

/** Delete your account and everything tied to it. Rounds others started keep your name but lose the link. */
app.delete('/my/account', async (c) => {
  const user = requireUser(c);
  const db = c.env.DB;
  const id = user.id;
  // Explicit child deletes (robust whether or not D1 enforces foreign keys this request), children first.
  await db.batch([
    db.prepare('DELETE FROM round_players WHERE round_id IN (SELECT id FROM rounds WHERE user_id = ?)').bind(id),
    db.prepare('UPDATE round_players SET user_id = NULL WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM rounds WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM submissions WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM posts WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM player_accounts WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM league_members WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM user_identities WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
    db.prepare("INSERT INTO audit_log (action, detail) VALUES ('account deleted', ?)").bind(JSON.stringify({ account: id })),
  ]);
  for (const v of signOutCookies()) c.header('Set-Cookie', v, { append: true });
  return c.json({ ok: true });
});

// ---------- push notifications ----------

app.get('/push/key', (c) => c.json({ key: vapidPublicKey(c.env), configured: !!c.env.VAPID_JWK }));

app.post('/push/subscribe', async (c) => {
  const user = requireUser(c);
  const { endpoint, keys } = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>();
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new BadRequest('Invalid subscription');
  await saveSubscription(c.env.DB, user.id, str(endpoint, 'endpoint').slice(0, 1000), keys.p256dh, keys.auth);
  return c.json({ ok: true });
});

app.post('/push/unsubscribe', async (c) => {
  requireUser(c);
  const { endpoint } = await c.req.json<{ endpoint?: string }>();
  if (endpoint) await removeSubscription(c.env.DB, endpoint);
  return c.json({ ok: true });
});

/** The device's service worker fetches queued notifications here when a push wakes it. */
app.get('/push/pending', async (c) => c.json(await pendingNotifications(c.env.DB, requireUser(c).id)));

app.post('/push/test', async (c) => {
  const user = requireUser(c);
  await notify(c.env.DB, c.env, bg(c), [user.id], { title: BRAND.name, body: 'Test notification — it works!', url: '/' });
  return c.json({ ok: true, configured: !!c.env.VAPID_JWK });
});

/** Daily match-day reminders, triggered by a scheduled GitHub Action with the shared secret. */
app.post('/cron/reminders', async (c) => {
  if (!c.env.CRON_SECRET || c.req.header('X-Cron-Key') !== c.env.CRON_SECRET) return c.json({ error: 'Not allowed' }, 403);
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await c.env.DB.prepare('SELECT season_id, number FROM weeks WHERE date = ?').bind(today).all<{ season_id: number; number: number }>();
  let sent = 0;
  for (const w of results) {
    const data = await loadSeason(c.env.DB, w.season_id);
    const week = data?.weeks.find((x) => x.number === w.number);
    if (!data || !week || !week.matches.length) continue;
    const playerIds = [...new Set(week.matches.flatMap((m) => matchPlayerIds(data, week, m).flat()))];
    const users = await usersForPlayers(c.env.DB, w.season_id, playerIds);
    await notify(c.env.DB, c.env, bg(c), users, { title: 'Match today', body: 'You have a league match today. Good luck!', url: '/play' });
    sent += users.length;
  }
  return c.json({ ok: true, sent });
});

// ---------- message board (each league has its own) ----------

app.get('/board', async (c) => c.json(await listPosts(c.env.DB, leagueParam(c, c.req.query('league')))));

app.post('/board', async (c) => {
  const body = await c.req.json<{ body?: string; parentId?: number | null; leagueId?: number }>();
  const leagueId = leagueParam(c, body.leagueId);
  const user = requireUser(c);
  const text = str(body.body, 'Message');
  if (text.length > 2000) throw new BadRequest('Keep messages under 2,000 characters');
  try {
    const id = await addPost(c.env.DB, leagueId, user.id, text, body.parentId == null ? null : int(body.parentId, 'post'));
    const members = (await leagueMemberIds(c.env.DB, leagueId)).filter((uid) => uid !== user.id);
    await notify(c.env.DB, c.env, bg(c), members, { title: 'Message board', body: `${shortName(user.name, user.email)}: ${text}`, url: '/board' });
    return c.json({ id });
  } catch (e) {
    if ((e as Error).message === 'not found') throw new BadRequest('That post was deleted');
    throw e;
  }
});

/** Authors can delete their own posts; the league's admins can delete any (replies go with their post). */
app.delete('/board/:id', async (c) => {
  const id = int(c.req.param('id'), 'post');
  const post = await postInfo(c.env.DB, id);
  if (!post) return c.json({ ok: true });
  if (!roleIn(c, post.leagueId)) throw notInLeague(c);
  if (post.userId !== c.var.user?.id && !isLeagueAdmin(c, post.leagueId)) throw new Forbidden('You can only delete your own posts');
  await c.env.DB.prepare('DELETE FROM posts WHERE id = ? OR parent_id = ?').bind(id, id).run();
  return c.json({ ok: true });
});

app.put('/board/:id/pin', async (c) => {
  const id = int(c.req.param('id'), 'post');
  const post = await postInfo(c.env.DB, id);
  if (!post || !isLeagueAdmin(c, post.leagueId)) throw new Forbidden('Only the league’s admins can pin posts');
  const { pinned } = await c.req.json<{ pinned?: boolean }>();
  await c.env.DB.prepare('UPDATE posts SET pinned = ? WHERE id = ? AND parent_id IS NULL').bind(pinned ? 1 : 0, id).run();
  return c.json({ ok: true });
});

app.get('/my/rounds', async (c) => c.json(await listRounds(c.env.DB, requireUser(c).id)));

app.post('/my/rounds', async (c) => {
  const id = await saveRound(c.env.DB, requireUser(c).id, await validateRound(c.env.DB, await c.req.json<Round>()));
  return c.json({ id });
});

/** A round you started or are playing in. */
app.get('/my/rounds/:id', async (c) => {
  const round = await getRound(c.env.DB, int(c.req.param('id'), 'round'), requireUser(c).id);
  return round ? c.json(round) : c.json({ error: 'Round not found' }, 404);
});

app.put('/my/rounds/:id', async (c) => {
  const round = { ...(await validateRound(c.env.DB, await c.req.json<Round>())), id: int(c.req.param('id'), 'round') };
  try {
    await saveRound(c.env.DB, requireUser(c).id, round);
  } catch {
    return c.json({ error: 'Round not found' }, 404);
  }
  return c.json({ id: round.id });
});

/** Anyone in the round can enter a score for anyone in it, one hole at a time. */
async function scoreFor(db: D1Database, round: Round | null, body: { idx?: unknown; hole?: unknown; score?: unknown }) {
  if (!round) throw new AccountError('Round not found', 403);
  const idx = int(body.idx, 'player');
  const hole = int(body.hole, 'hole');
  const score = int(body.score ?? 0, 'score');
  if (idx !== 0 && !round.players.some((p) => p.idx === idx)) throw new BadRequest('That player isn’t in the round');
  if (hole < 0 || hole >= round.par.length || score < 0 || score > 20) throw new BadRequest('Score must be 1–20 (0 to clear)');
  await setScore(db, round.id!, idx, hole, score);
}

async function wolfFor(db: D1Database, round: Round | null, body: { hole?: unknown; choice?: unknown }) {
  if (!round) throw new AccountError('Round not found', 403);
  const hole = int(body.hole, 'hole');
  const choice = body.choice == null ? null : body.choice === 'lone' ? 'lone' : int(body.choice, 'partner');
  if (hole < 0 || hole >= round.par.length) throw new BadRequest('No such hole');
  if (typeof choice === 'number' && choice !== 0 && !round.players.some((p) => p.idx === choice)) throw new BadRequest('That player isn’t in the round');
  await setWolf(db, round.id!, hole, choice);
}

app.put('/my/rounds/:id/score', async (c) => {
  await scoreFor(c.env.DB, await getRound(c.env.DB, int(c.req.param('id'), 'round'), requireUser(c).id), await c.req.json());
  return c.json({ ok: true });
});

app.put('/my/rounds/:id/wolf', async (c) => {
  await wolfFor(c.env.DB, await getRound(c.env.DB, int(c.req.param('id'), 'round'), requireUser(c).id), await c.req.json());
  return c.json({ ok: true });
});

/** A link for a guest without an account to open this round (the round's owner). */
app.post('/my/rounds/:id/players/:idx/link', async (c) => {
  const round = await getRound(c.env.DB, int(c.req.param('id'), 'round'), requireUser(c).id);
  if (!round || round.me !== 0) throw new Forbidden('Only the player who started the round can share it');
  const idx = int(c.req.param('idx'), 'player');
  if (!round.players.some((p) => p.idx === idx)) throw new BadRequest('That player isn’t in the round');
  return c.json({ url: `${new URL(c.req.url).origin}/g/${await guestLink(c.env.DB, round.id!, idx)}` });
});

/** People from your leagues to add to a round. */
app.get('/my/golfers', async (c) => c.json(await golfers(c.env.DB, requireUser(c).id, c.var.leagues.map((l) => l.id))));

/** Find a registered player by their exact email address. */
app.post('/my/golfers/find', async (c) => {
  requireUser(c);
  const { email } = await c.req.json<{ email?: string }>();
  const found = await golferByEmail(c.env.DB, emailOf(email));
  return found ? c.json(found) : c.json({ error: 'No account uses that email. Add them as a guest instead.' }, 404);
});

// ---------- guests: a link to one round, no account needed ----------

const guest = async (c: C) => {
  const round = await guestRound(c.env.DB, c.req.param('token') ?? '');
  if (!round) throw new AccountError('This link has expired. Ask the player who started the round for a new one.', 404);
  return round;
};

app.get('/guest/:token', async (c) => c.json(await guest(c)));

app.put('/guest/:token/score', async (c) => {
  await scoreFor(c.env.DB, await guest(c), await c.req.json());
  return c.json({ ok: true });
});

app.put('/guest/:token/wolf', async (c) => {
  await wolfFor(c.env.DB, await guest(c), await c.req.json());
  return c.json({ ok: true });
});

/** A friend takes a round someone else started off their own list (the starter keeps it). */
app.delete('/my/rounds/:id/me', async (c) => {
  await c.env.DB.prepare('UPDATE round_players SET user_id = NULL WHERE round_id = ? AND user_id = ?').bind(int(c.req.param('id'), 'round'), requireUser(c).id).run();
  return c.json({ ok: true });
});

app.delete('/my/rounds/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM rounds WHERE id = ? AND user_id = ?').bind(int(c.req.param('id'), 'round'), requireUser(c).id).run();
  return c.json({ ok: true });
});

// Course lookup for signed-in players and admins (proxied so the provider's API key never reaches the browser).
app.get('/courses/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 3) throw new BadRequest('Type at least 3 letters of the course name');
  return c.json(await searchCourses(c.env, q.slice(0, 100)));
});

app.get('/courses/:id', async (c) => c.json(await getCourse(c.env, c.req.param('id'))));

// ---------- admin ----------

// Each admin route checks that you run the league it touches (super admins run them all).
app.use('/admin/*', async (c, next) => {
  if (!c.var.user && !c.var.superAdmin) return c.json({ error: 'Not signed in' }, 401);
  if (!c.var.superAdmin && !c.var.leagues.some((l) => l.role === 'admin')) return c.json({ error: 'Your account is not an admin' }, 403);
  await next();
});

/**
 * Create a season: a full import document, or `{ name, copyFrom }` to start a new year from an old
 * roster, optionally with the season's course (`nines`) and a generated `schedule`.
 */
app.post('/admin/seasons', async (c) => {
  const body = await c.req.json<
    Partial<SeasonData> & { name?: string; copyFrom?: number; makeCurrent?: boolean; schedule?: SchedulePlan; leagueId?: number; format?: string }
  >();
  if (body.format !== undefined && !isFormat(body.format)) throw new BadRequest('Unknown format');
  const leagueId = adminLeague(c, body.leagueId);
  if (body.copyFrom && (await seasonLeague(c.env.DB, int(body.copyFrom, 'season'))) !== leagueId) throw new BadRequest('Season to copy not found');
  let data: SeasonData;
  if (body.weeks || body.players) {
    data = validateSeason(body);
  } else {
    const name = str(body.name, 'name');
    const from = body.copyFrom ? await loadSeason(c.env.DB, body.copyFrom) : null;
    if (body.copyFrom && !from) throw new BadRequest('Season to copy not found');
    const result = from ? computeSeason(from) : null;
    const nines = body.nines ? validateNines(body.nines) : (from?.nines ?? []);
    const settings = { ...(from?.settings ?? {}), ...(body.format ? { format: body.format as Settings['format'] } : {}) };
    // Carry each player's current handicap forward as next season's starting handicap.
    let players = from?.players.map((p) => ({ ...p, startingHc: result!.handicaps.get(p.id)!.current })) ?? [];
    let teams = from?.teams ?? [];
    if (formatInfo(normalizeSeason({ settings }).settings).individual) ({ teams, players } = individualTeams(players));
    data = normalizeSeason({ season: { name }, settings, nines, teams, players, weeks: [] });
    if (body.schedule) data.weeks = scheduleFor(data, validatePlan(body.schedule, nines)).map((w) => ({ ...w, scores: [] }));
  }
  if (formatInfo(data.settings).individual) Object.assign(data, individualTeams(data.players));
  const id = await insertSeason(c.env.DB, leagueId, data, body.makeCurrent !== false);
  const stmts = touch(c.env.DB, id, 'create season', { name: data.season.name, weeks: data.weeks.length });
  // Keep hand-made account links for the copied players.
  if (body.copyFrom && !body.players) {
    stmts.push(c.env.DB.prepare('INSERT INTO player_accounts (season_id, player_id, user_id) SELECT ?, player_id, user_id FROM player_accounts WHERE season_id = ?').bind(id, body.copyFrom));
  } else if (body.players) {
    // An imported season gets new player ids: match players to the league's earlier seasons by name
    // so their sign-in emails and account links carry over (the most recent season wins).
    const sameLeague = `IN (SELECT id FROM seasons WHERE league_id = ${leagueId} AND id != ?1)`;
    stmts.push(
      c.env.DB.prepare(
        `UPDATE players SET
           email = COALESCE(email, (SELECT p2.email FROM players p2 WHERE lower(p2.name) = lower(players.name) AND p2.season_id != ?1
             AND p2.season_id ${sameLeague} AND p2.email IS NOT NULL ORDER BY p2.season_id DESC LIMIT 1)),
           phone = COALESCE(phone, (SELECT p2.phone FROM players p2 WHERE lower(p2.name) = lower(players.name) AND p2.season_id != ?1
             AND p2.season_id ${sameLeague} AND p2.phone IS NOT NULL ORDER BY p2.season_id DESC LIMIT 1))
         WHERE season_id = ?1`,
      ).bind(id),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO player_accounts (season_id, player_id, user_id)
         SELECT ?1, p.id, pa.user_id FROM players p
         JOIN players p2 ON lower(p2.name) = lower(p.name) AND p2.season_id ${sameLeague}
         JOIN player_accounts pa ON pa.season_id = p2.season_id AND pa.player_id = p2.id
         WHERE p.season_id = ?1 AND pa.user_id NOT IN (SELECT user_id FROM player_accounts WHERE season_id = ?1)
         ORDER BY p2.season_id DESC`,
      ).bind(id),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ id });
});

const hasScores = async (db: D1Database, id: number) => !!(await db.prepare('SELECT 1 FROM scores WHERE season_id = ? LIMIT 1').bind(id).first());

app.put('/admin/seasons/:id', async (c) => {
  const id = await seasonParam(c);
  const body = await c.req.json<{
    name?: string;
    settings?: Partial<Settings>;
    nines?: Nine[];
    /** Changing the course: weeks played on a removed nine move to its replacement, { oldId: newId }. */
    replaceNines?: Record<string, string>;
    isCurrent?: boolean;
  }>();
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];
  if (body.name !== undefined) stmts.push(db.prepare('UPDATE seasons SET name = ? WHERE id = ?').bind(str(body.name, 'name'), id));
  if (body.settings) {
    const settings = validateSettings(body.settings);
    const current = (await loadSeason(db, id))!;
    const before = formatInfo(current.settings);
    const after = formatInfo(settings);
    if (before.id !== after.id) {
      if (await hasScores(db, id)) throw new BadRequest('The format can’t change once scores are entered. Start a new season instead.');
      // Head-to-head and field formats (or teams and individuals) need a different schedule.
      if (before.field !== after.field || before.individual !== after.individual) {
        stmts.push(...['submissions', 'matches'].map((t) => db.prepare(`DELETE FROM ${t} WHERE season_id = ?`).bind(id)));
      }
      if (after.individual) {
        const { teams, players } = individualTeams(current.players);
        stmts.push(...rosterStatements(db, id, teams, players));
      }
    }
    stmts.push(db.prepare('UPDATE seasons SET settings = ? WHERE id = ?').bind(JSON.stringify(settings), id));
  }
  // Admins can change the course at any time; every result is recalculated from the new scorecard.
  if (body.nines) {
    const nines = validateNines(body.nines);
    const ids = new Set(nines.map((n) => n.id));
    const replace = body.replaceNines ?? {};
    for (const [from, to] of Object.entries(replace)) {
      if (!ids.has(to)) throw new BadRequest(`The replacement for ${from} isn’t one of the season’s nines`);
      stmts.push(db.prepare('UPDATE weeks SET nine_id = ? WHERE season_id = ? AND nine_id = ?').bind(to, id, from));
    }
    // Every week must still be played on one of the course's nines.
    const { results } = await db.prepare('SELECT number, nine_id FROM weeks WHERE season_id = ? ORDER BY number').bind(id).all<{ number: number; nine_id: string }>();
    const orphan = results.find((w) => !ids.has(replace[w.nine_id] ?? w.nine_id));
    if (orphan) throw new BadRequest(`Week ${orphan.number} is played on a nine you removed. Choose which nine replaces it.`);
    stmts.push(db.prepare('UPDATE seasons SET nines = ? WHERE id = ?').bind(JSON.stringify(nines), id));
  }
  if (body.isCurrent) stmts.push(...currentStatements(c.env.DB, id));
  await c.env.DB.batch([...stmts, ...touch(c.env.DB, id, 'update season', Object.keys(body))]);
  return c.json({ ok: true });
});

app.delete('/admin/seasons/:id', async (c) => {
  const id = await seasonParam(c);
  const db = c.env.DB;
  await db.batch([
    ...SEASON_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE season_id = ?`).bind(id)),
    db.prepare('DELETE FROM seasons WHERE id = ?').bind(id),
    db.prepare('INSERT INTO audit_log (season_id, action) VALUES (?, ?)').bind(id, 'delete season'),
  ]);
  return c.json({ ok: true });
});

/** Replace the whole schedule with a generated one. Only before any scores are entered. */
app.post('/admin/seasons/:id/schedule', async (c) => {
  const id = await seasonParam(c);
  const db = c.env.DB;
  if (await hasScores(db, id)) throw new BadRequest('Scores have been entered, so the schedule can only be edited week by week');
  const data = (await loadSeason(db, id))!;
  const weeks = scheduleFor(data, validatePlan(await c.req.json<SchedulePlan>(), data.nines));
  await db.batch([
    ...['submissions', 'matches', 'weeks'].map((t) => db.prepare(`DELETE FROM ${t} WHERE season_id = ?`).bind(id)),
    ...weeks.flatMap((w) => weekStatements(db, id, w)),
    ...touch(db, id, 'generate schedule', { weeks: weeks.length }),
  ]);
  return c.json({ ok: true, weeks: weeks.length });
});

app.put('/admin/seasons/:id/roster', async (c) => {
  const id = await seasonParam(c);
  const body = await c.req.json<{ teams: Team[]; players: Player[] }>();
  const season = await c.env.DB.prepare('SELECT settings FROM seasons WHERE id = ?').bind(id).first<{ settings: string }>();
  const individual = formatInfo(normalizeSeason({ settings: JSON.parse(season!.settings) }).settings).individual;
  // Individual formats: every player is their own team, kept in step with the player list.
  let teams = individual ? [] : validateTeams(body.teams);
  let players = validatePlayers(individual ? body.players.map((p) => ({ ...p, teamId: null })) : body.players, teams);
  if (individual) ({ teams, players } = individualTeams(players));
  await c.env.DB.batch([...rosterStatements(c.env.DB, id, teams, players), ...touch(c.env.DB, id, 'update roster')]);
  return c.json({ ok: true });
});

app.put('/admin/seasons/:id/weeks/:n', async (c) => {
  const id = await seasonParam(c);
  const number = int(c.req.param('n'), 'week');
  const body = await c.req.json<{ date?: string; nineId: string; playoff?: boolean; inclement?: boolean; matches: Match[] }>();
  const week = {
    number,
    date: body.date || null,
    nineId: str(body.nineId, 'nineId'),
    playoff: !!body.playoff,
    inclement: !!body.inclement,
    matches: validateMatches(body.matches),
  };
  await c.env.DB.batch([...weekStatements(c.env.DB, id, week), ...touch(c.env.DB, id, 'update week', { week: number })]);
  return c.json({ ok: true });
});

app.delete('/admin/seasons/:id/weeks/:n', async (c) => {
  const id = await seasonParam(c);
  const n = int(c.req.param('n'), 'week');
  const db = c.env.DB;
  await db.batch([
    ...['submissions', 'scores', 'matches'].map((t) => db.prepare(`DELETE FROM ${t} WHERE season_id = ? AND week = ?`).bind(id, n)),
    db.prepare('DELETE FROM weeks WHERE season_id = ? AND number = ?').bind(id, n),
    ...touch(db, id, 'delete week', { week: n }),
  ]);
  return c.json({ ok: true });
});

/** Replace all scores for a week (the score-entry screen owns the whole week). */
app.put('/admin/seasons/:id/weeks/:n/scores', async (c) => {
  const id = await seasonParam(c);
  const n = int(c.req.param('n'), 'week');
  const body = await c.req.json<{ scores: Score[]; matches?: Match[] }>();
  const scores = validateScores(body.scores);
  const db = c.env.DB;
  const exists = await db.prepare('SELECT 1 FROM weeks WHERE season_id = ? AND number = ?').bind(id, n).first();
  if (!exists) throw new BadRequest(`Week ${n} is not on the schedule`);
  const stmts = scoreStatements(db, id, n, scores);
  // Forfeit overrides are edited on the same screen.
  for (const [idx, m] of (body.matches ?? []).entries()) {
    stmts.push(
      db
        .prepare('UPDATE matches SET override_a = ?, override_b = ? WHERE season_id = ? AND week = ? AND idx = ?')
        .bind(m.pointsOverride?.[0] ?? null, m.pointsOverride?.[1] ?? null, id, n, idx),
    );
  }
  await db.batch([...stmts, ...touch(db, id, 'enter scores', { week: n, count: scores.length })]);
  return c.json({ ok: true });
});

/** Player-entered cards for each match of a week, and whether they agree. */
app.get('/admin/seasons/:id/weeks/:n/submissions', async (c) => {
  const id = await seasonParam(c);
  const n = int(c.req.param('n'), 'week');
  const data = (await loadSeason(c.env.DB, id))!;
  const week = data.weeks.find((w) => w.number === n);
  if (!week) throw new BadRequest(`Week ${n} is not on the schedule`);
  const out = [];
  for (const m of week.matches) {
    const subs = await loadSubmissions(c.env.DB, id, n, m.teamA, m.teamB);
    out.push({ teamA: m.teamA, teamB: m.teamB, consensus: consensus(subs, m.teamA, m.teamB), submissions: subs });
  }
  return c.json(out);
});

/** Matches with player cards that aren't official yet (one team only, or cards that differ). */
async function pendingCards(db: D1Database, seasonId: number) {
  const data = await loadSeason(db, seasonId);
  if (!data) return [];
  const { results } = await db.prepare('SELECT DISTINCT week, team_a, team_b FROM submissions WHERE season_id = ? ORDER BY week').bind(seasonId).all<{ week: number; team_a: number; team_b: number }>();
  const out = [] as { week: number; teamA: number; teamB: number; status: string; missingTeams: number[]; names: (string | null)[] }[];
  for (const r of results) {
    const week = data.weeks.find((w) => w.number === r.week);
    const match = week?.matches.find((m) => m.teamA === r.team_a && m.teamB === r.team_b);
    if (!week || !match || match.pointsOverride) continue;
    const ids = matchPlayerIds(data, week, match).flat();
    if (ids.every((pid) => week.scores.some((s) => s.playerId === pid))) continue; // already official
    const subs = await loadSubmissions(db, seasonId, r.week, r.team_a, r.team_b);
    const result = consensus(subs, r.team_a, r.team_b);
    out.push({ week: r.week, teamA: r.team_a, teamB: r.team_b, status: result.status, missingTeams: result.missingTeams, names: subs.map((s) => s.name) });
  }
  return out;
}

app.get('/admin/seasons/:id/pending-cards', async (c) => c.json(await pendingCards(c.env.DB, await seasonParam(c))));

/**
 * What's waiting on a league admin right now, for the nudge badges: match cards to finalise, people
 * asking to join, and approved members not yet linked to a roster player.
 */
app.get('/admin/leagues/:lid/todo', async (c) => {
  const leagueId = adminLeague(c, c.req.param('lid'));
  const db = c.env.DB;
  const q = c.req.query('season');
  const seasonId = q ? int(q, 'season') : await currentSeasonId(db, leagueId);
  if (seasonId != null && (await seasonLeague(db, seasonId)) !== leagueId) throw new BadRequest('Season not found');
  const accounts = await listAccounts(db, leagueId, seasonId, true);
  const requests = accounts.filter((a) => a.leagueRole === 'requested').length;
  const unlinked = accounts.filter((a) => a.status === 'active' && a.leagueRole === 'member' && a.playerId == null && a.id !== c.var.user?.id).length;
  const scores = seasonId != null ? (await pendingCards(db, seasonId)).length : 0;
  return c.json({ scores, requests, unlinked, total: scores + requests + unlinked });
});

/** Make one player-entered card the official scores for its match (e.g. only one team sent a card). */
app.post('/admin/seasons/:id/weeks/:n/accept', async (c) => {
  const id = await seasonParam(c);
  const n = int(c.req.param('n'), 'week');
  const body = await c.req.json<{ teamA: number; teamB: number; userId: number }>();
  const db = c.env.DB;
  const data = (await loadSeason(db, id))!;
  const week = data.weeks.find((w) => w.number === n);
  const match = week?.matches.find((m) => m.teamA === int(body.teamA, 'team') && m.teamB === int(body.teamB, 'team'));
  if (!week || !match) throw new BadRequest('That match is not on the schedule');
  const card = (await loadSubmissions(db, id, n, match.teamA, match.teamB)).find((s) => s.userId === int(body.userId, 'account'));
  if (!card) throw new BadRequest('That card was not found. Reload the page.');
  // The roster may have changed since the card was entered: it must still cover the match's players.
  const cards = validateCards(card.cards, matchPlayerIds(data, week, match).flat(), data.players);
  await db.batch([
    ...cards.map((cd) => upsertScoreStatement(db, id, n, { playerId: cd.playerId, holes: cd.holes, virtual: cd.absent, dnf: cd.dnf })),
    ...touch(db, id, 'accept player card', { week: n, teams: [match.teamA, match.teamB], from: card.name }),
  ]);
  return c.json({ ok: true });
});

/** Rained out: move a week and every later week back by `days` (7 by default; -7 undoes it). */
app.post('/admin/seasons/:id/shift', async (c) => {
  const id = await seasonParam(c);
  const body = await c.req.json<{ fromWeek: number; days?: number }>();
  const from = int(body.fromWeek, 'week');
  const days = body.days === undefined ? 7 : int(body.days, 'days');
  if (Math.abs(days) > 60 || days === 0) throw new BadRequest('Move the schedule by 1–60 days');
  const db = c.env.DB;
  const res = await db
    .prepare("UPDATE weeks SET date = date(date, ? || ' days') WHERE season_id = ? AND number >= ? AND date IS NOT NULL")
    .bind(days > 0 ? `+${days}` : String(days), id, from)
    .run();
  await db.batch(touch(db, id, 'shift schedule', { fromWeek: from, days }));
  return c.json({ ok: true, weeks: res.meta.changes });
});

/**
 * Everyone on a season's roster with the best known email and phone: the player's own account
 * (My profile) first, then what an admin typed on the roster.
 */
app.get('/admin/seasons/:id/contacts', async (c) => {
  const id = await seasonParam(c);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.team_id, p.active, p.email AS roster_email, p.phone AS roster_phone,
            u.id AS user_id, u.email AS user_email, u.phone AS user_phone, u.sms_ok
     FROM players p
     LEFT JOIN users u ON u.status = 'active' AND u.id = COALESCE(
       (SELECT user_id FROM player_accounts pa WHERE pa.season_id = p.season_id AND pa.player_id = p.id),
       (SELECT id FROM users v WHERE v.email_verified = 1 AND v.email = lower(p.email)))
     WHERE p.season_id = ? ORDER BY p.team_id, p.id`,
  )
    .bind(id)
    .all<Record<string, never>>();
  return c.json(
    results.map((r) => ({
      playerId: r.id,
      name: r.name,
      teamId: r.team_id,
      active: !!r.active,
      hasAccount: r.user_id != null,
      email: r.user_email ?? r.roster_email ?? null,
      phone: r.user_phone ?? r.roster_phone ?? null,
      smsOk: !!r.sms_ok && r.user_phone != null,
    })),
  );
});

/** People in a league (or, for super admins with `all`, every account on the site). */
app.get('/admin/accounts', async (c) => {
  const leagueId = adminLeague(c, c.req.query('league'));
  const q = c.req.query('season');
  const seasonId = q ? int(q, 'season') : await currentSeasonId(c.env.DB, leagueId);
  if (seasonId != null && (await seasonLeague(c.env.DB, seasonId)) !== leagueId) throw new BadRequest('Season not found');
  const all = c.var.superAdmin && c.req.query('all') !== undefined;
  return c.json(await listAccounts(c.env.DB, leagueId, seasonId, !all));
});

/**
 * Site-wide account changes, for super admins: super admin access, permission to start leagues,
 * approving or turning off an account. League admins approve people through their league instead.
 */
app.put('/admin/accounts/:id', async (c) => {
  if (!c.var.superAdmin) throw new Forbidden('Only site admins can change that');
  const id = int(c.req.param('id'), 'account');
  const { isAdmin, status, canCreateLeagues } = await c.req.json<{ isAdmin?: boolean; status?: UserStatus; canCreateLeagues?: boolean }>();
  const self = c.var.user?.id === id;
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];
  if (canCreateLeagues !== undefined) {
    stmts.push(
      db.prepare('UPDATE users SET can_create_leagues = ? WHERE id = ?').bind(canCreateLeagues ? 1 : 0, id),
      db.prepare('INSERT INTO audit_log (action, detail) VALUES (?, ?)').bind(canCreateLeagues ? 'allow starting leagues' : 'stop starting leagues', JSON.stringify({ account: id })),
    );
  }
  if (isAdmin !== undefined) {
    if (!isAdmin && self) throw new BadRequest("You can't remove your own admin access");
    stmts.push(
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(isAdmin ? 1 : 0, id),
      db.prepare('INSERT INTO audit_log (action, detail) VALUES (?, ?)').bind(isAdmin ? 'grant admin' : 'remove admin', JSON.stringify({ account: id })),
    );
  }
  if (status !== undefined) {
    if (!['active', 'disabled'].includes(status)) throw new BadRequest('status must be active or disabled');
    if (status === 'disabled' && self) throw new BadRequest("You can't turn off your own account");
    stmts.push(
      db.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id),
      db.prepare('INSERT INTO audit_log (action, detail) VALUES (?, ?)').bind(status === 'active' ? 'approve account' : 'turn off account', JSON.stringify({ account: id })),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return c.json({ ok: true });
});

/** Link an account to a roster player by hand (or unlink with playerId null). */
app.put('/admin/seasons/:id/links', async (c) => {
  const id = await seasonParam(c);
  const body = await c.req.json<{ userId: number; playerId: number | null }>();
  const userId = int(body.userId, 'account');
  const db = c.env.DB;
  const stmts = [db.prepare('DELETE FROM player_accounts WHERE season_id = ? AND user_id = ?').bind(id, userId)];
  if (body.playerId != null) {
    const playerId = int(body.playerId, 'player');
    stmts.push(
      // Someone who asked to join is in once they're on the roster.
      db.prepare("UPDATE league_members SET role = 'member' WHERE league_id = (SELECT league_id FROM seasons WHERE id = ?) AND user_id = ? AND role = 'requested'").bind(id, userId),
      db.prepare('DELETE FROM player_accounts WHERE season_id = ? AND player_id = ?').bind(id, playerId),
      db.prepare('INSERT INTO player_accounts (season_id, player_id, user_id) VALUES (?, ?, ?)').bind(id, playerId, userId),
    );
  }
  await db.batch([...stmts, ...touch(db, id, 'link account', { account: userId, player: body.playerId })]);
  return c.json({ ok: true });
});

app.get('/admin/audit', async (c) => {
  const leagueId = adminLeague(c, c.req.query('league'));
  const { results } = await c.env.DB.prepare('SELECT * FROM audit_log WHERE league_id = ? ORDER BY id DESC LIMIT 200').bind(leagueId).all();
  return c.json(results);
});

// ---------- running a league ----------

/** The league's name, invite code, admins, members who aren't on a roster, and requests to join. */
app.get('/admin/leagues/:lid', async (c) => {
  const id = adminLeague(c, c.req.param('lid'));
  const db = c.env.DB;
  const [league, members] = await db.batch([
    db.prepare('SELECT id, name, join_code FROM leagues WHERE id = ?').bind(id),
    db.prepare(
      `SELECT m.user_id, m.role, m.created_at, u.name, u.email, u.status FROM league_members m JOIN users u ON u.id = m.user_id
       WHERE m.league_id = ? ORDER BY m.role = 'requested' DESC, u.name COLLATE NOCASE`,
    ).bind(id),
  ]);
  const l = league.results[0] as { id: number; name: string; join_code: string };
  return c.json({
    id: l.id,
    name: l.name,
    joinCode: l.join_code,
    members: (members.results as Record<string, never>[]).map((m) => ({
      userId: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      pendingAccount: m.status === 'pending',
      since: m.created_at,
    })),
  });
});

app.put('/admin/leagues/:lid', async (c) => {
  const id = adminLeague(c, c.req.param('lid'));
  const { name } = await c.req.json<{ name?: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE leagues SET name = ? WHERE id = ?').bind(str(name, 'League name').slice(0, 80), id),
    c.env.DB.prepare("INSERT INTO audit_log (league_id, action, detail) VALUES (?, 'rename league', ?)").bind(id, JSON.stringify({ name })),
  ]);
  return c.json({ ok: true });
});

/** A new invite link; the old one stops working. */
app.post('/admin/leagues/:lid/join-code', async (c) => c.json({ joinCode: await newJoinCode(c.env.DB, adminLeague(c, c.req.param('lid'))) }));

/**
 * Approve a request to join (role member), make someone a league admin, or remove them from the
 * league's member list (role null). Approving also turns on an email/password account that's waiting.
 */
app.put('/admin/leagues/:lid/members/:uid', async (c) => {
  const id = adminLeague(c, c.req.param('lid'));
  const userId = int(c.req.param('uid'), 'account');
  const { role } = await c.req.json<{ role?: 'member' | 'admin' | null }>();
  if (role != null && role !== 'member' && role !== 'admin') throw new BadRequest('role must be member or admin');
  const db = c.env.DB;
  if (!(await inLeague(db, id, userId))) throw new BadRequest('That person isn’t in this league');
  if (userId === c.var.user?.id && role !== 'admin' && !c.var.superAdmin) throw new BadRequest('You can’t remove your own admin access');
  await db.batch([
    role
      ? db.prepare('INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (league_id, user_id) DO UPDATE SET role = excluded.role').bind(id, userId, role)
      : db.prepare('DELETE FROM league_members WHERE league_id = ? AND user_id = ?').bind(id, userId),
    ...(role ? [db.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'").bind(userId)] : []),
    db.prepare('INSERT INTO audit_log (league_id, action, detail) VALUES (?, ?, ?)').bind(id, role ? `league ${role}` : 'remove from league', JSON.stringify({ account: userId })),
  ]);
  return c.json({ ok: true });
});

// ---------- validation ----------

/** A season you run: its league's admins (and super admins) only. */
async function seasonParam(c: C): Promise<number> {
  const id = int(c.req.param('id'), 'season id');
  const leagueId = await seasonLeague(c.env.DB, id);
  if (leagueId == null) throw new BadRequest('Season not found');
  if (!isLeagueAdmin(c, leagueId)) throw new Forbidden('Only this league’s admins can do that');
  return id;
}

/** A league you run: the one asked for, or your only one. */
function adminLeague(c: C, v: unknown): number {
  if (v != null && v !== '') {
    const id = int(v, 'league');
    if (!isLeagueAdmin(c, id)) throw new Forbidden('Only this league’s admins can do that');
    return id;
  }
  const mine = c.var.leagues.filter((l) => l.role === 'admin');
  if (mine.length !== 1) throw new BadRequest('Choose a league');
  return mine[0].id;
}

function int(v: unknown, what: string): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new BadRequest(`${what} must be a whole number`);
  return n;
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new BadRequest(`${what} is required`);
  return v.trim();
}

function ints(v: unknown, what: string, length: number, min: number, max: number): number[] {
  if (!Array.isArray(v) || v.length !== length) throw new BadRequest(`${what} needs ${length} values`);
  return v.map((x) => {
    const n = int(x, what);
    if (n < min || n > max) throw new BadRequest(`${what} values must be ${min}-${max}`);
    return n;
  });
}

const nineInts = (v: unknown, what: string, min: number, max: number) => ints(v, what, 9, min, max);

/** Nine true/false "did not play" flags, or null when none were sent or none are true. */
function nineBools(v: unknown): boolean[] | null {
  if (!Array.isArray(v) || v.length !== 9) return null;
  const flags = v.map(Boolean);
  return flags.some(Boolean) ? flags : null;
}

const isoDate = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new BadRequest(`${what} must be a date`);
  return v;
};

/** Head-to-head formats get round-robin matchups; field formats just get dated weeks. */
function scheduleFor(data: SeasonData, plan: SchedulePlan) {
  if (formatInfo(data.settings).field) return buildSchedule([], plan);
  if (data.teams.length < 2) throw new BadRequest(formatInfo(data.settings).individual ? 'Add at least two players first' : 'Add at least two teams first');
  return buildSchedule(data.teams.map((t) => t.id), plan);
}

function validateSettings(raw: Partial<Settings>): Settings {
  const s = normalizeSeason({ settings: raw }).settings;
  if (!isFormat(s.format)) throw new BadRequest('Unknown format');
  const list = (v: unknown, what: string, max: number, maxLen: number) => {
    if (!Array.isArray(v) || !v.length || v.length > maxLen) throw new BadRequest(`${what} needs 1–${maxLen} values`);
    return v.map((x) => {
      const n = int(x, what);
      if (n < 0 || n > max) throw new BadRequest(`${what} values must be 0–${max}`);
      return n;
    });
  };
  return { ...s, absentRule: s.absentRule === 'bestBall' ? 'bestBall' : 'virtual', stableford: ints(s.stableford, 'Stableford points', 6, 0, 20), scramblePercents: list(s.scramblePercents, 'Scramble percentages', 100, 8) };
}

function validateNines(nines: Nine[]): Nine[] {
  if (!Array.isArray(nines) || !nines.length) throw new BadRequest('At least one nine is required');
  return nines.map((n) => ({
    id: str(n.id, 'nine id'),
    name: str(n.name, 'nine name'),
    par: nineInts(n.par, `${n.name} par`, 3, 6),
    menHcp: nineInts(n.menHcp, `${n.name} men's hole handicaps`, 1, 9),
    womenHcp: nineInts(n.womenHcp, `${n.name} women's hole handicaps`, 1, 9),
    ...(n.course ? { course: String(n.course).trim().slice(0, 120) } : {}),
    ...(n.tee ? { tee: String(n.tee).trim().slice(0, 60) } : {}),
    ...(n.yardage ? { yardage: nineInts(n.yardage, `${n.name} yardage`, 0, 800) } : {}),
    ...(n.firstHole && n.firstHole !== 1 ? { firstHole: int(n.firstHole, 'first hole') } : {}),
    ...(n.source ? { source: String(n.source).slice(0, 120) } : {}),
    ...(n.greens ? { greens: validateGreens(n.greens) } : {}),
  }));
}

/** Nine green points: one entry per hole, each with optional front/center/back [lat, lng]. */
function validateGreens(v: unknown): (import('../../src/engine').HoleGreens | null)[] {
  if (!Array.isArray(v)) throw new BadRequest('greens must be a list');
  const point = (p: unknown): [number, number] => {
    if (!Array.isArray(p) || p.length !== 2) throw new BadRequest('A green point must be [lat, lng]');
    const [lat, lng] = [Number(p[0]), Number(p[1])];
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) throw new BadRequest('Green point out of range');
    return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
  };
  return Array.from({ length: 9 }, (_, i) => {
    const e = v[i] as { f?: unknown; c?: unknown; b?: unknown } | null | undefined;
    if (!e || (e.f == null && e.c == null && e.b == null)) return null;
    const g: import('../../src/engine').HoleGreens = {};
    if (e.f != null) g.f = point(e.f);
    if (e.c != null) g.c = point(e.c);
    if (e.b != null) g.b = point(e.b);
    return g;
  });
}

function validateTeams(teams: Team[]): Team[] {
  if (!Array.isArray(teams)) throw new BadRequest('teams must be a list');
  return teams.map((t) => ({ id: int(t.id, 'team id'), name: str(t.name, 'team name') }));
}

function validatePlayers(players: Player[], teams: Team[]): Player[] {
  if (!Array.isArray(players)) throw new BadRequest('players must be a list');
  const teamIds = new Set(teams.map((t) => t.id));
  return players.map((p) => {
    const teamId = p.teamId == null ? null : int(p.teamId, 'team');
    if (teamId != null && !teamIds.has(teamId)) throw new BadRequest(`${p.name}: unknown team`);
    const email = p.email?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequest(`${p.name}: email doesn't look right`);
    const phone = phoneOf(p.phone, `${p.name}'s phone number`);
    return { id: int(p.id, 'player id'), name: str(p.name, 'player name'), teamId, startingHc: int(p.startingHc ?? 0, 'starting handicap'), redTees: !!p.redTees, active: p.active !== false, email, phone };
  });
}

/** Optional phone number: 10 digits (US) or + and 8–15 digits. Stored as +<digits>. */
function phoneOf(v: unknown, what: string): string | null {
  if (v == null || String(v).trim() === '') return null;
  const raw = String(v).trim();
  const digits = raw.replace(/\D/g, '');
  if (!/^[+\d\s().-]+$/.test(raw)) throw new BadRequest(`${what} doesn't look right`);
  if (!raw.startsWith('+') && digits.length === 10) return `+1${digits}`;
  if (!raw.startsWith('+') && digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  throw new BadRequest(`${what} doesn't look right. Use a 10-digit US number, or + and the country code.`);
}

function validateMatches(matches: Match[]): Match[] {
  if (!Array.isArray(matches)) throw new BadRequest('matches must be a list');
  return matches.map((m) => ({
    slot: m.slot || undefined,
    teeTime: m.teeTime || undefined,
    teamA: int(m.teamA, 'team'),
    teamB: int(m.teamB, 'team'),
    pointsOverride: m.pointsOverride ? [int(m.pointsOverride[0], 'points'), int(m.pointsOverride[1], 'points')] : null,
  }));
}

function validateScores(scores: Score[]): Score[] {
  if (!Array.isArray(scores)) throw new BadRequest('scores must be a list');
  return scores.map((s) => ({
    playerId: int(s.playerId, 'player'),
    virtual: !!s.virtual,
    holes: s.virtual || !s.holes ? null : nineInts(s.holes, 'hole scores', 0, 20),
    dnf: s.virtual ? null : nineBools(s.dnf),
    hc: s.hc == null ? null : int(s.hc, 'handicap'),
  }));
}

/** A player-entered card must cover exactly the match's players, with every hole filled in. */
function validateCards(cards: CardEntry[], playerIds: number[], players: Player[]): CardEntry[] {
  if (!Array.isArray(cards)) throw new BadRequest('cards must be a list');
  const ids = cards.map((cd) => int(cd.playerId, 'player'));
  if (ids.length !== playerIds.length || !playerIds.every((id) => ids.includes(id))) throw new BadRequest('The card must include every player in the match');
  return cards.map((cd) => {
    const name = players.find((p) => p.id === cd.playerId)?.name ?? 'player';
    if (cd.absent) return { playerId: cd.playerId, absent: true, holes: null, dnf: null };
    const dnf = nineBools(cd.dnf);
    const holes = nineInts(cd.holes, `${name}'s scores`, 0, 20);
    // Every hole the player actually played needs a real score; DNF holes may stay blank.
    holes.forEach((h, i) => {
      if (!dnf?.[i] && h < 1) throw new BadRequest(`${name}'s scores must be 1-20`);
    });
    return { playerId: cd.playerId, absent: false, holes, dnf };
  });
}

function validatePlan(plan: SchedulePlan, nines: Nine[]): SchedulePlan {
  if (!plan || typeof plan !== 'object') throw new BadRequest('schedule is required');
  const weeks = int(plan.weeks, 'regular-season weeks');
  const playoffWeeks = int(plan.playoffWeeks ?? 0, 'playoff weeks');
  if (weeks < 1 || weeks > 40 || playoffWeeks < 0 || playoffWeeks > 10) throw new BadRequest('Use 1–40 regular weeks and 0–10 playoff weeks');
  const nineIds = Array.isArray(plan.nineIds) ? plan.nineIds.map((x) => str(x, 'nine')) : [];
  if (!nineIds.length || nineIds.some((id) => !nines.some((n) => n.id === id))) throw new BadRequest('Pick which nines to play from the season’s course');
  const slots = Array.isArray(plan.slots) ? plan.slots.slice(0, 30).map((s) => ({ slot: String(s.slot ?? '').slice(0, 10), teeTime: s.teeTime ? String(s.teeTime).slice(0, 20) : undefined })) : [];
  return { startDate: plan.startDate ? isoDate(plan.startDate, 'start date') : null, weeks, playoffWeeks, nineIds, slots };
}

async function validateRound(db: D1Database, r: Round): Promise<Round> {
  const par = Array.isArray(r?.par) && r.par.length === 18 ? ints(r.par, 'par', 18, 3, 6) : nineInts(r?.par, 'par', 3, 6);
  const live = !!r.live;
  // While a round is being played, holes not reached yet are 0.
  const holes = ints(r.holes, 'scores', par.length, live ? 0 : 1, 20);
  const handicap = (v: unknown, who: string) => {
    if (v == null || v === '') return null;
    const n = int(v, `${who}’s handicap`);
    if (n < -10 || n > 54) throw new BadRequest(`${who}’s handicap must be −10 to 54`);
    return n;
  };
  if (!Array.isArray(r.players ?? [])) throw new BadRequest('players must be a list');
  const others = r.players ?? [];
  if (others.length > 7) throw new BadRequest('A group can have up to 8 players');
  const players = [];
  for (const [i, p] of others.entries()) {
    const name = str(p.name, 'Player name').slice(0, 40);
    const userId = p.userId == null ? null : int(p.userId, 'player account');
    if (userId != null && !(await db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").bind(userId).first())) throw new BadRequest(`${name}’s account wasn’t found`);
    players.push({ idx: int(p.idx ?? i + 1, 'player'), name, userId, handicap: handicap(p.handicap, name), holes: ints(p.holes, `${name}’s scores`, par.length, 0, 20) });
  }
  if (new Set(players.map((p) => p.idx)).size !== players.length || players.some((p) => p.idx < 1)) throw new BadRequest('Players need different numbers');
  return {
    live,
    handicap: handicap(r.handicap, 'Your'),
    players,
    game: r.game ? validateGame(r.game, players.length + 1, par.length) : null,
    playedOn: isoDate(r.playedOn, 'date'),
    courseId: r.courseId ? String(r.courseId).slice(0, 40) : null,
    courseName: str(r.courseName, 'course').slice(0, 120),
    tee: r.tee ? String(r.tee).trim().slice(0, 60) || null : null,
    firstHole: r.firstHole === 10 ? 10 : 1,
    par,
    holes,
    notes: r.notes ? String(r.notes).trim().slice(0, 500) || null : null,
    // Optional scorecard details; missing yardage on some holes is stored as 0.
    yardage: r.yardage ? ints(r.yardage, 'yardage', par.length, 0, 1000) : null,
    hcp: r.hcp ? ints(r.hcp, 'hole handicaps', par.length, 1, 18) : null,
    stats: r.stats ? validateStats(r.stats, par, holes) : null,
  };
}

function validateGame(g: GameSetup, players: number, holes: number): GameSetup {
  if (!GAMES.some((x) => x.id === g?.id)) throw new BadRequest('Unknown game');
  const info = gameInfo(g.id);
  if (!info.fits(players)) throw new BadRequest(`${info.name} is for ${info.players} players`);
  const unit = Number(g.unit ?? 1);
  if (!Number.isFinite(unit) || unit < 0 || unit > 1000) throw new BadRequest('Stake must be 0–1000');
  const teamA = Array.isArray(g.teamA) ? g.teamA.map((x) => int(x, 'team')).filter((x) => x >= 0 && x < players).slice(0, 2) : undefined;
  return {
    id: g.id,
    handicaps: g.handicaps === 'full' || g.handicaps === 'offLow' ? g.handicaps : 'off',
    stakes: g.stakes === 'money' ? 'money' : 'points',
    unit: Math.round(unit * 100) / 100,
    ...(teamA ? { teamA } : {}),
    ...(g.id === 'skins' ? { carryover: g.carryover !== false } : {}),
    ...(g.id === 'vegas' ? { birdieFlip: g.birdieFlip !== false } : {}),
    // Wolf choices: one per hole, kept the right length so single holes can be updated.
    ...(g.id === 'wolf'
      ? { wolf: Array.from({ length: holes }, (_, h) => { const c = g.wolf?.[h]; return c === 'lone' ? 'lone' : typeof c === 'number' && c >= 0 && c < players ? c : null; }) }
      : {}),
  };
}

/** Optional per-hole stats: one entry per hole, null when not recorded. */
function validateStats(s: RoundStats, par: number[], holes: number[]): RoundStats | null {
  const list = <T,>(v: unknown, what: string, each: (x: unknown, h: number) => T): T[] => {
    if (!Array.isArray(v) || v.length !== par.length) throw new BadRequest(`${what} needs one entry per hole`);
    return v.map((x, h) => (x == null ? null : each(x, h))) as T[];
  };
  const flag = (what: string) => (x: unknown) => {
    if (typeof x !== 'boolean') throw new BadRequest(`${what} must be yes or no`);
    return x;
  };
  const stats: RoundStats = {
    // There's no fairway to hit on a par 3.
    fir: list(s.fir, 'Fairways', (x, h) => (par[h] === 3 ? null : flag('Fairway hit')(x))),
    gir: list(s.gir, 'Greens in regulation', flag('Green in regulation')),
    putts: list(s.putts, 'Putts', (x, h) => {
      const n = int(x, 'putts');
      if (n < 0 || n > 10) throw new BadRequest('Putts must be 0–10');
      if (n > holes[h]) throw new BadRequest(`Hole ${h + 1}: more putts than strokes`);
      return n;
    }),
  };
  const any = [...stats.fir, ...stats.gir, ...stats.putts].some((x) => x != null);
  return any ? stats : null;
}

function validateSeason(raw: Partial<SeasonData> & { legacy?: unknown }): SeasonData {
  const data = normalizeSeason(raw);
  // Files from tools/import_numbers.py carry the sheet's per-week handicaps; the engine recomputes
  // them identically, so drop them rather than freezing them in as overrides.
  if (raw.legacy) data.weeks.forEach((w) => w.scores.forEach((s) => (s.hc = null)));
  data.season = { name: str(data.season?.name, 'season name') };
  data.nines = validateNines(data.nines);
  data.teams = validateTeams(data.teams);
  data.players = validatePlayers(data.players, data.teams);
  data.weeks = data.weeks.map((w) => ({
    number: int(w.number, 'week'),
    date: w.date ?? null,
    nineId: str(w.nineId, 'nineId'),
    playoff: !!w.playoff,
    inclement: !!w.inclement,
    matches: validateMatches(w.matches),
    scores: validateScores(w.scores),
  }));
  return data;
}

export const onRequest = handle(app);
