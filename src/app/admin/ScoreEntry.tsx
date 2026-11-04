import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { computeSeason, holeNumber, nineLabel, type CardEntry, type Match, type Nine, type Player, type PlayerCard, type Score, type SeasonData } from '../../engine';
import { api } from '../api';
import { WeekPicker } from '../components/WeekPicker';
import { formatDate, lookups } from '../format';
import { useLoaded } from '../season';
import { useSaver } from './useSaver';

interface DraftScore {
  holes: string[];
  virtual: boolean;
  /** Holes the player didn't play (left early / arrived late). */
  dnf: boolean[];
  hc: string;
}
type Forfeit = '' | 'A' | 'B';

const blank = (): DraftScore => ({ holes: Array(9).fill(''), virtual: false, dnf: Array(9).fill(false), hc: '' });

export function ScoreEntryPage() {
  const s = useLoaded()!;
  const { data, result, seasonId, refreshTodo } = s;
  const params = useParams();
  const navigate = useNavigate();
  const weekNum = params.week ? Number(params.week) : (result.currentWeek ?? result.latestWeek ?? data.weeks[0]?.number);
  const week = data.weeks.find((w) => w.number === weekNum);
  const { players, teams } = lookups(data);
  const saver = useSaver();

  const [draft, setDraft] = useState<Map<number, DraftScore>>(new Map());
  const [forfeits, setForfeits] = useState<Forfeit[]>([]);
  const [dirty, setDirty] = useState(false);
  const [submissions, setSubmissions] = useState<Awaited<ReturnType<typeof api.submissions>>>([]);
  const tableRef = useRef<HTMLDivElement>(null);

  // Cards entered by players for this week's matches.
  useEffect(() => {
    if (week && seasonId) api.submissions(seasonId, week.number).then(setSubmissions, () => setSubmissions([]));
  }, [week, seasonId]);

  // Load the saved week into the form.
  useEffect(() => {
    if (!week) return;
    const m = new Map<number, DraftScore>();
    for (const sc of week.scores) {
      m.set(sc.playerId, {
        holes: (sc.holes ?? Array(9).fill(0)).map((h) => (h ? String(h) : '')),
        virtual: !!sc.virtual,
        dnf: sc.dnf ? [...sc.dnf] : Array(9).fill(false),
        hc: sc.hc == null ? '' : String(sc.hc),
      });
    }
    setDraft(m);
    setForfeits(week.matches.map((mt) => forfeitOf(mt, data)));
    setDirty(false);
  }, [week, data]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const scores: Score[] = useMemo(
    () =>
      [...draft].map(([playerId, d]) => ({
        playerId,
        virtual: d.virtual,
        holes: d.virtual ? null : d.holes.map((h) => Number(h) || 0),
        dnf: d.virtual ? null : d.dnf,
        hc: d.hc === '' ? null : Number(d.hc),
      })),
    [draft],
  );
  const matches: Match[] = useMemo(
    () =>
      (week?.matches ?? []).map((m, i) => ({
        ...m,
        pointsOverride:
          forfeits[i] === 'A'
            ? [data.settings.forfeitLoserPoints, data.settings.forfeitWinnerPoints]
            : forfeits[i] === 'B'
              ? [data.settings.forfeitWinnerPoints, data.settings.forfeitLoserPoints]
              : null,
      })),
    [week, forfeits, data.settings],
  );

  // Recalculate the whole season live with the unsaved scores.
  const live = useMemo(() => {
    if (!week) return null;
    const draftData: SeasonData = { ...data, weeks: data.weeks.map((w) => (w.number === week.number ? { ...w, scores, matches } : w)) };
    return computeSeason(draftData);
  }, [data, week, scores, matches]);
  const wr = live?.weeks.find((w) => w.week.number === weekNum);

  if (!week || !wr || !live) {
    return <p className="empty">No weeks on the schedule yet. <Link to="/admin/schedule">Add weeks</Link>.</p>;
  }

  const update = (pid: number, fn: (d: DraftScore) => DraftScore) => {
    setDraft((prev) => new Map(prev).set(pid, fn(prev.get(pid) ?? blank())));
    setDirty(true);
  };

  const onHole = (pid: number, h: number, raw: string, el: HTMLInputElement) => {
    const v = raw.replace(/\D/g, '').slice(0, 2);
    update(pid, (d) => ({ ...d, holes: d.holes.map((x, i) => (i === h ? v : x)) }));
    // Jump to the next box after a complete score (a leading 1 could be 10-19, so wait for a second digit).
    if (v.length === 2 || (v.length === 1 && v !== '1')) {
      const inputs = [...(tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-hole]') ?? [])];
      inputs[inputs.indexOf(el) + 1]?.focus();
    }
  };

  const loadCard = (cards: CardEntry[]) => {
    setDraft((prev) => {
      const next = new Map(prev);
      for (const c of cards) {
        const dnf = c.dnf ? [...c.dnf] : Array(9).fill(false);
        next.set(c.playerId, {
          ...(prev.get(c.playerId) ?? blank()),
          virtual: c.absent,
          dnf: c.absent ? Array(9).fill(false) : dnf,
          holes: c.absent ? Array(9).fill('') : (c.holes ?? []).map((h, i) => (dnf[i] ? '' : String(h))),
        });
      }
      return next;
    });
    setDirty(true);
  };

  const save = () =>
    saver.run(async () => {
      await api.saveScores(seasonId!, week.number, scores, matches);
      setDirty(false);
      void refreshTodo();
    }, `Week ${week.number} saved – standings, handicaps and stats are updated.`);

  /** One player's (or scramble team's) line: absent, handicap, hole scores and totals. */
  const playerRow = (pid: number, card: PlayerCard | null | undefined, key: string, first: boolean, allowAbsent: boolean, points: string | number | null) => {
    const name = pid < 0 ? `${teams.get(-pid)?.name ?? 'Team'} (team card)` : players.get(pid)!.name;
    const d = draft.get(pid) ?? blank();
    const calculated = pid < 0 ? card?.hc : live.handicaps.get(pid)!.playing.get(week.number);
    return (
      <tr key={key} className={`${first ? 'team-start' : ''} ${d.virtual ? 'is-virtual' : ''}`}>
        <td className="player left">
          {name} {card?.hotshot && <span className="badge hot">Hotshot</span>}
        </td>
        <td>
          {allowAbsent && (
            <input type="checkbox" aria-label={`${name} absent`} checked={d.virtual} onChange={(e) => update(pid, (x) => ({ ...x, virtual: e.target.checked }))} />
          )}
        </td>
        <td>
          <input
            className="hc"
            type="text"
            inputMode="numeric"
            aria-label={`${name} handicap`}
            placeholder={calculated == null ? '' : String(calculated)}
            value={d.hc}
            onChange={(e) => update(pid, (x) => ({ ...x, hc: e.target.value.replace(/[^\d-]/g, '') }))}
          />
        </td>
        {wr.nine.par.map((_, h) => (
          <td key={h} className={`${card?.escCapped[h] ? 'capped' : ''} ${d.dnf[h] ? 'dnf' : ''}`}>
            {d.virtual || d.dnf[h] ? (
              <span className="muted" title={d.dnf[h] ? 'Did not play — virtual score' : undefined}>{card?.gross[h]}</span>
            ) : (
              <input
                type="text"
                inputMode="numeric"
                data-hole
                aria-label={`${name} hole ${holeNumber(wr.nine, h)}`}
                value={d.holes[h]}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onHole(pid, h, e.target.value, e.target)}
              />
            )}
            {pid >= 0 && !d.virtual && (
              <label className="dnf-box" title="Did not play this hole (left early / arrived late)">
                <input
                  type="checkbox"
                  aria-label={`${name} did not play hole ${holeNumber(wr.nine, h)}`}
                  checked={d.dnf[h]}
                  onChange={(e) => update(pid, (x) => ({ ...x, dnf: x.dnf.map((v, i) => (i === h ? e.target.checked : v)) }))}
                />
                <span aria-hidden>DNF</span>
              </label>
            )}
          </td>
        ))}
        <td className="total">{card?.grossTotal ?? ''}</td>
        <td>{card?.netTotal ?? ''}</td>
        <td className="num-strong">{points ?? ''}</td>
      </tr>
    );
  };

  const missing = wr.field
    ? wr.field.filter((e) => !e.card).length
    : wr.matches.flatMap((m) => m.sides.flatMap((sd) => sd.playerIds.filter((_, i) => !sd.cards[i]))).length;

  return (
    <div ref={tableRef}>
      <h1>Enter scores</h1>
      <WeekPicker
        weeks={live.weeks}
        value={weekNum}
        onChange={(n) => (!dirty || confirm('Discard unsaved scores?')) && navigate(`/admin/scores/${n}`)}
      />
      <p className="muted">
        Week {week.number} · {formatDate(week.date)} · {nineLabel(wr.nine)}
        {week.playoff && ' · Playoffs'}
        {week.inclement && ' · Inclement weather'} · <Link to="/admin/schedule">edit week</Link>
      </p>
      <p className="small muted">
        Type gross scores hole by hole. The cursor jumps ahead automatically.{wr.field ? '' : <> Tick <b>Absent</b> for a virtual score.</>} Tick{' '}
        <b>DNF</b> under any hole a player didn’t play (left early or arrived late): it’s scored by the league’s absent rule, and the round won’t
        count toward handicaps. Leave HC blank to use the calculated handicap. Totals, points and handicaps update as you type.
      </p>

      {wr.field && (
        <section className="match">
          <div className="match-head">
            <strong>Everyone plays the field</strong>
            <span className="small muted">{data.settings.format === 'stableford' ? 'Pts = Stableford points' : 'Pts = standings points for the finish'}</span>
          </div>
          <div className="scroll">
            <table className="scorecard entry">
              <thead>
                <tr>
                  <th className="player left">{wr.field.some((e) => e.entrantId < 0) ? 'Team' : 'Player'}</th>
                  <th />
                  <th title="Playing handicap (blank = calculated)">HC</th>
                  {wr.nine.par.map((p, h) => (
                    <th key={h}>{holeNumber(wr.nine, h)}<div className="muted">{p}</div></th>
                  ))}
                  <th>Gross</th>
                  <th>Net</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {[...wr.field]
                  .sort((x, y) => (x.entrantId < 0 ? x.teamId - y.teamId : players.get(x.entrantId)!.name.localeCompare(players.get(y.entrantId)!.name)))
                  .map((e) =>
                    playerRow(e.entrantId, e.card, String(e.entrantId), false, false, e.value == null ? null : data.settings.format === 'stableford' ? e.value : Math.round(e.points * 10) / 10),
                  )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {wr.matches.map((m, mi) => (
        <section key={mi} className="match">
          <div className="match-head">
            <strong>
              {teams.get(m.sides[0].teamId)?.name} vs {teams.get(m.sides[1].teamId)?.name}
              {m.match.teeTime && <span className="muted small"> · {m.match.teeTime}</span>}
            </strong>
            <PlayerCards
              entry={submissions.find((x) => x.teamA === m.match.teamA && x.teamB === m.match.teamB)}
              official={m.sides.every((sd) => sd.playerIds.every((pid) => week.scores.some((sc) => sc.playerId === pid)))}
              busy={saver.busy}
              players={players}
              nine={wr.nine}
              teamName={(id) => teams.get(id)?.name ?? `Team ${id}`}
              onLoad={loadCard}
              onAccept={(userId, name) => {
                if (dirty && !confirm('You have unsaved changes on this page. Accepting reloads the week and discards them. Continue?')) return;
                if (!confirm(`Make ${name}’s card the official scores for ${teams.get(m.match.teamA)?.name} vs ${teams.get(m.match.teamB)?.name}?`)) return;
                void saver.run(() => api.acceptCard(seasonId!, week.number, m.match.teamA, m.match.teamB, userId), `${name}’s card is now official`).then(refreshTodo);
              }}
            />
            <span className="match-score">
              {m.status === 'forfeit' && !forfeits[mi] && <span className="badge forfeit" title="A whole team is marked absent">Auto-forfeit</span>}{' '}
              {m.status === 'pending' ? <span className="muted small">incomplete</span> : `${m.sides[0].total} – ${m.sides[1].total}`}
            </span>
            <label className="field small">
              <select
                value={forfeits[mi] ?? ''}
                onChange={(e) => {
                  setForfeits((f) => f.map((x, i) => (i === mi ? (e.target.value as Forfeit) : x)));
                  setDirty(true);
                }}
              >
                <option value="">No forfeit</option>
                <option value="A">{teams.get(m.sides[0].teamId)?.name} forfeits</option>
                <option value="B">{teams.get(m.sides[1].teamId)?.name} forfeits</option>
              </select>
            </label>
          </div>
          <div className="scroll">
            <table className="scorecard entry">
              <thead>
                <tr>
                  <th className="player left">Player</th>
                  <th>Absent</th>
                  <th title="Playing handicap (blank = calculated)">HC</th>
                  {wr.nine.par.map((p, h) => (
                    <th key={h}>{holeNumber(wr.nine, h)}<div className="muted">{p}</div></th>
                  ))}
                  <th>Gross</th>
                  <th>Net</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {m.sides.flatMap((side, si) => [
                  ...side.playerIds.map((pid, pi) => playerRow(pid, side.cards[pi], `${si}-${pid}`, pi === 0, true, null)),
                  <tr key={`${si}-pts`} className="points">
                    <td className="player left">{teams.get(side.teamId)?.name} points</td>
                    <td />
                    <td />
                    {side.holePoints.map((pt, h) => (
                      <td key={h}>{pt}</td>
                    ))}
                    <td />
                    <td>{side.teamNetTotal}</td>
                    <td className={side.outcome}>{side.total}</td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div className="save-bar">
        <button className="primary" onClick={save} disabled={saver.busy || !dirty}>
          {saver.busy ? 'Saving…' : dirty ? 'Save week' : 'Saved'}
        </button>
        {missing > 0 && <span className="small muted">{missing} {wr.field?.some((e) => e.entrantId < 0) ? 'team(s)' : 'player(s)'} without a score</span>}
        {saver.view}
      </div>
    </div>
  );
}

function forfeitOf(m: Match, data: SeasonData): Forfeit {
  if (!m.pointsOverride) return '';
  return m.pointsOverride[0] === data.settings.forfeitLoserPoints && m.pointsOverride[1] === data.settings.forfeitWinnerPoints ? 'A' : 'B';
}

/** Status of the cards players entered for a match, with a button to load one into the form. */
function PlayerCards({
  entry,
  official,
  busy,
  players,
  nine,
  teamName,
  onLoad,
  onAccept,
}: {
  entry: Awaited<ReturnType<typeof api.submissions>>[number] | undefined;
  /** Every player in the match already has a saved score. */
  official: boolean;
  busy: boolean;
  players: Map<number, Player>;
  nine: Nine;
  teamName: (id: number) => string;
  onLoad: (cards: CardEntry[]) => void;
  onAccept: (userId: number, name: string) => void;
}) {
  if (!entry?.submissions.length) return null;
  const { status, missingTeams, differences } = entry.consensus;
  // Both teams sent matching cards: the scores were posted automatically, nothing for the admin to do.
  if (status === 'agreed') return <div className="player-cards"><span className="badge ok">Players agreed ✓ — scores posted automatically</span></div>;
  if (official) return <div className="player-cards"><span className="badge ok">Official ✓</span></div>;
  const label =
    status === 'mismatch'
      ? <span className="badge bad" title={`${differences.length} difference(s)`}>Player cards differ — compare below</span>
      : <span className="badge warn">Only one card so far · waiting for {missingTeams.map(teamName).join(', ')}</span>;
  return (
    <div className="player-cards">
      <div className="small">{label}</div>
      {entry.submissions.map((s) => (
        <div key={s.userId} className="submitted-card">
          <div className="small muted">{s.name ?? 'A player'} ({teamName(s.teamId)}) entered:</div>
          <SubmittedScores cards={s.cards} players={players} nine={nine} />
          <div className="card-actions">
            <button className="primary" disabled={busy} onClick={() => onAccept(s.userId, s.name ?? 'the player')} title="Make this card the official scores now">
              Accept these scores
            </button>
            <button className="link" onClick={() => onLoad(s.cards)} title="Copy this card into the form below to edit it, then Save week">
              Edit first
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A read-only view of a player-entered card, so the admin can see the scores before accepting. */
function SubmittedScores({ cards, players, nine }: { cards: CardEntry[]; players: Map<number, Player>; nine: Nine }) {
  return (
    <div className="scroll">
      <table className="scorecard compact">
        <thead>
          <tr>
            <th className="left name">Player</th>
            {nine.par.map((_, h) => <th key={h}>{holeNumber(nine, h)}</th>)}
            <th className="total">Tot</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => {
            const total = c.absent || !c.holes ? null : c.holes.reduce((a, b) => a + b, 0);
            return (
              <tr key={c.playerId} className={c.absent ? 'is-virtual' : ''}>
                <td className="left name">{players.get(c.playerId)?.name ?? `Player ${c.playerId}`}</td>
                {nine.par.map((_, h) => <td key={h}>{c.absent ? '–' : (c.holes?.[h] ?? '')}</td>)}
                <td className="total">{c.absent ? 'abs' : total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
