import { useEffect, useState } from 'react';
import { formatInfo, type Player, type Team } from '../../engine';
import { api } from '../api';
import { useLoaded } from '../season';
import { useSaver } from './useSaver';

export function RosterPage() {
  const { data, result, seasonId } = useLoaded()!;
  const saver = useSaver();
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTeams(structuredClone(data.teams));
    setPlayers(structuredClone(data.players));
    setDirty(false);
  }, [data]);

  const hasScores = (pid: number) => data.weeks.some((w) => w.scores.some((s) => s.playerId === pid));
  const editTeam = (i: number, patch: Partial<Team>) => {
    setTeams(teams.map((t, j) => (i === j ? { ...t, ...patch } : t)));
    setDirty(true);
  };
  const editPlayer = (i: number, patch: Partial<Player>) => {
    setPlayers(players.map((p, j) => (i === j ? { ...p, ...patch } : p)));
    setDirty(true);
  };
  const nextId = (xs: { id: number }[]) => Math.max(0, ...xs.map((x) => x.id)) + 1;
  // Individual formats: every player is their own side, so there are no teams to manage.
  const individual = formatInfo(data.settings).individual;

  return (
    <>
      <h1>{individual ? 'Players' : 'Teams & players'}</h1>
      <p className="muted small">
        Changing a starting handicap recalculates every handicap from week 1. Players with scores can’t be deleted; mark them inactive
        instead (their past rounds stay in the history). A player who signs in with Google using the email shown here can
        enter scores for their own matches. Emails are only visible to admins.
      </p>
      <div className={individual ? '' : 'grid-2'}>
        {!individual && <section className="card">
          <h3>Teams</h3>
          <table className="edit-table">
            <thead><tr><th>#</th><th className="left">Name</th><th /></tr></thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td><input value={t.name} onChange={(e) => editTeam(i, { name: e.target.value })} /></td>
                  <td>
                    <button
                      className="danger"
                      aria-label={`Remove ${t.name}`}
                      disabled={players.some((p) => p.teamId === t.id) || data.weeks.some((w) => w.matches.some((m) => m.teamA === t.id || m.teamB === t.id))}
                      title="Teams with players or matches can't be removed"
                      onClick={() => { setTeams(teams.filter((_, j) => j !== i)); setDirty(true); }}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><button onClick={() => { const id = nextId(teams); setTeams([...teams, { id, name: `Team ${id}` }]); setDirty(true); }}>+ Add team</button></p>
        </section>}

        <section className="card">
          <h3>Players</h3>
          <div className="scroll">
            <table className="edit-table">
              <thead>
                <tr><th className="left">Name</th><th className="left">Email (for sign-in)</th><th className="left">Phone</th>{!individual && <th>Team</th>}<th>Start HC</th><th>Now</th><th>Red tees</th><th>Active</th><th /></tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={p.id}>
                    <td><input value={p.name} onChange={(e) => editPlayer(i, { name: e.target.value })} style={{ minWidth: '9rem' }} /></td>
                    <td><input type="email" value={p.email ?? ''} placeholder="name@example.com" onChange={(e) => editPlayer(i, { email: e.target.value || null })} style={{ minWidth: '12rem' }} /></td>
                    <td><input type="tel" value={p.phone ?? ''} placeholder="303-555-0100" onChange={(e) => editPlayer(i, { phone: e.target.value || null })} style={{ minWidth: '9rem' }} /></td>
                    {!individual && (
                      <td>
                        <select value={p.teamId ?? ''} onChange={(e) => editPlayer(i, { teamId: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">—</option>
                          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                    )}
                    <td><input type="number" value={p.startingHc} onChange={(e) => editPlayer(i, { startingHc: Number(e.target.value) })} style={{ width: '4rem' }} /></td>
                    <td className="muted">{result.handicaps.get(p.id)?.current ?? ''}</td>
                    <td><input type="checkbox" checked={p.redTees} onChange={(e) => editPlayer(i, { redTees: e.target.checked })} /></td>
                    <td><input type="checkbox" checked={p.active !== false} onChange={(e) => editPlayer(i, { active: e.target.checked })} /></td>
                    <td>
                      <button className="danger" aria-label={`Remove ${p.name}`} disabled={hasScores(p.id)} title={hasScores(p.id) ? 'Has scores – mark inactive instead' : ''}
                        onClick={() => { setPlayers(players.filter((_, j) => j !== i)); setDirty(true); }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p><button onClick={() => { setPlayers([...players, { id: nextId(players), name: '', teamId: null, startingHc: 0, redTees: false, active: true }]); setDirty(true); }}>+ Add player</button></p>
        </section>
      </div>
      <div className="save-bar">
        <button className="primary" disabled={!dirty || saver.busy} onClick={() => saver.run(() => api.saveRoster(seasonId!, teams, players))}>
          {dirty ? 'Save teams & players' : 'Saved'}
        </button>
        {saver.view}
      </div>
    </>
  );
}
