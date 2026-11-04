/**
 * Phone-first score entry: one hole at a time, a big − / + stepper per player that starts at par,
 * and a review grid with the usual scorecard symbols before submitting.
 */
import type { ReactNode } from 'react';

export interface HoleInfo {
  /** As printed on the card (10-18 on a back nine). */
  number: number;
  par: number;
  yards?: number | null;
  /** Hole handicap (stroke index). */
  hcp?: number | null;
}

export interface EntryRow {
  id: number;
  name: string;
  /** e.g. the team name. */
  detail?: string;
  /** League cards can mark a player absent. */
  allowAbsent?: boolean;
}

export interface RowScore {
  scores: (number | null)[];
  absent: boolean;
  /** Holes the player didn't play (left early / arrived late): one flag per hole. */
  dnf?: boolean[];
}

export type Entry = Record<number, RowScore>;

/** Cells to highlight, as "rowId:holeIndex" (or "rowId:absent"). */
export type Flags = Set<string>;

export const emptyEntry = (rows: EntryRow[], holes: number): Entry =>
  Object.fromEntries(rows.map((r) => [r.id, { scores: Array(holes).fill(null), absent: false, dnf: Array(holes).fill(false) }]));

/** Did the player not play this hole (left early / arrived late)? */
export const didNotPlay = (r: RowScore | undefined, h: number) => !!r?.dnf?.[h];

export const holeDone = (entry: Entry, rows: EntryRow[], h: number) =>
  rows.every((r) => entry[r.id]?.absent || didNotPlay(entry[r.id], h) || entry[r.id]?.scores[h] != null);
export const entryComplete = (entry: Entry, rows: EntryRow[], holes: number) => Array.from({ length: holes }, (_, h) => holeDone(entry, rows, h)).every(Boolean);

const toPar = (r: RowScore, holes: HoleInfo[]) =>
  r.scores.reduce<number>((sum, s, h) => (s == null ? sum : sum + s - holes[h].par), 0);
const signedPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

/** The scorecard class for a score relative to par: eagle, birdie, par, bogey, double. */
export function scoreClass(score: number | null | undefined, par: number): string {
  if (score == null) return '';
  const d = score - par;
  return d <= -2 ? 'sc-eagle' : d === -1 ? 'sc-birdie' : d === 0 ? 'sc-par' : d === 1 ? 'sc-bogey' : 'sc-double';
}

export function HoleByHole({
  holes,
  rows,
  value,
  onChange,
  hole,
  onHole,
  flags,
  below,
}: {
  holes: HoleInfo[];
  rows: EntryRow[];
  value: Entry;
  onChange: (v: Entry) => void;
  hole: number;
  onHole: (h: number) => void;
  flags?: Flags;
  /** Extra inputs under a player's score for this hole (e.g. fairway, green, putts). */
  below?: (rowId: number) => ReactNode;
}) {
  const info = holes[hole];
  const set = (id: number, patch: Partial<RowScore>) => onChange({ ...value, [id]: { ...value[id], ...patch } });
  const setScore = (id: number, s: number | null) => set(id, { scores: value[id].scores.map((x, i) => (i === hole ? s : x)) });
  const setDnf = (id: number, on: boolean) => {
    const cur = value[id].dnf ?? holes.map(() => false);
    set(id, {
      dnf: cur.map((x, i) => (i === hole ? on : x)),
      // Clear any score for this hole when it's marked not played.
      scores: on ? value[id].scores.map((x, i) => (i === hole ? null : x)) : value[id].scores,
    });
  };
  const step = (id: number, delta: number) => {
    const cur = value[id].scores[hole];
    setScore(id, Math.min(20, Math.max(1, (cur ?? info.par) + delta)));
  };

  return (
    <div className="hbh">
      <nav className="hole-strip" aria-label="Holes">
        {holes.map((h, i) => (
          <button
            key={i}
            className={`hole-pill ${i === hole ? 'current' : ''} ${holeDone(value, rows, i) ? 'done' : ''} ${rows.some((r) => flags?.has(`${r.id}:${i}`)) ? 'flagged' : ''}`}
            aria-current={i === hole ? 'step' : undefined}
            aria-label={`Hole ${h.number}${holeDone(value, rows, i) ? ', entered' : ''}`}
            onClick={() => onHole(i)}
          >
            {h.number}
          </button>
        ))}
      </nav>

      <header className="hole-head">
        <div className="hole-number">
          <span className="muted small">Hole</span> {info.number}
        </div>
        <dl className="hole-facts">
          <div><dt>Par</dt><dd>{info.par}</dd></div>
          {info.yards ? <div><dt>Yards</dt><dd>{info.yards}</dd></div> : null}
          {info.hcp ? <div><dt>Hcp</dt><dd>{info.hcp}</dd></div> : null}
        </dl>
      </header>

      <ul className="hole-rows">
        {rows.map((r) => {
          const rs = value[r.id];
          const s = rs.scores[hole];
          const dnf = didNotPlay(rs, hole);
          const flagged = flags?.has(`${r.id}:${hole}`) || flags?.has(`${r.id}:absent`);
          return (
            <li key={r.id} className={`hole-row ${flagged ? 'flagged' : ''} ${rs.absent || dnf ? 'absent' : ''}`}>
              <div className="hole-player">
                <strong>{r.name}</strong>
                <span className="small muted">
                  {r.detail ? `${r.detail} · ` : ''}
                  {rs.absent ? 'absent' : dnf ? 'did not play' : signedPar(toPar(rs, holes))}
                </span>
                {r.allowAbsent && (
                  <span className="hole-marks">
                    <label className="check small">
                      <input type="checkbox" checked={rs.absent} onChange={(e) => set(r.id, { absent: e.target.checked })} /> Absent
                    </label>
                    {!rs.absent && (
                      <label className="check small">
                        <input type="checkbox" checked={dnf} onChange={(e) => setDnf(r.id, e.target.checked)} /> Didn’t play this hole
                      </label>
                    )}
                  </span>
                )}
              </div>
              {!rs.absent && !dnf && (
                <div className="stepper" role="group" aria-label={`${r.name}, hole ${info.number}`}>
                  <button type="button" aria-label="One less" onClick={() => step(r.id, -1)}>−</button>
                  <button
                    type="button"
                    className={`stepper-value ${s == null ? 'empty' : scoreClass(s, info.par)}`}
                    aria-label={s == null ? `Set par (${info.par})` : `Score ${s}`}
                    onClick={() => s == null && setScore(r.id, info.par)}
                  >
                    {s ?? info.par}
                  </button>
                  <button type="button" aria-label="One more" onClick={() => step(r.id, 1)}>+</button>
                </div>
              )}
              {below && !rs.absent && !dnf && <div className="hole-extra">{below(r.id)}</div>}
            </li>
          );
        })}
      </ul>
      {rows.some((r) => !value[r.id].absent && !didNotPlay(value[r.id], hole) && value[r.id].scores[hole] == null) && (
        <p className="small muted center">Tap a grey score to take par, or use − / +.</p>
      )}
    </div>
  );
}

/** The whole card, for checking before submitting. Tap a cell to go back to that hole. */
export interface ExtraRow {
  label: string;
  /** One cell per hole. */
  cells: ReactNode[];
  total?: ReactNode;
}

export function CardReview({
  holes,
  rows,
  value,
  flags,
  onHole,
  extraRows = [],
}: {
  holes: HoleInfo[];
  rows: EntryRow[];
  value: Entry;
  flags?: Flags;
  onHole?: (h: number) => void;
  /** Rows under the scores, e.g. putts or fairways. */
  extraRows?: ExtraRow[];
}) {
  const halves = holes.length > 9 ? [holes.slice(0, 9), holes.slice(9)] : [holes];
  const total = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  return (
    <>
      {halves.map((half, hi) => {
        const offset = hi * 9;
        return (
          <div key={hi} className="scroll review">
            <table className="scorecard compact">
              <thead>
                <tr>
                  <th className="left">Hole</th>
                  {half.map((h) => <th key={h.number}>{h.number}</th>)}
                  <th>{halves.length > 1 ? (hi ? 'In' : 'Out') : 'Tot'}</th>
                </tr>
                <tr className="muted">
                  <th className="left">Par</th>
                  {half.map((h) => <th key={h.number}>{h.par}</th>)}
                  <th>{total(half.map((h) => h.par))}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rs = value[r.id];
                  const part = rs.scores.slice(offset, offset + half.length);
                  return (
                    <tr key={r.id} className={rs.absent ? 'is-virtual' : ''}>
                      <td className={`left name ${flags?.has(`${r.id}:absent`) ? 'mismatch' : ''}`}>{r.name}</td>
                      {half.map((h, i) => (
                        <td key={h.number} className={flags?.has(`${r.id}:${offset + i}`) ? 'mismatch' : ''} onClick={() => onHole?.(offset + i)}>
                          {rs.absent ? '–' : didNotPlay(rs, offset + i) ? <span className="muted" title="Did not play">×</span> : <span className={`sc ${scoreClass(part[i], h.par)}`}>{part[i] ?? '·'}</span>}
                        </td>
                      ))}
                      <td className="total">{rs.absent ? '' : total(part) || ''}</td>
                    </tr>
                  );
                })}
                {extraRows.map((x) => (
                  <tr key={x.label} className="sub">
                    <td className="left name">{x.label}</td>
                    {half.map((h, i) => <td key={h.number} onClick={() => onHole?.(offset + i)}>{x.cells[offset + i]}</td>)}
                    <td className="total">{hi === halves.length - 1 ? x.total : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {holes.length > 9 && (
        <p className="small muted right">
          Totals:{' '}
          {rows
            .filter((r) => !value[r.id].absent)
            .map((r) => `${r.name} ${total(value[r.id].scores)} (${signedPar(toPar(value[r.id], holes))})`)
            .join(' · ')}
        </p>
      )}
    </>
  );
}
