import { useState, type FormEvent } from 'react';
import { courseLabel, type CourseInfo, type CourseSummary } from '../../engine';
import { api } from '../api';

/** A course and tee to play, as needed for a personal round. */
export interface CourseChoice {
  courseId: string | null;
  courseName: string;
  tee: string | null;
  /** 1 for 18 holes or the front nine, 10 for the back nine. */
  firstHole: number;
  par: number[];
  yardage: number[] | null;
  /** Hole handicaps as printed on the card (stroke index 1-18). */
  hcp: number[] | null;
}

type Holes = '18' | 'front' | 'back';

/** Search the course-data provider and pick a tee and which holes were played. */
export function CoursePicker({ onPick }: { onPick: (c: CourseChoice) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseSummary[] | null>(null);
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [tee, setTee] = useState(0);
  const [holes, setHoles] = useState<Holes>('18');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
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

  const t = course?.tees[tee];
  const choose = () => {
    if (!course || !t) return;
    const start = holes === 'back' ? 9 : 0;
    const count = holes === '18' && t.holes.length >= 18 ? 18 : 9;
    const played = t.holes.slice(start, start + count);
    onPick({
      courseId: course.id,
      courseName: courseLabel(course),
      tee: t.name,
      firstHole: start + 1,
      par: played.map((h) => h.par),
      yardage: played.some((h) => h.yardage) ? played.map((h) => h.yardage ?? 0) : null,
      hcp: played.every((h) => h.handicap && h.handicap >= 1 && h.handicap <= 18) ? played.map((h) => h.handicap!) : null,
    });
  };

  return (
    <div>
      <form className="toolbar" onSubmit={search}>
        <input type="search" placeholder="Search for a course, e.g. Pebble Beach" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Course name" style={{ flex: 1, minWidth: 180 }} />
        <button type="submit" disabled={busy || query.trim().length < 3}>{busy && !course ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {results && !course && (
        <ul className="pick-list">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => run(async () => { const c = await api.course(r.id); setCourse(c); setTee(0); setHoles('18'); })} disabled={busy}>
                <strong>{courseLabel(r)}</strong> <span className="small muted">{[r.city, r.state, r.country].filter(Boolean).join(', ')}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="muted">No courses found. Try fewer words, or enter the course by hand.</li>}
        </ul>
      )}
      {course && (
        <div className="card">
          <div className="toolbar">
            <strong>{courseLabel(course)}</strong>
            <span className="spacer" />
            <button type="button" onClick={() => setCourse(null)}>← Results</button>
          </div>
          {!course.tees.length ? (
            <p className="notice">No hole-by-hole data for this course. Enter it by hand instead.</p>
          ) : (
            <div className="form-grid">
              <label className="field">
                <span>Tees</span>
                <select value={tee} onChange={(e) => setTee(Number(e.target.value))}>
                  {course.tees.map((x, i) => (
                    <option key={i} value={i}>{x.name} ({x.gender === 'male' ? 'men' : 'women'}){x.totalYards ? ` – ${x.totalYards} yds` : ''}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Holes played</span>
                <select value={holes} onChange={(e) => setHoles(e.target.value as Holes)}>
                  {t && t.holes.length >= 18 && <option value="18">18 holes</option>}
                  <option value="front">Front nine</option>
                  {t && t.holes.length >= 18 && <option value="back">Back nine</option>}
                </select>
              </label>
              <div className="field">
                <span>&nbsp;</span>
                <button type="button" className="primary" onClick={choose}>Use this course</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
