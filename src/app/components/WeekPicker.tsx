import type { WeekResult } from '../../engine';
import { formatDate } from '../format';

export function WeekPicker({ weeks, value, onChange }: { weeks: WeekResult[]; value: number | null; onChange: (n: number) => void }) {
  return (
    <div className="week-picker" role="tablist" aria-label="Week">
      {weeks.map((w) => (
        <button
          key={w.week.number}
          role="tab"
          aria-selected={w.week.number === value}
          className={[w.week.number === value ? 'on' : '', w.started ? 'played' : '', w.week.playoff ? 'playoff' : ''].join(' ')}
          onClick={() => onChange(w.week.number)}
          title={formatDate(w.week.date)}
        >
          {w.week.playoff ? 'P' : ''}
          {w.week.number}
        </button>
      ))}
    </div>
  );
}
