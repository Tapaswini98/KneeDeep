import { Circle, CircleMarker, MapContainer, Popup, TileLayer, Tooltip } from 'react-leaflet';
import { Activity, AgentQuery, api, formatHbar, LiveReport } from '../lib/api';
import { LEVELS, MUMBAI_CENTER } from '../lib/levels';
import { usePolling } from '../lib/usePolling';

const MAX_AGE_MIN = 180;
const levelInfo = (id: string | null) => LEVELS.find((l) => l.id === id);

/** Fresh reports are solid; they fade as they age, and vanish when Arkiv expires them. */
const opacityForAge = (ageMin: number) => Math.max(0.15, 1 - ageMin / MAX_AGE_MIN);

const timeAgo = (iso: string) => {
  const min = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)} min ago`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min ago`;
};

export function MapPage() {
  const reports = usePolling(
    () =>
      api<{ reports: LiveReport[]; arkivBlock: string }>(
        `/v1/reports?lat=${MUMBAI_CENTER[0]}&lng=${MUMBAI_CENTER[1]}&radius=20000`,
      ),
    10_000,
  );
  const activity = usePolling(() => api<Activity>('/v1/activity?limit=15'), 10_000);

  const live = reports.data?.reports ?? [];
  const queries = activity.data?.queries ?? [];
  const simulated = live.some((r) => r.source === 'simulated');

  return (
    <div className="map-page">
      <MapContainer center={MUMBAI_CENTER} zoom={12} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {queries.slice(0, 5).map((q) => (
          <Circle
            key={q.id}
            center={[q.lat, q.lng]}
            radius={q.radiusM}
            pathOptions={{ color: '#1f8fd1', weight: 1, dashArray: '4 4', fillOpacity: 0.04 }}
          >
            <Tooltip>Agent query · {timeAgo(q.createdAt)}</Tooltip>
          </Circle>
        ))}

        {live.map((r) => {
          const info = levelInfo(r.level);
          const o = opacityForAge(r.ageMin);
          return (
            <CircleMarker
              key={r.key}
              center={[r.center.lat, r.center.lng]}
              radius={10}
              pathOptions={{
                color: info?.color,
                fillColor: info?.color,
                fillOpacity: 0.75 * o,
                opacity: o,
                weight: 2,
                dashArray: r.source === 'simulated' ? '3 3' : undefined,
              }}
            >
              <Popup>
                <strong>{info?.label ?? r.level}</strong> · {Math.round(r.ageMin)} min ago
                <br />+{r.confirmations} confirm · −{r.disputes} dispute
                <br />
                {r.source === 'simulated' ? 'SIMULATED demo data' : 'Live, World ID-verified reporter'}
                <br />
                <code title={r.key}>{r.key.slice(0, 10)}…</code> on Arkiv
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <aside className="panel">
        {simulated && <p className="banner">Includes SIMULATED demo data (dashed markers).</p>}

        <section>
          <h3>Live now</h3>
          <div className="stats">
            <div>
              <strong>{live.length}</strong>
              <span>live reports</span>
            </div>
            <div>
              <strong>{activity.data?.totals.paidQueries ?? '–'}</strong>
              <span>paid queries</span>
            </div>
            <div>
              <strong>{activity.data ? formatHbar(activity.data.totals.revenueTinybars) : '–'}</strong>
              <span>earned</span>
            </div>
          </div>
          <p className="muted small">
            Arkiv block {reports.data?.arkivBlock ?? '…'}
            {reports.updatedAt && ` · updated ${reports.updatedAt.toLocaleTimeString()}`}
          </p>
          {(reports.error || activity.error) && <p className="notice error">{reports.error ?? activity.error}</p>}
        </section>

        <section>
          <h3>Water level</h3>
          <ul className="legend-list">
            {LEVELS.map((l) => (
              <li key={l.id}>
                <span className="swatch" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
          <p className="muted small">Markers fade with age and disappear when the report expires (3 h).</p>
        </section>

        <section>
          <h3>Agent queries</h3>
          {queries.length === 0 && <p className="muted small">None yet. Run: npm run agent</p>}
          {queries.map((q) => (
            <QueryCard key={q.id} q={q} />
          ))}
        </section>
      </aside>
    </div>
  );
}

function QueryCard({ q }: { q: AgentQuery }) {
  const worst = q.summary[0];
  const info = levelInfo(worst?.level ?? null);
  return (
    <div className="query">
      <div className="query-head">
        <span>{timeAgo(q.createdAt)}</span>
        {q.paid ? (
          <span className="badge paid">paid {formatHbar(q.amountTinybars)}</span>
        ) : (
          <span className="badge unpaid">unpaid</span>
        )}
      </div>
      {worst ? (
        <>
          <div className="query-answer">
            <span className="swatch" style={{ background: info?.color ?? '#999' }} />
            <strong>{info?.label ?? 'Contested'}</strong>
            <span className={`conf ${worst.confidenceLabel}`}>
              {worst.confidence.toFixed(2)} {worst.confidenceLabel}
            </span>
          </div>
          <p className="small">{worst.explanation}</p>
        </>
      ) : (
        <p className="small muted">No fresh reports in range{q.dataStatus === 'stub' ? ' (stub answer)' : ''}.</p>
      )}
      <p className="small muted">
        {q.reportsUsed} report(s) used, {q.corroboratedUsed} corroborated · data: {q.dataStatus}
        {q.hashscan && (
          <>
            {' · '}
            <a href={q.hashscan} target="_blank" rel="noreferrer">
              HashScan
            </a>
          </>
        )}
      </p>
    </div>
  );
}
