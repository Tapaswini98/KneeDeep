import { useEffect, useMemo, useRef, useState } from 'react';
import ngeohash from 'ngeohash';
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
import { type BBox, CoverageLayer, CoverageLegend, ViewportWatcher } from '../components/CoverageLayer';
import { CreBadge } from '../components/CreBadge';
import { DispatchPanel } from '../components/DispatchPanel';
import { Earnings } from '../components/Earnings';
import { SignInCard } from '../components/SignInCard';
import { TripLayer } from '../components/TripLayer';
import { castVote, errorText, sessionVote, submitReport, voteBlocker, voterPosition } from '../lib/actions';
import {
  type Activity,
  type AgentQuery,
  api,
  formatHbar,
  type LiveReport,
  type LiveReports,
  type PayoutBatch,
  type Trip,
  type Trips,
  type Verification,
} from '../lib/api';
import { type Level, LEVELS, MUMBAI_CENTER } from '../lib/levels';
import { useMyVotes } from '../lib/myVotes';
import { PASSABILITY } from '../lib/passability';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { useTestLocation } from '../lib/testLocation';
import { useCoverage } from '../lib/useCoverage';
import { useVerification } from '../lib/useVerification';
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
  const { session } = useSession();
  const reports = usePolling(
    () => api<LiveReports>(`/v1/reports?lat=${MUMBAI_CENTER[0]}&lng=${MUMBAI_CENTER[1]}&radius=20000`),
    10_000,
  );
  const activity = usePolling(() => api<Activity>('/v1/activity?limit=15'), 10_000);
  const trips = usePolling(() => api<Trips>('/v1/trips?limit=10'), 10_000);

  const [layers, setLayers] = useState({
    live: true,
    simulated: true,
    queries: true,
    dispatch: true,
    coverage: false,
  });
  const [draft, setDraft] = useState<Point | null>(null);
  const [flyTo, setFlyTo] = useState<(Point & { zoom?: number }) | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const { location: here } = useTestLocation();
  const verification = useVerification();

  // Coverage is fetched for the visible area only, while the layer is on.
  const [bbox, setBbox] = useState<BBox | null>(null);
  const coverage = useCoverage(layers.coverage, bbox);
  const covered = useMemo(() => new Set(coverage.data?.cells.map((c) => c.cell)), [coverage.data]);

  // The dispatch shown: the latest by default, or one picked from the list or linked with ?trip=<id>.
  const linkedId = useRef(new URLSearchParams(window.location.search).get('trip'));
  const [tripId, setTripId] = useState<string | null>(linkedId.current);
  const [linkedTrip, setLinkedTrip] = useState<Trip | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const listed = useMemo(() => trips.data?.trips ?? [], [trips.data]);
  const selectedTrip = tripId
    ? (listed.find((t) => t.id === tripId) ?? (linkedTrip?.id === tripId ? linkedTrip : null))
    : (listed[0] ?? null);

  useEffect(() => {
    // A linked trip older than the latest ten: fetch it on its own.
    if (!tripId || !trips.data || listed.some((t) => t.id === tripId) || linkedTrip?.id === tripId) return;
    api<Trip>(`/v1/trips/${tripId}`).then(setLinkedTrip, () => setTripId(null));
  }, [tripId, trips.data, listed, linkedTrip]);

  useEffect(() => {
    // Opened from a link (the agent prints one): fit the map to that trip once it has loaded.
    if (linkedId.current && selectedTrip?.id === linkedId.current) {
      linkedId.current = null;
      setFitKey((k) => k + 1);
    }
  }, [selectedTrip]);

  const selectTrip = (t: Trip) => {
    // Picking the newest one keeps following new dispatches; any other one stays pinned.
    const pinned = t.id === listed[0]?.id ? null : t.id;
    setTripId(pinned);
    setFitKey((k) => k + 1);
    setLayers((l) => ({ ...l, dispatch: true }));
    window.history.replaceState(null, '', pinned ? `/map?trip=${pinned}` : '/map');
  };

  // Picking a test location in the top bar flies the map there.
  useEffect(() => {
    if (here) setFlyTo({ lat: here.lat, lng: here.lng, zoom: 14 });
  }, [here]);

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
        <ViewportWatcher onChange={setBbox} />
        {layers.coverage && coverage.data && (
          // Below ~zoom 16 (a view over ~2.5 km tall) a 150 m cell is too small to see as a square.
          <CoverageLayer cells={coverage.data.cells} zoomedOut={!!bbox && bbox[2] - bbox[0] > 0.025} />
        )}
        {layers.dispatch && selectedTrip && <TripLayer trip={selectedTrip} fitKey={fitKey} />}
        {here && (
          <>
            <Circle
              center={[here.lat, here.lng]}
              radius={1000}
              interactive={false}
              pathOptions={{ color: '#1479c9', weight: 1.5, dashArray: '2 6', fillOpacity: 0.05 }}
            />
            <CircleMarker
              center={[here.lat, here.lng]}
              radius={7}
              interactive={false}
              pathOptions={{ color: '#fff', weight: 3, fillColor: '#1479c9', fillOpacity: 1 }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]} className="here-label">
                You (test location) · votes within 1 km
              </Tooltip>
            </CircleMarker>
          </>
        )}
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
              noData={
                layers.coverage && !!coverage.data && !covered.has(ngeohash.encode(draft.lat, draft.lng, 7))
              }
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

        <DispatchPanel
          trips={listed}
          selected={selectedTrip}
          onSelect={selectTrip}
          unavailable={!trips.data && !!trips.error}
        />

        <section>
          <h3>You</h3>
          {session ? (
            <>
              <p className="small">
                {session.method === 'world' ? 'Verified human' : 'Dev identity (simulated)'} · reporter{' '}
                <code>{session.reporter}</code>
                <br />
                <span className="muted">
                  Click a marker to confirm or dispute it.
                  {session.method === 'dev' ? ' Click anywhere on the map to report there.' : ''}
                </span>
              </p>
              <Earnings session={session} />
              <button className="link small" onClick={() => navigate('/me')}>
                My activity: your reports, votes and earnings →
              </button>
            </>
          ) : (
            <SignInCard why="Anyone can read the map. Sign in to report, confirm or dispute." />
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
              <strong>{reports.data ? all.length : '–'}</strong>
              <span>live reports</span>
            </div>
            <div>
              <strong>{activity.data?.totals.paidQueries ?? '–'}</strong>
              <span>paid queries</span>
            </div>
            <div>
              <strong>{activity.data ? formatHbar(activity.data.totals.revenueTinybars) : '–'}</strong>
              <span>revenue</span>
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
            <p className="notice error small">
              Live data is unavailable right now ({reports.error ?? activity.error}). The map keeps retrying
              every 10 seconds; what you see may be out of date.
            </p>
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
                ['dispatch', 'Dispatch routes'],
                ['coverage', 'Coverage'],
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
          {layers.dispatch && (
            <>
              <ul className="legend-list">
                <li>
                  <span className="line-swatch chosen" />
                  Chosen route
                </li>
                <li>
                  <span className="line-swatch rejected" />
                  Rejected
                </li>
                {(['safe', 'risky', 'blocked', 'unknown'] as const).map((p) => (
                  <li key={p} title={PASSABILITY[p].hint}>
                    <span className="swatch" style={{ background: PASSABILITY[p].color }} />
                    {PASSABILITY[p].label}
                  </li>
                ))}
              </ul>
              <p className="muted small">Checkpoint dots: passability for a two-wheeler.</p>
            </>
          )}
          {layers.coverage && <CoverageLegend truncated={!!coverage.data?.truncated} />}
          {layers.coverage && coverage.error && <p className="notice error small">{coverage.error}</p>}
        </section>

        <section>
          <h3>Reporter payouts</h3>
          <div className="stats">
            <div>
              <strong>{activity.data ? formatHbar(activity.data.payouts.paidOutTinybars) : '–'}</strong>
              <span>paid to humans</span>
            </div>
            <div>
              <strong>{activity.data ? formatHbar(activity.data.payouts.owedTinybars) : '–'}</strong>
              <span>owed</span>
            </div>
            <div>
              <strong>{activity.data?.payouts.batches ?? '–'}</strong>
              <span>batches</span>
            </div>
          </div>
          {(activity.data?.payouts.recent ?? []).map((p) => (
            <PayoutRow key={p.id} p={p} />
          ))}
          <p className="muted small">
            Verified reporters whose live reports another human corroborated share{' '}
            {activity.data?.payouts.reporterSharePercent ?? '…'}% of each paid query, sent in one batched
            Hedera transfer.
          </p>
        </section>

        {verification && <VerificationPanel v={verification} />}

        <section>
          <h3>Agent queries</h3>
          {queries.length === 0 && <p className="muted small">None yet. Run: npm run agent</p>}
          {queries.map((q) => (
            <QueryCard
              key={q.id}
              q={q}
              v={verification}
              onSelect={() => setFlyTo({ lat: q.lat, lng: q.lng })}
            />
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

function FlyTo({ target }: { target: (Point & { zoom?: number }) | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? 16, { duration: 0.8 });
  }, [map, target]);
  return null;
}

function ReportPopup({ report: r, onDone }: { report: LiveReport; onDone: (n: Notice) => void }) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const info = levelInfo(r.level);
  useMyVotes(); // re-render as soon as a vote is remembered
  const blocked = voteBlocker(session, r);
  const voted = sessionVote(session, r);

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
        {busy ? (
          <span className="muted small">Writing to Arkiv…</span>
        ) : voted ? (
          <span className={`vote-done ${voted}`}>
            {voted === 'confirm' ? '✓ You confirmed' : voted === 'dispute' ? '✕ You disputed' : '✓ You voted'}
          </span>
        ) : blocked ? (
          <span className="muted small">{blocked}</span>
        ) : (
          <>
            <button className="vote-confirm" onClick={() => vote('confirm')}>
              Confirm
            </button>
            <button className="vote-dispute" onClick={() => vote('dispute')}>
              Dispute
            </button>
          </>
        )}
      </div>
      {msg && <p className={`notice ${msg.kind} small`}>{msg.text}</p>}
    </div>
  );
}

function DraftPopup({ at, noData, onDone }: { at: Point; noData: boolean; onDone: (n: Notice) => void }) {
  const { session } = useSession();
  const [busy, setBusy] = useState<Level | null>(null);
  const [error, setError] = useState<string | null>(null);
  const note = noData && <p className="nodata-note">No data here: unknown, not dry.</p>;

  if (!session) {
    return (
      <div className="popup">
        {note}
        <p className="small">Verify in the side panel first, then click the map to report.</p>
      </div>
    );
  }
  if (session.method === 'world') {
    // A verified human's report must come from where they actually are.
    return (
      <div className="popup">
        {note}
        <p className="small">
          Live reports come from where you stand: open{' '}
          <button className="link" onClick={() => navigate('/report')}>
            Report
          </button>{' '}
          at the spot (while testing, pick a test location in the top bar).
        </p>
      </div>
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
      {note}
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

function PayoutRow({ p }: { p: PayoutBatch }) {
  return (
    <p className="small">
      <span
        className={`badge ${p.status === 'settled' ? 'paid' : p.status === 'failed' ? 'failed' : 'unpaid'}`}
      >
        {p.status}
      </span>{' '}
      {formatHbar(p.totalTinybars)} to {p.recipients} {p.recipients === 1 ? 'human' : 'humans'} ·{' '}
      {timeAgo(p.settledAt ?? p.createdAt)}
      {p.hashscan && (
        <>
          {' · '}
          <a href={p.hashscan} target="_blank" rel="noreferrer">
            HashScan
          </a>
        </>
      )}
      {p.error && <span className="muted"> · {p.error}</span>}
    </p>
  );
}

type EnabledVerification = Extract<Verification, { enabled: true }>;

/** Independent check: Chainlink CRE recomputed every area from public Arkiv evidence. */
function VerificationPanel({ v }: { v: EnabledVerification }) {
  const { areas, match, mismatch } = v.summary;
  const differing = v.areas.filter((a) => a.status === 'mismatch');
  return (
    <section className="verify-panel">
      <h3>Independent verification</h3>
      <div className="verify-line">
        <span className={`verify-score ${mismatch ? 'bad' : 'ok'}`}>
          {match}/{areas}
        </span>
        <span>
          areas match <strong>Chainlink CRE</strong>
          <br />
          <span className="muted">
            attested {Math.round(v.ageMin)} min ago from {v.reports} reports, {v.votes} votes ·{' '}
            <a href={v.contractUrl} target="_blank" rel="noreferrer">
              Sepolia contract
            </a>
          </span>
        </span>
      </div>
      {differing.length > 0 && (
        <ul>
          {differing.map((a) => (
            <li key={a.cell}>
              ⚠ {a.cell}: KneeDeep says {levelInfo(a.kneedeep?.level ?? null)?.label ?? 'contested'}, CRE
              computed {levelInfo(a.attested.level)?.label ?? 'contested'}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        A Chainlink DON reads the reports straight from Arkiv, not from KneeDeep, recomputes every area and
        agrees on the result. It proves what the public evidence says, not that the reports are true.
      </p>
    </section>
  );
}

function QueryCard({
  q,
  v,
  onSelect,
}: {
  q: AgentQuery;
  v: EnabledVerification | null;
  onSelect: () => void;
}) {
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
            {worst.passability && (
              <span className={`pass-pill ${worst.passability}`} title={worst.passabilityReason}>
                {PASSABILITY[worst.passability].label}
              </span>
            )}
            <CreBadge v={v} cell={worst.cell} level={worst.level} />
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
        {q.reportsUsed} report(s) used, {q.corroboratedUsed} corroborated
        {q.reportersCredited > 0 && `, ${q.reportersCredited} reporter(s) credited`} · data: {q.dataStatus}
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
