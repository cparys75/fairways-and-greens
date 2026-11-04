import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { addDays, formatInfo, nineLabel, roundRobin, scheduleBalance, type Match, type SchedulePlan, type Week } from '../../engine';
import { NineSelect } from '../components/NineSelect';
import { api } from '../api';
import { formatDate, lookups } from '../format';
import { useLoaded } from '../season';
import { defaultPlan, SchedulePlanFields } from './SchedulePlanFields';
import { useSaver } from './useSaver';

type Draft = Omit<Week, 'scores'>;

export function ScheduleEditorPage() {
  const { data, seasonId } = useLoaded()!;
  const { teamLabel } = lookups(data);
  const saver = useSaver();
  const format = formatInfo(data.settings);
  const last = data.weeks[data.weeks.length - 1];
  const [selected, setSelected] = useState<number | 'new'>(last?.number ?? 'new');
  const existing = data.weeks.find((w) => w.number === selected);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (existing) setDraft(structuredClone({ ...existing, scores: undefined }) as Draft);
    else
      setDraft({
        number: (last?.number ?? 0) + 1,
        date: last?.date ? addDays(last.date, 7) : null,
        nineId: last?.nineId ?? data.nines[0]?.id ?? '',
        playoff: false,
        inclement: false,
        matches: last ? last.matches.map((m) => ({ slot: m.slot, teeTime: m.teeTime, teamA: 0, teamB: 0 })) : [],
      });
  }, [existing, last, data.nines]);

  if (!draft) return null;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setMatch = (i: number, patch: Partial<Match>) => set({ matches: draft.matches.map((m, j) => (i === j ? { ...m, ...patch } : m)) });
  const used = draft.matches.flatMap((m) => [m.teamA, m.teamB]).filter(Boolean);
  const dupes = new Set(used.filter((t, i) => used.indexOf(t) !== i));

  const save = () =>
    saver.run(async () => {
      const matches = draft.matches.filter((m) => m.teamA && m.teamB);
      await api.saveWeek(seasonId!, draft.number, { ...draft, matches });
      setSelected(draft.number);
    }, `Week ${draft.number} saved`);

  const generate = () => {
    const empty = data.weeks.filter((w) => !w.matches.length && !w.playoff);
    if (!empty.length) return alert('Every regular-season week already has matches. Add empty weeks first.');
    const slots = (last?.matches.length ? last.matches : data.weeks.find((w) => w.matches.length)?.matches ?? []).map((m) => ({ slot: m.slot ?? '', teeTime: m.teeTime }));
    const rounds = roundRobin(data.teams.map((t) => t.id), empty.length, slots);
    if (!confirm(`Fill ${empty.length} empty week(s) with round-robin matchups?`)) return;
    void saver.run(async () => {
      for (const [i, w] of empty.entries()) await api.saveWeek(seasonId!, w.number, { ...w, matches: rounds[i] });
    }, `Generated matchups for ${empty.length} week(s)`);
  };

  const remove = () =>
    confirm(`Delete week ${draft.number} and all its scores?`) &&
    saver.run(async () => {
      await api.deleteWeek(seasonId!, draft.number);
      setSelected('new');
    }, 'Week deleted');

  const teamSelect = (value: number, onChange: (v: number) => void) => (
    <select value={value || ''} onChange={(e) => onChange(Number(e.target.value))} className={dupes.has(value) ? 'error' : ''}>
      <option value="">—</option>
      {data.teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} – {teamLabel(t.id)}
        </option>
      ))}
    </select>
  );

  const balance = scheduleBalance(data);
  const slotNames = [...new Set(data.weeks.flatMap((w) => w.matches.map((m) => m.slot)).filter(Boolean))].sort() as string[];

  return (
    <>
      <h1>Schedule</h1>
      <RainOut />
      <GenerateSchedule />
      <div className="toolbar">
        <select value={selected} onChange={(e) => setSelected(e.target.value === 'new' ? 'new' : Number(e.target.value))}>
          {data.weeks.map((w) => (
            <option key={w.number} value={w.number}>
              Week {w.number} – {formatDate(w.date)} · {nineLabel(data.nines.find((n) => n.id === w.nineId) ?? { name: w.nineId })} {w.playoff ? '(playoffs)' : ''}
            </option>
          ))}
          <option value="new">+ Add a week</option>
        </select>
        <span className="spacer" />
        {!format.field && <button onClick={generate}>Generate round-robin for empty weeks</button>}
      </div>

      <section className="card">
        <div className="form-grid">
          <label className="field"><span>Week #</span><input type="number" value={draft.number} disabled={!!existing} onChange={(e) => set({ number: Number(e.target.value) })} /></label>
          <label className="field"><span>Date</span><input type="date" value={draft.date ?? ''} onChange={(e) => set({ date: e.target.value })} /></label>
          <label className="field">
            <span>Course / nine</span>
            <NineSelect nines={data.nines} value={draft.nineId} onChange={(nineId) => set({ nineId })} />
          </label>
          <div className="field">
            <span>Flags</span>
            <label className="check"><input type="checkbox" checked={!!draft.playoff} onChange={(e) => set({ playoff: e.target.checked })} /> Playoff week (not in standings)</label>
            <label className="check"><input type="checkbox" checked={!!draft.inclement} onChange={(e) => set({ inclement: e.target.checked })} /> Inclement weather</label>
          </div>
        </div>

        {format.field && <p className="small muted">{format.name}: everyone plays the field each week, so there are no matchups to set.</p>}
        {!format.field && <h3 style={{ marginTop: 16 }}>Matches</h3>}
        {!format.field && <div className="scroll">
          <table className="edit-table">
            <thead><tr><th>Slot</th><th>Tee time</th><th>Team</th><th /><th>Team</th><th /></tr></thead>
            <tbody>
              {draft.matches.map((m, i) => (
                <tr key={i}>
                  <td><input value={m.slot ?? ''} onChange={(e) => setMatch(i, { slot: e.target.value })} style={{ width: '3rem' }} /></td>
                  <td><input value={m.teeTime ?? ''} onChange={(e) => setMatch(i, { teeTime: e.target.value })} placeholder="4:00pm" /></td>
                  <td>{teamSelect(m.teamA, (v) => setMatch(i, { teamA: v }))}</td>
                  <td className="muted">vs</td>
                  <td>{teamSelect(m.teamB, (v) => setMatch(i, { teamB: v }))}</td>
                  <td><button className="danger" aria-label="Remove match" onClick={() => set({ matches: draft.matches.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        {dupes.size > 0 && <p className="notice">A {format.individual ? 'player' : 'team'} is in more than one match.</p>}
        <div className="toolbar">
          {!format.field && <button onClick={() => set({ matches: [...draft.matches, { teamA: 0, teamB: 0, slot: String.fromCharCode(65 + draft.matches.length) }] })}>+ Add match</button>}
          <span className="spacer" />
          {existing && <button className="danger" onClick={remove}>Delete week</button>}
          <button className="primary" onClick={save} disabled={saver.busy}>Save week</button>
        </div>
        {saver.view}
      </section>

      {!format.field && <>
      <h2>Schedule balance</h2>
      <p className="muted small">How many times each pair of {format.individual ? 'players' : 'teams'} meets, and how often each gets each tee time (regular season).</p>
      <div className="card table-card scroll">
        <table>
          <thead>
            <tr>
              <th className="left sticky-col">Team</th>
              {data.teams.map((t) => <th key={t.id}>{t.id}</th>)}
              {slotNames.map((sl) => <th key={sl}>{sl}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.teams.map((a) => (
              <tr key={a.id}>
                <td className="left sticky-col">{a.name}</td>
                {data.teams.map((b) => {
                  const n = a.id === b.id ? null : balance.timesMet(a.id, b.id);
                  return <td key={b.id} className={n === 0 ? 'muted' : n && n > 1 ? 'num-strong' : ''}>{n ?? '·'}</td>;
                })}
                {slotNames.map((sl) => <td key={sl}>{balance.slotCount(a.id, sl)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </>
  );
}

/** Replace the whole schedule with a generated one. Only possible before any scores are entered. */
function GenerateSchedule() {
  const { data, seasonId } = useLoaded()!;
  const saver = useSaver();
  const scored = data.weeks.some((w) => w.scores.length > 0);
  const format = formatInfo(data.settings);
  const noun = format.individual ? 'players' : 'teams';
  const tooFew = !format.field && data.teams.length < 2;
  const slots = (data.weeks.find((w) => w.matches.length)?.matches ?? []).map((m) => ({ slot: m.slot ?? '', teeTime: m.teeTime }));
  const [open, setOpen] = useState(!data.weeks.length);
  const [plan, setPlan] = useState<SchedulePlan>(() => ({
    ...defaultPlan(data.nines, slots),
    ...(data.weeks[0]?.date ? { startDate: data.weeks[0].date } : {}),
    ...(data.weeks.length ? { weeks: data.weeks.filter((w) => !w.playoff).length, playoffWeeks: data.weeks.filter((w) => w.playoff).length } : {}),
  }));

  if (scored) return null;
  const run = () =>
    (!data.weeks.length || confirm(`Replace all ${data.weeks.length} weeks with a new schedule?`)) &&
    saver.run(() => api.generateSchedule(seasonId!, plan), 'Schedule generated');

  return (
    <section className="card">
      <div className="toolbar" style={{ margin: 0 }}>
        <h3 style={{ margin: 0 }}>Generate the whole schedule</h3>
        <span className="spacer" />
        {!open && <button onClick={() => setOpen(true)}>Set up…</button>}
      </div>
      {open && (
        <>
          <p className="small muted">
            {format.field
              ? 'Builds every week at once: dates a week apart and nines rotating, with playoff weeks at the end.'
              : `Builds every week at once: dates a week apart, nines rotating, round-robin matchups and rotating tee times, with empty playoff weeks at the end. Uses the current ${noun}.`}{' '}
            Available until the first scores are entered.
          </p>
          <SchedulePlanFields plan={plan} nines={data.nines} teams={data.teams.length} onChange={setPlan} field={format.field} noun={noun} />
          <div className="toolbar">
            <button className="primary" disabled={saver.busy || tooFew || !plan.nineIds.length} onClick={run}>
              {data.weeks.length ? 'Replace schedule' : 'Generate schedule'}
            </button>
            {tooFew && <span className="small muted">Add at least two {noun} first.</span>}
            {saver.view}
          </div>
        </>
      )}
    </section>
  );
}

/** Weather cancellation: move a week and everything after it back one week, keeping the matchups. */
function RainOut() {
  const { data, seasonId } = useLoaded()!;
  const saver = useSaver();
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash === '#rain-out') ref.current?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const today = new Date().toLocaleDateString('en-CA');
  const dated = data.weeks.filter((w) => w.date);
  const next = dated.find((w) => w.date! >= today && !w.scores.length) ?? dated.find((w) => !w.scores.length) ?? dated[dated.length - 1];
  const [week, setWeek] = useState<number | null>(next?.number ?? null);
  const [undo, setUndo] = useState<number | null>(null);
  if (!dated.length) return null;

  const chosen = dated.find((w) => w.number === week);
  const moving = dated.filter((w) => week != null && w.number >= week);
  const last = moving[moving.length - 1];
  const scored = moving.filter((w) => w.scores.length).map((w) => w.number);

  const push = () => {
    if (!chosen) return;
    const warn = scored.length ? `\n\nWeek(s) ${scored.join(', ')} already have scores; they keep them.` : '';
    if (!confirm(`Move week ${chosen.number} (${formatDate(chosen.date)}) and the ${moving.length - 1} week(s) after it back one week?\nThe matchups stay the same; only the dates change.${warn}`)) return;
    void saver.run(async () => {
      await api.shiftSchedule(seasonId!, chosen.number, 7);
      setUndo(chosen.number);
    }, `Weeks ${chosen.number}–${last.number} moved back one week`);
  };

  return (
    <section className="card" id="rain-out" ref={ref}>
      <h3>Rained out?</h3>
      <p className="small muted">
        Moves the cancelled week and every week after it back 7 days. Each week keeps its matchups, so the cancelled matches are played
        next week and the season ends a week later.
      </p>
      <div className="toolbar">
        <label className="field">
          <span>Cancelled week</span>
          <select value={week ?? ''} onChange={(e) => setWeek(Number(e.target.value))}>
            {dated.map((w) => (
              <option key={w.number} value={w.number}>Week {w.number} – {formatDate(w.date)}{w.playoff ? ' (playoffs)' : ''}</option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={saver.busy || !chosen} onClick={push}>Push back one week</button>
        {undo != null && (
          <button disabled={saver.busy} onClick={() => saver.run(async () => { await api.shiftSchedule(seasonId!, undo, -7); setUndo(null); }, 'Undone: dates moved back')}>
            Undo
          </button>
        )}
      </div>
      {chosen && last && (
        <p className="small">
          Week {chosen.number} moves from {formatDate(chosen.date)} to {formatDate(addDays(chosen.date!, 7))}; the season now ends {formatDate(addDays(last.date!, 7))}.
          {scored.length > 0 && <span className="muted"> Week(s) {scored.join(', ')} already have scores.</span>}
        </p>
      )}
      {saver.view}
    </section>
  );
}
