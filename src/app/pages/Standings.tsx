import { Link } from 'react-router';
import { Leaderboard } from '../components/Scorecard';
import { fixed, formatDate, lookups, ordinal } from '../format';
import { useLoaded } from '../season';
import { formatInfo, nineLabel, type SeasonResult } from '../../engine';

export function StandingsPage() {
  const s = useLoaded();
  if (!s) return <p className="empty">No season yet. An admin can create one under Admin → Seasons.</p>;
  const { data, result } = s;
  const { teamLabel } = lookups(data);
  const regular = data.weeks.filter((w) => !w.playoff);
  const latest = result.weeks.find((w) => w.week.number === result.latestWeek);
  const next = result.weeks.find((w) => w.week.number === result.currentWeek);
  if (formatInfo(data.settings).field) return <FieldStandings result={result} />;

  return (
    <>
      <h1>Standings</h1>
      <p className="muted small">
        Win = 2, tie = 1. Ties in the standings are broken by total match points. Regular season only
        {latest ? ` · through week ${latest.week.number}` : ''}.
      </p>
      <div className="card table-card scroll standings-table">
        <table>
          <thead>
            <tr>
              <th className="left sticky-col">Team</th>
              <th>W</th>
              <th>L</th>
              <th>T</th>
              <th title="2 per win, 1 per tie">Pts</th>
              <th title="Total match points">Match pts</th>
              <th>Avg</th>
              <th>Streak</th>
              {regular.map((w) => (
                <th key={w.number}>
                  {w.number}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.standings.map((r) => (
              <tr key={r.team.id}>
                <td className="left wrap-ok sticky-col">
                  <span className="rank-inline">{ordinal(r.rank)}</span> <strong>{r.team.name}</strong>
                  <div className="small muted">
                    {r.players.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ' & '}
                        <Link to={`/players/${p.id}`}>{p.name}</Link>
                      </span>
                    ))}
                  </div>
                </td>
                <td>{r.w}</td>
                <td>{r.l}</td>
                <td>{r.t}</td>
                <td className="num-strong">{r.standingPoints}</td>
                <td>{r.totalPoints}</td>
                <td>{fixed(r.avgPoints)}</td>
                <td className={r.streak[0] ?? ''}>{r.streak}</td>
                {regular.map((w) => (
                  <td key={w.number}>
                    {r.weekly.get(w.number) ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        {latest && (
          <section className="card">
            <h3>
              Week {latest.week.number} results <span className="muted small">{formatDate(latest.week.date)}</span>
            </h3>
            <div className="scroll"><table>
              <tbody>
                {latest.matches.map((m, i) => (
                  <tr key={i}>
                    <td className={`left ${m.sides[0].outcome}`}>{teamLabel(m.sides[0].teamId)}</td>
                    <td className="num-strong">
                      {m.status === 'pending' ? '–' : `${m.sides[0].total} – ${m.sides[1].total}`}
                    </td>
                    <td className={`left ${m.sides[1].outcome}`}>{teamLabel(m.sides[1].teamId)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="small">
              <Link to={`/results/${latest.week.number}`}>Full scorecards →</Link>
            </p>
          </section>
        )}
        {next && next.week.number !== latest?.week.number && (
          <section className="card">
            <h3>
              Up next: week {next.week.number} <span className="muted small">{formatDate(next.week.date)} · {nineLabel(next.nine)}</span>
              {next.week.playoff && <span className="badge playoff">Playoffs</span>}
            </h3>
            <div className="scroll"><table>
              <tbody>
                {next.week.matches.map((m, i) => (
                  <tr key={i}>
                    <td className="muted">{m.teeTime ?? m.slot}</td>
                    <td className="left">{teamLabel(m.teamA)}</td>
                    <td className="muted">vs</td>
                    <td className="left">{teamLabel(m.teamB)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )}
      </div>
    </>
  );
}

/** Stroke play, Stableford and scramble: season points from each week's finish (or Stableford points). */
function FieldStandings({ result }: { result: SeasonResult }) {
  const { data } = result;
  const { players, teams } = lookups(data);
  const format = formatInfo(data.settings);
  const stableford = data.settings.format === 'stableford';
  const regular = data.weeks.filter((w) => !w.playoff);
  const latest = result.weeks.find((w) => w.week.number === result.latestWeek);
  return (
    <>
      <h1>Standings</h1>
      <p className="muted small">
        {stableford
          ? 'Stableford points added up over the season; ties broken by the better average.'
          : `Each week, last place gets 1 point and every place higher one more (ties share). Points add up over the season; ties broken by the lower average net.`}{' '}
        Regular season only{latest ? ` · through week ${latest.week.number}` : ''}.
      </p>
      <div className="card table-card scroll standings-table">
        <table>
          <thead>
            <tr>
              <th className="left sticky-col">{format.teamCard ? 'Team' : 'Player'}</th>
              <th title="Rounds played">Rds</th>
              <th title="Weeks won">Wins</th>
              <th>Pts</th>
              <th>{stableford ? 'Avg pts' : 'Avg net'}</th>
              {regular.map((w) => (
                <th key={w.number}>{w.number}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.standings.map((r) => (
              <tr key={r.team.id}>
                <td className="left wrap-ok sticky-col">
                  <span className="rank-inline">{ordinal(r.rank)}</span>{' '}
                  {format.teamCard ? (
                    <>
                      <strong>{r.team.name}</strong>
                      <div className="small muted">
                        {r.players.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && ' & '}
                            <Link to={`/players/${p.id}`}>{p.name}</Link>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <strong><Link to={`/players/${r.team.id}`}>{r.team.name}</Link></strong>
                  )}
                </td>
                <td>{r.rounds}</td>
                <td>{r.w}</td>
                <td className="num-strong">{r.standingPoints}</td>
                <td>{r.avgValue == null ? '' : fixed(r.avgValue)}</td>
                {regular.map((w) => (
                  <td key={w.number}>{r.weekly.get(w.number) ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {latest?.field && (
        <section className="card">
          <h3>
            Week {latest.week.number} leaders <span className="muted small">{formatDate(latest.week.date)} · {nineLabel(latest.nine)}</span>
          </h3>
          <Leaderboard field={latest.field} settings={data.settings} players={players} teams={teams} compact />
          <p className="small">
            <Link to={`/results/${latest.week.number}`}>Full results →</Link>
          </p>
        </section>
      )}
    </>
  );
}
