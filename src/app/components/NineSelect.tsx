import type { Nine } from '../../engine';

/** Nine picker grouped by course. */
export function NineSelect({ nines, value, onChange }: { nines: Nine[]; value: string; onChange: (id: string) => void }) {
  const groups = new Map<string, Nine[]>();
  for (const n of nines) groups.set(n.course ?? '', [...(groups.get(n.course ?? '') ?? []), n]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {[...groups].map(([course, list]) =>
        course ? (
          <optgroup key={course} label={course}>
            {list.map((n) => <option key={n.id} value={n.id}>{n.name}{n.tee ? ` (${n.tee})` : ''}</option>)}
          </optgroup>
        ) : (
          list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)
        ),
      )}
    </select>
  );
}
