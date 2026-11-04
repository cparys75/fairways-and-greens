import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { BRAND } from '../../brand';
import { dismiss, useOutbox } from '../offline';
import { SignInPage } from '../pages/SignIn';
import { useSeason } from '../season';

const LEAGUE_PATHS = ['/standings', '/results', '/schedule', '/board', '/handicaps', '/players', '/records', '/stats', '/rules'];
/** Pages reachable without signing in. */
const OPEN_PATHS = ['/join', '/g/', '/privacy', '/admin/password'];

/** App shell: everything is behind sign-in; phones get a bottom tab bar, scoring screens go full screen. */
export function Layout() {
  const { me, admin, league, leagues, setLeagueId, todo } = useSeason();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!me) return <div className="splash">Loading…</div>;
  const open = OPEN_PATHS.some((p) => pathname.startsWith(p));
  if (!me.user && !me.superAdmin && !open) return <SignInPage />;
  // Guests opening a round link see just that round, signed in or not.
  if (pathname.startsWith('/g/') || pathname.startsWith('/privacy') || (pathname.startsWith('/join') && !me.user)) return <Outlet />;

  // Entering scores hole by hole: no navigation in the way.
  const focus = /^\/(play\/\d+|rounds\/(new|\d+))/.test(pathname);
  const inLeague = LEAGUE_PATHS.some((p) => pathname.startsWith(p));
  const tabs = [
    { to: '/', label: 'Home', icon: '⌂', end: true, show: true },
    { to: '/standings', label: 'League', icon: '🏆', show: !!league, active: inLeague },
    { to: '/play', label: 'Score', icon: '✎', show: !!league && !!me.user },
    { to: '/rounds', label: 'My rounds', icon: '⛳', show: !!me.user },
    { to: '/admin', label: 'Admin', icon: '⚙', show: admin, badge: todo?.total ?? 0 },
  ].filter((t) => t.show);

  const signOut = async () => {
    await api.logout();
    location.assign('/');
  };
  const first = me.user?.name?.split(' ')[0] ?? me.user?.email?.split('@')[0];

  return (
    <>
      <header className={`site-header ${focus ? 'slim' : ''}`}>
        <div className="wrap header-row">
          <NavLink to="/" className="brand">
            <img className="brand-mark" src={BRAND.logoMark} alt="" width={34} height={34} />
            {leagues.length < 2 && <span>{league?.name ?? BRAND.name}</span>}
          </NavLink>
          {leagues.length > 1 && (
            <select className="league-switch" aria-label="League" value={league?.id ?? ''} onChange={(e) => setLeagueId(Number(e.target.value))}>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
          <nav className="top-nav" aria-label="Main">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive || t.active ? 'active' : '')}>
                {t.label}
                {t.badge ? <span className="nav-badge" title={`${t.badge} waiting`}>{t.badge}</span> : null}
              </NavLink>
            ))}
          </nav>
          {me.user ? (
            <NavLink to="/profile" className="header-button" title={`${me.user.email ?? ''} · profile and sign out`}>
              👤 {first}
            </NavLink>
          ) : (
            <button className="header-button" onClick={signOut} title="Signed in with the admin password">Sign out</button>
          )}
        </div>
      </header>
      <main className={`wrap ${focus ? 'focus' : ''}`}>
        <OutboxBanner />
        <Outlet />
      </main>
      {!focus && (
        <nav className="bottom-nav" aria-label="Main">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive || t.active ? 'active' : '')} onClick={() => t.to === pathname && navigate(t.to)}>
              <span className="tab-icon" aria-hidden>{t.icon}{t.badge ? <span className="nav-badge">{t.badge}</span> : null}</span>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}

/** Scores waiting for a connection, and any the server refused. */
function OutboxBanner() {
  const queued = useOutbox();
  if (!queued.length) return null;
  const waiting = queued.filter((q) => !q.error);
  return (
    <div className="outbox">
      {waiting.length > 0 && (
        <p className="notice small">
          {waiting.map((q) => q.job.label).join(', ')} saved on this phone, waiting for a connection to send.
        </p>
      )}
      {queued
        .filter((q) => q.error)
        .map((q) => (
          <p key={q.id} className="error small">
            {q.job.label} couldn’t be sent: {q.error} <button className="link" onClick={() => dismiss(q.id)}>Dismiss</button>
          </p>
        ))}
    </div>
  );
}

/** League pages: members only, with the season switcher and section tabs. */
export function LeagueLayout() {
  const { league, seasons, seasonId, setSeasonId, data, error, loading } = useSeason();
  if (!league) {
    return (
      <p className="notice">
        The league pages are for league members. Open your league’s invite link, or see <Link to="/leagues">Leagues</Link>.
      </p>
    );
  }
  if (!loading && !seasons.length) return <p className="empty">{league.name} has no season yet.</p>;
  const sections = [
    ['/standings', 'Standings'],
    ['/results', 'Results'],
    ['/schedule', 'Schedule'],
    ['/handicaps', 'Handicaps'],
    ['/records', 'Hotshots'],
    ['/stats', 'Stats'],
    ['/rules', 'Rules'],
    ['/board', 'Board'],
  ];
  return (
    <>
      <div className="league-head">
        <strong className="season-name">{data?.season.name ?? 'League'}</strong>
        {seasons.length > 1 && (
          <select aria-label="Season" value={seasonId ?? ''} onChange={(e) => setSeasonId(Number(e.target.value))}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>
      <nav className="chips-nav" aria-label="League">
        {sections.map(([to, label]) => (
          <NavLink key={to} to={to}>{label}</NavLink>
        ))}
      </nav>
      {error && <p className="error">Couldn’t load league data: {error}</p>}
      {loading && !data ? <p className="empty">Loading…</p> : <Outlet />}
    </>
  );
}
