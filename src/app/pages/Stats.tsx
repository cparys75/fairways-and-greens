import { Link } from 'react-router';
import { fixed, signed } from '../format';
import { useLoaded } from '../season';
import { holeNumber, nineLabel } from '../../engine';

export function StatsPage() {
  const s = useLoaded();
  if (!s) return null;
  const { data, result } = s;

  return (
    <>
      <h1>Scoring averages</h1>
      <p className="muted small">
        Average gross score per hole{data.settings.averagesIncludeVirtual ? ' (virtual rounds included)' : ''}. “Plays as” ranks holes by
        how far over par the league actually scores, to compare with the published hole handicap.
      </p>
      {result.leagueAverages.map((la) => {
        const overPar = la.avg.map((a, h) => a - la.nine.par[h]);
        const order = [...overPar.keys()].sort((x, y) => overPar[y] - overPar[x]);
        const playsAs = overPar.map((_, h) => order.indexOf(h) + 1);
        const players = data.players
          .map((p) => ({ p, a: result.playerAverages.get(p.id)?.find((x) => x.nine.id === la.nine.id) }))
          .filter((r) => r.a)
          .sort((x, y) => x.a!.total - y.a!.total);
        return (
          <section key={la.nine.id}>
            <h2>{nineLabel(la.nine)} <span className="muted small">{la.rounds} rounds</span></h2>
            <div className="card table-card scroll">
              <table>
                <thead>
                  <tr>
                    <th className="left sticky-col">Hole</th>
                    {la.nine.par.map((_, h) => <th key={h}>{holeNumber(la.nine, h)}</th>)}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="left sticky-col">Par</td>{la.nine.par.map((p, h) => <td key={h}>{p}</td>)}<td>{la.nine.par.reduce((a, b) => a + b, 0)}</td></tr>
                  <tr><td className="left sticky-col">League avg</td>{la.avg.map((a, h) => <td key={h}>{fixed(a, 2)}</td>)}<td className="num-strong">{fixed(la.total, 2)}</td></tr>
                  <tr><td className="left sticky-col">vs par</td>{overPar.map((o, h) => <td key={h}>{signed(Number(fixed(o, 2)))}</td>)}<td /></tr>
                  <tr><td className="left sticky-col">Published hcp</td>{la.nine.menHcp.map((x, h) => <td key={h}>{x}</td>)}<td /></tr>
                  <tr><td className="left sticky-col">Plays as</td>{playsAs.map((x, h) => <td key={h} className={x === la.nine.menHcp[h] ? '' : 'num-strong'}>{x}</td>)}<td /></tr>
                </tbody>
              </table>
            </div>
            <div className="card table-card scroll">
              <table>
                <thead>
                  <tr>
                    <th className="left sticky-col">Player</th>
                    <th>Rds</th>
                    {la.nine.par.map((_, h) => <th key={h}>{holeNumber(la.nine, h)}</th>)}
                    <th>Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map(({ p, a }) => (
                    <tr key={p.id}>
                      <td className="left sticky-col"><Link to={`/players/${p.id}`}>{p.name}</Link></td>
                      <td>{a!.rounds}</td>
                      {a!.avg.map((x, h) => <td key={h}>{fixed(x, 1)}</td>)}
                      <td className="num-strong">{fixed(a!.total, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!result.leagueAverages.length && <p className="empty">No rounds played yet.</p>}
    </>
  );
}
