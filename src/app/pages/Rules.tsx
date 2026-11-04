import { useLoaded } from '../season';
import { formatInfo, STABLEFORD_LABELS, type Settings } from '../../engine';

export function RulesPage() {
  const s = useLoaded();
  if (!s) return null;
  const st = s.data.settings;
  const esc = st.esc.map((r, i) => {
    const from = i === 0 ? null : (st.esc[i - 1].upToHc ?? 0) + 1;
    const range = r.upToHc === null ? `${from} and over` : from === null ? `${r.upToHc} or less` : `${from} to ${r.upToHc}`;
    return { range, max: r.maxScore ?? (r.overPar === 2 ? 'Double bogey' : `Par + ${r.overPar}`) };
  });
  return (
    <>
      <h1>How scoring works</h1>
      <div className="grid-2">
        <FormatRules st={st} />
        <section className="card">
          <h3>Absent players</h3>
          {st.absentRule === 'bestBall' ? (
            <p>If a player is absent, the match is played <b>2 vs 1</b>: the full team counts its better ball (the lower net of the two partners on each hole) against the lone player. If one player from each team is absent, it’s simply 1 vs 1. Nobody gets a made-up score.</p>
          ) : (
            <p>An absent player gets a “virtual” score: par plus their strokes plus {st.virtualOverPar}, i.e. a net of par + {st.virtualOverPar}. Virtual scores don’t count toward handicaps and can’t be hotshots.</p>
          )}
          <h3>Hotshots</h3>
          <p>Any net score below {st.hotshotBelow}.</p>
        </section>
        <section className="card">
          <h3>Handicaps</h3>
          <ul>
            <li>Average of the best {st.handicapBest} of the last {st.handicapWindow} differentials, rounded. Your starting handicap counts as one of them.</li>
            <li>Differential = adjusted gross − par, capped at {st.menMaxHc} (men) / {st.womenMaxHc} (red tees). Differentials below {st.minHc} count as {st.minHc}.</li>
            <li>Handicaps update automatically after every week; the handicap you play with is the one from the previous week.</li>
            {!st.inclementCountsForHandicap && <li>Weeks marked inclement weather don’t count toward handicaps.</li>}
          </ul>
        </section>
        <section className="card">
          <h3>Max score per hole (for handicaps only)</h3>
          <table>
            <thead><tr><th className="left">Handicap</th><th>Max score</th></tr></thead>
            <tbody>{esc.map((e) => <tr key={e.range}><td className="left">{e.range}</td><td>{e.max}</td></tr>)}</tbody>
          </table>
        </section>
      </div>
    </>
  );
}

/** The scoring rules for the season's format. */
function FormatRules({ st }: { st: Settings }) {
  const f = formatInfo(st);
  const strokes = <li>Each player gets handicap strokes on the hardest holes (1 stroke per hole for every 9 of handicap, plus one on the hardest remaining holes).</li>;
  const matchPoints = (side: string, total: string) => (
    <>
      <li>Lower {side} on a hole: <b>{st.holeWinPoints}</b> points (tie: {st.holeTiePoints} each).</li>
      <li>Lower {total} for the nine: <b>{st.netBonusWin}</b> bonus points (tie: {st.netBonusTie} each).</li>
      <li>Forfeit: the winner gets {st.forfeitWinnerPoints}, the side that forfeits {st.forfeitLoserPoints}.</li>
      <li>Standings: win = 2, tie = 1; ties broken by total match points. Playoff weeks don’t count toward standings.</li>
    </>
  );
  const finishPoints = <li>Standings: each week the last finisher gets 1 point and every place higher one more; tied players share the points of their places. Points add up over the season; ties broken by the lower average net. Playoff weeks don’t count.</li>;
  return (
    <section className="card">
      <h3>{f.name}</h3>
      <ul>
        {strokes}
        {f.id === 'teamMatch' && (
          <>
            <li>Team net per hole = both partners’ net scores added together.</li>
            {matchPoints('team net', 'team net')}
          </>
        )}
        {f.id === 'bestBall' && (
          <>
            <li>Team score per hole = the better net score of the partners (best ball).</li>
            {matchPoints('best ball', 'best-ball total')}
          </>
        )}
        {f.id === 'individualMatch' && (
          <>
            <li>You play one other player each week, net score against net score.</li>
            {matchPoints('net score', 'net total')}
          </>
        )}
        {f.id === 'stroke' && (
          <>
            <li>Everyone plays the field. Lowest net total for the nine wins the week.</li>
            {finishPoints}
          </>
        )}
        {f.id === 'stableford' && (
          <>
            <li>Points on each hole for your net score:</li>
            <li className="plain-li">
              {STABLEFORD_LABELS.map((label, i) => `${label} ${st.stableford[i]}`).join(' · ')}
            </li>
            <li>Most points wins the week. Standings are your Stableford points added up over the season; ties broken by the better average. Playoff weeks don’t count.</li>
          </>
        )}
        {f.id === 'scramble' && (
          <>
            <li>Each team plays one ball (everyone hits, the team picks the best shot) and turns in one card.</li>
            <li>Team handicap: {st.scramblePercents.map((p) => `${p}%`).join(' / ')} of the players’ handicaps, lowest handicap first, added up and rounded. Players’ handicaps don’t change from scramble scores.</li>
            <li>Lowest team net wins the week.</li>
            {finishPoints}
          </>
        )}
      </ul>
    </section>
  );
}
