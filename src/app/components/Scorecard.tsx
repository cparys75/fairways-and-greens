import { Link } from 'react-router';
import type { FieldEntry, MatchResult, MatchSide, Nine, Player, PlayerCard, Settings, Team } from '../../engine';
import { formatInfo, holeHcps, holeNumber, isTeamCardId } from '../../engine';
import { ordinal } from '../format';
import { scoreClass } from './HoleByHole';

const holes = Array.from({ length: 9 }, (_, i) => i);

/** Hole numbers, par and yardage across the top of a scorecard. */
function CardHead({ nine }: { nine: Nine }) {
  return (
    <thead>
      <tr>
        <th className="name left">Hole</th>
        <th>HC</th>
        {holes.map((h) => (
          <th key={h}>{holeNumber(nine, h)}</th>
        ))}
        <th className="total">Tot</th>
      </tr>
      <tr>
        <th className="name left">Par</th>
        <th />
        {nine.par.map((p, h) => (
          <th key={h}>{p}</th>
        ))}
        <th className="total">{nine.par.reduce((x, y) => x + y, 0)}</th>
      </tr>
      {nine.yardage?.some(Boolean) && (
        <tr>
          <th className="name left">Yards</th>
          <th />
          {nine.yardage.map((y, h) => (
            <th key={h}>{y || ''}</th>
          ))}
          <th className="total">{nine.yardage.reduce((x, y) => x + y, 0)}</th>
        </tr>
      )}
    </thead>
  );
}

/** Name of a field entrant: the player, or the team for a scramble card. */
export function entrantName(e: Pick<FieldEntry, 'entrantId' | 'teamId'>, players: Map<number, Player>, teams: Map<number, Team>): string {
  return isTeamCardId(e.entrantId) ? (teams.get(e.teamId)?.name ?? `Team ${e.teamId}`) : (players.get(e.entrantId)?.name ?? 'Player');
}

/** A field week (stroke play, Stableford, scramble): everyone's place, score and standings points. */
export function Leaderboard({ field, settings, players, teams, compact = false }: { field: FieldEntry[]; settings: Settings; players: Map<number, Player>; teams: Map<number, Team>; compact?: boolean }) {
  const stableford = settings.format === 'stableford';
  const scramble = formatInfo(settings).teamCard;
  const shown = compact ? field.filter((e) => e.value != null).slice(0, 5) : field;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Pos</th>
            <th className="left">{scramble ? 'Team' : 'Player'}</th>
            {!compact && <th>HC</th>}
            {!compact && <th>Gross</th>}
            <th>Net</th>
            {stableford ? <th>Points</th> : <th title="Standings points for this finish">Pts</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.entrantId} className={e.card?.incomplete ? 'is-virtual' : ''}>
              <td>{e.rank ? ordinal(e.rank) : ''}</td>
              <td className="left">
                {isTeamCardId(e.entrantId) ? entrantName(e, players, teams) : <Link to={`/players/${e.entrantId}`}>{entrantName(e, players, teams)}</Link>}
                {e.card?.hotshot && <> <span className="badge hot">Hotshot</span></>}
                {scramble && !compact && (
                  <div className="small muted">{[...players.values()].filter((p) => p.teamId === e.teamId && p.active !== false).map((p) => p.name).join(' & ')}</div>
                )}
              </td>
              {!compact && <td>{e.card?.hc ?? ''}</td>}
              {!compact && <td>{e.card ? (e.card.virtual ? <span className="badge virtual">Virtual</span> : e.card.incomplete ? <span className="badge virtual" title="Didn’t play every hole">Incomplete</span> : e.card.grossTotal) : <span className="muted">–</span>}</td>}
              <td>{e.card?.netTotal ?? ''}</td>
              <td className="num-strong">{e.value == null ? '' : stableford ? e.value : Math.round(e.points * 10) / 10}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hole-by-hole cards for a field week, best first. */
export function FieldScorecards({ field, nine, settings, players, teams }: { field: FieldEntry[]; nine: Nine; settings: Settings; players: Map<number, Player>; teams: Map<number, Team> }) {
  const stableford = settings.format === 'stableford';
  const played = field.filter((e) => e.card);
  if (!played.length) return null;
  return (
    <article className="match">
      <div className="scroll">
        <table className="scorecard">
          <CardHead nine={nine} />
          <tbody>
            {played.map((e) => {
              const player = players.get(e.entrantId) ?? { id: e.entrantId, name: entrantName(e, players, teams), teamId: e.teamId, startingHc: 0, redTees: false };
              return [
                <PlayerRows key={e.entrantId} first player={player} card={e.card} nine={nine} rank={e.rank} />,
                stableford && e.card ? (
                  <tr key={`${e.entrantId}-pts`} className="points">
                    <td className="name left">Stableford</td>
                    <td />
                    {e.card.stableford.map((p, h) => (
                      <td key={h}>{p}</td>
                    ))}
                    <td className="total">{e.card.stablefordTotal}</td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function Scorecard({ match, nine, players, teamName, bestBall = false }: { match: MatchResult; nine: Nine; players: Map<number, Player>; teamName: (id: number) => string; bestBall?: boolean }) {
  const [a, b] = match.sides;
  return (
    <article className="match">
      <div className="match-head">
        <div>
          <strong className={a.outcome}>{teamName(a.teamId)}</strong> <span className="muted">vs</span>{' '}
          <strong className={b.outcome}>{teamName(b.teamId)}</strong>
          {match.match.teeTime && <span className="muted small"> · {match.match.teeTime}</span>}
          {match.twoVsOne && <> <span className="badge" title="Best ball, because a player didn’t play every hole">{present(a) === present(b) ? 'Best ball' : `${present(a)} v ${present(b)}`}</span></>}
        </div>
        <div className="match-score">
          {match.status === 'forfeit' && <span className="badge forfeit">Forfeit</span>}{' '}
          {match.status === 'pending' ? <span className="muted small">Scores pending</span> : `${a.total} – ${b.total}`}
        </div>
      </div>
      <div className="scroll">
        <table className="scorecard">
          <CardHead nine={nine} />
          <tbody>
            <Side side={a} other={b} nine={nine} players={players} bestBall={bestBall} twoVsOne={!!match.twoVsOne} />
            <Side side={b} other={a} nine={nine} players={players} bestBall={bestBall} twoVsOne={!!match.twoVsOne} />
          </tbody>
        </table>
      </div>
    </article>
  );
}

const present = (s: MatchSide) => s.cards.filter((c) => c && !c.virtual).length;

function Side({ side, other, nine, players, bestBall, twoVsOne }: { side: MatchSide; other: MatchSide; nine: Nine; players: Map<number, Player>; bestBall: boolean; twoVsOne: boolean }) {
  // In a 2-vs-1 (or 1-vs-1) match each side counts its present players' best ball.
  const label = bestBall ? 'Best ball' : twoVsOne ? (present(side) > 1 ? 'Best ball' : 'Net') : 'Team net';
  return (
    <>
      {side.playerIds.map((pid, i) => (
        <PlayerRows key={pid} first={i === 0} player={players.get(pid)!} card={side.cards[i]} nine={nine} />
      ))}
      {side.playerIds.length > 1 && <tr className="team-net">
        <td className="name left">{label}</td>
        <td />
        {side.teamNet.map((n, h) => (
          <td key={h} className={n < other.teamNet[h] ? 'won' : ''}>
            {n}
          </td>
        ))}
        <td className={`total ${side.teamNetTotal < other.teamNetTotal ? 'won' : ''}`}>{side.teamNetTotal}</td>
      </tr>}
      <tr className="points">
        <td className="name left">
          Points <span className="muted small">(+{side.bonus} net bonus)</span>
        </td>
        <td />
        {side.holePoints.map((p, h) => (
          <td key={h}>{p}</td>
        ))}
        <td className={`total ${side.outcome}`}>{side.total}</td>
      </tr>
    </>
  );
}

function PlayerRows({ player, card, nine, first, rank }: { player: Player; card: PlayerCard | null; nine: Nine; first: boolean; rank?: number | null }) {
  const hcps = holeHcps(nine, player.redTees);
  return (
    <>
      <tr className={first ? 'team-start' : ''}>
        <td className="name left">
          {rank ? <span className="muted small">{ordinal(rank)} </span> : null}
          {isTeamCardId(player.id) ? player.name : <Link to={`/players/${player.id}`}>{player.name}</Link>}{' '}
          {card?.virtual && <span className="badge virtual" title="Absent: virtual score (net 39), doesn't count for handicap">Virtual</span>}
          {card && !card.virtual && card.incomplete && (
            <span className="badge virtual" title="Didn’t play every hole (left early / arrived late): doesn’t count for handicap">Incomplete</span>
          )}
          {card?.hotshot && <span className="badge hot">Hotshot</span>}
          {player.redTees && <span className="badge">Red tees</span>}
        </td>
        <td>{card?.hc ?? ''}</td>
        {card
          ? card.gross.map((g, h) => (
              <td key={h} className={`${card.escCapped[h] ? 'capped' : ''} ${card.dnf[h] && !card.virtual ? 'dnf' : ''}`} title={`Hole hcp ${hcps[h]}${card.strokes[h] ? `, ${card.strokes[h]} stroke(s)` : ''}`}>
                {card.dnf[h] ? <span className="muted" title={card.virtual ? 'Absent: virtual score' : 'Did not play: virtual score'}>{g}</span> : <span className={`sc ${scoreClass(g, nine.par[h])}`}>{g}</span>}
                <span className="dots">{'•'.repeat(card.strokes[h])}</span>
              </td>
            ))
          : nine.par.map((_, h) => <td key={h} className="muted">–</td>)}
        <td className="total">{card?.grossTotal ?? ''}</td>
      </tr>
      {card && (
        <tr className="sub">
          <td className="name left">net</td>
          <td />
          {card.net.map((n, h) => (
            <td key={h}>{n}</td>
          ))}
          <td className="total">{card.netTotal}</td>
        </tr>
      )}
    </>
  );
}
