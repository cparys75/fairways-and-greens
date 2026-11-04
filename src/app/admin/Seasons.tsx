import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useSeason } from '../season';
import { useSaver } from './useSaver';

export function SeasonsPage() {
  const { seasons, setSeasonId, leagueId } = useSeason();
  const saver = useSaver();
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof api.audit>>>([]);

  useEffect(() => {
    if (leagueId) api.audit(leagueId).then(setAudit, () => setAudit([]));
  }, [seasons, leagueId]);

  const importFile = async (file: File) => {
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      saver.setMessage({ kind: 'error', text: 'That file is not valid JSON' });
      return;
    }
    if (!confirm(`Import “${json.season?.name ?? file.name}” as a new season and make it current?`)) return;
    await saver.run(async () => {
      const { id } = await api.createSeason({ ...json, makeCurrent: true, leagueId: leagueId! });
      setSeasonId(id);
    }, 'Imported');
  };

  return (
    <>
      <h1>Seasons &amp; data</h1>
      <section className="card">
        <h3>Seasons</h3>
        <table>
          <thead><tr><th className="left">Season</th><th>Last change</th><th /></tr></thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.id}>
                <td className="left">{s.name} {s.isCurrent && <span className="badge playoff">Current</span>}</td>
                <td className="muted small">{s.updatedAt} UTC</td>
                <td className="toolbar" style={{ margin: 0, justifyContent: 'flex-end' }}>
                  <a className="button" href={`/api/seasons/${s.id}?download`}>Download backup</a>
                  {!s.isCurrent && <button onClick={() => saver.run(() => api.updateSeason(s.id, { isCurrent: true }), `${s.name} is now the current season`)}>Make current</button>}
                  <button
                    className="danger"
                    onClick={() => prompt(`This permanently deletes ${s.name} and all its scores. Download a backup first.\nType the season name to confirm:`) === s.name && saver.run(() => api.deleteSeason(s.id), 'Deleted')}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Start a new season</h3>
          <p className="small muted">Name it, copy last season’s teams and handicaps, pick the course and generate the schedule, all on one screen.</p>
          <p><Link className="button primary" to="/admin/new-season">Start a new season</Link></p>
        </section>

        <section className="card">
          <h3>Import</h3>
          <p className="small muted">
            Load a backup file, or a season converted from the old Numbers workbook with <code>tools/import_numbers.py</code>. It’s added
            as a new season; existing seasons aren’t touched.
          </p>
          <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </section>
      </div>
      {saver.view}

      <h2>Recent changes</h2>
      <div className="card table-card scroll">
        <table>
          <thead><tr><th className="left">When (UTC)</th><th className="left">Season</th><th className="left">Change</th></tr></thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="left small">{a.at}</td>
                <td className="left small">{seasons.find((s) => s.id === a.season_id)?.name ?? a.season_id}</td>
                <td className="left small">{a.action} {a.detail && <span className="muted">{a.detail}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
