import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type Account } from '../api';
import { useSeason } from '../season';
import { useSaver } from './useSaver';

/**
 * People in the league: which player they are this season. Super admins can also list every account
 * on the site, approve sign-ups that came without an invite link, and grant site-wide roles.
 */
export function AccountsPage() {
  const { data, seasonId, me, leagueId, league, superAdmin, refreshTodo } = useSeason();
  const saver = useSaver();
  const [params, setParams] = useSearchParams();
  const all = superAdmin && params.has('all');
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  const load = useCallback(() => {
    if (leagueId) api.accounts(leagueId, seasonId, all).then(setAccounts, () => setAccounts([]));
  }, [leagueId, seasonId, all]);
  useEffect(load, [load]);

  const run = (fn: () => Promise<unknown>, ok: string) => saver.run(fn, ok).then(load).then(refreshTodo);
  const players = (data?.players ?? []).filter((p) => p.active !== false);
  const taken = new Map((accounts ?? []).filter((a) => a.playerId != null).map((a) => [a.playerId!, a]));
  const missing = players.filter((p) => !taken.has(p.id));

  return (
    <>
      <h1>Accounts</h1>
      <p className="muted small">
        {all ? 'Every account on the site.' : `People in ${league?.name ?? 'the league'}.`} Google accounts are linked to a player automatically when
        the email matches <Link to="/admin/roster">Teams &amp; players</Link>. People who ask to join from the invite link are approved on{' '}
        <Link to="/admin/league">League</Link>; then pick their player here.
      </p>
      {superAdmin && (
        <label className="check small">
          <input type="checkbox" checked={all} onChange={(e) => setParams(e.target.checked ? { all: '' } : {})} /> Show every account on the site (site admin)
        </label>
      )}
      {!accounts ? (
        <p className="empty">Loading…</p>
      ) : !accounts.length ? (
        <p className="empty">Nobody has signed in yet.</p>
      ) : (
        <div className="card table-card scroll">
          <table>
            <thead>
              <tr>
                <th className="left">Account</th>
                <th className="left">Status</th>
                <th className="left">Player in {data?.season.name}</th>
                {superAdmin && <th title="Runs every league and the site">Site admin</th>}
                {superAdmin && <th title="Can start new leagues">Starts leagues</th>}
                <th className="left">Last sign-in (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className={a.status === 'pending' ? 'pending-row' : a.status === 'disabled' ? 'is-virtual' : ''}>
                  <td className="left">
                    {a.name ?? '—'}
                    <div className="small muted">
                      {a.email ?? 'no email'} · {a.providers.includes('google') ? 'Google' : a.providers.includes('email') ? 'email code' : a.hasPassword ? 'password (legacy)' : '—'}
                    </div>
                  </td>
                  <td className="left">
                    {a.leagueRole === 'requested' ? (
                      <Link className="button primary" to="/admin/league">Asked to join ›</Link>
                    ) : a.status === 'pending' ? (
                      superAdmin ? (
                        <button className="primary" disabled={saver.busy} onClick={() => run(() => api.setStatus(a.id, 'active'), `${a.name ?? a.email} approved`)}>Approve</button>
                      ) : (
                        <span className="badge warn">Waiting</span>
                      )
                    ) : a.status === 'disabled' ? (
                      superAdmin ? <button disabled={saver.busy} onClick={() => run(() => api.setStatus(a.id, 'active'), 'Account turned back on')}>Turn on</button> : <span className="badge">Off</span>
                    ) : (
                      <span className="badge ok">{a.leagueRole === 'admin' ? 'League admin' : 'Active'}</span>
                    )}{' '}
                    {superAdmin && a.status !== 'disabled' && a.id !== me?.user?.id && (
                      <button className="link danger small" disabled={saver.busy} onClick={() => confirm(`Turn off ${a.name ?? a.email}? They’ll be signed out.`) && run(() => api.setStatus(a.id, 'disabled'), 'Account turned off')}>
                        {a.status === 'pending' ? 'Reject' : 'Turn off'}
                      </button>
                    )}
                  </td>
                  <td className="left">
                    <select
                      value={a.playerId ?? ''}
                      disabled={saver.busy || !seasonId}
                      onChange={(e) => run(() => api.linkAccount(seasonId!, a.id, e.target.value ? Number(e.target.value) : null), 'Link saved')}
                    >
                      <option value="">Not linked</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id} disabled={taken.has(p.id) && taken.get(p.id)!.id !== a.id}>{p.name}</option>
                      ))}
                    </select>
                    {a.playerId != null && <span className="small muted"> {a.manualLink ? 'linked by hand' : 'by email'}</span>}
                  </td>
                  {superAdmin && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${a.name ?? a.email} is a site admin`}
                        checked={a.isAdmin}
                        disabled={saver.busy || (a.isAdmin && a.id === me?.user?.id)}
                        title={a.id === me?.user?.id ? "You can't remove your own admin access" : ''}
                        onChange={(e) => run(() => api.setAdmin(a.id, e.target.checked), e.target.checked ? 'Site admin access granted' : 'Site admin access removed')}
                      />
                    </td>
                  )}
                  {superAdmin && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${a.name ?? a.email} can start leagues`}
                        checked={a.isAdmin || a.canCreateLeagues}
                        disabled={saver.busy || a.isAdmin}
                        onChange={(e) => run(() => api.setCanCreateLeagues(a.id, e.target.checked), e.target.checked ? 'Can now start leagues' : 'Can no longer start leagues')}
                      />
                    </td>
                  )}
                  <td className="left small">{a.lastLoginAt ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {saver.view}
      {accounts && missing.length > 0 && (
        <p className="small muted">Players without an account yet: {missing.map((p) => p.name).join(', ')}.</p>
      )}
    </>
  );
}
