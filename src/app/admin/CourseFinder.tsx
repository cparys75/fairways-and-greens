import { useState, type FormEvent } from 'react';
import { courseLabel, halvesOf, holeNumber, ninesFromCourse, type CourseInfo, type CourseSummary, type Half, type Nine } from '../../engine';
import { api } from '../api';

/** Search a course-data provider and turn the chosen course's nines into league nines. */
export function CourseFinder({ existingIds, onAdd, doneHint = 'Then press “Save rules & course”.' }: { existingIds: string[]; onAdd: (nines: Nine[]) => void; doneHint?: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseSummary[] | null>(null);
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [menTee, setMenTee] = useState(0);
  const [womenTee, setWomenTee] = useState(-1);
  const [halves, setHalves] = useState<Half[]>(['front', 'back']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    setCourse(null);
    void run(async () => setResults(await api.searchCourses(query)));
  };

  const pick = (id: string) =>
    run(async () => {
      const c = await api.course(id);
      setCourse(c);
      const male = c.tees.findIndex((t) => t.gender === 'male');
      setMenTee(male >= 0 ? male : 0);
      const female = c.tees.findIndex((t) => t.gender === 'female' && t.holes.length === c.tees[male >= 0 ? male : 0]?.holes.length);
      setWomenTee(female);
      setHalves(['front', 'back']);
    });

  const tee = course?.tees[menTee];
  const preview = course && tee ? ninesFromCourse(course, tee, course.tees[womenTee] ?? null, halves, existingIds) : [];

  return (
    <section className="card">
      <h3>Find a course</h3>
      <p className="small muted">
        Search by course or club name to pull par, hole handicaps and yardage for any course, then pick the tees and which nines
        to add. You can still type or correct a scorecard by hand below.
      </p>
      <form className="toolbar" onSubmit={search}>
        <input type="search" placeholder="e.g. Pebble Beach" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Course name" style={{ flex: 1, minWidth: 180 }} />
        <button className="primary" type="submit" disabled={busy || query.trim().length < 3}>
          {busy && !course ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {results && !course && (
        <div className="scroll">
          <table>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="left">
                    <strong>{courseLabel(r)}</strong>
                    <div className="small muted">{[r.city, r.state, r.country].filter(Boolean).join(', ')}</div>
                  </td>
                  <td>
                    <button onClick={() => pick(r.id)} disabled={busy}>Select</button>
                  </td>
                </tr>
              ))}
              {!results.length && (
                <tr>
                  <td className="muted">No courses found. Try the club’s name or fewer words.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {course && (
        <>
          <div className="toolbar">
            <strong>{courseLabel(course)}</strong>
            <span className="muted small">{[course.city, course.state].filter(Boolean).join(', ')}</span>
            <span className="spacer" />
            <button onClick={() => setCourse(null)}>← Back to results</button>
          </div>
          {!course.tees.length ? (
            <p className="notice">This course has no hole-by-hole data. Add it by hand with “+ Add nine” below.</p>
          ) : (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>Men’s tees</span>
                  <select value={menTee} onChange={(e) => setMenTee(Number(e.target.value))}>
                    {course.tees.map((t, i) => (
                      <option key={i} value={i}>{teeLabel(t)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Red tees (hole handicaps only)</span>
                  <select value={womenTee} onChange={(e) => setWomenTee(Number(e.target.value))}>
                    <option value={-1}>Same as men’s</option>
                    {course.tees.map((t, i) =>
                      t.holes.length === tee?.holes.length ? <option key={i} value={i}>{teeLabel(t)}</option> : null,
                    )}
                  </select>
                </label>
                <div className="field">
                  <span>Nines to add</span>
                  {tee &&
                    halvesOf(tee).map((h) => (
                      <label key={h} className="check">
                        <input
                          type="checkbox"
                          checked={halves.includes(h)}
                          onChange={(e) => setHalves(e.target.checked ? [...halves, h] : halves.filter((x) => x !== h))}
                        />
                        {halvesOf(tee).length > 1 ? (h === 'front' ? 'Front nine (1–9)' : 'Back nine (10–18)') : 'All 9 holes'}
                      </label>
                    ))}
                </div>
              </div>

              {preview.map((n) => (
                <div key={n.id} className="scroll" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th className="left">{n.name}</th>
                        {n.par.map((_, h) => <th key={h}>{holeNumber(n, h)}</th>)}
                        <th>Tot</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="left">Par</td>{n.par.map((p, h) => <td key={h}>{p}</td>)}<td>{n.par.reduce((a, b) => a + b, 0)}</td></tr>
                      {n.yardage && <tr><td className="left">Yards</td>{n.yardage.map((y, h) => <td key={h}>{y || ''}</td>)}<td>{n.yardage.reduce((a, b) => a + b, 0)}</td></tr>}
                      <tr><td className="left">Hcp (men)</td>{n.menHcp.map((x, h) => <td key={h}>{x}</td>)}<td /></tr>
                      <tr><td className="left">Hcp (red)</td>{n.womenHcp.map((x, h) => <td key={h}>{x}</td>)}<td /></tr>
                    </tbody>
                  </table>
                </div>
              ))}
              {tee && tee.holes.some((h) => !h.handicap) && (
                <p className="notice small">Some holes have no handicap in the course data. Check the hole handicaps against the scorecard after adding.</p>
              )}
              <p className="small muted">Hole handicaps are re-ranked 1–9 within each nine, as the league uses them.</p>
              <div className="toolbar">
                <button
                  className="primary"
                  disabled={!preview.length}
                  onClick={() => {
                    onAdd(preview);
                    setCourse(null);
                    setResults(null);
                    setQuery('');
                  }}
                >
                  Add {preview.length === 1 ? 'this nine' : `these ${preview.length} nines`}
                </button>
                <span className="small muted">{doneHint}</span>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function teeLabel(t: CourseInfo['tees'][number]): string {
  const extra = [t.totalYards ? `${t.totalYards} yds` : '', t.rating && t.slope ? `${t.rating}/${t.slope}` : ''].filter(Boolean).join(', ');
  return `${t.name} (${t.gender === 'male' ? 'men' : 'women'}${t.holes.length < 18 ? ', 9 holes' : ''})${extra ? ` – ${extra}` : ''}`;
}
