import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { addSummaries, emptyStats, gameInfo, girFrom, percent, summarizeStats, type RoundStats } from '../../engine';
import { api, OfflineError, type Round } from '../api';
import { CoursePicker, type CourseChoice } from '../components/CoursePicker';
import { GroupSetup, type GroupSetupValue } from '../components/GroupSetup';
import { LiveRound } from './LiveRound';
import { CardReview, entryComplete, HoleByHole, type Entry, type EntryRow, type ExtraRow, type HoleInfo } from '../components/HoleByHole';
import { fixed, formatDate, signed } from '../format';
import { readDraft, send, useDraft } from '../offline';
import { useSeason } from '../season';

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const today = () => new Date().toLocaleDateString('en-CA');
const holesLabel = (c: Pick<CourseChoice, 'par' | 'firstHole'>) => (c.par.length === 18 ? '18 holes' : c.firstHole === 10 ? 'Back 9' : 'Front 9');

/** Your own scores in a round: you started it (player 0), or someone added you. */
export function myHoles(r: Round): number[] {
  if (!r.me) return r.holes;
  return r.players?.find((p) => p.idx === r.me)?.holes ?? r.holes;
}

/** A finished card: every hole has a score. */
const finished = (r: Round) => !r.live && myHoles(r).every((s) => s > 0);

/** The signed-in user's rounds, newest first. */
export function useRounds() {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.rounds().then(setRounds, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return { rounds, error, load };
}

/** Courses played before (same course, tees and holes), most recent first. */
export function recentCourses(rounds: Round[], limit = 6): CourseChoice[] {
  const seen = new Map<string, CourseChoice>();
  for (const r of rounds) {
    const key = `${r.courseName}|${r.tee}|${r.firstHole}|${r.par.length}`;
    if (!seen.has(key)) seen.set(key, { courseId: r.courseId, courseName: r.courseName, tee: r.tee, firstHole: r.firstHole, par: r.par, yardage: r.yardage, hcp: r.hcp });
  }
  return [...seen.values()].slice(0, limit);
}

// A round being entered, kept on the phone until it's saved.
export const ROUND_DRAFT = 'golf-league.round.new';
interface RoundDraft {
  course: CourseChoice | null;
  playedOn: string;
  entry: Entry;
  hole: number;
  notes: string;
  /** Fairways, greens in regulation and putts (null when not tracking). */
  stats: RoundStats | null;
  /** Who's playing and the game, chosen before the first hole. */
  setup?: GroupSetupValue;
  /** Past the "who's playing" step (drafts from before it existed count as started). */
  started?: boolean;
}
const ME = 0; // the single row on a personal card

// Whether to show the fairway / green / putts inputs; remembered on this phone.
const TRACK_KEY = 'golf-league.track-stats';
const trackByDefault = () => {
  try {
    return localStorage.getItem(TRACK_KEY) !== 'off';
  } catch {
    return true;
  }
};
const rememberTrack = (on: boolean) => {
  try {
    localStorage.setItem(TRACK_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
};

export function MyRoundsPage() {
  const { rounds, error } = useRounds();
  const navigate = useNavigate();
  const inProgress = readDraft<RoundDraft>(ROUND_DRAFT);

  const stats = useMemo(() => {
    // Finished cards only, with your own scores (also from rounds a friend started).
    const r = (rounds ?? []).filter(finished);
    const full = r.filter((x) => x.par.length === 18).map((x) => total(myHoles(x)));
    const nines = r.filter((x) => x.par.length === 9).map((x) => total(myHoles(x)));
    const toPar18 = r.map((x) => ((total(myHoles(x)) - total(x.par)) * 18) / x.par.length);
    // Only rounds where fairways, greens or putts were tracked count toward these.
    const tracked = addSummaries(r.map((x) => summarizeStats(x.stats, x.par)));
    return {
      fairways: percent(tracked.fairways),
      greens: percent(tracked.greens),
      puttsPer18: tracked.putts.holes ? (tracked.putts.total / tracked.putts.holes) * 18 : NaN,
      count: r.length,
      avg18: full.length ? total(full) / full.length : NaN,
      best18: full.length ? Math.min(...full) : null,
      avg9: nines.length ? total(nines) / nines.length : NaN,
      toPar: toPar18.length ? total(toPar18) / toPar18.length : NaN,
    };
  }, [rounds]);

  if (error) return <p className="error">{error}</p>;
  if (!rounds) return <p className="empty">Loading…</p>;
  const recent = recentCourses(rounds);

  return (
    <>
      <h1>My rounds</h1>
      {inProgress?.course ? (
        <Link className="hero-action" to="/rounds/new">
          <span>
            <strong>Resume round</strong>
            <span className="small">{inProgress.course.courseName} · hole {inProgress.course.firstHole + inProgress.hole}</span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      ) : (
        <Link className="hero-action" to="/rounds/new">
          <span><strong>Start a round</strong><span className="small">Any course, 9 or 18 holes</span></span>
          <span aria-hidden>›</span>
        </Link>
      )}
      {!inProgress?.course && recent.length > 0 && (
        <>
          <h2>Play again</h2>
          <div className="chips">
            {recent.map((c, i) => (
              <button key={i} className="chip" onClick={() => navigate('/rounds/new', { state: { course: c } })}>
                <strong>{c.courseName}</strong>
                <span className="small muted">{[c.tee, holesLabel(c)].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {rounds.length > 0 && (
        <div className="stat-row">
          <Stat label="Rounds" value={String(stats.count)} />
          <Stat label="Avg 18" value={fixed(stats.avg18)} />
          <Stat label="Best 18" value={stats.best18 == null ? '' : String(stats.best18)} />
          <Stat label="Avg 9" value={fixed(stats.avg9)} />
          <Stat label="Vs par / 18" value={Number.isFinite(stats.toPar) ? signed(Number(stats.toPar.toFixed(1))) : ''} />
          {stats.fairways != null && <Stat label="Fairways hit" value={`${stats.fairways}%`} />}
          {stats.greens != null && <Stat label="Greens in reg." value={`${stats.greens}%`} />}
          {Number.isFinite(stats.puttsPer18) && <Stat label="Putts / 18" value={fixed(stats.puttsPer18)} />}
        </div>
      )}

      <h2>History</h2>
      <p className="small muted">Your own rounds, not part of the league. Only you and the people you played with can see them.</p>
      {!rounds.length ? (
        <p className="empty">No rounds yet.</p>
      ) : (
        <ul className="list-cards">
          {[...rounds].sort((a, b) => Number(!!b.live) - Number(!!a.live)).map((r) => {
            const mine = myHoles(r);
            const thru = mine.filter((s) => s > 0).length;
            const parThru = total(r.par.filter((_, h) => mine[h] > 0));
            const group = [r.me ? r.ownerName : null, ...(r.players ?? []).filter((p) => p.idx !== r.me).map((p) => p.name)].filter(Boolean);
            return (
              <li key={r.id}>
                <Link to={`/rounds/${r.id}`} className="list-card">
                  <span>
                    <strong>{r.courseName}</strong> {r.live && <span className="badge warn">In progress</span>}
                    <span className="small muted block">{formatDate(r.playedOn)} {r.playedOn.slice(0, 4)} · {[r.tee, holesLabel(r)].filter(Boolean).join(' · ')}</span>
                    {group.length > 0 && <span className="small muted block">with {group.join(', ')}{r.game ? ` · ${gameInfo(r.game.id).name}` : ''}</span>}
                  </span>
                  <span className="score-pill">
                    <strong>{total(mine) || '–'}</strong>
                    <span className="small">{thru ? signed(total(mine) - parThru).replace(/^0$/, 'E') : ''}{thru && thru < r.par.length ? ` thru ${thru}` : ''}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card stat">
      <div className="small muted">{label}</div>
      <div className="stat-value">{value || '–'}</div>
    </div>
  );
}

/** /rounds/new (with an optional course passed from "Play again") and /rounds/:id. */
export function RoundPage() {
  const { id } = useParams();
  const { rounds, error, load } = useRounds();
  if (error) return <p className="error">{error}</p>;
  if (!rounds) return <p className="empty">Loading…</p>;
  if (id) {
    const round = rounds.find((r) => r.id === Number(id));
    if (!round) return <p className="notice">Round not found. <Link to="/rounds">Back</Link></p>;
    // Group rounds (and anything still being played or started by someone else) live on the server.
    if (round.live || round.me || round.players?.length) return <LiveRound key={id} source={{ kind: 'mine', id: round.id! }} onChanged={load} />;
    return <RoundEditor key={id} round={round} recent={recentCourses(rounds)} onSaved={load} />;
  }
  return <RoundEditor key="new" round={null} recent={recentCourses(rounds)} onSaved={load} />;
}

function RoundEditor({ round, recent, onSaved }: { round: Round | null; recent: CourseChoice[]; onSaved: () => Promise<unknown> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { me } = useSeason();
  const passed = (location.state as { course?: CourseChoice } | null)?.course ?? null;
  const fresh = (course: CourseChoice | null): RoundDraft => ({
    course,
    playedOn: today(),
    entry: { [ME]: { scores: Array(course?.par.length ?? 18).fill(null), absent: false } },
    stats: course && trackByDefault() ? emptyStats(course.par.length) : null,
    hole: 0,
    notes: '',
    setup: { handicap: null, players: [], game: null },
    started: false,
  });

  // New rounds are drafted on the phone (so they survive closing the browser); edits are in memory.
  const [stored, setStored, clearStored] = useDraft<RoundDraft>(round ? null : ROUND_DRAFT, () =>
    round
      ? { course: round, playedOn: round.playedOn, entry: { [ME]: { scores: round.holes, absent: false } }, hole: 0, notes: round.notes ?? '', stats: round.stats ?? null }
      : fresh(passed),
  );
  const draft = passed && !stored.course ? fresh(passed) : stored;
  const set = (patch: Partial<RoundDraft>) => setStored({ ...draft, ...patch });
  const [reviewing, setReviewing] = useState(!!round);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'notice'; text: string } | null>(null);

  const pick = (course: CourseChoice) => {
    setManual(false);
    setStored({
      ...draft,
      course,
      hole: 0,
      entry: { [ME]: { scores: Array(course.par.length).fill(null), absent: false } },
      stats: trackByDefault() ? emptyStats(course.par.length) : null,
      started: !!round,
    });
  };

  // Step 1: choose the course.
  if (!draft.course) {
    return (
      <div className="scoring">
        <div className="scoring-top"><button className="link" onClick={() => navigate('/rounds')}>‹ Rounds</button></div>
        <h1>Where are you playing?</h1>
        {recent.length > 0 && (
          <>
            <h2>Recent courses</h2>
            <div className="chips stack">
              {recent.map((c, i) => (
                <button key={i} className="chip" onClick={() => pick(c)}>
                  <strong>{c.courseName}</strong>
                  <span className="small muted">{[c.tee && `${c.tee} tees`, holesLabel(c), `par ${total(c.par)}`].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <h2>Find a course</h2>
        {manual ? <ManualCourse onPick={pick} onCancel={() => setManual(false)} /> : <CoursePicker onPick={pick} />}
        {!manual && <p className="small"><button className="link" onClick={() => setManual(true)}>Can’t find it? Enter the course by hand</button></p>}
      </div>
    );
  }

  const course = draft.course;

  // Step 2 (new rounds): who's playing, and a game.
  if (!round && draft.started === false) {
    const setup = draft.setup ?? { handicap: null, players: [], game: null };
    const startGroup = async () => {
      setBusy(true);
      setMessage(null);
      try {
        const zeros = Array(course.par.length).fill(0);
        const { id } = await api.saveRound({
          ...course,
          playedOn: draft.playedOn,
          holes: zeros,
          notes: null,
          stats: null,
          live: true,
          handicap: setup.handicap,
          game: setup.game,
          players: setup.players.map((p) => ({ ...p, name: p.name.trim() || 'Guest', holes: zeros })),
        });
        clearStored();
        await onSaved();
        navigate(`/rounds/${id}`, { replace: true });
      } catch (e) {
        setMessage({
          kind: 'error',
          text: e instanceof OfflineError ? 'A group round needs a connection to start, so everyone can follow along. Try again with signal, or play just yourself.' : (e as Error).message,
        });
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="scoring">
        <div className="scoring-top">
          <button className="link" onClick={() => set({ course: null })}>‹ Course</button>
        </div>
        <p className="small muted scoring-sub">{course.courseName}{course.tee ? ` · ${course.tee}` : ''} · {holesLabel(course)}</p>
        <h1>Who’s playing?</h1>
        {!setup.players.length && (
          <button className="hero-action" onClick={() => set({ started: true })}>
            <span><strong>Just me</strong><span className="small">Start keeping your score</span></span>
            <span aria-hidden>›</span>
          </button>
        )}
        <GroupSetup value={setup} onChange={(v) => set({ setup: v })} me={me?.user?.name?.split(' ')[0] ?? 'You'} />
        {message && <p className={message.kind}>{message.text}</p>}
        {setup.players.length > 0 && (
          <div className="action-bar">
            <button onClick={() => set({ setup: { handicap: setup.handicap, players: [], game: null } })}>Just me</button>
            <button className="primary" disabled={busy || setup.players.some((p) => !p.name.trim())} onClick={startGroup}>
              {busy ? 'Starting…' : `Start round with ${setup.players.length + 1}`}
            </button>
          </div>
        )}
      </div>
    );
  }

  const holes: HoleInfo[] = course.par.map((par, i) => ({ number: course.firstHole + i, par, yards: course.yardage?.[i] || null, hcp: course.hcp?.[i] ?? null }));
  const rows: EntryRow[] = [{ id: ME, name: me?.user?.name?.split(' ')[0] ?? 'You' }];
  const complete = entryComplete(draft.entry, rows, holes.length);
  const last = holes.length - 1;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const payload: Round = {
      ...course,
      id: round?.id,
      playedOn: draft.playedOn,
      holes: draft.entry[ME].scores.map(Number),
      notes: draft.notes.trim() || null,
      stats: draft.stats,
    };
    try {
      const res = await send({ kind: 'round', round: payload, label: `${course.courseName} round` });
      clearStored();
      if (res.queued) {
        setMessage({ kind: 'notice', text: 'No signal. Your round is saved on this phone and will be sent when you’re back online.' });
        return;
      }
      await onSaved();
      navigate('/rounds');
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Saved rounds are deleted on the server; a round still being entered is just discarded from the phone.
  const remove = async () => {
    if (!round?.id) {
      if (!confirm('Discard this round? The scores you’ve entered will be lost.')) return;
      clearStored();
      navigate('/rounds');
      return;
    }
    if (!confirm(`Delete your round at ${round.courseName} on ${formatDate(round.playedOn)}? This can’t be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteRound(round.id);
      await onSaved();
      navigate('/rounds');
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof OfflineError ? 'No connection. Deleting a saved round needs a connection; try again when you have signal.' : (e as Error).message });
      setBusy(false);
    }
  };

  const gross = total(draft.entry[ME].scores.map((s) => s ?? 0));

  return (
    <div className="scoring">
      <div className="scoring-top">
        <button className="link" onClick={() => navigate('/rounds')}>‹ Rounds</button>
        <button className="delete-round" disabled={busy} onClick={remove}>{round ? 'Delete round' : 'Discard round'}</button>
      </div>
      <p className="small muted scoring-sub">{course.courseName}{course.tee ? ` · ${course.tee}` : ''} · {holesLabel(course)}</p>
      {message && !reviewing && <p className={message.kind}>{message.text}</p>}

      {!reviewing ? (
        <>
          <HoleByHole
            holes={holes}
            rows={rows}
            value={draft.entry}
            onChange={(entry) => {
              // A new score changes whether the green was hit in regulation.
              const h = draft.hole;
              const stats = draft.stats && draft.stats.putts[h] != null
                ? { ...draft.stats, gir: draft.stats.gir.map((g, i) => (i === h ? girFrom(entry[ME].scores[h], draft.stats!.putts[h], holes[h].par) : g)) }
                : draft.stats;
              set({ entry, stats });
            }}
            hole={draft.hole}
            onHole={(hole) => set({ hole })}
            below={() =>
              draft.stats ? (
                <HoleStats hole={draft.hole} par={holes[draft.hole].par} score={draft.entry[ME].scores[draft.hole]} stats={draft.stats} onChange={(stats) => set({ stats })} />
              ) : null
            }
          />
          <p className="center small">
            <label className="check">
              <input
                type="checkbox"
                checked={!!draft.stats}
                onChange={(e) => {
                  rememberTrack(e.target.checked);
                  set({ stats: e.target.checked ? (draft.stats ?? emptyStats(holes.length)) : null });
                }}
              />
              Track fairways, greens &amp; putts
            </label>
          </p>
          <div className="action-bar">
            <button disabled={draft.hole === 0} onClick={() => set({ hole: draft.hole - 1 })}>‹ Back</button>
            {draft.hole < last ? (
              <button className="primary" onClick={() => set({ hole: draft.hole + 1 })}>Next hole ›</button>
            ) : (
              <button className="primary" onClick={() => setReviewing(true)}>Finish round</button>
            )}
          </div>
        </>
      ) : (
        <>
          <h2>{round ? 'Round' : 'Check your card'}</h2>
          <CardReview holes={holes} rows={rows} value={draft.entry} extraRows={statRows(draft.stats, course.par)} onHole={(hole) => { set({ hole }); setReviewing(false); }} />
          <p className="center"><strong className="big">{gross || '–'}</strong> {complete && <span className="muted">({signed(gross - total(course.par)).replace(/^0$/, 'E')})</span>}</p>
          <StatsLine stats={draft.stats} par={course.par} />
          <div className="form-grid">
            <label className="field"><span>Date played</span><input type="date" value={draft.playedOn} max={today()} onChange={(e) => set({ playedOn: e.target.value })} /></label>
            <label className="field"><span>Notes (optional)</span><input value={draft.notes} maxLength={500} placeholder="e.g. windy, played with Sam" onChange={(e) => set({ notes: e.target.value })} /></label>
          </div>
          {message && <p className={message.kind}>{message.text}</p>}
          <div className="action-bar">
            <button onClick={() => setReviewing(false)}>‹ Edit scores</button>
            <button className="primary" disabled={busy || !complete} onClick={save}>{busy ? 'Saving…' : 'Save round'}</button>
          </div>
          <p className="center small">
            <button className="link" onClick={() => set({ course: null })}>Change course</button>
          </p>
        </>
      )}
    </div>
  );
}

function ManualCourse({ onPick, onCancel }: { onPick: (c: CourseChoice) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [count, setCount] = useState(18);
  const [par, setPar] = useState<number[]>(Array(18).fill(4));
  return (
    <div className="card">
      <div className="form-grid">
        <label className="field"><span>Course name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">
          <span>Holes</span>
          <select value={count} onChange={(e) => { const n = Number(e.target.value); setCount(n); setPar(Array(n).fill(4)); }}>
            <option value={18}>18</option>
            <option value={9}>9</option>
          </select>
        </label>
      </div>
      <p className="small muted">Par for each hole:</p>
      <div className="par-grid">
        {par.map((p, h) => (
          <label key={h} className="field">
            <span>{h + 1}</span>
            <select value={p} onChange={(e) => setPar(par.map((x, i) => (i === h ? Number(e.target.value) : x)))}>
              {[3, 4, 5, 6].map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="toolbar">
        <button className="primary" disabled={!name.trim()} onClick={() => onPick({ courseId: null, courseName: name.trim(), tee: null, firstHole: 1, par, yardage: null, hcp: null })}>Use this course</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Fairway, green and putts for one hole, under the score. */
function HoleStats({ hole, par, score, stats, onChange }: { hole: number; par: number; score: number | null; stats: RoundStats; onChange: (s: RoundStats) => void }) {
  const set = (key: keyof RoundStats, v: boolean | number | null) => {
    const next = { ...stats, [key]: stats[key].map((x, i) => (i === hole ? v : x)) } as RoundStats;
    // Putts decide whether the green was hit in regulation (you can still change it).
    if (key === 'putts') next.gir = next.gir.map((g, i) => (i === hole ? girFrom(score ?? par, v as number | null, par) : g));
    onChange(next);
  };
  const toggle = (key: 'fir' | 'gir', v: boolean) => set(key, stats[key][hole] === v ? null : v);
  return (
    <div className="hole-stats">
      {par > 3 && (
        <div className="stat-group" role="group" aria-label="Fairway">
          <span className="small muted">Fairway</span>
          <button type="button" className={stats.fir[hole] === true ? 'on' : ''} aria-pressed={stats.fir[hole] === true} onClick={() => toggle('fir', true)}>Hit</button>
          <button type="button" className={stats.fir[hole] === false ? 'on miss' : ''} aria-pressed={stats.fir[hole] === false} onClick={() => toggle('fir', false)}>Missed</button>
        </div>
      )}
      <div className="stat-group" role="group" aria-label="Putts">
        <span className="small muted">Putts</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button key={n} type="button" className={`putt ${stats.putts[hole] === n ? 'on' : ''}`} aria-pressed={stats.putts[hole] === n} onClick={() => set('putts', stats.putts[hole] === n ? null : n)}>
            {n === 4 ? '4+' : n}
          </button>
        ))}
      </div>
      <div className="stat-group" role="group" aria-label="Green in regulation">
        <span className="small muted">Green in reg.</span>
        <button type="button" className={stats.gir[hole] === true ? 'on' : ''} aria-pressed={stats.gir[hole] === true} onClick={() => toggle('gir', true)}>Yes</button>
        <button type="button" className={stats.gir[hole] === false ? 'on miss' : ''} aria-pressed={stats.gir[hole] === false} onClick={() => toggle('gir', false)}>No</button>
      </div>
    </div>
  );
}

const mark = (v: boolean | null | undefined) => (v == null ? '·' : v ? '✓' : '✗');

/** Putts, fairway and green rows for the review card. */
function statRows(stats: RoundStats | null, par: number[]): ExtraRow[] {
  if (!stats) return [];
  const s = summarizeStats(stats, par);
  return [
    { label: 'Putts', cells: stats.putts.map((p) => p ?? '·'), total: s.putts.holes ? s.putts.total : '' },
    { label: 'Fairway', cells: stats.fir.map((f, h) => (par[h] === 3 ? '' : mark(f))), total: s.fairways.of ? `${s.fairways.hit}/${s.fairways.of}` : '' },
    { label: 'Green', cells: stats.gir.map(mark), total: s.greens.of ? `${s.greens.hit}/${s.greens.of}` : '' },
  ];
}

function StatsLine({ stats, par }: { stats: RoundStats | null | undefined; par: number[] }) {
  const s = summarizeStats(stats, par);
  if (!s.putts.holes && !s.fairways.of && !s.greens.of) return null;
  return (
    <p className="center small stats-line">
      {s.fairways.of > 0 && <span>Fairways {s.fairways.hit}/{s.fairways.of} ({percent(s.fairways)}%)</span>}
      {s.greens.of > 0 && <span>Greens {s.greens.hit}/{s.greens.of} ({percent(s.greens)}%)</span>}
      {s.putts.holes > 0 && <span>{s.putts.total} putts{s.putts.holes < par.length ? ` on ${s.putts.holes} holes` : ''}</span>}
    </p>
  );
}
