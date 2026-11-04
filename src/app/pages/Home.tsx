import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { formatDate, lookups, ordinal } from '../format';
import { readDraft } from '../offline';
import { useSeason } from '../season';
import { myHoles, recentCourses, ROUND_DRAFT, useRounds } from './MyRounds';
import { dueMatch, StatusBadge, useMyMatches } from './Play';
import { timeAgo, useBoard } from './Board';

/** After signing in: the league or your own golf, with today's most likely action first. */
export function HomePage() {
  const { me, admin, league, seasons, loading } = useSeason();
  const first = me?.user?.name?.split(' ')[0];
  return (
    <>
      <h1>{first ? `Hi, ${first}` : 'Welcome'}</h1>
      {league && (seasons.length || loading ? <LeagueHome /> : <p className="notice">{league.name} has no season yet.</p>)}
      {league && <BoardHome />}
      {!league && me?.user && (
        <p className="notice">
          {me.requested.length
            ? `You’ve asked to join ${me.requested.map((l) => l.name).join(' and ')}. You’ll see the league here once its admin approves you.`
            : 'You’re signed in, but not in a league yet. Open your league’s invite link to ask to join.'}{' '}
          You can still track your own rounds. <Link to="/leagues">Leagues ›</Link>
        </p>
      )}
      {me?.user && <GolfHome />}
      {admin && <AdminHome />}
    </>
  );
}

function LeagueHome() {
  const { s, state } = useMyMatches();
  if (!s || !state) return <section className="home-card"><p className="muted">Loading league…</p></section>;
  const { teams, players } = lookups(s.data);
  const myTeam = state.playerId != null ? players.get(state.playerId)?.teamId : null;
  const due = dueMatch(state.matches);
  const today = new Date().toLocaleDateString('en-CA');
  const next = state.matches.find((m) => m.date && m.date > today);
  const standing = s.result.standings.find((r) => r.team.id === myTeam);
  const vs = (m: { teamA: number; teamB: number }) => (state.field ? 'your round' : `vs ${teams.get(m.teamA === myTeam ? m.teamB : m.teamA)?.name ?? ''}`);

  return (
    <section className="home-card league">
      <div className="home-card-head">
        <h2>League</h2>
        <span className="muted small">{s.data.season.name}</span>
      </div>
      {due ? (
        <Link className="hero-action" to={`/play/${due.week}`}>
          <span>
            <strong>Enter week {due.week} scores</strong>
            <span className="small">{vs(due)} · {formatDate(due.date)}</span>
          </span>
          <StatusBadge m={due} teamName={(id) => teams.get(id)?.name ?? ''} />
        </Link>
      ) : next ? (
        <p className="next-match">
          Next {state.field ? 'round' : 'match'}: <strong>week {next.week}</strong>, {formatDate(next.date)} {state.field ? '' : vs(next)}
        </p>
      ) : null}
      <div className="home-links">
        {standing && (
          <Link to="/standings" className="mini-stat">
            <span className="mini-value">{ordinal(standing.rank)}</span>
            <span className="small muted">{standing.team.name} · {standing.standingPoints} pts</span>
          </Link>
        )}
        <Link to="/standings" className="mini-stat"><span className="mini-value">🏆</span><span className="small muted">Standings</span></Link>
        <Link to="/results" className="mini-stat"><span className="mini-value">▦</span><span className="small muted">Results</span></Link>
        <Link to="/schedule" className="mini-stat"><span className="mini-value">📅</span><span className="small muted">Schedule</span></Link>
      </div>
    </section>
  );
}

function BoardHome() {
  const { posts } = useBoard();
  const latest = (posts ?? []).slice(0, 3);
  return (
    <section className="home-card">
      <div className="home-card-head">
        <h2>Message board</h2>
        <Link to="/board" className="small">Open ›</Link>
      </div>
      {!posts ? (
        <p className="muted small">Loading…</p>
      ) : !latest.length ? (
        <p className="muted small">No messages yet. <Link to="/board">Write the first one</Link>.</p>
      ) : (
        <ul className="list-cards">
          {latest.map((p) => (
            <li key={p.id}>
              <Link to="/board" className="list-card board-preview">
                <span>
                  <strong>{p.author}</strong> <span className="small muted">{timeAgo(p.createdAt)}{p.pinned ? ' · pinned' : ''}</span>
                  <span className="block small clamp">{p.body}</span>
                </span>
                {p.replies.length > 0 && <span className="badge">{p.replies.length} repl{p.replies.length === 1 ? 'y' : 'ies'}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GolfHome() {
  const { rounds } = useRounds();
  const navigate = useNavigate();
  const inProgress = readDraft<{ course: { courseName: string; firstHole: number } | null; hole: number }>(ROUND_DRAFT);
  const recent = rounds ? recentCourses(rounds, 4) : [];
  const last = rounds?.[0];
  return (
    <section className="home-card golf">
      <div className="home-card-head">
        <h2>My golf</h2>
        <Link to="/rounds" className="small">All rounds ›</Link>
      </div>
      {inProgress?.course ? (
        <Link className="hero-action" to="/rounds/new">
          <span><strong>Resume round</strong><span className="small">{inProgress.course.courseName} · hole {inProgress.course.firstHole + inProgress.hole}</span></span>
          <span aria-hidden>›</span>
        </Link>
      ) : (
        <Link className="hero-action" to="/rounds/new">
          <span><strong>Start a round</strong><span className="small">Score any course, hole by hole</span></span>
          <span aria-hidden>›</span>
        </Link>
      )}
      {!inProgress?.course && recent.length > 0 && (
        <div className="chips">
          {recent.map((c, i) => (
            <button key={i} className="chip" onClick={() => navigate('/rounds/new', { state: { course: c } })}>
              <strong>{c.courseName}</strong>
              <span className="small muted">{c.par.length === 18 ? '18' : c.firstHole === 10 ? 'Back 9' : 'Front 9'}{c.tee ? ` · ${c.tee}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {last && (
        <p className="small muted">
          {last.live ? 'Playing now' : 'Last round'}: <Link to={`/rounds/${last.id}`}>{myHoles(last).reduce((a, b) => a + b, 0) || '–'} at {last.courseName}</Link>, {formatDate(last.playedOn)}
        </p>
      )}
    </section>
  );
}

function AdminHome() {
  const { seasonId, data, leagueId, league, superAdmin } = useSeason();
  const [requests, setRequests] = useState(0);
  const [pending, setPending] = useState(0);
  const [cards, setCards] = useState<Awaited<ReturnType<typeof api.pendingCards>>>([]);
  useEffect(() => {
    if (!leagueId) return;
    api.league(leagueId).then((l) => setRequests(l.members.filter((m) => m.role === 'requested').length), () => undefined);
    // Sign-ups that didn't come through a league's invite link wait for a site admin.
    if (superAdmin) api.accounts(leagueId, null, true).then((a) => setPending(a.filter((x) => x.status === 'pending' && !x.leagueRole).length), () => undefined);
  }, [leagueId, superAdmin]);
  useEffect(() => {
    if (seasonId) api.pendingCards(seasonId).then(setCards, () => setCards([]));
  }, [seasonId]);
  const team = (id: number) => data?.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  return (
    <section className="home-card">
      <div className="home-card-head">
        <h2>Admin · {league?.name}</h2>
        <Link to="/admin" className="small">Admin ›</Link>
      </div>
      {requests > 0 && (
        <Link className="hero-action warn" to="/admin/league">
          <span><strong>{requests} {requests > 1 ? 'people' : 'person'} asking to join</strong><span className="small">Approve, then link them to a player</span></span>
          <span aria-hidden>›</span>
        </Link>
      )}
      {pending > 0 && (
        <Link className="hero-action warn" to="/admin/accounts?all">
          <span><strong>{pending} sign-up{pending > 1 ? 's' : ''} with no league</strong><span className="small">Approve or turn off on the site’s account list</span></span>
          <span aria-hidden>›</span>
        </Link>
      )}
      {cards.length > 0 && (
        <>
          <p className="small muted">Player cards waiting for you:</p>
          <ul className="list-cards">
            {cards.map((c) => (
              <li key={`${c.week}-${c.teamA}-${c.teamB}`}>
                <Link to={`/admin/scores/${c.week}`} className="list-card">
                  <span>
                    <strong>Week {c.week}: {team(c.teamA)} vs {team(c.teamB)}</strong>
                    <span className="small muted block">Card from {c.names.filter(Boolean).join(', ') || 'a player'}</span>
                  </span>
                  <span className={`badge ${c.status === 'mismatch' ? 'bad' : 'warn'}`}>{c.status === 'mismatch' ? 'Cards differ' : 'Only one card'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="home-links">
        <Link to="/admin" className="mini-stat"><span className="mini-value">✎</span><span className="small muted">Enter scores</span></Link>
        <Link to="/admin/schedule#rain-out" className="mini-stat"><span className="mini-value">☔</span><span className="small muted">Rained out</span></Link>
        <Link to="/admin/new-season" className="mini-stat"><span className="mini-value">＋</span><span className="small muted">New season</span></Link>
        <Link to="/admin/accounts" className="mini-stat"><span className="mini-value">👤</span><span className="small muted">Accounts</span></Link>
      </div>
    </section>
  );
}
