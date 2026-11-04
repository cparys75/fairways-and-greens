import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FORMATS, formatInfo, nineLabel, type Format, type Nine, type SchedulePlan, type SeasonData } from '../../engine';
import { api } from '../api';
import { useSeason } from '../season';
import { CourseFinder } from './CourseFinder';
import { defaultPlan, SchedulePlanFields } from './SchedulePlanFields';
import { useSaver } from './useSaver';

/**
 * One screen to start a season: name, teams (copied from a past season), the course for the
 * whole season, and a generated schedule.
 */
export function NewSeasonPage() {
  const { seasons, setSeasonId, leagueId } = useSeason();
  const navigate = useNavigate();
  const saver = useSaver();
  const nextYear = new Date().getFullYear() + (new Date().getMonth() > 8 ? 1 : 0);
  const [name, setName] = useState(`${nextYear} League`);
  const [copyFrom, setCopyFrom] = useState<number | ''>(seasons.find((s) => s.isCurrent)?.id ?? seasons[0]?.id ?? '');
  const [source, setSource] = useState<SeasonData | null>(null);
  const [courseMode, setCourseMode] = useState<'same' | 'new'>('same');
  const [newNines, setNewNines] = useState<Nine[]>([]);
  const [generate, setGenerate] = useState(true);
  const [plan, setPlan] = useState<SchedulePlan>(defaultPlan([]));
  const [format, setFormat] = useState<Format | null>(null);

  useEffect(() => {
    if (!copyFrom) {
      setSource(null);
      setCourseMode('new');
      return;
    }
    api.season(copyFrom).then((s) => {
      setSource(s);
      // Reuse last season's tee times.
      const slots = (s.weeks.find((w) => w.matches.length)?.matches ?? []).map((m) => ({ slot: m.slot ?? '', teeTime: m.teeTime }));
      setPlan((p) => ({ ...defaultPlan(s.nines, slots), startDate: p.startDate }));
    });
  }, [copyFrom]);

  const nines = useMemo(() => (courseMode === 'same' ? (source?.nines ?? []) : newNines), [courseMode, source, newNines]);
  useEffect(() => setPlan((p) => ({ ...p, nineIds: nines.map((n) => n.id) })), [nines]);

  // Same format as the season being copied, unless changed.
  const chosen = formatInfo({ format: format ?? source?.settings.format ?? 'teamMatch' });
  const activePlayers = source?.players.filter((p) => p.active !== false).length ?? 0;
  // Copying an individual season into a team format: the one-player "teams" don't carry over as real teams.
  const sourceIndividual = !!source && formatInfo(source.settings).individual;
  const teams = chosen.individual ? activePlayers : sourceIndividual ? 0 : (source?.teams.length ?? 0);
  const noun = chosen.individual ? 'players' : 'teams';
  const canSchedule = chosen.field || teams >= 2;
  const ready = !!name.trim() && nines.length > 0 && (!generate || !canSchedule || (plan.nineIds.length > 0 && plan.weeks > 0));

  const create = () =>
    saver.run(async () => {
      const { id } = await api.createSeason({
        leagueId: leagueId!,
        name: name.trim(),
        copyFrom: copyFrom || undefined,
        nines,
        format: chosen.id,
        schedule: generate && canSchedule ? plan : undefined,
      });
      setSeasonId(id);
      navigate('/admin/roster');
    }, 'Season created');

  return (
    <>
      <h1>Start a new season</h1>
      <p className="muted small">Fill this in from top to bottom and press Create. The season becomes the current one.</p>

      <section className="card">
        <h3>1. Format</h3>
        <div className="format-options">
          {FORMATS.map((f) => (
            <label key={f.id} className={`format-option ${chosen.id === f.id ? 'selected' : ''}`}>
              <input type="radio" name="format" checked={chosen.id === f.id} onChange={() => setFormat(f.id)} />
              <span>
                <strong>{f.name}</strong>
                <span className="small muted block">{f.summary}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>2. Name and {chosen.individual ? 'players' : 'teams'}</h3>
        <div className="form-grid">
          <label className="field"><span>Season name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">
            <span>Copy teams, players and rules from</span>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Start empty</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        {source && (
          <p className="small muted">
            {chosen.individual ? '' : `${source.teams.length} teams and `}{activePlayers} active players. Each player’s current handicap becomes
            their starting handicap. You can edit {chosen.individual ? 'players' : 'teams'} right after creating the season.
          </p>
        )}
      </section>

      <section className="card">
        <h3>3. Course</h3>
        <p className="small muted">The course for the season. You can change it later under Rules &amp; course.</p>
        {source && (
          <label className="check">
            <input type="radio" checked={courseMode === 'same'} onChange={() => setCourseMode('same')} /> Same course as {source.season.name}:{' '}
            {source.nines.map(nineLabel).join(', ')}
          </label>
        )}
        <label className="check">
          <input type="radio" checked={courseMode === 'new'} onChange={() => setCourseMode('new')} /> Choose a different course
        </label>
        {courseMode === 'new' && (
          <>
            {newNines.length > 0 && (
              <p>
                <strong>Selected:</strong> {newNines.map(nineLabel).join(', ')} <button onClick={() => setNewNines([])}>Clear</button>
              </p>
            )}
            {!newNines.length && <CourseFinder existingIds={[]} onAdd={setNewNines} doneHint="Then continue below." />}
          </>
        )}
      </section>

      <section className="card">
        <h3>4. Schedule</h3>
        <label className="check">
          <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} /> Generate the schedule now
          {chosen.field ? ' (weekly dates and nines)' : ' (round-robin, rotating tee times)'}
        </label>
        {generate && !canSchedule && <p className="notice small">Needs at least two {noun}. Add them after creating the season, then generate from the Schedule page.</p>}
        {generate && canSchedule && <SchedulePlanFields plan={plan} nines={nines} teams={teams} onChange={setPlan} field={chosen.field} noun={noun} />}
      </section>

      <div className="save-bar">
        <button className="primary" disabled={!ready || saver.busy} onClick={create}>{saver.busy ? 'Creating…' : 'Create season'}</button>
        {!nines.length && <span className="small muted">Choose a course first.</span>}
        {saver.view}
      </div>
    </>
  );
}
