/** End-to-end API tests: real routes and SQL, with the in-memory D1 stand-in. */
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequest } from '../api/[[route]]';
import { testDatabase } from './d1';

const nine = (id: string, firstHole = 1) => ({ id, name: id, par: [4, 4, 3, 5, 4, 4, 3, 5, 4], menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], firstHole });
const player = (id: number, teamId: number, email?: string) => ({ id, name: `Player ${id}`, teamId, startingHc: 10, redTees: false, active: true, email });

let env: Record<string, unknown>;

beforeEach(() => {
  env = { DB: testDatabase(), SESSION_SECRET: 'test-secret', ADMIN_PASSWORD: 'pw', DEV_LOGIN: 'true' };
});

/** A browser: keeps cookies between requests. */
function client(host = 'http://localhost') {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const request = new Request(host + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const res = await (onRequest as unknown as (ctx: unknown) => Promise<Response>)({ request, env, params: {}, data: {}, waitUntil() {}, passThroughOnException() {}, next() {} });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split('; ');
      const [k, v] = kv.split('=');
      if (attrs.includes('Max-Age=0')) jar.delete(k);
      else jar.set(k, v);
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, json: json as any, res };
  };
  return {
    jar,
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    put: (p: string, b: unknown) => call('PUT', p, b),
    del: (p: string) => call('DELETE', p),
  };
}

async function signIn(email: string, admin = false) {
  const c = client();
  expect((await c.post('/api/auth/dev', { email, admin })).status).toBe(200);
  return c;
}

/** 4 teams of 2, schedule starting in the past so week 1 can be scored. */
async function setUpSeason() {
  const admin = client();
  expect((await admin.post('/api/login', { password: 'pw' })).status).toBe(200);
  const created = await admin.post('/api/admin/seasons', {
    season: { name: '2026 League' },
    nines: [nine('front'), nine('back', 10)],
    teams: [1, 2, 3, 4].map((id) => ({ id, name: `Team ${id}` })),
    players: [player(1, 1, 'a1@example.com'), player(2, 1, 'a2@example.com'), player(3, 2, 'b1@example.com'), player(4, 2), player(5, 3), player(6, 3), player(7, 4), player(8, 4)],
    weeks: [],
    makeCurrent: true,
  });
  expect(created.status).toBe(200);
  const id = created.json.id as number;
  const sched = await admin.post(`/api/admin/seasons/${id}/schedule`, {
    startDate: '2026-01-06',
    weeks: 3,
    playoffWeeks: 1,
    nineIds: ['front', 'back'],
    slots: [{ slot: 'A', teeTime: '4:00pm' }, { slot: 'B', teeTime: '4:09pm' }],
  });
  expect(sched.json).toEqual({ ok: true, weeks: 4 });
  return { admin, id };
}

const holes = (n: number) => Array(9).fill(n);

describe('sign-in', () => {
  it('reports enabled providers and the signed-in user', async () => {
    env.GOOGLE_CLIENT_ID = 'g';
    env.GOOGLE_CLIENT_SECRET = 's';
    const c = await signIn('pat@example.com');
    const me = await c.get('/api/me');
    expect(me.json).toMatchObject({ superAdmin: false, leagues: [], providers: ['google'], user: { email: 'pat@example.com', isAdmin: false } });
    await c.post('/api/logout');
    expect((await c.get('/api/me')).json.user).toBeNull();
  });

  it('only allows the dev sign-in on localhost with DEV_LOGIN', async () => {
    expect((await client('https://league.example').post('/api/auth/dev', { email: 'x@example.com' })).status).toBe(404);
    env.DEV_LOGIN = undefined;
    expect((await client().post('/api/auth/dev', { email: 'x@example.com' })).status).toBe(404);
  });

  it('redirects to the provider with a state cookie, and back to /signin on a bad callback', async () => {
    const c = client('https://league.example');
    expect((await c.get('/api/auth/google/start')).res.headers.get('Location')).toMatch(/^\/signin\?error=/);
    expect((await c.get('/api/auth/microsoft/start')).res.headers.get('Location')).toMatch(/^\/signin\?error=/);
    env.GOOGLE_CLIENT_ID = 'g';
    env.GOOGLE_CLIENT_SECRET = 's';
    const start = await c.get('/api/auth/google/start?returnTo=/me');
    expect(start.status).toBe(302);
    expect(start.res.headers.get('Location')).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(c.jar.has('league_oauth')).toBe(true);
    const back = await c.get('/api/auth/google/callback?code=x&state=wrong');
    expect(back.res.headers.get('Location')).toMatch(/^\/signin\?error=/);
  });

  it('keeps admin pages closed to non-admin accounts', async () => {
    const c = await signIn('pat@example.com');
    expect((await c.get('/api/admin/audit')).status).toBe(403);
    expect((await client().get('/api/admin/audit')).status).toBe(401);
  });
});

describe('season setup', () => {
  it('shows the league only to members, and player emails only to admins', async () => {
    const { admin, id } = await setUpSeason();
    expect((await client().get(`/api/seasons/${id}`)).status).toBe(401);
    expect((await client().get('/api/seasons')).status).toBe(401);
    const stranger = await signIn('nobody@example.com');
    expect((await stranger.get(`/api/seasons/${id}`)).status).toBe(403);
    expect((await stranger.get('/api/me')).json.leagues).toEqual([]);
    const member = await signIn('a1@example.com');
    expect((await member.get('/api/me')).json.leagues).toEqual([{ id: 1, name: 'Fairways and Greens', role: 'member' }]);
    expect((await member.get(`/api/seasons/${id}`)).json.players[0].email).toBeUndefined();
    expect((await admin.get(`/api/seasons/${id}`)).json.players[0].email).toBe('a1@example.com');
  });

  it('generates dated weeks with rotating nines and round-robin matches', async () => {
    const { admin, id } = await setUpSeason();
    const weeks = (await admin.get(`/api/seasons/${id}`)).json.weeks;
    expect(weeks.map((w: any) => [w.date, w.nineId, w.playoff, w.matches.length])).toEqual([
      ['2026-01-06', 'front', false, 2],
      ['2026-01-13', 'back', false, 2],
      ['2026-01-20', 'front', false, 2],
      ['2026-01-27', 'back', true, 0],
    ]);
  });

  it('starts a new season from an old one with a new course and schedule', async () => {
    const { admin, id } = await setUpSeason();
    const res = await admin.post('/api/admin/seasons', {
      name: '2027 League',
      copyFrom: id,
      nines: [nine('north')],
      schedule: { startDate: '2027-04-27', weeks: 3, playoffWeeks: 0, nineIds: ['north'], slots: [] },
    });
    const s = (await admin.get(`/api/seasons/${res.json.id}`)).json;
    expect(s.nines.map((n: any) => n.id)).toEqual(['north']);
    expect(s.players).toHaveLength(8);
    expect(s.players[0].email).toBe('a1@example.com');
    expect(s.weeks).toHaveLength(3);
    expect(s.weeks.every((w: any) => w.nineId === 'north' && w.matches.length === 2)).toBe(true);
  });
});

describe('importing a season file', () => {
  it('carries sign-in emails and account links over from earlier seasons by player name', async () => {
    const { admin, id } = await setUpSeason();
    // Player 4 (no roster email) is linked by hand to an account.
    await signIn('four@example.com');
    const four = (await admin.get('/api/admin/accounts?all')).json.find((a: any) => a.email === 'four@example.com');
    await admin.put(`/api/admin/seasons/${id}/links`, { userId: four.id, playerId: 4 });

    const imported = await admin.post('/api/admin/seasons', {
      season: { name: '2027 League' },
      nines: [nine('front')],
      teams: [{ id: 1, name: 'Team 1' }, { id: 2, name: 'Team 2' }],
      // New ids and different capitalization, as an import from the spreadsheet would have.
      players: [{ ...player(10, 1), name: 'PLAYER 1' }, { ...player(11, 2), name: 'Player 4' }, player(12, 2)],
      weeks: [],
    });
    const s = (await admin.get(`/api/seasons/${imported.json.id}`)).json;
    expect(s.players.map((p: any) => [p.id, p.email ?? null])).toEqual([[10, 'a1@example.com'], [11, null], [12, null]]);
    const links = (await admin.get(`/api/admin/accounts?season=${imported.json.id}`)).json;
    expect(links.find((a: any) => a.id === four.id)).toMatchObject({ playerId: 11, manualLink: true });
  });
});

describe('player-entered match cards', () => {
  it('posts scores once both teams submit identical cards', async () => {
    const { admin, id } = await setUpSeason();
    const a1 = await signIn('a1@example.com');
    const mine = (await a1.get('/api/my/matches')).json;
    expect(mine.playerId).toBe(1);
    const wk1 = mine.matches.find((m: any) => m.week === 1);
    const opponent = wk1.teamA === 1 ? wk1.teamB : wk1.teamA;
    const ids: number[] = wk1.playerIds.flat();
    const card = ids.map((pid) => ({ playerId: pid, holes: holes(pid % 3 + 4), absent: false }));

    expect((await a1.put(`/api/my/matches/${id}/1`, { cards: card })).json).toMatchObject({ status: 'waiting', missingTeams: [opponent] });
    const a2 = await signIn('a2@example.com');
    // Until you enter your own card, you can see that others have, but not what they entered.
    const before = (await a2.get('/api/my/matches')).json.matches.find((m: any) => m.week === 1);
    expect(before.submissions).toMatchObject([{ name: 'Player 1', cards: null, mine: false }]);
    expect((await a2.put(`/api/my/matches/${id}/1`, { cards: card })).json.status).toBe('waiting');
    const after = (await a2.get('/api/my/matches')).json.matches.find((m: any) => m.week === 1);
    expect(after.submissions.every((s: any) => s.cards)).toBe(true);

    // The opponent signs in from the invite link and gets linked by the admin (their roster player has no email).
    const opp = await signIn(`opp${opponent}@example.com`);
    const { joinCode } = (await admin.get('/api/admin/leagues/1')).json;
    expect((await opp.post('/api/leagues/join', { code: joinCode })).json).toMatchObject({ status: 'requested', name: 'Fairways and Greens' });
    const accounts = (await admin.get('/api/admin/accounts')).json;
    const oppUser = accounts.find((u: any) => u.email === `opp${opponent}@example.com`);
    const oppPlayer = ids.find((pid) => pid > 2 && (pid === opponent * 2 - 1 || pid === opponent * 2))!;
    expect((await admin.put(`/api/admin/seasons/${id}/links`, { userId: oppUser.id, playerId: oppPlayer })).status).toBe(200);

    const wrong = card.map((cd) => (cd.playerId === 1 ? { ...cd, holes: [...cd.holes.slice(0, 8), 9] } : cd));
    const mismatch = (await opp.put(`/api/my/matches/${id}/1`, { cards: wrong })).json;
    expect(mismatch).toMatchObject({ status: 'mismatch', differences: [{ playerId: 1, hole: 8 }] });
    expect((await admin.get(`/api/seasons/${id}`)).json.weeks[0].scores).toEqual([]);

    expect((await opp.put(`/api/my/matches/${id}/1`, { cards: card })).json.status).toBe('agreed');
    const scores = (await admin.get(`/api/seasons/${id}`)).json.weeks[0].scores;
    expect(scores.map((s: any) => s.playerId).sort()).toEqual([...ids].sort());
    expect((await admin.get(`/api/admin/seasons/${id}/weeks/1/submissions`)).json.find((m: any) => m.consensus.status === 'agreed').submissions).toHaveLength(3);

    // Now the match is final: players can no longer change it, but an admin still can.
    const lockedA = await opp.put(`/api/my/matches/${id}/1`, { cards: card });
    expect(lockedA.status).toBe(400);
    expect(lockedA.json.error).toMatch(/final/i);
    expect((await a1.put(`/api/my/matches/${id}/1`, { cards: card })).status).toBe(400);
    expect((await admin.put(`/api/admin/seasons/${id}/weeks/1/scores`, { scores: ids.map((p) => ({ playerId: p, holes: holes(6) })) })).status).toBe(200);
    expect((await admin.get(`/api/seasons/${id}`)).json.weeks[0].scores.every((s: any) => s.holes.every((h: number) => h === 6))).toBe(true);
  });

  it('rejects incomplete cards, other matches, future weeks and unlinked accounts', async () => {
    const { id } = await setUpSeason();
    const a1 = await signIn('a1@example.com');
    const wk1 = (await a1.get('/api/my/matches')).json.matches[0];
    const ids: number[] = wk1.playerIds.flat();
    expect((await a1.put(`/api/my/matches/${id}/1`, { cards: [{ playerId: 1, holes: holes(4), absent: false }] })).status).toBe(400);
    expect((await a1.put(`/api/my/matches/${id}/1`, { cards: ids.map((p) => ({ playerId: p, holes: holes(0), absent: false })) })).status).toBe(400);

    const stranger = await signIn('nobody@example.com');
    expect((await stranger.get('/api/my/matches')).json).toMatchObject({ playerId: null, matches: [] });
    expect((await stranger.put(`/api/my/matches/${id}/1`, { cards: [] })).status).toBe(403);
    expect((await client().put(`/api/my/matches/${id}/1`, { cards: [] })).status).toBe(401);
  });

  it('blocks entry before the match day', async () => {
    const { admin, id } = await setUpSeason();
    await admin.post(`/api/admin/seasons/${id}/schedule`, { startDate: '2099-01-06', weeks: 2, playoffWeeks: 0, nineIds: ['front'], slots: [] });
    const a1 = await signIn('a1@example.com');
    const m = (await a1.get('/api/my/matches')).json.matches[0];
    expect(m.blocked).toMatch(/day of the match/);
    const cards = m.playerIds.flat().map((p: number) => ({ playerId: p, holes: holes(4), absent: false }));
    expect((await a1.put(`/api/my/matches/${id}/1`, { cards })).status).toBe(400);
  });

  it('counts what is waiting on the admin for the nudge badges', async () => {
    const { admin, id } = await setUpSeason();
    expect((await admin.get('/api/admin/leagues/1/todo')).json).toMatchObject({ scores: 0, requests: 0, unlinked: 0, total: 0 });

    // One team submits a card for week 1 → a match waiting to be finalised.
    const a1 = await signIn('a1@example.com');
    const wk1 = (await a1.get('/api/my/matches')).json.matches.find((m: any) => m.week === 1);
    await a1.put(`/api/my/matches/${id}/1`, { cards: wk1.playerIds.flat().map((p: number) => ({ playerId: p, holes: holes(4), absent: false })) });

    // Someone opens the invite link and asks to join.
    const joinCode = (await admin.get('/api/admin/leagues/1')).json.joinCode;
    const newbie = await signIn('newbie@example.com');
    await newbie.post('/api/leagues/join', { code: joinCode });

    const todo = (await admin.get('/api/admin/leagues/1/todo')).json;
    expect(todo).toMatchObject({ scores: 1, requests: 1 });
    expect(todo.total).toBe(todo.scores + todo.requests + todo.unlinked);
  });
});

describe('after scores are entered', () => {
  it('still lets an admin change the course, but locks the generated schedule', async () => {
    const { admin, id } = await setUpSeason();
    const s = (await admin.get(`/api/seasons/${id}`)).json;
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: [...s.nines, nine('extra')] })).status).toBe(200);
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: s.nines })).status).toBe(200);

    const ids = s.players.filter((p: any) => [s.weeks[0].matches[0].teamA].includes(p.teamId)).map((p: any) => p.id);
    await admin.put(`/api/admin/seasons/${id}/weeks/1/scores`, { scores: ids.map((p: number) => ({ playerId: p, holes: holes(5) })) });

    const changed = [{ ...s.nines[0], par: [5, 5, 3, 4, 4, 4, 3, 5, 4] }, s.nines[1]];
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: changed })).status).toBe(200);
    expect((await admin.get(`/api/seasons/${id}`)).json.nines[0].par).toEqual(changed[0].par);
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: s.nines, name: 'Renamed' })).status).toBe(200);
    expect((await admin.post(`/api/admin/seasons/${id}/schedule`, { startDate: '2026-01-06', weeks: 2, playoffWeeks: 0, nineIds: ['front'], slots: [] })).status).toBe(400);
  });
});

describe('email sign-in (one-time codes)', () => {
  /** Request a code and verify it, like the real sign-in page. Returns the signed-in client. */
  async function emailSignIn(email: string, joinCode?: string) {
    const c = client();
    const req = await c.post('/api/auth/otp/request', { email, ...(joinCode ? { joinCode } : {}) });
    expect(req.json.sent).toBe(true);
    const code = req.json.devCode as string; // returned on localhost dev
    expect(code).toMatch(/^\d{6}$/);
    expect((await c.post('/api/auth/otp/verify', { email, code, ...(joinCode ? { joinCode } : {}) })).status).toBe(200);
    return c;
  }

  it('signs in with an emailed code and verifies the address, so roster players auto-link', async () => {
    const { id } = await setUpSeason(); // player 1 has email a1@example.com
    const c = await emailSignIn('a1@example.com');
    const me = (await c.get('/api/me')).json;
    expect(me.user).toMatchObject({ email: 'a1@example.com' });
    expect(me.leagues).toEqual([{ id: 1, name: 'Fairways and Greens', role: 'member' }]); // auto-linked by verified email
    expect((await c.get(`/api/seasons/${id}`)).status).toBe(200);
  });

  it('only emails addresses it already knows, and never reveals which (no enumeration)', async () => {
    await setUpSeason();
    const known = await client().post('/api/auth/otp/request', { email: 'a1@example.com' });
    const unknown = await client().post('/api/auth/otp/request', { email: 'stranger@example.com' });
    expect(known.json.sent).toBe(true);
    expect(unknown.json.sent).toBe(true); // same response…
    expect(known.json.devCode).toMatch(/^\d{6}$/); // …but only the known one actually gets a code
    expect(unknown.json.devCode).toBeUndefined();
  });

  it('rejects a wrong code and clears it after too many tries', async () => {
    await setUpSeason();
    const c = client();
    await c.post('/api/auth/otp/request', { email: 'a1@example.com' });
    for (let i = 0; i < 5; i++) expect((await c.post('/api/auth/otp/verify', { email: 'a1@example.com', code: '000000' })).status).toBe(401);
    // Now locked out until a new code is requested.
    expect((await c.post('/api/auth/otp/verify', { email: 'a1@example.com', code: '000000' })).status).toBe(429);
  });

  it('reuses one account for the same email across Google and code sign-in', async () => {
    await setUpSeason();
    const viaGoogle = await signIn('dupe@example.com'); // dev login acts like Google (verified email)
    const googleId = (await viaGoogle.get('/api/me')).json.user.id;
    const viaCode = client();
    const { devCode } = (await viaCode.post('/api/auth/otp/request', { email: 'dupe@example.com' })).json;
    await viaCode.post('/api/auth/otp/verify', { email: 'dupe@example.com', code: devCode });
    expect((await viaCode.get('/api/me')).json.user.id).toBe(googleId); // same account, not a duplicate
  });
});
describe('admin tools', () => {
  it('lists cards that aren’t official yet and accepts one as the official scores', async () => {
    const { admin, id } = await setUpSeason();
    const a1 = await signIn('a1@example.com');
    const wk1 = (await a1.get('/api/my/matches')).json.matches.find((m: any) => m.week === 1);
    const cards = wk1.playerIds.flat().map((pid: number) => ({ playerId: pid, holes: holes(4), absent: false }));
    await a1.put(`/api/my/matches/${id}/1`, { cards });

    const pending = (await admin.get(`/api/admin/seasons/${id}/pending-cards`)).json;
    expect(pending).toMatchObject([{ week: 1, teamA: wk1.teamA, teamB: wk1.teamB, status: 'waiting', names: ['Player 1'] }]);

    const userId = (await a1.get('/api/me')).json.user.id;
    expect((await a1.post(`/api/admin/seasons/${id}/weeks/1/accept`, { teamA: wk1.teamA, teamB: wk1.teamB, userId })).status).toBe(403);
    expect((await admin.post(`/api/admin/seasons/${id}/weeks/1/accept`, { teamA: wk1.teamA, teamB: wk1.teamB, userId })).status).toBe(200);
    const scores = (await admin.get(`/api/seasons/${id}`)).json.weeks[0].scores;
    expect(scores.map((s: any) => s.playerId).sort()).toEqual([...wk1.playerIds.flat()].sort());
    expect((await admin.get(`/api/admin/seasons/${id}/pending-cards`)).json).toEqual([]);
  });

  it('pushes a week and every later week back a week, and can undo it', async () => {
    const { admin, id } = await setUpSeason();
    const dates = async () => (await admin.get(`/api/seasons/${id}`)).json.weeks.map((w: any) => w.date);
    expect((await admin.post(`/api/admin/seasons/${id}/shift`, { fromWeek: 2 })).json).toEqual({ ok: true, weeks: 3 });
    expect(await dates()).toEqual(['2026-01-06', '2026-01-20', '2026-01-27', '2026-02-03']);
    await admin.post(`/api/admin/seasons/${id}/shift`, { fromWeek: 2, days: -7 });
    expect(await dates()).toEqual(['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27']);
    expect((await admin.post(`/api/admin/seasons/${id}/shift`, { fromWeek: 2, days: 0 })).status).toBe(400);
  });
});

describe('message board', () => {
  it('lets members post and reply, authors delete their own, and admins pin or delete anything', async () => {
    const { admin } = await setUpSeason();
    const a1 = await signIn('a1@example.com');
    const a2 = await signIn('a2@example.com');
    expect((await (await signIn('nobody@example.com')).get('/api/board')).status).toBe(403);
    expect((await client().get('/api/board')).status).toBe(401);

    const first = (await a1.post('/api/board', { body: 'Tee times moved up 10 minutes' })).json.id;
    const second = (await a2.post('/api/board', { body: 'Anyone have a sub for week 3?' })).json.id;
    const reply = (await a2.post('/api/board', { body: 'Thanks!', parentId: first })).json.id;
    // Replying to a reply goes under the original post.
    await a1.post('/api/board', { body: 'You bet', parentId: reply });
    expect((await a1.post('/api/board', { body: '   ' })).status).toBe(400);

    let board = (await a1.get('/api/board')).json;
    expect(board.map((p: any) => p.body)).toEqual(['Anyone have a sub for week 3?', 'Tee times moved up 10 minutes']);
    expect(board[1].replies.map((r: any) => [r.author, r.body])).toEqual([['a2', 'Thanks!'], ['a1', 'You bet']]);

    expect((await a1.del(`/api/board/${second}`)).status).toBe(403);
    expect((await a1.put(`/api/board/${first}/pin`, { pinned: true })).status).toBe(403);
    await admin.put(`/api/board/${first}/pin`, { pinned: true });
    board = (await a2.get('/api/board')).json;
    expect(board[0]).toMatchObject({ id: first, pinned: true });

    expect((await a2.del(`/api/board/${second}`)).status).toBe(200);
    expect((await admin.del(`/api/board/${first}`)).status).toBe(200);
    expect((await a1.get('/api/board')).json).toEqual([]);
  });
});

describe('contact details', () => {
  it('keeps phone numbers on My profile and shows admins the best email and phone per player', async () => {
    const { admin, id } = await setUpSeason();
    const a1 = await signIn('a1@example.com');
    expect((await a1.put('/api/my/profile', { name: 'Al One', phone: '(303) 555-0101', smsOk: true })).json).toEqual({ ok: true, phone: '+13035550101' });
    expect((await a1.get('/api/my/profile')).json).toEqual({ name: 'Al One', email: 'a1@example.com', phone: '+13035550101', smsOk: true });
    expect((await a1.put('/api/my/profile', { name: 'Al One', phone: '555-01' })).status).toBe(400);

    // The admin types a number on the roster for a player without an account.
    const season = (await admin.get(`/api/seasons/${id}`)).json;
    const players = season.players.map((p: any) => (p.id === 3 ? { ...p, phone: '720-555-0103' } : p));
    expect((await admin.put(`/api/admin/seasons/${id}/roster`, { teams: season.teams, players })).status).toBe(200);
    expect((await a1.get(`/api/seasons/${id}`)).json.players.find((p: any) => p.id === 3).phone).toBeUndefined();

    expect((await a1.get(`/api/admin/seasons/${id}/contacts`)).status).toBe(403);
    const contacts = (await admin.get(`/api/admin/seasons/${id}/contacts`)).json;
    expect(contacts.find((x: any) => x.playerId === 1)).toMatchObject({ name: 'Player 1', email: 'a1@example.com', phone: '+13035550101', smsOk: true, hasAccount: true });
    expect(contacts.find((x: any) => x.playerId === 3)).toMatchObject({ email: 'b1@example.com', phone: '+17205550103', smsOk: false, hasAccount: false });
  });
});

describe('changing the course', () => {
  it('moves weeks to the replacement nine, and refuses to strand a week on a removed one', async () => {
    const { admin, id } = await setUpSeason();
    // Weeks alternate front / back. Replace both with one nine of a new course.
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: [nine('north')] })).json.error).toMatch(/Week 1 is played on a nine you removed/);
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: [nine('north')], replaceNines: { front: 'north' } })).json.error).toMatch(/Week 2/);
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: [nine('north')], replaceNines: { front: 'south' } })).status).toBe(400);
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: [nine('north')], replaceNines: { front: 'north', back: 'north' } })).status).toBe(200);
    const s = (await admin.get(`/api/seasons/${id}`)).json;
    expect(s.nines.map((n: any) => n.id)).toEqual(['north']);
    expect(s.weeks.every((w: any) => w.nineId === 'north')).toBe(true);
  });
});

describe('accounts', () => {
  it('lets an admin grant admin access but not remove their own', async () => {
    const boss = await signIn('boss@example.com', true);
    await signIn('pat@example.com');
    const pat = (await boss.get('/api/admin/accounts?all')).json.find((u: any) => u.email === 'pat@example.com');
    expect((await boss.put(`/api/admin/accounts/${pat.id}`, { isAdmin: true })).status).toBe(200);
    const me = (await boss.get('/api/me')).json.user;
    expect((await boss.put(`/api/admin/accounts/${me.id}`, { isAdmin: false })).status).toBe(400);
  });
});

describe('personal rounds', () => {
  const round = { playedOn: '2026-06-01', courseId: '123', courseName: 'Oak Creek', tee: 'Blue', firstHole: 1, par: Array(18).fill(4), holes: Array(18).fill(5), notes: 'windy' };

  it('saves, edits and deletes your own rounds only', async () => {
    const pat = await signIn('pat@example.com');
    const id = (await pat.post('/api/my/rounds', round)).json.id;
    expect((await pat.get('/api/my/rounds')).json).toMatchObject([{ id, courseName: 'Oak Creek', holes: round.holes }]);
    expect((await pat.put(`/api/my/rounds/${id}`, { ...round, holes: Array(18).fill(4) })).status).toBe(200);

    const other = await signIn('other@example.com');
    expect((await other.get('/api/my/rounds')).json).toEqual([]);
    expect((await other.put(`/api/my/rounds/${id}`, round)).status).toBe(404);
    await other.del(`/api/my/rounds/${id}`);
    expect((await pat.get('/api/my/rounds')).json).toHaveLength(1);

    await pat.del(`/api/my/rounds/${id}`);
    expect((await pat.get('/api/my/rounds')).json).toEqual([]);
  });

  it('keeps scorecard details: yardage and hole handicaps', async () => {
    const pat = await signIn('pat@example.com');
    const details = { yardage: Array(18).fill(380), hcp: Array.from({ length: 18 }, (_, i) => i + 1) };
    const id = (await pat.post('/api/my/rounds', { ...round, ...details })).json.id;
    expect((await pat.get('/api/my/rounds')).json[0]).toMatchObject({ id, ...details });
    // Rounds without details still work.
    await pat.post('/api/my/rounds', round);
    expect((await pat.get('/api/my/rounds')).json.map((r: any) => r.hcp?.length ?? null)).toEqual(expect.arrayContaining([18, null]));
    expect((await pat.post('/api/my/rounds', { ...round, hcp: Array(9).fill(1) })).status).toBe(400);
  });

  it('keeps fairways, greens and putts, and checks them', async () => {
    const pat = await signIn('pat@example.com');
    const par = [4, 3, 5, 4, 4, 3, 4, 5, 4];
    const nine = { ...round, par, holes: [5, 3, 5, 4, 6, 2, 4, 6, 4] };
    const stats = {
      fir: [true, null, false, true, false, null, true, true, null],
      gir: [false, true, true, true, false, true, true, false, null],
      putts: [2, 2, 2, 2, 3, 1, 2, 2, null],
    };
    const id = (await pat.post('/api/my/rounds', { ...nine, stats })).json.id;
    expect((await pat.get('/api/my/rounds')).json.find((r: any) => r.id === id).stats).toEqual(stats);
    // A fairway on a par 3 is ignored rather than refused; nothing recorded at all is stored as no stats.
    const id2 = (await pat.post('/api/my/rounds', { ...nine, stats: { ...stats, fir: stats.fir.map(() => true) } })).json.id;
    expect((await pat.get('/api/my/rounds')).json.find((r: any) => r.id === id2).stats.fir[1]).toBeNull();
    const empty = { fir: Array(9).fill(null), gir: Array(9).fill(null), putts: Array(9).fill(null) };
    const id3 = (await pat.post('/api/my/rounds', { ...nine, stats: empty })).json.id;
    expect((await pat.get('/api/my/rounds')).json.find((r: any) => r.id === id3).stats).toBeNull();

    expect((await pat.post('/api/my/rounds', { ...nine, stats: { ...stats, putts: [4, ...stats.putts.slice(1)].map((p, i) => (i === 1 ? 4 : p)) } })).status).toBe(400);
    expect((await pat.post('/api/my/rounds', { ...nine, stats: { ...stats, gir: stats.gir.slice(1) } })).status).toBe(400);
    expect((await pat.post('/api/my/rounds', { ...nine, stats: { ...stats, gir: stats.gir.map(() => 'yes') } })).status).toBe(400);
  });

  it('validates rounds', async () => {
    const pat = await signIn('pat@example.com');
    expect((await pat.post('/api/my/rounds', { ...round, holes: Array(17).fill(5) })).status).toBe(400);
    expect((await pat.post('/api/my/rounds', { ...round, playedOn: 'yesterday' })).status).toBe(400);
    expect((await pat.post('/api/my/rounds', { ...round, par: Array(9).fill(4), holes: Array(9).fill(5), firstHole: 10 })).status).toBe(200);
  });
});

describe('several leagues', () => {
  /** pat starts a second league with its own season; Fairways and Greens (league 1) has the first. */
  async function twoLeagues() {
    const lm = await setUpSeason();
    const pat = await signIn('pat@example.com');
    expect((await pat.post('/api/leagues', { name: 'Tuesday Twilight' })).status).toBe(403);
    const patId = (await lm.admin.get('/api/admin/accounts?all')).json.find((a: any) => a.email === 'pat@example.com').id;
    expect((await lm.admin.put(`/api/admin/accounts/${patId}`, { canCreateLeagues: true })).status).toBe(200);
    const league = (await pat.post('/api/leagues', { name: 'Tuesday Twilight' })).json.id as number;
    const season = await pat.post('/api/admin/seasons', {
      leagueId: league,
      season: { name: 'Twilight 2027' },
      nines: [nine('red')],
      teams: [1, 2].map((id) => ({ id, name: `Twilight ${id}` })),
      players: [player(1, 1, 'pat@example.com'), player(2, 1), player(3, 2, 'a1@example.com'), player(4, 2)],
      weeks: [],
    });
    expect(season.status).toBe(200);
    return { ...lm, pat, league, twilight: season.json.id as number };
  }

  it('shows each person only their own leagues, and lets league admins run only theirs', async () => {
    const { admin, id, pat, league, twilight } = await twoLeagues();
    expect((await pat.get('/api/me')).json.leagues).toEqual([{ id: league, name: 'Tuesday Twilight', role: 'admin' }]);
    // a1 is on both leagues' rosters by email.
    const a1 = await signIn('a1@example.com');
    expect((await a1.get('/api/me')).json.leagues.map((l: any) => [l.id, l.role])).toEqual([[1, 'member'], [league, 'member']]);
    expect((await a1.get(`/api/seasons?league=${league}`)).json.map((s: any) => s.name)).toEqual(['Twilight 2027']);
    expect((await a1.get('/api/seasons?league=1')).json.map((s: any) => s.name)).toEqual(['2026 League']);

    // pat can't see or run the first league.
    expect((await pat.get(`/api/seasons/${id}`)).status).toBe(403);
    expect((await pat.get('/api/seasons?league=1')).status).toBe(403);
    expect((await pat.put(`/api/admin/seasons/${id}`, { name: 'mine now' })).status).toBe(403);
    expect((await pat.get('/api/admin/accounts?league=1')).status).toBe(403);
    // League admins can't change site-wide account settings.
    expect((await pat.put('/api/admin/accounts/1', { isAdmin: true })).status).toBe(403);
    // ...but run their own league, and the super admin can run every league.
    expect((await pat.put(`/api/admin/seasons/${twilight}`, { name: 'Twilight 2027 Spring' })).status).toBe(200);
    expect((await admin.get(`/api/seasons/${twilight}`)).json.season.name).toBe('Twilight 2027 Spring');
    expect((await admin.get('/api/me')).json.leagues.map((l: any) => l.id)).toEqual([1, league]);
  });

  it('keeps one current season per league', async () => {
    const { admin, id, twilight } = await twoLeagues();
    expect((await admin.get('/api/seasons/current?league=1')).json.season.id).toBe(id);
    expect((await admin.get(`/api/seasons/current?league=${(await admin.get('/api/me')).json.leagues[1].id}`)).json.season.id).toBe(twilight);
  });

  it('keeps each league’s message board separate', async () => {
    const { pat, league } = await twoLeagues();
    const a1 = await signIn('a1@example.com');
    await a1.post('/api/board', { body: 'LM news', leagueId: 1 });
    await pat.post('/api/board', { body: 'Twilight news', leagueId: league });
    expect((await a1.get('/api/board?league=1')).json.map((p: any) => p.body)).toEqual(['LM news']);
    expect((await a1.get(`/api/board?league=${league}`)).json.map((p: any) => p.body)).toEqual(['Twilight news']);
    const lmPost = (await a1.get('/api/board?league=1')).json[0].id;
    expect((await pat.get('/api/board?league=1')).status).toBe(403);
    expect((await pat.del(`/api/board/${lmPost}`)).status).toBe(403);
    expect((await pat.put(`/api/board/${lmPost}/pin`, { pinned: true })).status).toBe(403);
  });

  it('lets people join from the invite link once the league admin approves', async () => {
    const { pat, league } = await twoLeagues();
    const { joinCode } = (await pat.get(`/api/admin/leagues/${league}`)).json;
    expect((await client().get(`/api/join/${joinCode}`)).json).toEqual({ name: 'Tuesday Twilight' });
    expect((await client().get('/api/join/nope')).status).toBe(404);

    // Sign in with a code from the invite link: the account is made and a join request filed.
    const sam = client();
    const { devCode } = (await sam.post('/api/auth/otp/request', { email: 'sam@example.com', joinCode })).json;
    expect((await sam.post('/api/auth/otp/verify', { email: 'sam@example.com', code: devCode, joinCode })).status).toBe(200);
    const waiting = (await pat.get(`/api/admin/leagues/${league}`)).json.members.find((m: any) => m.email === 'sam@example.com');
    expect(waiting).toMatchObject({ role: 'requested' });
    expect((await pat.put(`/api/admin/leagues/${league}/members/${waiting.userId}`, { role: 'member' })).status).toBe(200);
    expect((await sam.get('/api/me')).json.leagues).toEqual([{ id: league, name: 'Tuesday Twilight', role: 'member' }]);

    // Made a league admin, who can't then remove their own admin access.
    await pat.put(`/api/admin/leagues/${league}/members/${waiting.userId}`, { role: 'admin' });
    expect((await sam.get('/api/me')).json.leagues[0].role).toBe('admin');
    expect((await sam.put(`/api/admin/leagues/${league}/members/${waiting.userId}`, { role: null })).status).toBe(400);
    // A league admin can only manage people in their league.
    expect((await pat.put(`/api/admin/leagues/${league}/members/9999`, { role: 'admin' })).status).toBe(400);

    // A new invite link replaces the old one.
    const fresh = (await pat.post(`/api/admin/leagues/${league}/join-code`)).json.joinCode;
    expect(fresh).not.toBe(joinCode);
    expect((await client().get(`/api/join/${joinCode}`)).status).toBe(404);
  });

  it('lets a Google user already signed in ask to join', async () => {
    const { pat, league } = await twoLeagues();
    const { joinCode } = (await pat.get(`/api/admin/leagues/${league}`)).json;
    const kim = await signIn('kim@example.com');
    expect((await kim.post('/api/leagues/join', { code: joinCode })).json).toMatchObject({ status: 'requested', name: 'Tuesday Twilight' });
    expect((await kim.get('/api/me')).json).toMatchObject({ leagues: [], requested: [{ id: league, name: 'Tuesday Twilight' }] });
    // Linking to a roster player lets them in too.
    const kimId = (await pat.get(`/api/admin/accounts?league=${league}`)).json.find((a: any) => a.email === 'kim@example.com').id;
    const twilight = (await pat.get(`/api/seasons?league=${league}`)).json[0].id;
    expect((await pat.put(`/api/admin/seasons/${twilight}/links`, { userId: kimId, playerId: 2 })).status).toBe(200);
    expect((await kim.get('/api/me')).json).toMatchObject({ leagues: [{ id: league, role: 'member' }], requested: [] });
  });
});

describe('formats', () => {
  async function fieldSeason(format: string, teams: { id: number; name: string }[], players: any[]) {
    const admin = client();
    await admin.post('/api/login', { password: 'pw' });
    const created = await admin.post('/api/admin/seasons', { season: { name: 'Field' }, settings: { format }, nines: [nine('front')], teams, players, weeks: [], makeCurrent: true });
    expect(created.status).toBe(200);
    const id = created.json.id as number;
    const sched = await admin.post(`/api/admin/seasons/${id}/schedule`, { startDate: '2026-01-06', weeks: 2, playoffWeeks: 0, nineIds: ['front'], slots: [] });
    expect(sched.json).toEqual({ ok: true, weeks: 2 });
    return { admin, id };
  }

  it('stroke play: every player is their own side, no matchups, and your own card counts right away', async () => {
    const { admin, id } = await fieldSeason('stroke', [{ id: 9, name: 'Leftover team' }], [player(1, 9, 'a1@example.com'), player(2, 9, 'a2@example.com')]);
    const s = (await admin.get(`/api/seasons/${id}`)).json;
    expect(s.teams).toEqual([{ id: 1, name: 'Player 1' }, { id: 2, name: 'Player 2' }]);
    expect(s.players.map((p: any) => p.teamId)).toEqual([1, 2]);
    expect(s.weeks.every((w: any) => !w.matches.length)).toBe(true);

    const a1 = await signIn('a1@example.com');
    const mine = (await a1.get('/api/my/matches')).json;
    expect(mine.field).toBe(true);
    expect(mine.matches[0].playerIds).toEqual([[1], []]);
    // Only your own card.
    expect((await a1.put(`/api/my/matches/${id}/1`, { cards: [{ playerId: 2, holes: holes(4), absent: false }] })).status).toBe(400);
    expect((await a1.put(`/api/my/matches/${id}/1`, { cards: [{ playerId: 1, holes: holes(4), absent: false }] })).json.status).toBe('agreed');
    const after = (await a1.get(`/api/seasons/${id}`)).json.weeks[0].scores;
    expect(after).toEqual([expect.objectContaining({ playerId: 1, holes: holes(4) })]);

    // Adding a player gives them their own side too.
    await admin.put(`/api/admin/seasons/${id}/roster`, { teams: [], players: [...s.players, player(3, 0)] });
    expect((await admin.get(`/api/seasons/${id}`)).json.teams.map((t: any) => t.name)).toEqual(['Player 1', 'Player 2', 'Player 3']);
  });

  it('scramble: one card per team, entered by any player on it', async () => {
    const { id } = await fieldSeason('scramble', [{ id: 1, name: 'Aces' }, { id: 2, name: 'Birdies' }], [player(1, 1, 'a1@example.com'), player(2, 1), player(3, 2), player(4, 2)]);
    const a1 = await signIn('a1@example.com');
    expect((await a1.get('/api/my/matches')).json.matches[0].playerIds).toEqual([[-1], []]);
    expect((await a1.put(`/api/my/matches/${id}/1`, { cards: [{ playerId: -1, holes: holes(4), absent: false }] })).json.status).toBe('agreed');
    expect((await a1.get(`/api/seasons/${id}`)).json.weeks[0].scores[0].playerId).toBe(-1);
  });

  it('changes format only before scores, and clears matchups when they no longer fit', async () => {
    const { admin, id } = await setUpSeason();
    const s = (await admin.get(`/api/seasons/${id}`)).json;
    expect((await admin.put(`/api/admin/seasons/${id}`, { settings: { ...s.settings, format: 'bestBall' } })).status).toBe(200);
    expect((await admin.get(`/api/seasons/${id}`)).json.weeks[0].matches.length).toBe(2); // still head-to-head teams
    expect((await admin.put(`/api/admin/seasons/${id}`, { settings: { ...s.settings, format: 'stableford' } })).status).toBe(200);
    const now = (await admin.get(`/api/seasons/${id}`)).json;
    expect(now.weeks[0].matches).toEqual([]);
    expect(now.teams).toHaveLength(8);
    expect((await admin.put(`/api/admin/seasons/${id}`, { settings: { ...s.settings, format: 'nope' } })).status).toBe(400);
    await admin.put(`/api/admin/seasons/${id}/weeks/1/scores`, { scores: [{ playerId: 1, holes: holes(4) }] });
    expect((await admin.put(`/api/admin/seasons/${id}`, { settings: { ...s.settings, format: 'stroke' } })).status).toBe(400);
  });
});

describe('group rounds', () => {
  const par = [4, 4, 3, 5, 4, 4, 3, 5, 4];
  const zeros = Array(9).fill(0);
  const base = { playedOn: '2026-06-01', courseId: null, courseName: 'Muni', tee: null, firstHole: 1, par, notes: null, yardage: null, hcp: null, stats: null };

  it('shares a live round with a registered friend and a guest, who can all keep score', async () => {
    const pat = await signIn('pat@example.com');
    const sam = await signIn('sam@example.com');
    const samId = (await sam.get('/api/me')).json.user.id;
    expect((await pat.post('/api/my/golfers/find', { email: 'sam@example.com' })).json).toEqual({ userId: samId, name: 'sam' });
    expect((await pat.post('/api/my/golfers/find', { email: 'nobody@example.com' })).status).toBe(404);

    const created = await pat.post('/api/my/rounds', {
      ...base,
      live: true,
      holes: zeros,
      handicap: 10,
      players: [
        { idx: 1, name: 'Sam', userId: samId, handicap: 4, holes: zeros },
        { idx: 2, name: 'Uncle Bob', userId: null, handicap: null, holes: zeros },
      ],
      game: { id: 'skins', handicaps: 'full', stakes: 'money', unit: 2 },
    });
    expect(created.status).toBe(200);
    const id = created.json.id;

    // Sam sees it in My rounds as player 1, and can score anyone's hole.
    const samRounds = (await sam.get('/api/my/rounds')).json;
    expect(samRounds).toHaveLength(1);
    expect(samRounds[0]).toMatchObject({ id, me: 1, ownerName: 'pat', live: true, game: { id: 'skins', carryover: true, unit: 2 } });
    expect(samRounds[0].notes).toBeNull();
    expect((await sam.put(`/api/my/rounds/${id}/score`, { idx: 0, hole: 0, score: 5 })).status).toBe(200);
    expect((await sam.put(`/api/my/rounds/${id}/score`, { idx: 1, hole: 0, score: 4 })).status).toBe(200);

    // Only the owner makes guest links; the guest opens just this round and scores it.
    expect((await sam.post(`/api/my/rounds/${id}/players/2/link`)).status).toBe(403);
    const { url } = (await pat.post(`/api/my/rounds/${id}/players/2/link`)).json;
    const token = url.split('/g/')[1];
    const guest = client();
    const seen = (await guest.get(`/api/guest/${token}`)).json;
    expect(seen).toMatchObject({ id, me: 2, holes: [5, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(seen.players[0].holes[0]).toBe(4);
    expect((await guest.put(`/api/guest/${token}/score`, { idx: 2, hole: 0, score: 6 })).status).toBe(200);
    expect((await guest.put(`/api/guest/${token}/score`, { idx: 9, hole: 0, score: 6 })).status).toBe(400);
    expect((await client().get('/api/guest/not-a-token')).status).toBe(404);
    // The guest can't see anything else.
    expect((await guest.get('/api/my/rounds')).status).toBe(401);

    const now = (await pat.get(`/api/my/rounds/${id}`)).json;
    expect([now.holes[0], now.players[0].holes[0], now.players[1].holes[0]]).toEqual([5, 4, 6]);
    expect(now.players[1].hasLink).toBe(true);

    // A new link replaces the old one; saving the round keeps the current link working.
    const { url: url2 } = (await pat.post(`/api/my/rounds/${id}/players/2/link`)).json;
    expect((await guest.get(`/api/guest/${token}`)).status).toBe(404);
    // Finishing: the owner's card is complete; friends who stopped early can have blank holes.
    const done = { ...now, live: false, holes: Array(9).fill(5), notes: 'fun' };
    expect((await pat.put(`/api/my/rounds/${id}`, done)).status).toBe(200);
    expect((await client().get(`/api/guest/${url2.split('/g/')[1]}`)).status).toBe(200);

    // Strangers can't open it.
    const kim = await signIn('kim@example.com');
    expect((await kim.get(`/api/my/rounds/${id}`)).status).toBe(404);
    expect((await kim.put(`/api/my/rounds/${id}/score`, { idx: 0, hole: 1, score: 3 })).status).toBe(403);
  });

  it('checks the game fits the group, and records the wolf’s picks', async () => {
    const pat = await signIn('pat@example.com');
    const players = [1, 2, 3].map((idx) => ({ idx, name: `P${idx}`, userId: null, handicap: null, holes: zeros }));
    const round = { ...base, live: true, holes: zeros, handicap: null, players };
    expect((await pat.post('/api/my/rounds', { ...round, players: players.slice(0, 1), game: { id: 'wolf', handicaps: 'off', stakes: 'points', unit: 1 } })).status).toBe(400);
    const id = (await pat.post('/api/my/rounds', { ...round, game: { id: 'wolf', handicaps: 'off', stakes: 'points', unit: 1 } })).json.id;
    expect((await pat.put(`/api/my/rounds/${id}/wolf`, { hole: 0, choice: 2 })).status).toBe(200);
    expect((await pat.put(`/api/my/rounds/${id}/wolf`, { hole: 1, choice: 'lone' })).status).toBe(200);
    expect((await pat.get(`/api/my/rounds/${id}`)).json.game.wolf.slice(0, 3)).toEqual([2, 'lone', null]);
  });
});

describe('health and usage', () => {
  it('answers the uptime check without signing in', async () => {
    const r = await client().get('/api/health');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, database: 'ok' });
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('shows site usage to site admins only', async () => {
    const { admin } = await setUpSeason();
    const pat = await signIn('pat@example.com');
    expect((await pat.get('/api/admin/site')).status).toBe(403);
    const site = (await admin.get('/api/admin/site')).json;
    expect(site.accounts).toMatchObject({ active: 1, signedInMonth: 1 });
    expect(site.leagues[0]).toMatchObject({ name: 'Fairways and Greens', seasons: 1, current_season: '2026 League', players: 8 });
    expect(site.recent.length).toBeGreaterThan(0);
  });
});

describe('deleting a group round', () => {
  it('removes it for everyone', async () => {
    const zeros = Array(9).fill(0);
    const pat = await signIn('pat@example.com');
    const sam = await signIn('sam@example.com');
    const samId = (await sam.get('/api/me')).json.user.id;
    const id = (await pat.post('/api/my/rounds', {
      playedOn: '2026-06-01', courseId: null, courseName: 'Muni', tee: null, firstHole: 1, par: [4, 4, 3, 5, 4, 4, 3, 5, 4], notes: null, yardage: null, hcp: null, stats: null,
      live: true, holes: zeros, handicap: null, players: [{ idx: 1, name: 'Sam', userId: samId, handicap: null, holes: zeros }, { idx: 2, name: 'Bob', userId: null, handicap: null, holes: zeros }], game: null,
    })).json.id;
    await pat.post(`/api/my/rounds/${id}/players/2/link`);
    // A friend leaving only takes it off their own list; only the starter can delete it.
    expect((await sam.del(`/api/my/rounds/${id}/me`)).status).toBe(200);
    expect((await sam.get('/api/my/rounds')).json).toEqual([]);
    await sam.del(`/api/my/rounds/${id}`);
    expect((await pat.get('/api/my/rounds')).json).toHaveLength(1);
    const del = await pat.del(`/api/my/rounds/${id}`);
    expect(del.status).toBe(200);
    expect((await pat.get('/api/my/rounds')).json).toEqual([]);
    expect((await sam.get('/api/my/rounds')).json).toEqual([]);
  });
});

describe('calendar feed', () => {
  it('serves a member an .ics of their schedule with their own match, and resets the link', async () => {
    const { admin, id } = await setUpSeason();
    const a1 = await signIn('a1@example.com'); // Player 1, Team 1, linked by email

    const got = (await a1.get('/api/my/calendar')).json;
    expect(got.url).toMatch(/\/api\/calendar\/[\w-]+\.ics$/);
    const token = got.url.match(/calendar\/([\w-]+)\.ics/)[1];

    // The feed is raw iCalendar text, not JSON.
    const feed = await anonText(`/api/calendar/${token}.ics`);
    expect(feed.status).toBe(200);
    expect(feed.contentType).toContain('text/calendar');
    const raw = feed.text;
    expect(raw).toContain('BEGIN:VCALENDAR');
    const summaries = [...raw.matchAll(/SUMMARY:(.+)/g)].map((m) => m[1].trim());
    expect(summaries[0]).toMatch(/^Fairways and Greens: Week 1 vs Team \d/); // league name, with the round-robin opponent
    expect(summaries[3]).toBe('Fairways and Greens: Week 4 (Playoffs)'); // playoff week has no matchup yet
    expect((raw.match(/BEGIN:VEVENT/g) ?? []).length).toBe(4); // 4 scheduled weeks
    expect(raw.endsWith('END:VCALENDAR\r\n')).toBe(true);

    // A bad token is a plain 404; resetting makes the old link stop working.
    expect((await anonText('/api/calendar/nope.ics')).status).toBe(404);
    const fresh = (await a1.post('/api/my/calendar/reset')).json.url;
    expect(fresh).not.toBe(got.url);
    expect((await anonText(`/api/calendar/${token}.ics`)).status).toBe(404);

    // Someone not in the league gets an empty but valid calendar.
    const stranger = await signIn('nobody@example.com');
    const theirToken = (await stranger.get('/api/my/calendar')).json.url.match(/calendar\/([\w-]+)\.ics/)[1];
    const empty = await anonText(`/api/calendar/${theirToken}.ics`);
    expect(empty.text).toContain('BEGIN:VCALENDAR');
    expect(empty.text).not.toContain('BEGIN:VEVENT');
    expect(admin).toBeTruthy();
  });

  // Raw body + headers (the normal client parses JSON, which this route isn't).
  async function anonText(path: string) {
    const req = new Request('http://localhost' + path, { method: 'GET' });
    const res = await (onRequest as unknown as (ctx: unknown) => Promise<Response>)({ request: req, env, params: {}, data: {}, waitUntil() {}, passThroughOnException() {}, next() {} });
    return { status: res.status, text: await res.text(), contentType: res.headers.get('Content-Type') ?? '' };
  }
});

describe('custom domain redirect', () => {
  const hit = async (url: string) => {
    const res = await (onRequest as unknown as (ctx: unknown) => Promise<Response>)({ request: new Request(url, { redirect: 'manual' }), env, params: {}, data: {}, waitUntil() {}, passThroughOnException() {}, next() {} });
    return { status: res.status, location: res.headers.get('Location') };
  };
  // The optional legacy-host redirect is off by default (BRAND.legacyHost is ''); set it to migrate
  // an old host to your domain. With it unset, the site and preview deploys serve normally.
  it('serves the site and preview deploys without redirecting by default', async () => {
    expect((await hit('https://example.com/api/health')).status).toBe(200);
    expect((await hit('https://abc123.example-preview.pages.dev/api/health')).status).toBe(200); // preview deploy
  });
});

describe('green coordinates (GPS)', () => {
  it('saves and returns front/center/back green points, rejecting bad ones', async () => {
    const { admin, id } = await setUpSeason();
    const season = (await admin.get(`/api/seasons/${id}`)).json;
    const greens = Array(9).fill(null);
    greens[0] = { f: [39.8797, -105.0528], c: [39.88, -105.0528], b: [39.8803, -105.0528] };
    greens[1] = { c: [39.8795, -105.051] }; // center only is fine
    const nines = season.nines.map((n: any, i: number) => (i === 0 ? { ...n, greens } : n));
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines })).status).toBe(200);

    const back = (await admin.get(`/api/seasons/${id}`)).json.nines[0].greens;
    expect(back[0]).toEqual({ f: [39.8797, -105.0528], c: [39.88, -105.0528], b: [39.8803, -105.0528] });
    expect(back[1]).toEqual({ c: [39.8795, -105.051] });
    expect(back[2]).toBeNull();

    // Out-of-range coordinates are refused.
    const bad = season.nines.map((n: any, i: number) => (i === 0 ? { ...n, greens: [{ c: [200, -105] }] } : n));
    expect((await admin.put(`/api/admin/seasons/${id}`, { nines: bad })).status).toBe(400);

    // Players see the green points too (for on-course distances).
    const a1 = await signIn('a1@example.com');
    expect((await a1.get(`/api/seasons/${id}`)).json.nines[0].greens[0].c).toEqual([39.88, -105.0528]);
  });
});

describe('absent rule setting', () => {
  it('saves the 2-vs-1 best-ball option', async () => {
    const { admin, id } = await setUpSeason();
    const s = (await admin.get(`/api/seasons/${id}`)).json;
    expect(s.settings.absentRule).toBe('virtual'); // default
    expect((await admin.put(`/api/admin/seasons/${id}`, { settings: { ...s.settings, absentRule: 'bestBall' } })).status).toBe(200);
    expect((await admin.get(`/api/seasons/${id}`)).json.settings.absentRule).toBe('bestBall');
    // An unknown value falls back to virtual.
    await admin.put(`/api/admin/seasons/${id}`, { settings: { ...s.settings, absentRule: 'nonsense' } });
    expect((await admin.get(`/api/seasons/${id}`)).json.settings.absentRule).toBe('virtual');
  });
});

describe('account privacy & CSRF', () => {
  it('blocks cross-site state-changing requests but allows our own origins', async () => {
    const c = await signIn('pat@example.com');
    const call = (origin?: string) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      if (origin) headers.Origin = origin;
      return (onRequest as unknown as (ctx: unknown) => Promise<Response>)({ request: new Request('https://example.com/api/my/profile', { method: 'PUT', headers, body: JSON.stringify({ name: 'Pat' }) }), env, params: {}, data: {}, waitUntil() {}, passThroughOnException() {}, next() {} });
    };
    expect((await call('https://evil.example')).status).toBe(403);
    expect((await call('https://example.com')).status).toBe(200);
    expect((await call('https://abc.example-preview.pages.dev')).status).toBe(200);
    expect((await call(undefined)).status).toBe(200); // non-browser client (no Origin)
  });

  it('exports and deletes a user’s own data', async () => {
    const { admin, id } = await setUpSeason();
    const sam = await signIn('sam@example.com');
    const samId = (await sam.get('/api/me')).json.user.id;
    // Give Sam a round.
    await sam.post('/api/my/rounds', { playedOn: '2026-06-01', courseId: null, courseName: 'Muni', tee: null, firstHole: 1, par: [4, 4, 3, 5, 4, 4, 3, 5, 4], notes: null, yardage: null, hcp: null, stats: null, live: false, holes: Array(9).fill(4), handicap: null, players: [], game: null });

    const data = (await sam.get('/api/my/data')).json;
    expect(data.profile.email).toBe('sam@example.com');
    expect(data.rounds).toHaveLength(1);

    expect((await sam.del('/api/my/account')).status).toBe(200);
    // Signed out, and the account is gone.
    expect((await sam.get('/api/me')).json.user).toBeNull();
    expect((await admin.get('/api/admin/accounts?all')).json.find((a: any) => a.id === samId)).toBeUndefined();
  });
});

describe('notifications', () => {
  async function pending(c: any) {
    // /push/pending returns JSON; the normal client already parses it.
    return (await c.get('/api/push/pending')).json;
  }
  it('queues notifications for league members on a new board post, and the device fetches them', async () => {
    await setUpSeason();
    const a1 = await signIn('a1@example.com'); // member (player 1 by email)
    const a2 = await signIn('a2@example.com'); // member (player 2 by email)
    await a1.post('/api/board', { body: 'Tee times posted!', leagueId: 1 });
    expect(await pending(a1)).toEqual([]); // the author isn't notified
    const forA2 = await pending(a2);
    expect(forA2[0]).toMatchObject({ title: 'Message board', url: '/board' });
    expect(forA2[0].body).toContain('Tee times');
    expect(await pending(a2)).toEqual([]); // fetching marks them delivered
  });

  it('lets a device subscribe and unsubscribe', async () => {
    const a1 = await signIn('a1@example.com');
    expect((await a1.post('/api/push/subscribe', { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } })).status).toBe(200);
    expect((await a1.post('/api/push/subscribe', { endpoint: 'https://push.example/abc', keys: {} })).status).toBe(400);
    expect((await a1.post('/api/push/unsubscribe', { endpoint: 'https://push.example/abc' })).status).toBe(200);
    expect((await a1.get('/api/push/key')).json).toEqual({ key: null, configured: false }); // no VAPID in tests
  });

  it('reminds players of a match dated today, only with the cron key', async () => {
    const admin = client();
    await admin.post('/api/login', { password: 'pw' });
    const today = new Date().toISOString().slice(0, 10);
    const created = await admin.post('/api/admin/seasons', {
      season: { name: 'Today' }, nines: [nine('front')], teams: [1, 2].map((id) => ({ id, name: `T${id}` })),
      players: [player(1, 1, 'a1@example.com'), player(2, 2, 'a2@example.com')], weeks: [], makeCurrent: true,
    });
    const id = created.json.id;
    await admin.post(`/api/admin/seasons/${id}/schedule`, { startDate: today, weeks: 1, playoffWeeks: 0, nineIds: ['front'], slots: [] });
    const a1 = await signIn('a1@example.com'); // links to player 1 by email, so there's someone to remind
    env.CRON_SECRET = 'cron-key';
    const req = (key?: string) => new Request('http://localhost/api/cron/reminders', { method: 'POST', headers: key ? { 'X-Cron-Key': key } : {} });
    const run = (r: Request) => (onRequest as unknown as (ctx: unknown) => Promise<Response>)({ request: r, env, params: {}, data: {}, waitUntil() {}, passThroughOnException() {}, next() {} });
    expect((await run(req())).status).toBe(403);
    const res = await run(req('cron-key'));
    expect(res.status).toBe(200);
    expect((await a1.get('/api/push/pending')).json[0]).toMatchObject({ title: 'Match today', url: '/play' });
  });
});
