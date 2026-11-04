import { Link, useParams } from 'react-router';
import { fixed, formatDate, lookups, ordinal } from '../format';
import { useLoaded } from '../season';
import { formatInfo, nineLabel } from '../../engine';

export function PlayerPage() {
  const s = useLoaded();
  const { id } = useParams();
  if (!s) return null;
  const { data, result } = s;
  const { players, teams, teamLabel } = lookups(data);
  const player = players.get(Number(id));
  if (!player) return <p className="empty">Player not found.</p>;
  const h = result.handicaps.get(player.id)!;
  const format = formatInfo(data.settings);
  const rounds = result.weeks
    .map((w) => {
      const card = w.cards.get(player.id);
      const match = w.matches.find((m) => m.sides.some((sd) => sd.playerIds.includes(player.id)));
      const side = match?.sides.find((sd) => sd.playerIds.includes(player.id));
      const opp = match?.sides.find((sd) => sd !== side);
      // Field formats: this player's (or their scramble team's) place that week.
      const entry = w.field?.find((e) => e.entrantId === player.id || (format.teamCard && e.teamId === player.teamId));
      return { w, card: card ?? (format.teamCard ? entry?.card : undefined), match, side, opp, entry };
    })
    .filter((r) => r.card);
  const real = rounds.filter((r) => !r.card!.virtual);
  const avg = result.playerAverages.get(player.id) ?? [];

  return (
    <>
      <h1>{player.name}</h1>
      <p className="muted">
        {teams.get(player.teamId ?? -1)?.name} {player.redTees && '· Red tees'}
      </p>
      <div className="kpis">
        <div className="kpi"><div className="v">{h.current}</div><div className="k">Handicap (started {player.startingHc})</div></div>
        <div className="kpi"><div className="v">{real.length ? Math.min(...real.map((r) => r.card!.grossTotal)) : '–'}</div><div className="k">Best gross</div></div>
        <div className="kpi"><div className="v">{real.length ? Math.min(...real.map((r) => r.card!.netTotal)) : '–'}</div><div className="k">Best net</div></div>
        <div className="kpi"><div className="v">{avg[0] ? fixed(avg[0].total) : '–'}</div><div className="k">Avg gross ({avg[0] ? nineLabel(avg[0].nine) : ''})</div></div>
        <div className="kpi"><div className="v">{rounds.filter((r) => r.card!.hotshot).length}</div><div className="k">Hotshots</div></div>
      </div>

      <section className="card">
        <h3>How the current handicap is calculated</h3>
        {h.window.length < data.settings.handicapWindow ? (
          <p className="small muted">
            Fewer than {data.settings.handicapWindow} scores (including the starting handicap), so the starting handicap of{' '}
            {player.startingHc} is used.
          </p>
        ) : (
          <>
            <p className="small muted">
              Last {data.settings.handicapWindow} differentials; the best {data.settings.handicapBest} (highlighted) are averaged and rounded.
            </p>
            <table>
              <thead>
                <tr>{h.window.map((v, i) => <th key={i}>{v.week ? `Wk ${v.week}` : 'Start'}</th>)}</tr>
              </thead>
              <tbody>
                <tr>{h.window.map((v, i) => <td key={i} className={v.used ? 'W num-strong' : 'muted'}>{v.value}</td>)}</tr>
              </tbody>
            </table>
          </>
        )}
      </section>

      <h2>Rounds</h2>
      <div className="card table-card scroll">
        <table>
          <thead>
            <tr>
              <th>Wk</th>
              <th className="left">Date</th>
              <th>HC</th>
              <th>Gross</th>
              <th>Net</th>
              <th title="Counts toward handicap">Diff</th>
              <th className="left">{format.field ? 'Finish' : 'Match'}</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map(({ w, card, match, side, opp, entry }) => (
              <tr key={w.week.number}>
                <td><Link to={`/results/${w.week.number}`}>{w.week.number}</Link></td>
                <td className="left">{formatDate(w.week.date)}</td>
                <td>{card!.hc}</td>
                <td>{card!.virtual ? <span className="badge virtual">Virtual</span> : card!.grossTotal}</td>
                <td>{card!.netTotal} {card!.hotshot && <span className="badge hot">Hotshot</span>}</td>
                <td className="muted">{card!.virtual || (w.week.inclement && !data.settings.inclementCountsForHandicap) ? '–' : card!.differential}</td>
                <td className="left">
                  {entry?.rank ? (
                    <span>
                      {ordinal(entry.rank)}{' '}
                      <span className="muted">
                        {data.settings.format === 'stableford' ? `${entry.value} pts` : `${Math.round(entry.points * 10) / 10} pts`}
                        {format.teamCard ? ' · team card' : ''}
                      </span>
                    </span>
                  ) : match && side && opp && match.status !== 'pending' ? (
                    <span className={side.outcome}>
                      {side.outcome} {side.total}–{opp.total} <span className="muted">vs {teamLabel(opp.teamId)}</span>
                    </span>
                  ) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
