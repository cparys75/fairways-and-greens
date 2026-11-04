import { useNavigate, useParams } from 'react-router';
import { FieldScorecards, Leaderboard, Scorecard } from '../components/Scorecard';
import { WeekPicker } from '../components/WeekPicker';
import { formatDate, lookups } from '../format';
import { useLoaded } from '../season';
import { formatInfo, nineLabel } from '../../engine';

export function ResultsPage() {
  const s = useLoaded();
  const params = useParams();
  const navigate = useNavigate();
  if (!s) return null;
  const { data, result } = s;
  const { players, teams, teamLabel } = lookups(data);
  const weekNum = params.week ? Number(params.week) : (result.latestWeek ?? data.weeks[0]?.number ?? null);
  const wr = result.weeks.find((w) => w.week.number === weekNum);

  return (
    <>
      <h1>Results</h1>
      <WeekPicker weeks={result.weeks} value={weekNum} onChange={(n) => navigate(`/results/${n}`)} />
      {!wr ? (
        <p className="empty">No weeks scheduled yet.</p>
      ) : (
        <>
          <p className="muted">
            Week {wr.week.number} · {formatDate(wr.week.date)} · {nineLabel(wr.nine)}{wr.nine.tee ? ` (${wr.nine.tee} tees)` : ''}
            {wr.week.playoff && <> · <span className="badge playoff">Playoffs</span></>}
            {wr.week.inclement && <> · <span className="badge">Inclement weather – not used for handicaps</span></>}
          </p>
          {!wr.field && wr.matches.length > 0 && (
            <section className="card">
              <h3>Week {wr.week.number} at a glance</h3>
              <div className="scroll"><table>
                <tbody>
                  {wr.matches.map((m, i) => (
                    <tr key={i}>
                      <td className={`left ${m.sides[0].outcome}`}>{teamLabel(m.sides[0].teamId)}</td>
                      <td className="num-strong">{m.status === 'pending' ? '–' : `${m.sides[0].total} – ${m.sides[1].total}`}</td>
                      <td className={`left ${m.sides[1].outcome}`}>{teamLabel(m.sides[1].teamId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          )}
          {wr.field ? (
            <>
              <section className="card">
                <Leaderboard field={wr.field} settings={data.settings} players={players} teams={teams} />
              </section>
              <p className="small muted">Dots under a score are handicap strokes. Red scores exceed the max per hole used for handicaps.</p>
              <FieldScorecards field={wr.field} nine={wr.nine} settings={data.settings} players={players} teams={teams} />
            </>
          ) : (
            <>
              <p className="small muted">
                Dots under a score are handicap strokes. Red scores exceed the max per hole used for handicaps. Each hole won ={' '}
                {data.settings.holeWinPoints} points (tie {data.settings.holeTiePoints}); lower {data.settings.format === 'bestBall' ? 'best-ball' : formatInfo(data.settings).individual ? 'net' : 'team net'} for the nine ={' '}
                {data.settings.netBonusWin} bonus points (tie {data.settings.netBonusTie}).
              </p>
              {wr.matches.map((m, i) => (
                <Scorecard key={i} match={m} nine={wr.nine} players={players} teamName={(id) => teams.get(id)?.name ?? `Team ${id}`} bestBall={data.settings.format === 'bestBall'} />
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
