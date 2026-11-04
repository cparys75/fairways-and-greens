import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { formatInfo } from '../../engine';
import { api } from '../api';
import { useSeason } from '../season';

export function AdminLayout() {
  const { admin, me, refreshMe, data, league, loading, superAdmin, seasons, seasonId, setSeasonId, todo } = useSeason();
  const location = useLocation();
  if (!me) return <p className="empty">Loading…</p>;
  if (!admin) {
    if (location.pathname === '/admin/password') return <PasswordLogin onDone={refreshMe} />;
    return <p className="notice">Your account ({me.user?.email}) isn’t an admin of {league?.name ?? 'this league'}. The league’s admin can give you access under Admin → League.</p>;
  }
  const needsSeason = !['/admin/seasons', '/admin/new-season', '/admin/accounts', '/admin/league', '/admin/site'].some((p) => location.pathname.startsWith(p));
  return (
    <>
      {seasons.length > 0 && (
        <div className="toolbar admin-season">
          <label className="field">
            <span>Editing season</span>
            <select value={seasonId ?? ''} onChange={(e) => setSeasonId(Number(e.target.value))}>
              {seasons.map((seas) => (
                <option key={seas.id} value={seas.id}>{seas.name}{seas.isCurrent ? ' · current' : ''}</option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <span className="small muted">{league?.name}</span>
        </div>
      )}
      <nav className="admin-nav" aria-label="Admin">
        <NavLink to="/admin" end>Enter scores<NavBadge n={todo?.scores} /></NavLink>
        <NavLink to="/admin/schedule">Schedule</NavLink>
        <NavLink to="/admin/roster">{data && formatInfo(data.settings).individual ? 'Players' : 'Teams & players'}</NavLink>
        <NavLink to="/admin/settings">Rules &amp; course</NavLink>
        <NavLink to="/admin/greens">Greens (GPS)</NavLink>
        <NavLink to="/admin/league">League<NavBadge n={todo?.requests} /></NavLink>
        <NavLink to="/admin/accounts">Accounts<NavBadge n={todo?.unlinked} /></NavLink>
        <NavLink to="/admin/contacts">Contacts</NavLink>
        <NavLink to="/admin/seasons">Seasons &amp; data</NavLink>
        {superAdmin && <NavLink to="/admin/site">Site</NavLink>}
        <span style={{ flex: 1 }} />
        <NavLink to="/admin/new-season" className="button primary">+ New season</NavLink>
      </nav>
      {data || !needsSeason ? <Outlet /> : loading ? <p className="empty">Loading…</p> : <p className="notice">Start {league?.name ?? 'the league'}’s first season with “+ New season”.</p>}
    </>
  );
}

/** A small count bubble on an admin tab when something is waiting. */
function NavBadge({ n }: { n?: number }) {
  if (!n) return null;
  return <span className="nav-badge" title={`${n} waiting`}>{n}</span>;
}

/** Emergency fallback: the shared league admin password. */
function PasswordLogin({ onDone }: { onDone: () => Promise<void> }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.login(password);
      await onDone();
      navigate('/admin');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h1>Admin password</h1>
      <p className="small muted">For emergencies, or to give the first admin account access. Normally admins sign in with Google.</p>
      <label className="field">
        <span>League admin password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </label>
      {error && <p className="error">{error}</p>}
      <p><button className="primary" type="submit">Sign in</button></p>
    </form>
  );
}
