import { useEffect, useRef } from 'react';
import { CircleMarker, Pane, Popup, Rectangle, Tooltip, useMap } from 'react-leaflet';
import type { CoverageCell } from '../lib/api';
import { COVERAGE } from '../lib/passability';

export type BBox = [number, number, number, number];

/** Reports the visible area (debounced) so coverage is only fetched for what is on screen. */
export function ViewportWatcher({ onChange }: { onChange: (b: BBox) => void }) {
  const map = useMap();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        onChangeRef.current([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
      }, 250);
    };
    report();
    map.on('moveend', report); // also fires after zooming
    return () => {
      clearTimeout(timer);
      map.off('moveend', report);
    };
  }, [map]);
  return null;
}

/**
 * One translucent square per ~150 m cell, coloured by how far its evidence can be trusted. Zoomed
 * out, a cell is a few pixels wide, so each one is drawn as a coloured ring around its spot instead.
 */
export function CoverageLayer({ cells, zoomedOut }: { cells: CoverageCell[]; zoomedOut: boolean }) {
  return (
    // Under the route lines and report markers.
    <Pane name="coverage" style={{ zIndex: 380 }}>
      {cells.map((c) => {
        const s = COVERAGE[c.state];
        const [minLat, minLng, maxLat, maxLng] = c.bounds;
        const dash = c.source === 'simulated' ? '3 3' : undefined;
        const details = (
          <>
            <Tooltip>{s.label}</Tooltip>
            <Popup minWidth={220}>
              <div className="popup">
                <div className="popup-title">
                  <span className="swatch" style={{ background: s.color }} />
                  <strong>{s.label}</strong>
                  {c.source !== 'live' && <span className="muted small">{c.source}</span>}
                </div>
                <p className="small">{c.reason}</p>
                <p className="small muted">
                  Coverage shows how good the evidence is, not what it says. Agents pay for the conditions.
                </p>
              </div>
            </Popup>
          </>
        );
        return zoomedOut ? (
          <CircleMarker
            key={c.cell}
            center={[(minLat + maxLat) / 2, (minLng + maxLng) / 2]}
            radius={16}
            bubblingMouseEvents={false}
            pathOptions={{ color: s.color, weight: 4, opacity: 0.9, fillOpacity: 0, dashArray: dash }}
          >
            {details}
          </CircleMarker>
        ) : (
          <Rectangle
            key={c.cell}
            bounds={[
              [minLat, minLng],
              [maxLat, maxLng],
            ]}
            bubblingMouseEvents={false}
            pathOptions={{
              color: s.color,
              weight: 1.5,
              fillColor: s.color,
              fillOpacity: 0.28,
              dashArray: dash,
            }}
          >
            {details}
          </Rectangle>
        );
      })}
    </Pane>
  );
}

export function CoverageLegend({ truncated }: { truncated: boolean }) {
  return (
    <>
      <ul className="legend-list">
        {(['corroborated', 'unverified', 'conflicting', 'stale'] as const).map((k) => (
          <li key={k} title={COVERAGE[k].hint}>
            <span className="swatch square" style={{ background: COVERAGE[k].color, opacity: 0.7 }} />
            {COVERAGE[k].label}
          </li>
        ))}
        <li title={COVERAGE.none.hint}>
          <span className="swatch square outline" />
          No data
        </li>
      </ul>
      <p className="muted small">
        Coverage is how much to trust what we know, never what it says. No square means no data: unknown, not
        dry.{truncated ? ' Showing the 400 freshest cells; zoom in for more.' : ''}
      </p>
    </>
  );
}
