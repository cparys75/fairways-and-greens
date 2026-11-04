import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeSeason, type SeasonData, type SeasonResult } from '../engine';
import { api, type AdminTodo, type LeagueAccess, type Me, type SeasonSummary } from './api';

interface SeasonState {
  /** Leagues you can see, and the one you're looking at. */
  leagues: LeagueAccess[];
  league: LeagueAccess | null;
  leagueId: number | null;
  setLeagueId: (id: number) => void;
  superAdmin: boolean;
  seasons: SeasonSummary[];
  seasonId: number | null;
  setSeasonId: (id: number) => void;
  data: SeasonData | null;
  result: SeasonResult | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Admin of the league you're looking at. */
  admin: boolean;
  /** Counts of actions waiting on the admin (null until loaded, or when not an admin). */
  todo: AdminTodo | null;
  refreshTodo: () => Promise<void>;
  /** Who is signed in, and which sign-in options are set up. */
  me: Me | null;
  refreshMe: () => Promise<void>;
}

/** Exported for tests that render pages with a ready-made season. */
export const SeasonContext = createContext<SeasonState | null>(null);
const Ctx = SeasonContext;
const KEY = 'golf-league.season';
const LEAGUE_KEY = 'golf-league.league';

function stored(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return v || null;
  } catch {
    return null;
  }
}

function store(key: string, id: number) {
  try {
    localStorage.setItem(key, String(id));
  } catch {
    /* private mode */
  }
}

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [seasonId, setSeasonIdState] = useState<number | null>(() => stored(KEY));
  const [chosenLeague, setChosenLeague] = useState<number | null>(() => stored(LEAGUE_KEY));
  const [data, setData] = useState<SeasonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);

  const setSeasonId = useCallback((id: number) => {
    setSeasonIdState(id);
    store(KEY, id);
  }, []);

  const leagues = useMemo(() => me?.leagues ?? [], [me]);
  // The league you last looked at, if you're still in it; otherwise your first.
  const league = leagues.find((l) => l.id === chosenLeague) ?? leagues[0] ?? null;
  const leagueId = league?.id ?? null;
  const setLeagueId = useCallback((id: number) => {
    setChosenLeague(id);
    store(LEAGUE_KEY, id);
    setData(null);
  }, []);

  const reload = useCallback(async () => {
    // League data is only for league members.
    if (!leagueId) {
      setSeasons([]);
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.seasons(leagueId);
      setSeasons(list);
      const id = list.some((s) => s.id === seasonId) ? seasonId! : (list[0]?.id ?? null);
      if (id !== seasonId && id) setSeasonIdState(id);
      setData(id ? await api.season(id) : null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [seasonId, leagueId]);

  // Reloads when membership changes too (signing in or out), and admins see player emails.
  useEffect(() => {
    if (me) void reload();
  }, [reload, me]);

  const refreshMe = useCallback(async () => {
    setMe(await api.me().catch(() => null));
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const result = useMemo(() => (data ? computeSeason(data) : null), [data]);

  const admin = !!me?.superAdmin || league?.role === 'admin';
  const [todo, setTodo] = useState<AdminTodo | null>(null);
  const refreshTodo = useCallback(async () => {
    if (admin && leagueId) setTodo(await api.adminTodo(leagueId, seasonId).catch(() => null));
    else setTodo(null);
  }, [admin, leagueId, seasonId]);
  useEffect(() => {
    void refreshTodo();
  }, [refreshTodo]);

  return (
    <Ctx.Provider
      value={{
        leagues,
        league,
        leagueId,
        setLeagueId,
        superAdmin: !!me?.superAdmin,
        seasons,
        seasonId,
        setSeasonId,
        data,
        result,
        error,
        loading,
        reload,
        admin,
        todo,
        refreshTodo,
        me,
        refreshMe,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSeason(): SeasonState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSeason outside SeasonProvider');
  return s;
}

/** For pages that need loaded data: returns it, or null while the caller renders a placeholder. */
export function useLoaded() {
  const s = useSeason();
  return s.data && s.result ? { ...s, data: s.data, result: s.result } : null;
}
