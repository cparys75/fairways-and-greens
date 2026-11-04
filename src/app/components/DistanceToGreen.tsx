import { useEffect, useRef, useState } from 'react';
import { distancesToGreen, hasGreen, type LatLng, type Nine } from '../../engine';

const PREF = 'golf-league.gps';
const prefOn = () => {
  try {
    return localStorage.getItem(PREF) === 'on';
  } catch {
    return false;
  }
};

/** Live GPS distance to the current hole's green, shown while scoring (only when the hole is mapped). */
export function DistanceToGreen({ nine, hole }: { nine: Nine; hole: number }) {
  const green = nine.greens?.[hole] ?? null;
  const [on, setOn] = useState(prefOn);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watch = useRef<number | null>(null);

  useEffect(() => {
    if (!on) return;
    if (!navigator.geolocation) {
      setError('This device has no GPS.');
      return;
    }
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setPos([p.coords.latitude, p.coords.longitude]);
        setAccuracy(p.coords.accuracy);
        setError(null);
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'Location is off. Allow it for this site to see distances.' : 'Waiting for GPS…'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
    return () => {
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    };
  }, [on]);

  if (!hasGreen(green)) return null; // nothing mapped for this hole

  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(PREF, next ? 'on' : 'off');
    } catch {
      /* private mode */
    }
  };

  if (!on) {
    return (
      <button className="gps-pill" onClick={toggle}>📍 Show distance to green</button>
    );
  }

  const d = pos ? distancesToGreen(pos, green) : null;
  return (
    <div className="gps-distance" aria-live="polite">
      <div className="gps-row">
        {([['f', 'Front'], ['c', 'Center'], ['b', 'Back']] as const).map(([k, label]) =>
          green[k] ? (
            <div key={k} className={`gps-cell ${k === 'c' ? 'big' : ''}`}>
              <span className="gps-yds">{d && d[k] != null ? d[k] : '–'}</span>
              <span className="small muted">{label}</span>
            </div>
          ) : null,
        )}
        <button className="link small gps-off" onClick={toggle} aria-label="Hide distances">✕</button>
      </div>
      <div className="small muted center">
        {error ? error : !pos ? 'Locating…' : `yards to green${accuracy != null ? ` · GPS ±${Math.round(accuracy)} m` : ''}`}
      </div>
    </div>
  );
}
