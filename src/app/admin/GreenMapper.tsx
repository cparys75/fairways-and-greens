import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { holeNumber, nineLabel, type HoleGreens, type LatLng, type Nine } from '../../engine';
import { api } from '../api';
import { useLoaded } from '../season';
import { useSaver } from './useSaver';

type Point = 'f' | 'c' | 'b';
const POINTS: { key: Point; label: string; color: string }[] = [
  { key: 'f', label: 'Front', color: '#39d17b' },
  { key: 'c', label: 'Center', color: '#ffffff' },
  { key: 'b', label: 'Back', color: '#ff8a3d' },
];
// Hyland Hills Golf Course, Westminster CO — a sensible starting view.
const DEFAULT_CENTER: LatLng = [39.8797, -105.0528];

/** Click a satellite map to set each hole's front/center/back green, for GPS distances. */
export function GreenMapperPage() {
  const { data, seasonId } = useLoaded()!;
  const saver = useSaver();
  const [nineId, setNineId] = useState(data.nines[0]?.id ?? '');
  const nine = data.nines.find((n) => n.id === nineId) ?? data.nines[0];
  const [greens, setGreens] = useState<(HoleGreens | null)[]>([]);
  const [hole, setHole] = useState(0);
  const [point, setPoint] = useState<Point>('c');
  const [dirty, setDirty] = useState(false);

  // Load the selected nine's saved greens into local state.
  useEffect(() => {
    if (!nine) return;
    setGreens(nine.par.map((_, i) => nine.greens?.[i] ?? null));
    setHole(0);
    setDirty(false);
  }, [nine]);

  const setCurrent = (ll: LatLng | null) => {
    setGreens((g) => g.map((e, i) => (i === hole ? cleanEntry({ ...(e ?? {}), [point]: ll ?? undefined }) : e)));
    setDirty(true);
  };

  const save = () =>
    saver.run(async () => {
      const nines: Nine[] = data.nines.map((n) => (n.id === nine.id ? { ...n, greens } : n));
      await api.updateSeason(seasonId!, { nines });
    }, 'Greens saved');

  const mapped = greens.filter((g) => g && (g.f || g.c || g.b)).length;
  if (!nine) return <p className="empty">Add a course first under Rules &amp; course.</p>;

  return (
    <>
      <h1>Map greens (GPS distances)</h1>
      <p className="muted small">
        Pick a hole, choose Front / Center / Back, then click that spot on the green in the satellite image. Players then see live distances to
        the green while scoring. Zoom in close for accuracy. This is a one-time setup per course.
      </p>
      <div className="toolbar">
        <label className="field">
          <span>Course / nine</span>
          <select value={nineId} onChange={(e) => (!dirty || confirm('Discard unsaved greens?')) && setNineId(e.target.value)}>
            {data.nines.map((n) => (
              <option key={n.id} value={n.id}>{nineLabel(n)}</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <span className="small muted">{mapped}/{nine.par.length} holes mapped</span>
      </div>

      <div className="hole-strip" role="tablist" aria-label="Holes">
        {nine.par.map((_, i) => (
          <button
            key={i}
            className={`hole-pill ${i === hole ? 'current' : ''} ${greens[i] && (greens[i]!.f || greens[i]!.c || greens[i]!.b) ? 'done' : ''}`}
            onClick={() => setHole(i)}
          >
            {holeNumber(nine, i)}
          </button>
        ))}
      </div>

      <div className="toolbar" style={{ marginTop: 8 }}>
        <div className="segmented" role="tablist" aria-label="Green point">
          {POINTS.map((p) => (
            <button key={p.key} role="tab" aria-selected={point === p.key} onClick={() => setPoint(p.key)}>
              {p.label}{greens[hole]?.[p.key] ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <button disabled={!greens[hole]?.[point]} onClick={() => setCurrent(null)}>Clear {POINTS.find((p) => p.key === point)!.label.toLowerCase()}</button>
      </div>

      <GreenMap greens={greens} hole={hole} activePoint={point} onClick={setCurrent} />

      <p className="small muted">
        Hole {holeNumber(nine, hole)}: {POINTS.map((p) => `${p.label} ${fmt(greens[hole]?.[p.key])}`).join(' · ')}
      </p>
      <div className="save-bar">
        <button className="primary" onClick={save} disabled={saver.busy || !dirty}>{saver.busy ? 'Saving…' : dirty ? 'Save greens' : 'Saved'}</button>
        {saver.view}
      </div>
      <p className="small muted">Satellite imagery: Esri World Imagery.</p>
    </>
  );
}

const fmt = (ll?: LatLng) => (ll ? `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}` : '—');
function cleanEntry(e: HoleGreens): HoleGreens | null {
  const g: HoleGreens = {};
  if (e.f) g.f = e.f;
  if (e.c) g.c = e.c;
  if (e.b) g.b = e.b;
  return g.f || g.c || g.b ? g : null;
}

/** The Leaflet satellite map for one hole; clicking sets the active point. */
function GreenMap({ greens, hole, activePoint, onClick }: { greens: (HoleGreens | null)[]; hole: number; activePoint: Point; onClick: (ll: LatLng) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  // Where to center: this hole's existing point, any mapped point on the nine, else the course default.
  const start = useMemo<LatLng>(() => {
    const here = greens[hole];
    return here?.c || here?.f || here?.b || greens.find((g) => g?.c || g?.f || g?.b)?.c || DEFAULT_CENTER;
  }, [greens, hole]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: start, zoom: 18 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 21,
      maxNativeZoom: 19,
      attribution: 'Tiles © Esri',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => clickRef.current([Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6]));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recenter when the hole changes to a mapped one.
  useEffect(() => {
    const here = greens[hole];
    const c = here?.c || here?.f || here?.b;
    if (map.current && c) map.current.setView(c, Math.max(map.current.getZoom(), 18));
  }, [hole]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw this hole's points.
  useEffect(() => {
    const lg = layer.current;
    if (!lg) return;
    lg.clearLayers();
    const g = greens[hole];
    for (const p of POINTS) {
      const ll = g?.[p.key];
      if (!ll) continue;
      L.circleMarker(ll, { radius: p.key === activePoint ? 9 : 7, color: '#111', weight: 2, fillColor: p.color, fillOpacity: 1 })
        .bindTooltip(p.label, { permanent: false })
        .addTo(lg);
    }
  }, [greens, hole, activePoint]);

  return <div ref={el} className="green-map" aria-label="Satellite map" />;
}

export default GreenMapperPage;
