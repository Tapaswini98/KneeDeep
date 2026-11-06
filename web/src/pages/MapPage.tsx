import { MapContainer, TileLayer } from 'react-leaflet';
import { LEVELS, MUMBAI_CENTER } from '../lib/levels';

/**
 * Live map of street conditions. S6 adds: reports fading with age, confidence per
 * cell, agent queries and HashScan payment links.
 */
export function MapPage() {
  return (
    <div className="map-page">
      <MapContainer center={MUMBAI_CENTER} zoom={12} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      </MapContainer>
      <aside className="legend">
        <h3>Water level</h3>
        <ul>
          {LEVELS.map((l) => (
            <li key={l.id}>
              <span className="swatch" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
        <p className="muted">No live reports yet.</p>
      </aside>
    </div>
  );
}
