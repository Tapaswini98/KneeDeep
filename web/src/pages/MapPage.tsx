import { useEffect, useState } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { VerifyHuman } from '../components/VerifyHuman';
import { castVote, errorText, submitReport, voteBlocker, voterPosition } from '../lib/actions';
import {
  type Activity,
  type AgentQuery,
  api,
  formatHbar,
  type LiveReport,
  type LiveReports,
} from '../lib/api';
import { type Level, LEVELS, MUMBAI_CENTER } from '../lib/levels';
import { useSession } from '../lib/session';
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

type Point = { lat: number; lng: number };
type Notice = { kind: 'ok' | 'error'; text: string; link?: string } | null;

export function MapPage() {
  const { session, setSession } = useSession();
  const reports = usePolling(
    () => api<LiveReports>(`/v1/reports?lat=${MUMBAI_CENTER[0]}&lng=${MUMBAI_CENTER[1]}&radius=20000`),
    10_000,
  );
  const activity = usePolling(() => api<Activity>('/v1/activity?limit=15'), 10_000);

  const [layers, setLayers] = useState({ live: true, simulated: true, queries: true });
  const [draft, setDraft] = useState<Point | null>(null);
  const [flyTo, setFlyTo] = useState<Point | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const all = reports.data?.reports ?? [];
  const live = all.filter((r) => (r.source === 'simulated' ? layers.simulated : layers.live));
  const queries = activity.data?.queries ?? [];

  const afterAction = (n: Notice) => {
    setNotice(n);
    void reports.refresh();
  };

  return (
    <div className="map-page">
      <MapContainer center={MUMBAI_CENTER} zoom={12} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToReport onClick={setDraft} />
        <FlyTo target={flyTo} />

        {layers.queries &&
          queries.slice(0, 5).map((q) => (
            <Circle
              key={q.id}
              center={[q.lat, q.lng]}
              radius={q.radiusM}
              pathOptions={{ color: '#1f8fd1', weight: 1, dashArray: '4 4', fillOpacity: 0.04 }}
              eventHandlers={{ click: (e) => e.originalEvent.stopPropagation() }}
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
              bubblingMouseEvents={false}
            >
              <Tooltip>
                {info?.label} · {Math.round(r.ageMin)} min ago
              </Tooltip>
              <Popup minWidth={240}>
                <ReportPopup report={r} onDone={afterAction} />
              </Popup>
            </CircleMarker>
          );
        })}

        {draft && (
          <Popup position={[draft.lat, draft.lng]} eventHandlers={{ remove: () => setDraft(null) }}>
            <DraftPopup
              at={draft}
              onDone={(n) => {
                setDraft(null);
                afterAction(n);
              }}
            />
          </Popup>
        )}
      </MapContainer>

      <aside className="panel">
        {all.some((r) => r.source === 'simulated') && (
          <p className="banner">Includes SIMULATED demo data (dashed markers).</p>
        )}

        <section>
          <h3>You</h3>
          {session ? (
            <p className="small">
              {session.method === 'world' ? 'Verified human' : 'Dev identity (simulated)'} · reporter{' '}
              <code>{session.reporter}</code>
              <br />
              <span className="muted">
                Click a marker to confirm or dispute it.
                {session.method === 'dev' ? ' Click anywhere on the map to report there.' : ''}
              </span>
            </p>
          ) : (
            <VerifyHuman onVerified={setSession} />
          )}
          {notice && (
            <p className={`notice ${notice.kind} small`}>
              {notice.text}{' '}
              {notice.link && (
                <a href={notice.link} target="_blank" rel="noreferrer">
                  View on Arkiv
                </a>
              )}
            </p>
          )}
        </section>

        <section>
          <h3>Live now</h3>
          <div className="stats">
            <div>
              <strong>{all.length}</strong>
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
            {reports.data?.writerExplorer && (
              <>
                {' · '}
                <a href={reports.data.writerExplorer} target="_blank" rel="noreferrer">
                  all entities on Arkiv
                </a>
              </>
            )}
            {reports.updatedAt && ` · ${reports.updatedAt.toLocaleTimeString()}`}
          </p>
          {(reports.error || activity.error) && (
            <p className="notice error small">{reports.error ?? activity.error}</p>
          )}
        </section>

        <section>
          <h3>Layers</h3>
          <div className="toggles">
            {(
              [
                ['live', 'Live (verified)'],
                ['simulated', 'Simulated'],
                ['queries', 'Agent queries'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={layers[k]}
                  onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <ul className="legend-list">
            {LEVELS.map((l) => (
              <li key={l.id}>
                <span className="swatch" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
          <p className="muted small">Markers fade with age and disappear when the report expires on Arkiv.</p>
        </section>

        <section>
          <h3>Agent queries</h3>
          {queries.length === 0 && <p className="muted small">None yet. Run: npm run agent</p>}
          {queries.map((q) => (
            <QueryCard key={q.id} q={q} onSelect={() => setFlyTo({ lat: q.lat, lng: q.lng })} />
          ))}
        </section>
      </aside>
    </div>
  );
}

function ClickToReport({ onClick }: { onClick: (p: Point) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function FlyTo({ target }: { target: Point | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 16, { duration: 0.8 });
  }, [map, target]);
  return null;
}

function ReportPopup({ report: r, onDone }: { report: LiveReport; onDone: (n: Notice) => void }) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const info = levelInfo(r.level);
  const blocked = voteBlocker(session, r);

  const vote = async (v: 'confirm' | 'dispute') => {
    if (!session) return;
    setBusy(true);
    setMsg(null);
    try {
      const at = await voterPosition(session, r);
      const res = await castVote(session, r.key, v, at);
      const n = {
        kind: 'ok' as const,
        text: v === 'confirm' ? 'Confirmed.' : 'Disputed.',
        link: res.explorer,
      };
      setMsg(n);
      onDone(n);
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="popup">
      <div className="popup-title">
        <span className="swatch" style={{ background: info?.color }} />
        <strong>{info?.label ?? r.level}</strong>
        <span className="muted">{Math.round(r.ageMin)} min ago</span>
      </div>
      <div className="small">
        +{r.confirmations} confirm · −{r.disputes} dispute · expires in {Math.round(r.expiresInMin)} min
      </div>
      <div className="small">
        {r.source === 'simulated' ? 'SIMULATED demo data' : 'Live, World ID-verified reporter'} · reporter{' '}
        <code>{r.reporter}</code>
      </div>
      <div className="small">
        <a href={r.explorer.entity} target="_blank" rel="noreferrer">
          Entity on Arkiv
        </a>
        {r.explorer.tx && (
          <>
            {' · '}
            <a href={r.explorer.tx} target="_blank" rel="noreferrer">
              Write tx
            </a>
          </>
        )}
      </div>
      <div className="popup-actions">
        <button disabled={busy || !!blocked} onClick={() => vote('confirm')}>
          Confirm
        </button>
        <button disabled={busy || !!blocked} onClick={() => vote('dispute')}>
          Dispute
        </button>
        {blocked && <span className="muted small">{blocked}</span>}
        {busy && <span className="muted small">Writing to Arkiv…</span>}
      </div>
      {msg && <p className={`notice ${msg.kind} small`}>{msg.text}</p>}
    </div>
  );
}

function DraftPopup({ at, onDone }: { at: Point; onDone: (n: Notice) => void }) {
  const { session } = useSession();
  const [busy, setBusy] = useState<Level | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) return <p className="small">Verify in the side panel first, then click the map to report.</p>;
  if (session.method === 'world') {
    // A verified human's report must come from where they actually are.
    return (
      <p className="small">
        Live reports use your real location. Open <a href="/report">Report</a> on your phone at the spot.
      </p>
    );
  }

  const report = async (level: Level) => {
    setBusy(level);
    setError(null);
    try {
      const r = await submitReport(session, { level, ...at });
      onDone({ kind: 'ok', text: `Reported ${level} (simulated).`, link: r.explorer });
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  return (
    <div className="popup">
      <strong>Report here (simulated)</strong>
      <div className="popup-levels">
        {LEVELS.map((l) => (
          <button key={l.id} disabled={!!busy} onClick={() => report(l.id)} style={{ borderColor: l.color }}>
            <span className="swatch" style={{ background: l.color }} />
            {busy === l.id ? 'Saving…' : l.label}
          </button>
        ))}
      </div>
      {error && <p className="notice error small">{error}</p>}
    </div>
  );
}

function QueryCard({ q, onSelect }: { q: AgentQuery; onSelect: () => void }) {
  const worst = q.summary[0];
  const info = levelInfo(worst?.level ?? null);
  return (
    <div
      className="query"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
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
        <p className="small muted">
          No fresh reports in range{q.dataStatus === 'stub' ? ' (stub answer)' : ''}.
        </p>
      )}
      <p className="small muted">
        {q.reportsUsed} report(s) used, {q.corroboratedUsed} corroborated · data: {q.dataStatus}
        {q.hashscan && (
          <>
            {' · '}
            <a href={q.hashscan} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              HashScan
            </a>
          </>
        )}
      </p>
    </div>
  );
}
