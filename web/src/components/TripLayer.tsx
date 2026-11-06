import { useEffect } from 'react';
import { CircleMarker, Pane, Polyline, Popup, Rectangle, Tooltip, useMap } from 'react-leaflet';
import ngeohash from 'ngeohash';
import type { Trip, TripCheckpoint, TripRoute } from '../lib/api';
import { PASSABILITY } from '../lib/passability';

const ROUTE_STYLE: Record<TripRoute['verdict'], { color: string; weight: number; dashArray?: string }> = {
  chosen: { color: '#1d8a4b', weight: 6 },
  rejected: { color: '#c23a2b', weight: 4, dashArray: '10 8' },
  passed_over: { color: '#6b7785', weight: 4, dashArray: '4 8' },
};

const path = (t: Trip, r: TripRoute): [number, number][] => [
  [t.origin.lat, t.origin.lng],
  ...r.checkpoints.map((c): [number, number] => [c.lat, c.lng]),
  [t.destination.lat, t.destination.lng],
];

/** A checkpoint with no reports at all: outline its own ~150 m cell. No data is not dry. */
const noData = (c: TripCheckpoint) => c.passability === 'unknown' && c.cell === null;

/**
 * One dispatch on the map: the chosen route solid green, rejected routes dashed red, routes that
 * were passable but not chosen dashed grey, and every checkpoint coloured by its passability.
 */
export function TripLayer({ trip, fitKey }: { trip: Trip; fitKey: number }) {
  const map = useMap();

  useEffect(() => {
    if (fitKey === 0) return;
    const points = trip.routes.flatMap((r) => path(trip, r));
    // Keep the route clear of the side panel on wide screens.
    const wide = window.innerWidth > 720;
    map.flyToBounds(points, {
      paddingTopLeft: [40, 40],
      paddingBottomRight: [wide ? 380 : 40, 40],
      duration: 0.8,
    });
  }, [map, trip, fitKey]);

  // Draw the chosen route last so it sits on top.
  const ordered = [...trip.routes].sort(
    (a, b) => Number(a.verdict === 'chosen') - Number(b.verdict === 'chosen'),
  );

  return (
    <>
      {/* Lines under the report markers (overlayPane is 400), checkpoints above them. */}
      <Pane name="trip-lines" style={{ zIndex: 390 }}>
        {ordered.map((r) => (
          <Polyline
            key={r.id}
            positions={path(trip, r)}
            pathOptions={{ ...ROUTE_STYLE[r.verdict], opacity: 0.9, lineCap: 'round' }}
            bubblingMouseEvents={false}
          >
            <Tooltip sticky>{r.reason}</Tooltip>
          </Polyline>
        ))}

        {trip.routes.flatMap((r) =>
          r.checkpoints.filter(noData).map((c) => {
            const [minLat, minLng, maxLat, maxLng] = ngeohash.decode_bbox(ngeohash.encode(c.lat, c.lng, 7));
            return (
              <Rectangle
                key={`${r.id}-${c.name}-nodata`}
                bounds={[
                  [minLat, minLng],
                  [maxLat, maxLng],
                ]}
                interactive={false}
                pathOptions={{
                  color: PASSABILITY.unknown.color,
                  weight: 1.5,
                  dashArray: '3 4',
                  fillOpacity: 0,
                }}
              />
            );
          }),
        )}
      </Pane>

      <Pane name="trip-points" style={{ zIndex: 450 }}>
        {trip.routes.flatMap((r) =>
          r.checkpoints.map((c) => {
            const p = PASSABILITY[c.passability];
            return (
              <CircleMarker
                key={`${r.id}-${c.name}`}
                center={[c.lat, c.lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 2.5, fillColor: p.color, fillOpacity: 1 }}
                bubblingMouseEvents={false}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {c.name}: {p.label}
                </Tooltip>
                <Popup minWidth={220}>
                  <div className="popup">
                    <div className="popup-title">
                      <span className={`pass-pill ${c.passability}`}>{p.label}</span>
                      <strong>{c.name}</strong>
                    </div>
                    <p className="small">{c.reason}</p>
                    <p className="small muted">
                      {r.name}
                      {c.hashscan && (
                        <>
                          {' · '}
                          <a href={c.hashscan} target="_blank" rel="noreferrer">
                            paid query on HashScan
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            );
          }),
        )}

        {[
          { ...trip.origin, label: 'From' },
          { ...trip.destination, label: 'To' },
        ].map((pt) => (
          <CircleMarker
            key={pt.label}
            center={[pt.lat, pt.lng]}
            radius={6}
            interactive={false}
            pathOptions={{ color: '#0a2f47', weight: 3, fillColor: '#fff', fillOpacity: 1 }}
          >
            <Tooltip permanent direction="auto" offset={[0, 0]} className="trip-end">
              {pt.label}: {pt.name}
            </Tooltip>
          </CircleMarker>
        ))}
      </Pane>
    </>
  );
}
