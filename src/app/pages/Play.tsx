import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatInfo, holeNumber, nineLabel, type CardEntry, type SeasonData, type SeasonResult } from '../../engine';
import { api, type MyMatch } from '../api';
import { CardReview, didNotPlay, entryComplete, HoleByHole, type Entry, type EntryRow, type Flags, type HoleInfo } from '../components/HoleByHole';
import { DistanceToGreen } from '../components/DistanceToGreen';
import { formatDate, lookups } from '../format';
import { clearDraft, send, useDraft } from '../offline';
import { useLoaded, useSeason } from '../season';

/** The signed-in player's matches this season, and the hole-by-hole card for one of them. */
export function useMyMatches() {
  const s = useLoaded();
  const [state, setState] = useState<{ playerId: number | null; matches: MyMatch[]; field?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!s?.seasonId) return;
    try {
      setState(await api.myMatches(s.seasonId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [s?.seasonId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { s, state, error, load };
}

const today = () => new Date().toLocaleDateString('en-CA');

/** The match to enter now: today's (or the latest past one) that isn't official yet. */
export function dueMatch(matches: MyMatch[]): MyMatch | undefined {
  const open = matches.filter((m) => !m.blocked && (!m.date || m.date <= today()));
  return [...open].reverse().find((m) => m.consensus.status !== 'agreed' && !m.official.length) ?? undefined;
}

export function PlayPage() {
  const { s, state, error } = useMyMatches();
  const { me } = useSeason();
  if (!s) return <p className="empty">No season yet.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!state) return <p className="empty">Loading…</p>;
  const { teams, players } = lookups(s.data);
  if (state.playerId == null) {
    return <p className="notice">Your account ({me?.user?.email}) isn’t linked to a player in {s.data.season.name}. Ask a league admin to link it.</p>;
  }
  const myTeam = players.get(state.playerId)?.teamId;
  const due = dueMatch(state.matches);
  const format = formatInfo(s.data.settings);
  const against = (m: MyMatch) => (state.field ? (format.teamCard ? `${teams.get(myTeam ?? -1)?.name} team card` : 'Your round') : `vs ${teams.get(m.teamA === myTeam ? m.teamB : m.teamA)?.name ?? `Team ${m.teamA === myTeam ? m.teamB : m.teamA}`}`);

  return (
    <>
      <h1>League scoring</h1>
      {due && (
        <Link className="hero-action" to={`/play/${due.week}`}>
          <span>
            <strong>Enter week {due.week}</strong>
            <span className="small">{against(due)} · {formatDate(due.date)}</span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      )}
      <p className="small muted">
        {state.field
          ? format.teamCard
            ? 'Anyone on the team can enter the team’s card. It counts as soon as it’s sent; an admin can correct it.'
            : 'Enter your own card. It counts as soon as it’s sent; an admin can correct it.'
          : 'Anyone in the match can enter the whole card. It counts once a player from each side has entered a card and the cards match exactly.'}
      </p>
      <ul className="list-cards">
        {state.matches.map((m) => {
          return (
            <li key={m.week}>
              <Link to={`/play/${m.week}`} className="list-card">
                <span>
                  <strong>Week {m.week}</strong> <span className="muted small">{formatDate(m.date)}</span>
                  <span className="small block">{against(m)}</span>
                </span>
                <StatusBadge m={m} teamName={(id) => teams.get(id)?.name ?? `Team ${id}`} />
              </Link>
            </li>
          );
        })}
      </ul>
      {!state.matches.length && <p className="empty">{state.field ? 'No weeks on the schedule yet.' : 'You have no matches on the schedule yet.'}</p>}
    </>
  );
}

export function StatusBadge({ m, teamName }: { m: MyMatch; teamName: (id: number) => string }) {
  if (m.forfeit) return <span className="badge forfeit">Forfeit</span>;
  const mine = m.submissions.some((s) => s.mine);
  // Every player has a saved score (cards agreed, or an admin accepted or entered them).
  if (m.consensus.status !== 'agreed' && m.official.length === m.playerIds.flat().length) {
    return <span className="badge ok">{m.submissions.length ? 'Accepted by admin ✓' : 'Entered by admin'}</span>;
  }
  switch (m.consensus.status) {
    case 'agreed':
      return <span className="badge ok">Official ✓</span>;
    case 'mismatch':
      return <span className="badge bad">{mine ? 'Cards differ' : 'Needs your card'}</span>;
    case 'waiting':
      return <span className="badge warn">{mine ? `Waiting for ${m.consensus.missingTeams.map(teamName).join(', ')}` : 'Needs your card'}</span>;
    default:
      if (m.official.length) return <span className="badge ok">Entered by admin</span>;
      return m.blocked ? <span className="muted small">Upcoming</span> : <span className="badge warn">Not entered</span>;
  }
}

export function MatchCardPage() {
  const { week } = useParams();
  const { s, state, error, load } = useMyMatches();
  const { me, reload } = useSeason();
  const match = state?.matches.find((m) => m.week === Number(week));
  if (!s) return <p className="empty">No season yet.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!state) return <p className="empty">Loading…</p>;
  if (!match) return <p className="notice">You don’t have a match in week {week}. <Link to="/play">Back</Link></p>;
  return <MatchCard key={`${s.seasonId}-${match.week}`} match={match} field={!!state.field} seasonId={s.seasonId!} userId={me!.user!.id} data={s.data} result={s.result} onSaved={async (agreed) => { await load(); if (agreed) await reload(); }} />;
}

function MatchCard({ match, field, seasonId, userId, data, result, onSaved }: { match: MyMatch; field: boolean; seasonId: number; userId: number; data: SeasonData; result: SeasonResult; onSaved: (agreed: boolean) => Promise<void> }) {
  const navigate = useNavigate();
  const { players, teams } = lookups(data);
  const nine = data.nines.find((n) => n.id === match.nineId) ?? data.nines[0];
  const holes: HoleInfo[] = nine.par.map((par, i) => ({ number: holeNumber(nine, i), par, yards: nine.yardage?.[i] || null, hcp: nine.menHcp[i] }));
  // A scramble team card is stored under the negative team id.
  // The handicap each player is playing off this week, shown next to their name.
  const hcOf = (id: number) => result.handicaps.get(id)?.playing.get(match.week) ?? result.handicaps.get(id)?.current ?? null;
  const rows: EntryRow[] = match.playerIds.flatMap((side, si) =>
    side.map((id) => {
      const base = id < 0 ? (teams.get(-id)?.name ?? 'Team') : (players.get(id)?.name ?? `Player ${id}`);
      const hc = id < 0 ? null : hcOf(id);
      return {
        id,
        name: hc != null ? `${base} (${hc})` : base,
        detail: id < 0 ? 'Team card' : field ? undefined : teams.get(si ? match.teamB : match.teamA)?.name,
        allowAbsent: !field,
      };
    }),
  );
  const mine = match.submissions.find((x) => x.mine);
  // A finished head-to-head match (cards agreed, or an admin posted the scores) is locked: every
  // player has an official score. From here only a league admin can correct it, on the admin screen.
  const idCount = match.playerIds.flat().length;
  const lock =
    match.blocked ??
    (!field && idCount > 0 && match.official.length === idCount
      ? 'These scores are final — only a league admin can change them now.'
      : null);

  // Start from your own card, then the official scores, then blank. Kept on the phone as you go.
  const draftKey = `golf-league.card.${seasonId}.${match.week}.${userId}`;
  const [entry, setEntry] = useDraft<Entry>(draftKey, () => {
    const source = mine?.cards ?? match.official;
    return Object.fromEntries(
      rows.map((r) => {
        const c = source.find((x) => x.playerId === r.id);
        return [r.id, { absent: !!c?.absent, scores: c?.holes ? c.holes.map((h) => h || null) : Array(9).fill(null), dnf: c?.dnf ? [...c.dnf] : Array(9).fill(false) }];
      }),
    );
  });
  const [hole, setHole] = useState(() => Math.max(0, holes.findIndex((_, h) => rows.some((r) => !entry[r.id].absent && !didNotPlay(entry[r.id], h) && entry[r.id].scores[h] == null))));
  const [reviewing, setReviewing] = useState(!!lock || match.consensus.status === 'agreed');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'notice'; text: string } | null>(null);

  const flags: Flags = useMemo(
    () => new Set(match.consensus.differences.map((d) => `${d.playerId}:${d.hole}`)),
    [match.consensus.differences],
  );
  const complete = entryComplete(entry, rows, 9);
  const others = match.submissions.filter((x) => !x.mine && x.cards);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const cards: CardEntry[] = rows.map((r) => ({
      playerId: r.id,
      absent: entry[r.id].absent,
      holes: entry[r.id].absent ? null : entry[r.id].scores.map(Number),
      dnf: entry[r.id].absent ? null : (entry[r.id].dnf ?? null),
    }));
    try {
      const res = await send({ kind: 'card', seasonId, week: match.week, cards, label: `Week ${match.week} card` });
      clearDraft(draftKey);
      if (res.queued) {
        setMessage({ kind: 'notice', text: 'No signal. Your card is saved on this phone and will be sent automatically when you’re back online.' });
      } else {
        const status = (res.result as { status: string }).status;
        await onSaved(status === 'agreed');
        setMessage({
          kind: status === 'mismatch' ? 'error' : 'ok',
          text:
            field
              ? 'Saved. Your score is in the standings.'
              : status === 'agreed'
              ? 'Both sides’ cards match. The scores are in the standings.'
              : status === 'mismatch'
                ? 'Sent, but it doesn’t match another card. The holes that differ are highlighted.'
                : 'Sent. Waiting for the other side’s card.',
        });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scoring">
      <div className="scoring-top">
        <button className="link" onClick={() => navigate('/play')}>‹ {field ? 'Weeks' : 'Matches'}</button>
        <span className="small muted">Week {match.week} · {formatDate(match.date)} · {nineLabel(nine)}</span>
      </div>
      {lock && <p className="notice">{lock}</p>}

      {!reviewing ? (
        <>
          <DistanceToGreen nine={nine} hole={hole} />
          <HoleByHole holes={holes} rows={rows} value={entry} onChange={setEntry} hole={hole} onHole={setHole} flags={flags} />
          <div className="action-bar">
            <button disabled={hole === 0} onClick={() => setHole(hole - 1)}>‹ Back</button>
            {hole < 8 ? (
              <button className="primary" onClick={() => setHole(hole + 1)}>Next hole ›</button>
            ) : (
              <button className="primary" onClick={() => setReviewing(true)}>Review card</button>
            )}
          </div>
        </>
      ) : (
        <>
          <h2>Review the card</h2>
          <CardReview holes={holes} rows={rows} value={entry} flags={flags} onHole={lock ? undefined : (h) => { setHole(h); setReviewing(false); }} />
          {flags.size > 0 && (
            <div className="notice small">
              <strong>Doesn’t match the other card{others.length > 1 ? 's' : ''}:</strong>
              <ul>
                {match.consensus.differences.map((d, i) => (
                  <li key={i}>
                    {players.get(d.playerId)?.name}, {d.hole === 'absent' ? 'absent or not' : `hole ${holes[d.hole].number}`}: {describe(others, mine?.cards ?? null, d.playerId, d.hole)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {message && <p className={message.kind}>{message.text}</p>}
          {!lock && (
            <div className="action-bar">
              <button onClick={() => setReviewing(false)}>‹ Edit</button>
              <button className="primary" disabled={busy || !complete} onClick={submit}>
                {busy ? 'Sending…' : mine ? 'Send corrected card' : 'Submit card'}
              </button>
            </div>
          )}
          {!complete && !lock && <p className="small muted center">Every hole needs a score (or mark the player absent, or “Didn’t play this hole”).</p>}
        </>
      )}
    </div>
  );
}

/** "you 5, Smith 6": what each card says for one player's hole. */
function describe(others: MyMatch['submissions'], mine: CardEntry[] | null, playerId: number, hole: number | 'absent'): string {
  const value = (cards: CardEntry[] | null) => {
    const c = cards?.find((x) => x.playerId === playerId);
    if (!c) return '?';
    if (hole === 'absent') return c.absent ? 'absent' : 'played';
    return c.absent ? 'absent' : c.dnf?.[hole] ? 'did not play' : String(c.holes?.[hole] ?? '?');
  };
  return [...(mine ? [`you ${value(mine)}`] : []), ...others.map((o) => `${o.name ?? 'other card'} ${value(o.cards)}`)].join(', ');
}
