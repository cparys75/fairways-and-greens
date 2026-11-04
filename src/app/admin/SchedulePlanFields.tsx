import { nineLabel, type Nine, type SchedulePlan } from '../../engine';

/** Tee times typed as "4:00pm, 4:09pm, …" become slots A, B, … */
export function slotsFromText(text: string): SchedulePlan['slots'] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((teeTime, i) => ({ slot: String.fromCharCode(65 + i), teeTime }));
}

export const slotsToText = (slots: SchedulePlan['slots']) => slots.map((s) => s.teeTime ?? s.slot).join(', ');

export function defaultPlan(nines: Nine[], slots: SchedulePlan['slots'] = []): SchedulePlan {
  // Next Tuesday as a starting point.
  const d = new Date();
  d.setDate(d.getDate() + ((9 - d.getDay()) % 7 || 7));
  return { startDate: d.toLocaleDateString('en-CA'), weeks: 14, playoffWeeks: 2, nineIds: nines.map((n) => n.id), slots };
}

/** Start date, number of weeks, which nines to rotate through and the tee times. */
export function SchedulePlanFields({
  plan,
  nines,
  teams,
  onChange,
  field = false,
  noun = 'teams',
}: {
  plan: SchedulePlan;
  nines: Nine[];
  teams: number;
  onChange: (p: SchedulePlan) => void;
  /** Field formats (everyone plays the field) have no matchups or tee times per match. */
  field?: boolean;
  /** What the sides are called: teams, or players in individual formats. */
  noun?: string;
}) {
  const set = (patch: Partial<SchedulePlan>) => onChange({ ...plan, ...patch });
  const matches = Math.floor(teams / 2);
  return (
    <div className="form-grid">
      <label className="field"><span>First week</span><input type="date" value={plan.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value || null })} /></label>
      <label className="field"><span>Regular-season weeks</span><input type="number" min={1} max={40} value={plan.weeks} onChange={(e) => set({ weeks: Number(e.target.value) })} /></label>
      <label className="field"><span>Playoff weeks</span><input type="number" min={0} max={10} value={plan.playoffWeeks} onChange={(e) => set({ playoffWeeks: Number(e.target.value) })} /></label>
      <div className="field">
        <span>Nines (rotate weekly)</span>
        {nines.map((n) => (
          <label key={n.id} className="check">
            <input
              type="checkbox"
              checked={plan.nineIds.includes(n.id)}
              onChange={(e) => set({ nineIds: nines.map((x) => x.id).filter((id) => (id === n.id ? e.target.checked : plan.nineIds.includes(id))) })}
            />
            {nineLabel(n)}
          </label>
        ))}
        {!nines.length && <span className="small muted">Choose the course first.</span>}
      </div>
      {!field && (
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Tee times, one per match ({matches} match{matches === 1 ? '' : 'es'} a week with {teams} {noun})</span>
          <input key={slotsToText(plan.slots)} defaultValue={slotsToText(plan.slots)} placeholder="4:00pm, 4:09pm, 4:18pm" onBlur={(e) => set({ slots: slotsFromText(e.target.value) })} />
        </label>
      )}
    </div>
  );
}
