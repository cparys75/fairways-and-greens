import type { CardEntry, Consensus, CourseInfo, CourseSummary, Format, GameSetup, Match, Nine, Player, RoundStats, SchedulePlan, SeasonData, Score, Settings, Submission, Team } from '../engine';

export interface SeasonSummary {
  id: number;
  name: string;
  isCurrent: boolean;
  updatedAt: string;
}

export type Provider = 'google';

export interface LeagueAccess {
  id: number;
  name: string;
  /** Super admins are admins of every league. */
  role: 'admin' | 'member';
}

export interface Me {
  /** Runs every league and the site (an is_admin account, or the admin password). */
  superAdmin: boolean;
  canCreateLeagues: boolean;
  /** Leagues you can see. */
  leagues: LeagueAccess[];
  /** Leagues you've asked to join, waiting on their admins. */
  requested: { id: number; name: string }[];
  user: { id: number; name: string | null; email: string | null; isAdmin: boolean } | null;
  providers: Provider[];
  /** Email-code sign-in is available (Resend configured). */
  emailLogin: boolean;
  /** The emergency admin password is configured. */
  adminPassword: boolean;
  devLogin: boolean;
}

export interface MyMatch {
  week: number;
  date: string | null;
  nineId: string;
  playoff: boolean;
  teamA: number;
  teamB: number;
  playerIds: [number[], number[]];
  forfeit: boolean;
  /** Scores currently in the standings for this match's players. */
  official: CardEntry[];
  consensus: Consensus;
  /** Others' cards are null until you've entered your own. */
  submissions: { name: string | null; teamId: number; cards: CardEntry[] | null; updatedAt: string; mine: boolean }[];
  /** Why entry isn't possible (forfeit, or before match day). */
  blocked: string | null;
}

export interface Round {
  id?: number;
  playedOn: string;
  courseId: string | null;
  courseName: string;
  tee: string | null;
  firstHole: number;
  par: number[];
  holes: number[];
  notes: string | null;
  yardage: number[] | null;
  /** Hole handicaps (stroke index 1-18). */
  hcp: number[] | null;
  /** Fairways, greens in regulation and putts, when tracked (the owner's own). */
  stats?: RoundStats | null;
  /** The owner's handicap for this round's game. */
  handicap?: number | null;
  game?: GameSetup | null;
  /** Still being played: holes not reached yet are 0. */
  live?: boolean;
  /** Everyone else in the group (the owner is player 0). */
  players?: RoundPlayer[];
  ownerId?: number;
  ownerName?: string | null;
  /** Which player you are: 0 = you started the round. */
  me?: number;
}

export interface RoundPlayer {
  idx: number;
  name: string;
  userId: number | null;
  handicap: number | null;
  /** 0 = not played yet. */
  holes: number[];
  hasLink?: boolean;
}

export interface Golfer {
  userId: number;
  name: string;
}

export interface Post {
  id: number;
  userId: number;
  author: string;
  body: string;
  pinned: boolean;
  /** UTC, "YYYY-MM-DD HH:MM:SS". */
  createdAt: string;
  replies: Post[];
}

export interface Profile {
  name: string | null;
  email: string | null;
  phone: string | null;
  smsOk: boolean;
}

export interface Contact {
  playerId: number;
  name: string;
  teamId: number | null;
  active: boolean;
  hasAccount: boolean;
  email: string | null;
  phone: string | null;
  smsOk: boolean;
}

export interface Account {
  id: number;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  isAdmin: boolean;
  status: 'active' | 'pending' | 'disabled';
  hasPassword: boolean;
  providers: string[];
  createdAt: string;
  lastLoginAt: string | null;
  playerId: number | null;
  manualLink: boolean;
  canCreateLeagues: boolean;
  leagueRole: 'requested' | 'member' | 'admin' | null;
}

export interface LeagueDetails {
  id: number;
  name: string;
  joinCode: string;
  /** Admins, members who aren't on a roster, and requests to join. */
  members: { userId: number; name: string | null; email: string | null; role: 'requested' | 'member' | 'admin'; pendingAccount: boolean; since: string }[];
}

/** Counts of actions waiting on a league admin, for the nudge badges. */
export interface AdminTodo {
  /** Matches with player cards not yet official. */
  scores: number;
  /** People asking to join the league. */
  requests: number;
  /** Approved members not yet linked to a roster player this season. */
  unlinked: number;
  total: number;
}

export interface SiteUsage {
  accounts: { active: number; pending: number; disabled: number; signedInWeek: number; signedInMonth: number; newMonth: number };
  rounds: { total: number; month: number; live: number; groups: number; guestLinks: number };
  activity: { leagueScoresMonth: number; postsMonth: number; changesDay: number };
  leagues: { id: number; name: string; created_at: string; seasons: number; current_season: string | null; players: number; admins: number; requests: number; last_activity: string | null }[];
  recent: { at: string; action: string; detail: string | null; league: string | null }[];
  databaseBytes: number | null;
}

/** No connection (as opposed to the server answering with an error). */
export class OfflineError extends Error {
  constructor() {
    super('No connection');
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new OfflineError();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export const api = {
  seasons: (leagueId: number) => call<SeasonSummary[]>('GET', `/seasons?league=${leagueId}`),
  season: (id: number | 'current') => call<SeasonData>('GET', `/seasons/${id}`),
  me: () => call<Me>('GET', '/me'),
  login: (password: string) => call('POST', '/login', { password }),
  devLogin: (email: string, admin: boolean) => call('POST', '/auth/dev', { email, admin }),
  requestCode: (email: string, joinCode?: string | null) => call<{ sent: boolean; devCode?: string }>('POST', '/auth/otp/request', { email, joinCode: joinCode || undefined }),
  verifyCode: (email: string, code: string, joinCode?: string | null) => call('POST', '/auth/otp/verify', { email, code, joinCode: joinCode || undefined }),
  joinInfo: (code: string) => call<{ name: string }>('GET', `/join/${encodeURIComponent(code)}`),
  joinLeague: (code: string) => call<{ status: 'member' | 'requested'; id: number; name: string }>('POST', '/leagues/join', { code }),
  createLeague: (name: string) => call<{ id: number }>('POST', '/leagues', { name }),
  pushKey: () => call<{ key: string | null; configured: boolean }>('GET', '/push/key'),
  pushSubscribe: (endpoint: string, keys: { p256dh: string; auth: string }) => call('POST', '/push/subscribe', { endpoint, keys }),
  pushUnsubscribe: (endpoint: string) => call('POST', '/push/unsubscribe', { endpoint }),
  pushTest: () => call<{ ok: boolean; configured: boolean }>('POST', '/push/test'),
  myData: () => call<Record<string, unknown>>('GET', '/my/data'),
  deleteAccount: () => call('DELETE', '/my/account'),
  calendar: () => call<{ url: string }>('GET', '/my/calendar'),
  resetCalendar: () => call<{ url: string }>('POST', '/my/calendar/reset'),
  logout: () => call('POST', '/logout'),

  myMatches: (seasonId: number) =>
    call<{ seasonId: number | null; playerId: number | null; matches: MyMatch[]; field?: boolean }>('GET', `/my/matches?season=${seasonId}`),
  submitCard: (seasonId: number, week: number, cards: CardEntry[]) =>
    call<{ status: Consensus['status']; missingTeams: number[]; differences: Consensus['differences'] }>('PUT', `/my/matches/${seasonId}/${week}`, { cards }),
  rounds: () => call<Round[]>('GET', '/my/rounds'),
  profile: () => call<Profile>('GET', '/my/profile'),
  saveProfile: (p: { name: string; phone: string | null; smsOk: boolean }) => call<{ phone: string | null }>('PUT', '/my/profile', p),
  board: (leagueId: number) => call<Post[]>('GET', `/board?league=${leagueId}`),
  post: (leagueId: number, body: string, parentId?: number) => call<{ id: number }>('POST', '/board', { body, parentId, leagueId }),
  deletePost: (id: number) => call('DELETE', `/board/${id}`),
  pinPost: (id: number, pinned: boolean) => call('PUT', `/board/${id}/pin`, { pinned }),
  saveRound: (r: Round) => (r.id ? call<{ id: number }>('PUT', `/my/rounds/${r.id}`, r) : call<{ id: number }>('POST', '/my/rounds', r)),
  deleteRound: (id: number) => call('DELETE', `/my/rounds/${id}`),
  round: (id: number) => call<Round>('GET', `/my/rounds/${id}`),
  leaveRound: (id: number) => call('DELETE', `/my/rounds/${id}/me`),
  roundScore: (id: number, idx: number, hole: number, score: number) => call('PUT', `/my/rounds/${id}/score`, { idx, hole, score }),
  roundWolf: (id: number, hole: number, choice: number | 'lone' | null) => call('PUT', `/my/rounds/${id}/wolf`, { hole, choice }),
  guestLink: (id: number, idx: number) => call<{ url: string }>('POST', `/my/rounds/${id}/players/${idx}/link`),
  golfers: () => call<Golfer[]>('GET', '/my/golfers'),
  findGolfer: (email: string) => call<Golfer>('POST', '/my/golfers/find', { email }),
  guestRound: (token: string) => call<Round>('GET', `/guest/${encodeURIComponent(token)}`),
  guestScore: (token: string, idx: number, hole: number, score: number) => call('PUT', `/guest/${encodeURIComponent(token)}/score`, { idx, hole, score }),
  guestWolf: (token: string, hole: number, choice: number | 'lone' | null) => call('PUT', `/guest/${encodeURIComponent(token)}/wolf`, { hole, choice }),
  searchCourses: (q: string) => call<CourseSummary[]>('GET', `/courses/search?q=${encodeURIComponent(q)}`),
  course: (id: string) => call<CourseInfo>('GET', `/courses/${encodeURIComponent(id)}`),

  createSeason: (
    body: ({ name: string; copyFrom?: number; nines?: Nine[]; schedule?: SchedulePlan; format?: Format } | (SeasonData & { makeCurrent?: boolean })) & { leagueId: number },
  ) => call<{ id: number }>('POST', '/admin/seasons', body),
  updateSeason: (id: number, body: { name?: string; settings?: Settings; nines?: Nine[]; replaceNines?: Record<string, string>; isCurrent?: boolean }) =>
    call('PUT', `/admin/seasons/${id}`, body),
  deleteSeason: (id: number) => call('DELETE', `/admin/seasons/${id}`),
  generateSchedule: (id: number, plan: SchedulePlan) => call<{ weeks: number }>('POST', `/admin/seasons/${id}/schedule`, plan),
  saveRoster: (id: number, teams: Team[], players: Player[]) => call('PUT', `/admin/seasons/${id}/roster`, { teams, players }),
  saveWeek: (id: number, n: number, week: { date?: string | null; nineId: string; playoff?: boolean; inclement?: boolean; matches: Match[] }) =>
    call('PUT', `/admin/seasons/${id}/weeks/${n}`, week),
  deleteWeek: (id: number, n: number) => call('DELETE', `/admin/seasons/${id}/weeks/${n}`),
  saveScores: (id: number, n: number, scores: Score[], matches: Match[]) =>
    call('PUT', `/admin/seasons/${id}/weeks/${n}/scores`, { scores, matches }),
  submissions: (id: number, n: number) =>
    call<{ teamA: number; teamB: number; consensus: Consensus; submissions: (Submission & { name: string | null })[] }[]>('GET', `/admin/seasons/${id}/weeks/${n}/submissions`),
  pendingCards: (id: number) =>
    call<{ week: number; teamA: number; teamB: number; status: Consensus['status']; missingTeams: number[]; names: (string | null)[] }[]>('GET', `/admin/seasons/${id}/pending-cards`),
  acceptCard: (id: number, week: number, teamA: number, teamB: number, userId: number) => call('POST', `/admin/seasons/${id}/weeks/${week}/accept`, { teamA, teamB, userId }),
  shiftSchedule: (id: number, fromWeek: number, days = 7) => call<{ weeks: number }>('POST', `/admin/seasons/${id}/shift`, { fromWeek, days }),
  contacts: (id: number) => call<Contact[]>('GET', `/admin/seasons/${id}/contacts`),
  accounts: (leagueId: number, seasonId: number | null, all = false) =>
    call<Account[]>('GET', `/admin/accounts?league=${leagueId}${seasonId ? `&season=${seasonId}` : ''}${all ? '&all' : ''}`),
  setCanCreateLeagues: (userId: number, canCreateLeagues: boolean) => call('PUT', `/admin/accounts/${userId}`, { canCreateLeagues }),
  setAdmin: (userId: number, isAdmin: boolean) => call('PUT', `/admin/accounts/${userId}`, { isAdmin }),
  setStatus: (userId: number, status: 'active' | 'disabled') => call('PUT', `/admin/accounts/${userId}`, { status }),
  linkAccount: (seasonId: number, userId: number, playerId: number | null) => call('PUT', `/admin/seasons/${seasonId}/links`, { userId, playerId }),
  audit: (leagueId: number) => call<{ id: number; at: string; season_id: number; action: string; detail: string | null }[]>('GET', `/admin/audit?league=${leagueId}`),
  site: () => call<SiteUsage>('GET', '/admin/site'),
  adminTodo: (leagueId: number, seasonId: number | null) =>
    call<AdminTodo>('GET', `/admin/leagues/${leagueId}/todo${seasonId ? `?season=${seasonId}` : ''}`),
  league: (id: number) => call<LeagueDetails>('GET', `/admin/leagues/${id}`),
  renameLeague: (id: number, name: string) => call('PUT', `/admin/leagues/${id}`, { name }),
  newJoinCode: (id: number) => call<{ joinCode: string }>('POST', `/admin/leagues/${id}/join-code`),
  setLeagueRole: (id: number, userId: number, role: 'member' | 'admin' | null) => call('PUT', `/admin/leagues/${id}/members/${userId}`, { role }),
};
