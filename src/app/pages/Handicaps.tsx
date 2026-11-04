import { Link } from 'react-router';
import { signed } from '../format';
import { useLoaded } from '../season';

export function HandicapsPage() {
  const s = useLoaded();
  if (!s) return null;
  const { data, result } = s;
  const { settings } = data;
  const n = settings.handicapWindow;
  const rows = data.players
    .filter((p) => p.active !== false)
    .map((p) => ({ p, h: result.handicaps.get(p.id)! }))
    .sort((a, b) => a.h.current - b.h.current || a.p.name.localeCompare(b.p.name));

  return (
    <>
      <h1>Handicaps</h1>
      <p className="muted small">
        Your handicap is the average of your best {settings.handicapBest} of your last {n} differentials (score after max-per-hole
        adjustment, minus par). Your starting handicap counts as one of them, so it won’t change until you have {n - 1} rounds. Virtual and
        incomplete rounds don’t count. The last {n} columns show each round’s strokes over par; the{' '}
        <span className="hc-diff used inline">highlighted</span> ones are the best {settings.handicapBest} that set the handicap now.
      </p>
      <div className="card table-card scroll">
        <table>
          <thead>
            <tr>
              <th className="left sticky-col">Player</th>
              <th>Start</th>
              <th>Now</th>
              <th>±</th>
              <th className="left" colSpan={n}>Last {n} rounds (strokes over par)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, h }) => {
              // The recent window, newest on the right, padded on the left so columns line up.
              const pad = Math.max(0, n - h.window.length);
              return (
                <tr key={p.id}>
                  <td className="left sticky-col">
                    <Link to={`/players/${p.id}`}>{p.name}</Link>
                  </td>
                  <td>{p.startingHc}</td>
                  <td className="num-strong">{h.current}</td>
                  <td className={h.current < p.startingHc ? 'W' : h.current > p.startingHc ? 'L' : ''}>{signed(h.current - p.startingHc)}</td>
                  {Array.from({ length: pad }, (_, i) => <td key={`pad${i}`} className="hc-diff" />)}
                  {h.window.map((e, i) => (
                    <td
                      key={i}
                      className={`hc-diff ${e.used ? 'used' : ''}`}
                      title={e.week == null ? 'Starting handicap' : `Week ${e.week}${e.used ? ' · counts now' : ''}`}
                    >
                      <span className="v">{e.value}</span>
                      <span className="wk">{e.week == null ? 'start' : `wk ${e.week}`}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
