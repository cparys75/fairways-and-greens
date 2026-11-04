import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type LeagueDetails } from '../api';
import { useSeason } from '../season';
import { useSaver } from './useSaver';

/** Run the league: its name, invite link, people asking to join, and who else can run it. */
export function LeaguePage() {
  const { leagueId, me, superAdmin, refreshMe, refreshTodo } = useSeason();
  const saver = useSaver();
  const [league, setLeague] = useState<LeagueDetails | null>(null);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!leagueId) return;
    const l = await api.league(leagueId);
    setLeague(l);
    setName(l.name);
  }, [leagueId]);
  useEffect(() => {
    load().catch((e: Error) => saver.setMessage({ kind: 'error', text: e.message }));
  }, [load]);

  if (!league) return saver.view ?? <p className="empty">Loading…</p>;
  const run = (fn: () => Promise<unknown>, ok: string) => saver.run(fn, ok).then(load).then(refreshMe).then(refreshTodo);
  const link = `${location.origin}/join/${league.joinCode}`;
  const requests = league.members.filter((m) => m.role === 'requested');
  const others = league.members.filter((m) => m.role !== 'requested');
  const who = (m: LeagueDetails['members'][number]) => m.name ?? m.email ?? 'Someone';
  const copy = async () => {
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <h1>League</h1>

      <section className="card">
        <h3>Name</h3>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.renameLeague(league.id, name.trim()), 'League renamed');
          }}
        >
          <input aria-label="League name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={saver.busy || !name.trim() || name.trim() === league.name}>Rename</button>
        </form>
      </section>

      <section className="card">
        <h3>Invite link</h3>
        <p className="small muted">
          Send this to your players. They sign in with Google or make an account, and you approve them below. Anyone whose email is already on
          your <Link to="/admin/roster">roster</Link> gets in without asking.
        </p>
        <div className="copy-row">
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
        <p className="small">
          <button
            className="link small danger"
            disabled={saver.busy}
            onClick={() => confirm('Make a new invite link? The old one stops working.') && run(() => api.newJoinCode(league.id), 'New invite link made')}
          >
            Make a new link
          </button>{' '}
          <span className="muted">if the old one got passed around too far.</span>
        </p>
      </section>

      <section className="card">
        <h3>Asking to join {requests.length > 0 && <span className="badge warn">{requests.length}</span>}</h3>
        {!requests.length ? (
          <p className="small muted">Nobody is waiting.</p>
        ) : (
          <ul className="list-cards">
            {requests.map((m) => (
              <li key={m.userId} className="list-card">
                <span>
                  <strong>{who(m)}</strong>
                  <span className="small muted block">{m.email}{m.pendingAccount ? ' · new email account' : ''}</span>
                </span>
                <span className="toolbar" style={{ margin: 0 }}>
                  <button className="primary" disabled={saver.busy} onClick={() => run(() => api.setLeagueRole(league.id, m.userId, 'member'), `${who(m)} approved. Link them to their player under Accounts.`)}>
                    Approve
                  </button>
                  <button className="link danger small" disabled={saver.busy} onClick={() => confirm(`Turn down ${who(m)}?`) && run(() => api.setLeagueRole(league.id, m.userId, null), 'Request turned down')}>
                    Turn down
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">After approving, pick each person’s player on <Link to="/admin/accounts">Accounts</Link> so they can enter scores.</p>
      </section>

      <section className="card">
        <h3>League admins and other members</h3>
        <p className="small muted">
          League admins can do everything on these Admin pages for {league.name}, and nothing in other leagues. Roster players don’t need to be
          listed here; add someone to make them an admin, or to let in someone who isn’t on a roster.
        </p>
        {!others.length ? (
          <p className="small muted">Only {superAdmin ? 'site admins' : 'you'} so far.</p>
        ) : (
          <ul className="list-cards">
            {others.map((m) => (
              <li key={m.userId} className="list-card">
                <span>
                  <strong>{who(m)}</strong> {m.role === 'admin' && <span className="badge ok">Admin</span>}
                  <span className="small muted block">{m.email}</span>
                </span>
                <span className="toolbar" style={{ margin: 0 }}>
                  {m.role === 'admin' ? (
                    <button
                      disabled={saver.busy || (m.userId === me?.user?.id && !superAdmin)}
                      title={m.userId === me?.user?.id ? 'You can’t remove your own admin access' : ''}
                      onClick={() => run(() => api.setLeagueRole(league.id, m.userId, 'member'), 'Admin access removed')}
                    >
                      Remove admin
                    </button>
                  ) : (
                    <button disabled={saver.busy} onClick={() => run(() => api.setLeagueRole(league.id, m.userId, 'admin'), `${who(m)} is now a league admin`)}>Make admin</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <MakeAdmin leagueId={league.id} onDone={(text) => run(async () => undefined, text)} />
      </section>
      {saver.view}
    </>
  );
}

/** Make any player in the league an admin, picked from the league's accounts. */
function MakeAdmin({ leagueId, onDone }: { leagueId: number; onDone: (text: string) => void }) {
  const { seasonId } = useSeason();
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof api.accounts>>>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.accounts(leagueId, seasonId).then(setAccounts, () => setAccounts([]));
  }, [leagueId, seasonId]);
  const candidates = accounts.filter((a) => a.status === 'active' && a.leagueRole === 'member');
  if (!candidates.length) return null;
  return (
    <form
      className="toolbar"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api.setLeagueRole(leagueId, Number(pick), 'admin');
          setPick('');
          onDone('League admin added');
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <select aria-label="Player to make an admin" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Make a player an admin…</option>
        {candidates.map((a) => (
          <option key={a.id} value={a.id}>{a.name ?? a.email}</option>
        ))}
      </select>
      <button type="submit" disabled={!pick}>Make admin</button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}
