import { useEffect, useState, type FormEvent } from 'react';
import { GAMES, gameInfo, type GameId, type GameSetup } from '../../engine';
import { api, type Golfer } from '../api';

export interface SetupPlayer {
  idx: number;
  name: string;
  /** Registered: the round shows up in their My rounds. Otherwise a guest. */
  userId: number | null;
  handicap: number | null;
}

export interface GroupSetupValue {
  /** Your handicap for this round. */
  handicap: number | null;
  players: SetupPlayer[];
  game: GameSetup | null;
}

export const MAX_OTHERS = 7;

const newGame = (id: GameId): GameSetup => ({ id, handicaps: 'full', stakes: 'points', unit: 1 });

/** Who's playing with you, their handicaps, and the game to play. */
export function GroupSetup({ value, onChange, me }: { value: GroupSetupValue; onChange: (v: GroupSetupValue) => void; me: string }) {
  const set = (patch: Partial<GroupSetupValue>) => onChange({ ...value, ...patch });
  const everyone = [me, ...value.players.map((p) => p.name)];
  const setPlayer = (idx: number, patch: Partial<SetupPlayer>) => set({ players: value.players.map((p) => (p.idx === idx ? { ...p, ...patch } : p)) });
  const add = (p: Omit<SetupPlayer, 'idx'>) => {
    const idx = Math.max(0, ...value.players.map((x) => x.idx)) + 1;
    const players = [...value.players, { ...p, idx }];
    // Drop a game that no longer fits the group.
    set({ players, game: value.game && gameInfo(value.game.id).fits(players.length + 1) ? value.game : null });
  };
  const remove = (idx: number) => {
    const players = value.players.filter((p) => p.idx !== idx);
    set({ players, game: value.game && gameInfo(value.game.id).fits(players.length + 1) ? value.game : null });
  };

  return (
    <div className="group-setup">
      <section className="card">
        <h3>Who’s playing</h3>
        <ul className="setup-players">
          <li>
            <span className="grow"><strong>{me}</strong> <span className="small muted">(you)</span></span>
            <HandicapInput value={value.handicap} onChange={(handicap) => set({ handicap })} label="Your handicap" />
          </li>
          {value.players.map((p) => (
            <li key={p.idx}>
              <span className="grow">
                {p.userId ? (
                  <strong>{p.name}</strong>
                ) : (
                  <input aria-label="Guest name" value={p.name} maxLength={40} onChange={(e) => setPlayer(p.idx, { name: e.target.value })} />
                )}
                <span className="small muted block">{p.userId ? 'Has an account: sees this round in My rounds' : 'Guest: you can send a link to follow along'}</span>
              </span>
              <HandicapInput value={p.handicap} onChange={(handicap) => setPlayer(p.idx, { handicap })} label={`${p.name}’s handicap`} />
              <button className="link danger" aria-label={`Remove ${p.name}`} onClick={() => remove(p.idx)}>✕</button>
            </li>
          ))}
        </ul>
        {value.players.length < MAX_OTHERS ? (
          <AddPlayer taken={value.players.map((p) => p.userId).filter((x): x is number => x != null)} onAdd={add} />
        ) : (
          <p className="small muted">That’s a full group of 8.</p>
        )}
        <p className="small muted">Handicaps are just for this round’s game; type the course handicap for 18 holes (a nine uses half).</p>
      </section>

      {value.players.length > 0 && <GamePicker game={value.game} names={everyone} onChange={(game) => set({ game })} />}
    </div>
  );
}

function HandicapInput({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <label className="hc-input">
      <span className="small muted">HC</span>
      <input
        type="number"
        inputMode="numeric"
        min={-10}
        max={54}
        aria-label={label}
        placeholder="–"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.max(-10, Math.min(54, Math.round(Number(e.target.value)))))}
      />
    </label>
  );
}

/** Add someone from your leagues, a registered player by email, or a guest by name. */
function AddPlayer({ taken, onAdd }: { taken: number[]; onAdd: (p: Omit<SetupPlayer, 'idx'>) => void }) {
  const [mode, setMode] = useState<'league' | 'email' | 'guest' | null>(null);
  const [golfers, setGolfers] = useState<Golfer[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === 'league' && !golfers) api.golfers().then(setGolfers, () => setGolfers([]));
  }, [mode, golfers]);

  const done = (p: Omit<SetupPlayer, 'idx'>) => {
    onAdd(p);
    setText('');
    setError(null);
  };
  const findByEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const g = await api.findGolfer(text.trim());
      if (taken.includes(g.userId)) setError(`${g.name} is already in the group.`);
      else done({ name: g.name, userId: g.userId, handicap: null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-player">
      <div className="segmented" role="tablist" aria-label="Add a player">
        <button role="tab" aria-selected={mode === 'league'} onClick={() => setMode('league')}>From my leagues</button>
        <button role="tab" aria-selected={mode === 'email'} onClick={() => setMode('email')}>By email</button>
        <button role="tab" aria-selected={mode === 'guest'} onClick={() => setMode('guest')}>Guest</button>
      </div>
      {mode === 'league' &&
        (!golfers ? (
          <p className="small muted">Loading…</p>
        ) : !golfers.filter((g) => !taken.includes(g.userId)).length ? (
          <p className="small muted">Nobody else from your leagues has an account yet. Try by email, or add a guest.</p>
        ) : (
          <div className="chips">
            {golfers
              .filter((g) => !taken.includes(g.userId))
              .map((g) => (
                <button key={g.userId} className="chip" onClick={() => done({ name: g.name, userId: g.userId, handicap: null })}>
                  <strong>+ {g.name}</strong>
                </button>
              ))}
          </div>
        ))}
      {mode === 'email' && (
        <form className="toolbar" onSubmit={findByEmail}>
          <input type="email" placeholder="their sign-in email" aria-label="Email" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={busy || !text.includes('@')}>Add</button>
        </form>
      )}
      {mode === 'guest' && (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            done({ name: text.trim(), userId: null, handicap: null });
          }}
        >
          <input placeholder="Name" aria-label="Guest name" maxLength={40} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim()}>Add guest</button>
        </form>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** Choose a game, see how it's played, and set the stakes. */
export function GamePicker({ game, names, onChange }: { game: GameSetup | null; names: string[]; onChange: (g: GameSetup | null) => void }) {
  const n = names.length;
  const set = (patch: Partial<GameSetup>) => game && onChange({ ...game, ...patch });
  const info = game ? gameInfo(game.id) : null;
  const twoTeams = game && n === 4 && ['match', 'nassau', 'vegas'].includes(game.id);
  const partner = game?.teamA?.find((i) => i !== 0) ?? 1;

  return (
    <section className="card">
      <h3>Game</h3>
      <div className="game-options">
        <label className={`format-option ${!game ? 'selected' : ''}`}>
          <input type="radio" name="game" checked={!game} onChange={() => onChange(null)} />
          <span><strong>Just keep score</strong></span>
        </label>
        {GAMES.map((g) => (
          <label key={g.id} className={`format-option ${game?.id === g.id ? 'selected' : ''} ${g.fits(n) ? '' : 'disabled'}`}>
            <input type="radio" name="game" disabled={!g.fits(n)} checked={game?.id === g.id} onChange={() => onChange(newGame(g.id))} />
            <span>
              <strong>{g.name}</strong>
              <span className="small muted block">{g.fits(n) ? g.summary : `For ${g.players} players.`}</span>
            </span>
          </label>
        ))}
      </div>

      {game && info && (
        <>
          <div className="rules-box">
            <strong>How to play {info.name}</strong>
            <ul>
              {info.howTo.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {twoTeams && (
            <label className="field">
              <span>Teams: {names[0]} plays with</span>
              <select value={partner} onChange={(e) => set({ teamA: [0, Number(e.target.value)] })}>
                {names.slice(1).map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
              <span className="small muted">against {names.filter((_, i) => i !== 0 && i !== partner).join(' & ')}</span>
            </label>
          )}
          {game.id === 'wolf' && <p className="small muted">Wolf order: {names.join(', ')}, then around again.</p>}
          {game.id === 'skins' && (
            <label className="check"><input type="checkbox" checked={game.carryover !== false} onChange={(e) => set({ carryover: e.target.checked })} /> Tied holes carry the skin over</label>
          )}
          {game.id === 'vegas' && (
            <label className="check"><input type="checkbox" checked={game.birdieFlip !== false} onChange={(e) => set({ birdieFlip: e.target.checked })} /> A birdie flips the other team’s number</label>
          )}

          <div className="form-grid">
            <label className="field">
              <span>Handicaps</span>
              <select value={game.handicaps} onChange={(e) => set({ handicaps: e.target.value as GameSetup['handicaps'] })}>
                <option value="full">Full strokes (net scores)</option>
                <option value="offLow">Strokes off the lowest handicap</option>
                <option value="off">No handicaps (gross)</option>
              </select>
            </label>
            <div className="field">
              <span>Keep track in</span>
              <div className="segmented">
                <button type="button" aria-pressed={game.stakes === 'points'} onClick={() => set({ stakes: 'points' })}>Points</button>
                <button type="button" aria-pressed={game.stakes === 'money'} onClick={() => set({ stakes: 'money' })}>Dollars</button>
              </div>
            </div>
            {game.stakes === 'money' && (
              <label className="field">
                <span>Dollars per point</span>
                <input type="number" inputMode="decimal" min={0} step={0.25} value={game.unit} onChange={(e) => set({ unit: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
            )}
          </div>
        </>
      )}
    </section>
  );
}
