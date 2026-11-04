import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, FORMATS, formatInfo, holeNumber, nineLabel, STABLEFORD_LABELS, type EscRule, type Format, type Nine, type Settings } from '../../engine';
import { api } from '../api';
import { useLoaded } from '../season';
import { CourseFinder } from './CourseFinder';
import { useSaver } from './useSaver';

/** Rule fields, and whether they apply to head-to-head formats only. */
const numberFields: [keyof Settings, string, 'match'?][] = [
  ['menMaxHc', "Men's max handicap"],
  ['womenMaxHc', 'Red tees max handicap'],
  ['minHc', 'Minimum handicap'],
  ['handicapWindow', 'Handicap: last N scores'],
  ['handicapBest', 'Handicap: best N of those'],
  ['holeWinPoints', 'Points per hole won', 'match'],
  ['holeTiePoints', 'Points per hole tied', 'match'],
  ['netBonusWin', 'Net bonus (win)', 'match'],
  ['netBonusTie', 'Net bonus (tie)', 'match'],
  ['forfeitWinnerPoints', 'Forfeit: winner points', 'match'],
  ['forfeitLoserPoints', 'Forfeit: forfeiting side points', 'match'],
  ['hotshotBelow', 'Hotshot: net below'],
];

export function SettingsPage() {
  const { data, seasonId } = useLoaded()!;
  const saver = useSaver();
  const [name, setName] = useState(data.season.name);
  const [settings, setSettings] = useState<Settings>(data.settings);
  const [nines, setNines] = useState<Nine[]>(data.nines);
  // Changing the course: nines being removed, and the nine their weeks move to ({ oldId: newId }).
  const [replacements, setReplacements] = useState<Record<string, string>>({});

  useEffect(() => {
    setName(data.season.name);
    setSettings(structuredClone(data.settings));
    setNines(structuredClone(data.nines));
    setReplacements({});
  }, [data]);

  const setEsc = (i: number, patch: Partial<EscRule>) => setSettings({ ...settings, esc: settings.esc.map((r, j) => (i === j ? { ...r, ...patch } : r)) });
  const setNine = (i: number, patch: Partial<Nine>) => setNines(nines.map((n, j) => (i === j ? { ...n, ...patch } : n)));
  const setHole = (i: number, key: 'par' | 'menHcp' | 'womenHcp' | 'yardage', h: number, v: number) =>
    setNine(i, { [key]: (nines[i][key] ?? Array(9).fill(0)).map((x, k) => (k === h ? v : x)) });

  const scored = data.weeks.some((w) => w.scores.length > 0);
  const format = formatInfo(settings);
  const changingFormat = settings.format !== data.settings.format;
  const weeksOn = (id: string) => data.weeks.filter((w) => w.nineId === id).map((w) => w.number);
  const kept = nines.filter((n) => !replacements[n.id]);
  const targets = new Set(Object.values(replacements));
  const label = (id: string) => {
    const n = nines.find((x) => x.id === id);
    return n ? nineLabel(n) : id;
  };

  const save = () => {
    const before = formatInfo(data.settings);
    if (changingFormat && (before.field !== format.field || before.individual !== format.individual) && data.weeks.some((w) => w.matches.length) && !confirm(`Switching to ${format.name} clears the current matchups. Generate the schedule again afterwards on the Schedule page. Continue?`)) return;
    const swaps = Object.entries(replacements);
    if (swaps.length && scored && !confirm(`Move ${swaps.map(([from, to]) => `${label(from)} weeks to ${label(to)}`).join(' and ')}? Every score, handicap and standing on those weeks is recalculated with the new course.`)) return;
    return saver.run(
      () => api.updateSeason(seasonId!, { name, settings, nines: kept, replaceNines: swaps.length ? replacements : undefined }),
      swaps.length ? 'Course changed – all results recalculated' : 'Saved – all results recalculated with the new rules',
    );
  };

  return (
    <>
      <h1>Rules &amp; course</h1>
      <p className="muted small">Changes apply to the whole season immediately – every score, handicap and standing is recalculated.</p>

      <section className="card">
        <label className="field" style={{ maxWidth: 360 }}><span>Season name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      </section>

      <section className="card">
        <h3>Format</h3>
        <label className="field" style={{ maxWidth: 420 }}>
          <span>How the league plays</span>
          <select value={settings.format} disabled={scored} onChange={(e) => setSettings({ ...settings, format: e.target.value as Format })}>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <p className="small muted">{format.summary}</p>
        {scored && <p className="small muted">The format can’t change once scores are entered. Start a new season to play a different format.</p>}
        {settings.format === 'stableford' && (
          <>
            <h3 style={{ marginTop: 16 }}>Stableford points (for the net score on a hole)</h3>
            <div className="form-grid">
              {STABLEFORD_LABELS.map((label, i) => (
                <label key={label} className="field">
                  <span>{label}</span>
                  <input type="number" min={0} max={20} value={settings.stableford[i]} onChange={(e) => setSettings({ ...settings, stableford: settings.stableford.map((x, j) => (j === i ? Number(e.target.value) : x)) })} />
                </label>
              ))}
            </div>
          </>
        )}
        {settings.format === 'scramble' && (
          <>
            <h3 style={{ marginTop: 16 }}>Scramble team handicap</h3>
            <p className="small muted">
              Percent of each player’s handicap, lowest handicap first; added up and rounded. Common choices: two-person 35% / 15%; four-person
              25% / 20% / 15% / 10%.
            </p>
            <label className="field" style={{ maxWidth: 360 }}>
              <span>Percentages, lowest handicap first</span>
              <input
                key={settings.scramblePercents.join(',')}
                defaultValue={settings.scramblePercents.join(', ')}
                onBlur={(e) => {
                  const pcts = e.target.value.split(/[,\s/]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
                  if (pcts.length) setSettings({ ...settings, scramblePercents: pcts.slice(0, 8) });
                }}
              />
            </label>
          </>
        )}
      </section>

      {!format.field && (
        <section className="card">
          <h3>Absent players</h3>
          <div className="radio-cards">
            <label className={`format-option ${settings.absentRule !== 'bestBall' ? 'selected' : ''}`}>
              <input type="radio" name="absent" checked={settings.absentRule !== 'bestBall'} onChange={() => setSettings({ ...settings, absentRule: 'virtual' })} />
              <span>
                <strong>Virtual score</strong>
                <span className="small muted block">The absent player gets a score that counts: net = par + the strokes-over-par below.</span>
              </span>
            </label>
            <label className={`format-option ${settings.absentRule === 'bestBall' ? 'selected' : ''}`}>
              <input type="radio" name="absent" checked={settings.absentRule === 'bestBall'} onChange={() => setSettings({ ...settings, absentRule: 'bestBall' })} />
              <span>
                <strong>Play 2 vs 1 (best ball)</strong>
                <span className="small muted block">The full team plays its better ball (the lower net of the two partners on each hole) against the lone player.</span>
              </span>
            </label>
          </div>
          {settings.absentRule !== 'bestBall' && (
            <label className="field" style={{ maxWidth: 260, marginTop: 10 }}>
              <span>Virtual score: net over par</span>
              <input type="number" value={settings.virtualOverPar} onChange={(e) => setSettings({ ...settings, virtualOverPar: Number(e.target.value) })} />
            </label>
          )}
        </section>
      )}

      <section className="card">
        <h3>League rules</h3>
        <div className="form-grid">
          {numberFields.filter(([, , only]) => !only || !format.field).map(([k, label]) => (
            <label key={k} className="field">
              <span>{label}</span>
              <input type="number" value={settings[k] as number} onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) })} />
            </label>
          ))}
          <div className="field">
            <span>Options</span>
            <label className="check"><input type="checkbox" checked={settings.inclementCountsForHandicap} onChange={(e) => setSettings({ ...settings, inclementCountsForHandicap: e.target.checked })} /> Inclement-weather weeks count for handicaps</label>
            <label className="check"><input type="checkbox" checked={settings.averagesIncludeVirtual} onChange={(e) => setSettings({ ...settings, averagesIncludeVirtual: e.target.checked })} /> Include virtual rounds in averages</label>
          </div>
        </div>
        <h3 style={{ marginTop: 16 }}>Max score per hole for handicaps</h3>
        <table className="edit-table" style={{ maxWidth: 520 }}>
          <thead><tr><th>Handicap up to</th><th>Max score</th><th>or par +</th></tr></thead>
          <tbody>
            {settings.esc.map((r, i) => (
              <tr key={i}>
                <td><input type="number" placeholder="and over" value={r.upToHc ?? ''} onChange={(e) => setEsc(i, { upToHc: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                <td><input type="number" value={r.maxScore ?? ''} onChange={(e) => setEsc(i, { maxScore: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                <td><input type="number" disabled={r.maxScore != null} value={r.overPar ?? ''} onChange={(e) => setEsc(i, { overPar: Number(e.target.value) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="toolbar"><button onClick={() => setSettings({ ...DEFAULT_SETTINGS })}>Reset rules to defaults</button></p>
      </section>

      <h2>Course</h2>
      <p className="muted small">
        To change the course: add the new course’s nines with “Find a course”, then use <b>Replace with</b> on each old nine to move its
        weeks to a new one, and save. You can also correct a scorecard by hand.
      </p>
      {scored && (
        <p className="notice small">
          This season already has scores. Changing pars or hole handicaps recalculates every score, handicap and standing that uses those
          holes when you save.
        </p>
      )}
      <CourseFinder existingIds={nines.map((n) => n.id)} onAdd={(added) => setNines([...nines, ...added])} />

      {nines.map((n, i) =>
        replacements[n.id] ? (
          <div key={i} className="notice small replaced-nine">
            <span>
              <b>{nineLabel(n)}</b> will be removed. {weeksText(weeksOn(n.id))} move to <b>{label(replacements[n.id])}</b> when you save.
            </span>
            <button onClick={() => setReplacements(Object.fromEntries(Object.entries(replacements).filter(([k]) => k !== n.id)))}>Undo</button>
          </div>
        ) : (
        <fieldset key={i} className="card">
          <div className="toolbar">
            <label className="field"><span>Course</span><input value={n.course ?? ''} placeholder="e.g. Oak Creek GC" onChange={(e) => setNine(i, { course: e.target.value || undefined })} /></label>
            <label className="field"><span>Nine name</span><input value={n.name} onChange={(e) => setNine(i, { name: e.target.value })} /></label>
            <label className="field"><span>First hole #</span><input type="number" min={1} max={19} value={n.firstHole ?? 1} onChange={(e) => setNine(i, { firstHole: Number(e.target.value) || 1 })} style={{ width: '5rem' }} /></label>
            <label className="field"><span>Short id</span><input value={n.id} onChange={(e) => setNine(i, { id: e.target.value })} style={{ width: '6rem' }} disabled={data.weeks.some((w) => w.nineId === n.id)} /></label>
            <span className="spacer" />
            {weeksOn(n.id).length ? (
              <label className="field">
                <span>{weeksText(weeksOn(n.id))} played here</span>
                <select
                  value=""
                  disabled={kept.length < 2 || targets.has(n.id)}
                  onChange={(e) => e.target.value && setReplacements({ ...replacements, [n.id]: e.target.value })}
                >
                  <option value="">Replace with…</option>
                  {kept.filter((x) => x.id !== n.id).map((x) => (
                    <option key={x.id} value={x.id}>{nineLabel(x)}</option>
                  ))}
                </select>
              </label>
            ) : (
              <button className="danger" disabled={kept.length < 2 || targets.has(n.id)} onClick={() => setNines(nines.filter((_, j) => j !== i))}>Remove nine</button>
            )}
          </div>
          {(n.tee || n.source) && <p className="small muted">{[n.tee && `${n.tee} tees`, n.source && `from ${n.source}`].filter(Boolean).join(' · ')}</p>}
          <div className="scroll">
            <table className="edit-table">
              <thead><tr><th className="left">Hole</th>{n.par.map((_, h) => <th key={h}>{holeNumber(n, h)}</th>)}</tr></thead>
              <tbody>
                {([['par', 'Par'], ['yardage', 'Yards'], ['menHcp', 'Hole hcp (men)'], ['womenHcp', 'Hole hcp (red tees)']] as const).map(([k, label]) => (
                  <tr key={k}>
                    <td className="left">{label}</td>
                    {(n[k] ?? Array<number>(9).fill(0)).map((v, h) => (
                      <td key={h}><input type="number" value={v} onChange={(e) => setHole(i, k, h, Number(e.target.value))} style={{ width: '3.2rem' }} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
        ),
      )}
      <p><button onClick={() => setNines([...nines, { id: `nine${nines.length + 1}`, name: 'New nine', par: Array(9).fill(4), menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9] }])}>+ Add nine</button></p>

      <div className="save-bar">
        <button className="primary" onClick={save} disabled={saver.busy}>Save rules &amp; course</button>
        {saver.view}
      </div>
    </>
  );
}

/** "Weeks 1–18", "Weeks 2, 4, 6" or "Week 3". */
function weeksText(weeks: number[]): string {
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  const contiguous = weeks.every((w, i) => i === 0 || w === weeks[i - 1] + 1);
  return contiguous ? `Weeks ${weeks[0]}–${weeks[weeks.length - 1]}` : `${weeks.length} weeks`;
}
