import { Link } from 'react-router';
import { useLoaded } from '../season';

export function RecordsPage() {
  const s = useLoaded();
  if (!s) return null;
  const { data, result } = s;
  const weeks = result.weeks.filter((w) => w.started).map((w) => w.week.number);
  const maxCount = Math.max(1, ...result.netDistribution.values());
  const hotNets = [...result.netDistribution].filter(([net]) => net < data.settings.hotshotBelow);

  return (
    <>
      <h1>Hotshots &amp; records</h1>
      <div className="kpis">
        {result.lowGross && (
          <div className="kpi">
            <div className="v">{result.lowGross.value}</div>
            <div className="k">
              Season low gross:{' '}
              {result.lowGross.entries.map((e, i) => (
                <span key={i}>{i > 0 && ', '}<Link to={`/players/${e.player.id}`}>{e.player.name}</Link> (wk {e.week})</span>
              ))}
            </div>
          </div>
        )}
        {result.lowNet && (
          <div className="kpi">
            <div className="v">{result.lowNet.value}</div>
            <div className="k">
              Season low net:{' '}
              {result.lowNet.entries.map((e, i) => (
                <span key={i}>{i > 0 && ', '}<Link to={`/players/${e.player.id}`}>{e.player.name}</Link> (wk {e.week})</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <h2>Hotshots</h2>
      <p className="muted small">A hotshot is a net score under {data.settings.hotshotBelow}. Virtual scores never count.</p>
      <div className="card table-card scroll">
        <table>
          <thead>
            <tr>
              <th className="left sticky-col">Player</th>
              <th>Count</th>
              {weeks.map((n) => <th key={n}>{n}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.hotshots.map((h) => (
              <tr key={h.player.id}>
                <td className="left sticky-col"><Link to={`/players/${h.player.id}`}>{h.player.name}</Link></td>
                <td className="num-strong">{h.count}</td>
                {weeks.map((n) => <td key={n}>{h.byWeek.get(n) ?? ''}</td>)}
              </tr>
            ))}
            <tr>
              <td className="left sticky-col muted">Per week</td>
              <td />
              {weeks.map((n) => (
                <td key={n} className="muted">{result.hotshots.filter((h) => h.byWeek.has(n)).length || ''}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Hotshot net scores</h2>
      <section className="card">
        {hotNets.map(([net, count]) => (
          <div key={net} className="bar-row">
            <span>Net {net}</span>
            <div className="bar" style={{ width: `${(count / maxCount) * 100}%` }} />
            <span>{count}</span>
          </div>
        ))}
        {!hotNets.length && <p className="muted">None yet.</p>}
      </section>
    </>
  );
}
