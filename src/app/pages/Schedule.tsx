import { useLayoutEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Scorecard } from '../components/Scorecard';
import { formatDate, lookups } from '../format';
import { useLoaded } from '../season';
import { formatInfo, nineLabel, type WeekResult } from '../../engine';
import { entrantName } from '../components/Scorecard';

const SCROLL_KEY = 'golf-league.schedule-scroll';

export function SchedulePage() {
  const s = useLoaded();
  const [params, setParams] = useSearchParams();
  const [team, setTeam] = useState<number | ''>(() => {
    try {
      return Number(localStorage.getItem('golf-league.team')) || '';
    } catch {
      return '';
    }
  });

  // Coming back from a match: return to where the list was scrolled.
  useLayoutEffect(() => {
    const y = Number(sessionStorage.getItem(SCROLL_KEY));
    sessionStorage.removeItem(SCROLL_KEY);
    if (y) window.scrollTo(0, y);
  }, []);

  if (!s) return null;
  const { data, result } = s;
  const { teamLabel } = lookups(data);
  const pick = (v: string) => {
    setTeam(v ? Number(v) : '');
    try {
      localStorage.setItem('golf-league.team', v);
    } catch {
      /* ignore */
    }
  };

  const upcoming = result.weeks.filter((w) => !w.complete);
  const completed = result.weeks.filter((w) => w.complete).reverse(); // most recent first
  const view = params.get('view') === 'completed' || (!params.get('view') && !upcoming.length) ? 'completed' : 'upcoming';
  const weeks = view === 'completed' ? completed : upcoming;
  const remember = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  const field = formatInfo(data.settings).field;
  const individual = formatInfo(data.settings).individual;

  return (
    <>
      <h1>Schedule</h1>
      <div className="toolbar">
        <div className="segmented schedule-switch" role="tablist" aria-label="Weeks">
          <button role="tab" aria-selected={view === 'upcoming'} onClick={() => setParams({ view: 'upcoming' }, { replace: true })}>
            Upcoming ({upcoming.length})
          </button>
          <button role="tab" aria-selected={view === 'completed'} onClick={() => setParams({ view: 'completed' }, { replace: true })}>
            Completed ({completed.length})
          </button>
        </div>
        {!field && <label className="field">
          <span>{individual ? 'Only my matches' : 'Highlight my team'}</span>
          <select value={team} onChange={(e) => pick(e.target.value)}>
            <option value="">All teams</option>
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {individual ? t.name : `${t.name} – ${teamLabel(t.id)}`}
              </option>
            ))}
          </select>
        </label>}
      </div>
      {!weeks.length && <p className="empty">{view === 'upcoming' ? 'No more matches this season. See Completed.' : 'No completed weeks yet.'}</p>}
      <div className={view === 'completed' ? 'week-list compact' : 'grid-2'}>
        {weeks.map((w) =>
          field ? (
            <FieldWeekCard key={w.week.number} w={w} />
          ) : (
            <WeekCard key={w.week.number} w={w} team={team} teamLabel={teamLabel} onOpen={remember} />
          ),
        )}
      </div>
    </>
  );
}

/** A field week: when and where, and who won once it's played. */
function FieldWeekCard({ w }: { w: WeekResult }) {
  const s = useLoaded()!;
  const { players, teams } = lookups(s.data);
  const winners = (w.field ?? []).filter((e) => e.rank === 1);
  return (
    <section className="card week-card">
      <h3>
        Week {w.week.number} <span className="muted small">{formatDate(w.week.date)} · {nineLabel(w.nine)}</span>{' '}
        {w.week.playoff && <span className="badge playoff">Playoffs</span>}
      </h3>
      {winners.length ? (
        <p className="small">
          Won by <strong>{winners.map((e) => entrantName(e, players, teams)).join(' & ')}</strong> ({winners[0].value}
          {s.data.settings.format === 'stableford' ? ' points' : ' net'}) · <Link to={`/results/${w.week.number}`}>Results ›</Link>
        </p>
      ) : (
        <p className="small muted">Everyone plays the field.</p>
      )}
    </section>
  );
}

function WeekCard({ w, team, teamLabel, onOpen }: { w: WeekResult; team: number | ''; teamLabel: (id: number) => string; onOpen: () => void }) {
  const matches = w.week.matches.map((m, idx) => ({ m, idx })).filter(({ m }) => !team || m.teamA === team || m.teamB === team);
  if (team && !matches.length) return null;
  return (
    <section className="card week-card">
      <h3>
        Week {w.week.number} <span className="muted small">{formatDate(w.week.date)} · {nineLabel(w.nine)}</span>{' '}
        {w.week.playoff && <span className="badge playoff">Playoffs</span>}
      </h3>
      <ul className="match-rows">
        {matches.map(({ m, idx }) => {
          const r = w.matches.find((x) => x.match === m);
          const played = r && r.status !== 'pending';
          return (
            <li key={idx}>
              <Link to={`/schedule/${w.week.number}/${idx}`} className="match-row" onClick={onOpen}>
                <span className="muted small tee">{m.teeTime ?? m.slot ?? ''}</span>
                <span className={`team ${played ? r.sides[0].outcome : ''}`}>{teamLabel(m.teamA)}</span>
                <span className="result">{played ? `${r.sides[0].total}–${r.sides[1].total}` : <span className="muted">vs</span>}</span>
                <span className={`team b ${played ? r.sides[1].outcome : ''}`}>{teamLabel(m.teamB)}</span>
                <span className="chev" aria-hidden>›</span>
              </Link>
            </li>
          );
        })}
        {!matches.length && <li className="muted small">Matchups to be announced</li>}
      </ul>
    </section>
  );
}

/** One match from the schedule: its scorecard, or who's playing if it hasn't been played yet. */
export function ScheduleMatchPage() {
  const s = useLoaded();
  const { week, idx } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  if (!s) return null;
  const { data, result } = s;
  const { players, teams, teamPlayers } = lookups(data);
  const wr = result.weeks.find((w) => w.week.number === Number(week));
  const match = wr?.week.matches[Number(idx)];
  const mr = wr?.matches.find((x) => x.match === match);
  const teamName = (id: number) => teams.get(id)?.name ?? `Team ${id}`;
  // Back to the exact spot in the schedule when we came from there; otherwise to the schedule itself.
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate(`/schedule?view=${wr?.complete ? 'completed' : 'upcoming'}`));

  return (
    <>
      <div className="scoring-top">
        <button className="link back-link" onClick={back}>‹ Back to schedule</button>
      </div>
      {!wr || !match ? (
        <p className="notice">That match isn’t on the schedule.</p>
      ) : (
        <>
          <h1>{teamName(match.teamA)} vs {teamName(match.teamB)}</h1>
          <p className="muted">
            Week {wr.week.number} · {formatDate(wr.week.date)} · {nineLabel(wr.nine)}
            {match.teeTime ? ` · ${match.teeTime}` : ''}
            {wr.week.playoff && <> · <span className="badge playoff">Playoffs</span></>}
          </p>
          {mr && mr.status !== 'pending' ? (
            <Scorecard match={mr} nine={wr.nine} players={players} teamName={teamName} />
          ) : (
            <>
              <div className="grid-2">
                {[match.teamA, match.teamB].map((t) => (
                  <section key={t} className="card">
                    <h3>{teamName(t)}</h3>
                    <ul className="plain">
                      {teamPlayers(t).map((p) => (
                        <li key={p.id}><Link to={`/players/${p.id}`}>{p.name}</Link></li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <p className="muted small">Not played yet. The scorecard appears here once scores are in.</p>
            </>
          )}
          <p className="small"><Link to={`/results/${wr.week.number}`}>All of week {wr.week.number}’s results ›</Link></p>
        </>
      )}
    </>
  );
}
