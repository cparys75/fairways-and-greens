/**
 * A round played as a group: everyone's scores on one card, kept on the server so the person who
 * started it, friends with accounts and guests with a link all see the same card and can all score.
 * Each score is sent on its own as it's entered; the card refreshes every few seconds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatUnits, gameInfo, playGame, type GameResult, type GameSetup } from '../../engine';
import { api, OfflineError, type Round } from '../api';
import { GroupSetup, type GroupSetupValue } from '../components/GroupSetup';
import { CardReview, HoleByHole, type Entry, type EntryRow, type HoleInfo } from '../components/HoleByHole';
import { formatDate, signed } from '../format';

type Source = { kind: 'mine'; id: number } | { kind: 'guest'; token: string };
type Cell = { idx: number; hole: number; score: number };

const REFRESH_MS = 8000;
const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const today = () => new Date().toLocaleDateString('en-CA');

/** Scores entered without a connection, kept on the phone until they're sent. */
function usePending(key: string) {
  const read = (): Record<string, Cell> => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  };
  const ref = useRef<Record<string, Cell>>(read());
  const save = () => {
    try {
      if (Object.keys(ref.current).length) localStorage.setItem(key, JSON.stringify(ref.current));
      else localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  };
  return { ref, save };
}

export function LiveRound({ source, onChanged }: { source: Source; onChanged?: () => void }) {
  const navigate = useNavigate();
  const [round, setRound] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [hole, setHole] = useState<number | null>(null);
  const [view, setView] = useState<'play' | 'card' | 'group'>('play');
  const pending = usePending(`golf-league.live.${source.kind === 'mine' ? source.id : source.token}`);
  // Set once the round is deleted (or left), so the card stops refreshing and sending.
  const gone = useRef(false);

  const fetchRound = useCallback(() => (source.kind === 'mine' ? api.round(source.id) : api.guestRound(source.token)), [source]);
  const sendScore = useCallback(
    (c: Cell) => (source.kind === 'mine' ? api.roundScore(source.id, c.idx, c.hole, c.score) : api.guestScore(source.token, c.idx, c.hole, c.score)),
    [source],
  );

  /** Server copy, with this phone's unsent scores on top. */
  const withPending = useCallback(
    (r: Round): Round => {
      const cells = Object.values(pending.ref.current);
      if (!cells.length) return r;
      const holes = (idx: number, hs: number[]) => hs.map((s, h) => cells.find((c) => c.idx === idx && c.hole === h)?.score ?? s);
      return { ...r, holes: holes(0, r.holes), players: (r.players ?? []).map((p) => ({ ...p, holes: holes(p.idx, p.holes) })) };
    },
    [pending.ref],
  );

  const flush = useCallback(async () => {
    for (const [key, c] of Object.entries(pending.ref.current)) {
      try {
        await sendScore(c);
        if (pending.ref.current[key]?.score === c.score) delete pending.ref.current[key];
        pending.save();
        setOffline(false);
      } catch (e) {
        if (e instanceof OfflineError) {
          setOffline(true);
          return;
        }
        delete pending.ref.current[key];
        pending.save();
        setError((e as Error).message);
      }
    }
  }, [pending, sendScore]);

  const refresh = useCallback(async () => {
    if (gone.current) return;
    await flush();
    try {
      const r = await fetchRound();
      setRound(withPending(r));
      setOffline(false);
    } catch (e) {
      if (e instanceof OfflineError) setOffline(true);
      else setError((e as Error).message);
    }
  }, [fetchRound, flush, withPending]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const everyone = useMemo(
    () =>
      round
        ? [
            { idx: 0, name: round.me === 0 ? 'You' : (round.ownerName ?? 'Player 1'), handicap: round.handicap ?? null, holes: round.holes },
            ...(round.players ?? []).map((p) => ({ idx: p.idx, name: p.idx === round.me ? `${p.name} (you)` : p.name, handicap: p.handicap, holes: p.holes })),
          ]
        : [],
    [round],
  );
  const result: GameResult | null = useMemo(
    () => (round?.game ? playGame(round.game, round.par, round.hcp, everyone) : null),
    [round, everyone],
  );

  if (error && !round) return <p className="error">{error}</p>;
  if (!round) return <p className="empty">{offline ? 'No connection. Waiting to load the round…' : 'Loading…'}</p>;

  const holes: HoleInfo[] = round.par.map((par, i) => ({ number: round.firstHole + i, par, yards: round.yardage?.[i] || null, hcp: round.hcp?.[i] ?? null }));
  const current = hole ?? Math.max(0, Math.min(holes.length - 1, round.holes.findIndex((_, h) => everyone.some((p) => !p.holes[h]))));
  const owner = round.me === 0;
  const game = round.game ?? null;
  const rows: EntryRow[] = everyone.map((p, i) => {
    const strokes = result?.strokes[i]?.[current] ?? 0;
    return { id: p.idx, name: p.name, detail: [p.handicap != null && `HC ${p.handicap}`, strokes && `${strokes} stroke${strokes > 1 ? 's' : ''} here`].filter(Boolean).join(' · ') || undefined };
  });
  const entry: Entry = Object.fromEntries(everyone.map((p) => [p.idx, { absent: false, scores: p.holes.map((s) => s || null) }]));

  const onEntry = (next: Entry) => {
    // Find the score that changed on this hole and send just that one.
    for (const p of everyone) {
      const v = next[p.idx].scores[current] ?? 0;
      if (v !== (p.holes[current] ?? 0)) {
        pending.ref.current[`${p.idx}:${current}`] = { idx: p.idx, hole: current, score: v };
        pending.save();
      }
    }
    setRound(withPending(round));
    void flush();
  };

  const setWolf = async (choice: number | 'lone' | null) => {
    if (!game) return;
    const wolf = [...(game.wolf ?? Array(holes.length).fill(null))];
    wolf[current] = choice;
    setRound({ ...round, game: { ...game, wolf } });
    try {
      await (source.kind === 'mine' ? api.roundWolf(source.id, current, choice) : api.guestWolf(source.token, current, choice));
    } catch (e) {
      setError(e instanceof OfflineError ? 'No connection: the wolf’s pick wasn’t saved. Try again with signal.' : (e as Error).message);
    }
  };

  const title = `${round.courseName}${round.tee ? ` · ${round.tee}` : ''}`;

  // The starter deletes the round for everyone; a friend with an account can take it off their own list.
  const removeRound = async () => {
    if (source.kind !== 'mine') return;
    const question = owner
      ? `Delete this round at ${round.courseName}? It’s removed for everyone in the group too. This can’t be undone.`
      : `Leave this round? It comes off your My rounds; ${round.ownerName ?? 'the starter'} keeps it.`;
    if (!confirm(question)) return;
    gone.current = true;
    try {
      await (owner ? api.deleteRound(source.id) : api.leaveRound(source.id));
      pending.ref.current = {};
      pending.save();
      onChanged?.();
      navigate('/rounds', { replace: true });
    } catch (e) {
      gone.current = false;
      setError(e instanceof OfflineError ? 'No connection. Deleting a round needs a connection; try again when you have signal.' : (e as Error).message);
    }
  };
  const back = source.kind === 'mine' ? <button className="link" onClick={() => navigate('/rounds')}>‹ Rounds</button> : <span className="small muted">Guest scorecard</span>;

  return (
    <div className="scoring">
      <div className="scoring-top">
        {back}
        {source.kind === 'mine' && (
          <button className="delete-round" onClick={removeRound}>{owner ? 'Delete round' : 'Leave round'}</button>
        )}
      </div>
      <div className="segmented small-seg round-views">
        <button aria-pressed={view === 'play'} onClick={() => setView('play')}>Hole</button>
        <button aria-pressed={view === 'card'} onClick={() => setView('card')}>Card{game ? ' & game' : ''}</button>
        {owner && <button aria-pressed={view === 'group'} onClick={() => setView('group')}>Group</button>}
      </div>
      <p className="small muted scoring-sub">
        {title} · {formatDate(round.playedOn)}
        {round.me !== 0 && round.ownerName ? ` · started by ${round.ownerName}` : ''}
        {round.live ? ' · in progress' : ''}
      </p>
      {offline && <p className="notice small">No connection. Scores are saved on this phone and sent when you’re back online.</p>}
      {error && <p className="error small">{error}</p>}

      {view === 'play' && (
        <>
          {game?.id === 'wolf' && <WolfPick hole={current} game={game} names={everyone.map((p) => p.name)} onPick={setWolf} />}
          <HoleByHole holes={holes} rows={rows} value={entry} onChange={onEntry} hole={current} onHole={setHole} />
          {result && <GameLine game={game!} result={result} names={everyone.map((p) => p.name)} hole={current} />}
          <div className="action-bar">
            <button disabled={current === 0} onClick={() => setHole(current - 1)}>‹ Back</button>
            {current < holes.length - 1 ? (
              <button className="primary" onClick={() => setHole(current + 1)}>Next hole ›</button>
            ) : (
              <button className="primary" onClick={() => setView('card')}>See the card</button>
            )}
          </div>
        </>
      )}

      {view === 'card' && (
        <>
          <CardReview holes={holes} rows={rows.map((r) => ({ ...r, detail: undefined }))} value={entry} onHole={(h) => { setHole(h); setView('play'); }} />
          {result && game && <GameBoard game={game} result={result} names={everyone.map((p) => p.name)} holes={holes} />}
          {owner && source.kind === 'mine' && <Finish round={round} onDone={async () => { await refresh(); onChanged?.(); }} />}
          {source.kind === 'guest' && (
            <p className="small muted center">Scores you enter here go straight onto {round.ownerName ?? 'the'}’s card. <Link to="/">Get your own account</Link> to keep your rounds.</p>
          )}
        </>
      )}

      {view === 'group' && owner && source.kind === 'mine' && <GroupPanel round={round} onSaved={refresh} />}
    </div>
  );
}

/** The wolf for this hole picks a partner, or goes alone. */
function WolfPick({ hole, game, names, onPick }: { hole: number; game: GameSetup; names: string[]; onPick: (c: number | 'lone' | null) => void }) {
  const wolf = hole % names.length;
  const pick = game.wolf?.[hole] ?? null;
  return (
    <div className="wolf-pick card">
      <span className="small"><strong>{names[wolf]}</strong> is the wolf. Partner:</span>
      <div className="chips">
        {names.map((name, i) =>
          i === wolf ? null : (
            <button key={i} className={`chip ${pick === i ? 'on' : ''}`} aria-pressed={pick === i} onClick={() => onPick(pick === i ? null : i)}>
              {name}
            </button>
          ),
        )}
        <button className={`chip ${pick === 'lone' ? 'on' : ''}`} aria-pressed={pick === 'lone'} onClick={() => onPick(pick === 'lone' ? null : 'lone')}>
          Lone wolf 🐺
        </button>
      </div>
    </div>
  );
}

/** How the game stands, under the hole being scored. */
function GameLine({ game, result, names, hole }: { game: GameSetup; result: GameResult; names: string[]; hole: number }) {
  return (
    <div className="game-line small">
      <strong>{gameInfo(game.id).name}</strong>
      {result.holes[hole] && <span> · {result.holes[hole]}</span>}
      {result.status && <div className="muted">{result.status}</div>}
      <div className="game-chips">
        {names.map((name, i) => (
          <span key={i} className={`badge ${result.units[i] > 0 ? 'ok' : result.units[i] < 0 ? 'bad' : ''}`}>
            {name.replace(' (you)', '')}: {result.standing[i] || formatUnits(result.units[i], game)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The game's result: each player's standing and what they won or owe, and what happened on each hole. */
function GameBoard({ game, result, names, holes }: { game: GameSetup; result: GameResult; names: string[]; holes: HoleInfo[] }) {
  const info = gameInfo(game.id);
  return (
    <section className="card">
      <h3>{info.name}{game.stakes === 'money' ? ` · $${game.unit.toFixed(2)} a point` : ''}</h3>
      {result.status && <p className="small">{result.status}</p>}
      <table>
        <thead>
          <tr><th className="left">Player</th><th>Standing</th><th>{game.stakes === 'money' ? 'Owes / wins' : 'Points'}</th></tr>
        </thead>
        <tbody>
          {names.map((name, i) => (
            <tr key={i}>
              <td className="left">{name}</td>
              <td>{result.standing[i]}</td>
              <td className={`num-strong ${result.units[i] > 0 ? 'W' : result.units[i] < 0 ? 'L' : ''}`}>{formatUnits(result.units[i], game)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.holes.some(Boolean) && (
        <details>
          <summary className="small">Hole by hole</summary>
          <ul className="small plain">
            {result.holes.map((text, h) => (text ? <li key={h}>Hole {holes[h].number}: {text}</li> : null))}
          </ul>
        </details>
      )}
      <details>
        <summary className="small">How to play {info.name}</summary>
        <ul className="small">{info.howTo.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
    </section>
  );
}

/** The starter finishes the round: date and notes, and it moves to their history. */
function Finish({ round, onDone }: { round: Round; onDone: () => Promise<void> }) {
  const [playedOn, setPlayedOn] = useState(round.playedOn);
  const [notes, setNotes] = useState(round.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const mine = round.holes;
  const complete = mine.every((s) => s > 0);
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.saveRound({ ...round, playedOn, notes: notes.trim() || null, live: false });
      await onDone();
      setMessage({ kind: 'ok', text: 'Round saved.' });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof OfflineError ? 'No connection. Finish the round when you have signal; your scores are safe.' : (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <p className="center">
        Your score: <strong className="big">{total(mine) || '–'}</strong>{' '}
        {complete && <span className="muted">({signed(total(mine) - total(round.par)).replace(/^0$/, 'E')})</span>}
      </p>
      <div className="form-grid">
        <label className="field"><span>Date played</span><input type="date" value={playedOn} max={today()} onChange={(e) => setPlayedOn(e.target.value)} /></label>
        <label className="field"><span>Notes (optional)</span><input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {message && <p className={message.kind}>{message.text}</p>}
      <div className="action-bar">
        <button className="primary" disabled={busy || !complete} onClick={save}>{round.live ? 'Finish round' : 'Save changes'}</button>
      </div>
      {!complete && <p className="small muted center">Your card needs a score on every hole to finish. Friends’ cards can be left incomplete.</p>}
    </section>
  );
}

/** The starter's tools: change who's playing and the game, and send guests their link. */
function GroupPanel({ round, onSaved }: { round: Round; onSaved: () => Promise<void> }) {
  const [setup, setSetup] = useState<GroupSetupValue>(() => ({
    handicap: round.handicap ?? null,
    players: (round.players ?? []).map(({ idx, name, userId, handicap }) => ({ idx, name, userId, handicap })),
    game: round.game ?? null,
  }));
  const [links, setLinks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const players = setup.players.map((p) => ({ ...p, name: p.name.trim() || 'Guest', holes: round.players?.find((x) => x.idx === p.idx)?.holes ?? Array(round.par.length).fill(0) }));
      await api.saveRound({ ...round, handicap: setup.handicap, players, game: setup.game });
      await onSaved();
      setMessage({ kind: 'ok', text: 'Group saved.' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const share = async (idx: number, name: string) => {
    try {
      const { url } = await api.guestLink(round.id!, idx);
      setLinks((l) => ({ ...l, [idx]: url }));
      if (navigator.share) await navigator.share({ title: `${round.courseName} scorecard`, text: `${name}, here’s our scorecard:`, url }).catch(() => undefined);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const guests = (round.players ?? []).filter((p) => !p.userId);
  return (
    <>
      {guests.length > 0 && (
        <section className="card">
          <h3>Guest links</h3>
          <p className="small muted">Each guest gets their own link to this round only: they can follow the card and enter scores without an account. A link works for 3 days; making a new one stops the old one.</p>
          <ul className="setup-players">
            {guests.map((p) => (
              <li key={p.idx}>
                <span className="grow"><strong>{p.name}</strong></span>
                <button onClick={() => share(p.idx, p.name)}>{links[p.idx] || p.hasLink ? 'New link' : 'Share link'}</button>
                {links[p.idx] && (
                  <div className="copy-row" style={{ flexBasis: '100%' }}>
                    <input readOnly value={links[p.idx]} onFocus={(e) => e.target.select()} aria-label={`${p.name}’s link`} />
                    <button onClick={() => navigator.clipboard?.writeText(links[p.idx])}>Copy</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <GroupSetup value={setup} onChange={setSetup} me="You" />
      {message && <p className={message.kind}>{message.text}</p>}
      <div className="action-bar">
        <button className="primary" disabled={busy} onClick={save}>Save group &amp; game</button>
      </div>
    </>
  );
}
